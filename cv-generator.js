/* ============================================================================
 * RydeQuest — ATS CV reformatter
 * Turns a candidate's parsed profile into a clean, ATS-friendly CV in BOTH
 * .docx and PDF, branded with the RydeQuest logo + a subtle watermark.
 *
 * Usage (after including this file):
 *     RQCV.setLogo(dataUrl)             // optional: override the default logo
 *     await RQCV.generate(candidate, { download:true })   // makes + downloads both
 *     const { pdfDataUrl } = await RQCV.generate(candidate, { download:false })
 *
 * Dependencies (lazy-loaded from CDN on first use): jsPDF + docx.
 * No server, no build step — pure browser.
 * ========================================================================== */
(function (global) {
  "use strict";

  // ── Default RydeQuest wordmark (swap by uploading a logo in the admin). ──────
  // Brand navy #0a1e5e / blue #0052ff. Replace DEFAULT_LOGO_SVG with the real
  // logo, or set one at runtime via RQCV.setLogo(dataUrl).
  // RydeQuest brand teal. The official wordmark, recreated as SVG (swap for the
  // exact file via RQCV.setLogo or the admin "Set RydeQuest logo" control).
  const BRAND_TEAL = "#12B886";
  const DEFAULT_LOGO_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="760" height="180" viewBox="0 0 760 180">' +
    '<g fill="' + BRAND_TEAL + '">' +
    '<circle cx="66" cy="52" r="15"/>' +
    '<rect x="80" y="58" width="30" height="88" rx="15" transform="rotate(20 95 102)"/>' +
    '</g>' +
    '<text x="166" y="128" font-family="Arial,Helvetica,sans-serif" font-size="104" ' +
    'font-weight="800" letter-spacing="-3" fill="' + BRAND_TEAL + '">RydeQuest</text>' +
    '</svg>';

  const LOGO_KEY = "rq_brand_logo";
  const CDN = {
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    docx: "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js",
  };

  // ── small utils ─────────────────────────────────────────────────────────────
  function loadScript(src) {
    return new Promise((res, rej) => {
      if ([...document.scripts].some(s => s.src === src)) return res();
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }
  async function ensureLibs(needPdf) {
    if (!global.docx) await loadScript(CDN.docx);
    if (needPdf && !(global.jspdf && global.jspdf.jsPDF)) await loadScript(CDN.jspdf);
  }
  function clean(s) { return String(s || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").trim(); }
  function svgToDataUrl(svg) { return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))); }

  // Rasterize any logo (svg/png/jpg dataURL) to a PNG dataURL at a target width.
  // `alpha` < 1 produces a faded copy for the watermark.
  function rasterize(srcDataUrl, targetW, alpha) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = targetW / img.width;
        const c = document.createElement("canvas");
        c.width = targetW; c.height = Math.max(1, Math.round(img.height * scale));
        const ctx = c.getContext("2d");
        if (alpha != null) ctx.globalAlpha = alpha;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve({ dataUrl: c.toDataURL("image/png"), w: c.width, h: c.height });
      };
      img.onerror = () => resolve(null);
      img.src = srcDataUrl;
    });
  }

  function getLogoSource() {
    try { const v = localStorage.getItem(LOGO_KEY); if (v) return v; } catch (e) {}
    return svgToDataUrl(DEFAULT_LOGO_SVG);
  }

  // ── CV-section parsing ───────────────────────────────────────────────────────
  // Map common CV headings → a clean display title (or a control token).
  const HEADING_MAP = {
    "experience": "Experience", "work experience": "Experience", "professional experience": "Experience",
    "employment": "Experience", "employment history": "Experience", "work history": "Experience",
    "career history": "Experience", "career summary": "__summary__", "professional background": "Experience",
    "education": "Education", "academic": "Education", "academic background": "Education",
    "education and qualifications": "Education", "educational qualifications": "Education", "qualifications": "Education",
    "certifications": "Certifications", "certification": "Certifications", "certificates": "Certifications",
    "licenses": "Certifications", "licences": "Certifications", "training": "Training & Certifications",
    "courses": "Training & Certifications", "professional development": "Training & Certifications",
    "projects": "Projects", "key projects": "Projects", "selected projects": "Projects",
    "achievements": "Achievements", "accomplishments": "Achievements", "key achievements": "Achievements", "awards": "Achievements",
    "languages": "Languages",
    "summary": "__summary__", "professional summary": "__summary__", "profile": "__summary__",
    "personal profile": "__summary__", "about": "__summary__", "about me": "__summary__",
    "objective": "__summary__", "career objective": "__summary__",
    "skills": "__skip__", "technical skills": "__skip__", "key skills": "__skip__", "core skills": "__skip__",
    "core competencies": "__skip__", "competencies": "__skip__", "areas of expertise": "__skip__", "expertise": "__skip__",
    "references": "__skip__", "personal details": "__skip__", "personal information": "__skip__",
    "contact": "__skip__", "contact details": "__skip__", "declaration": "__skip__", "interests": "__skip__",
    "hobbies": "__skip__", "nationality": "__skip__",
  };
  function headingOf(line) {
    const norm = clean(line).toLowerCase().replace(/[:|.–—-]+\s*$/, "").replace(/[^a-z &]/g, " ").replace(/\s+/g, " ").trim();
    if (!norm || norm.length > 36) return null;
    return HEADING_MAP[norm] || null;
  }

  // Split the extracted CV text into clean, headed sections of bullet lines.
  function parseSections(cvText, excludeStrings) {
    const raw = String(cvText || "").replace(/\r/g, "");
    let lines = raw.split(/\n+/).map(l => clean(l)).filter(Boolean);
    // Flattened text (e.g. migrated single-line records) → break into chunks.
    if (lines.length <= 2) {
      let parts = raw.split(/\s*[•·▪‣|]\s*|\s{3,}/).map(s => clean(s)).filter(Boolean);
      if (parts.length <= 2) parts = raw.split(/(?<=[.;])\s+(?=[A-Z0-9])/).map(s => clean(s)).filter(Boolean);
      lines = parts;
    }
    const ex = (excludeStrings || []).map(s => s.toLowerCase()).filter(s => s.length > 3);
    const isNoise = (l) => {
      const low = l.toLowerCase();
      if (l.length < 3) return true;
      if (/^[\d\W_]+$/.test(l)) return true;                  // pure numbers/symbols
      if (ex.some(x => low === x || low.includes(x))) return true;  // echoed contact info
      if (/^(curriculum vitae|resume|cv)$/i.test(l)) return true;
      return false;
    };

    const sections = []; let cur = null; const preamble = []; let summaryText = "";
    for (const l of lines) {
      const h = headingOf(l);
      if (h === "__skip__") { cur = { skip: true, bullets: [] }; continue; }
      if (h === "__summary__") { cur = { summary: true, bullets: [] }; continue; }
      if (h) { cur = { title: h, bullets: [] }; sections.push(cur); continue; }
      if (cur && cur.skip) continue;
      if (isNoise(l)) continue;
      if (cur && cur.summary) { summaryText += (summaryText ? " " : "") + l; continue; }
      if (cur) cur.bullets.push(l); else preamble.push(l);
    }
    // Trim/cap each section's bullets.
    const tidy = (arr) => arr.map(b => b.replace(/^[•·▪‣*\-\s]+/, "").trim()).filter(b => b.length > 1).slice(0, 14);
    const real = sections.map(s => ({ title: s.title, bullets: tidy(s.bullets) })).filter(s => s.bullets.length);

    return { sections: real, preamble: tidy(preamble), summaryText: clean(summaryText) };
  }

  // ── shape the candidate into ATS sections ───────────────────────────────────
  function prepareData(c) {
    const contact = [
      (c.city ? c.city + ", " : "") + (c.country || ""),
      c.email, c.phone,
      c.linkedin ? (c.linkedin.replace(/^https?:\/\//, "")) : "",
    ].map(clean).filter(Boolean);

    const roleLine = [
      c.job, c.seniority, c.years ? (c.years.replace("-", "–") + " yrs") : "", c.industry,
    ].map(clean).filter(Boolean).join("  ·  ");

    // Parse the raw CV text into structured, de-duplicated sections.
    const exclude = [c.name, c.email, c.phone, c.linkedin, c.city, c.country].map(s => clean(s || "")).filter(Boolean);
    const parsed = (c.cvText && c.cvText.trim().length > 40)
      ? parseSections(c.cvText, exclude)
      : { sections: [], preamble: [], summaryText: "" };

    // Summary: candidate bio, else a summary heading from the CV, else nothing.
    let summary = clean(c.bio) || parsed.summaryText || "";

    // Build the section list. If headings were detected, use them; otherwise put
    // the cleaned content under a single "Experience & Background" section.
    let sections = parsed.sections;
    if (!sections.length) {
      const fallback = parsed.preamble.length ? parsed.preamble : [
        `Most recent role: ${clean(c.job) || "—"}${c.industry ? " (" + clean(c.industry) + ")" : ""}.`,
        c.years ? `Experience: ${clean(c.years).replace("-", "–")} years${c.seniority ? ", " + clean(c.seniority) + " level" : ""}.` : "",
      ].filter(Boolean);
      if (fallback.length) sections = [{ title: "Experience & Background", bullets: fallback }];
    } else if (parsed.preamble.length && !summary) {
      // Loose lines before the first heading become the summary when we lack a bio.
      summary = parsed.preamble.join(" ").slice(0, 600);
    }

    return {
      id: c.appId || c.id || "",
      name: clean(c.name) || "Candidate",
      roleLine,
      contact,
      summary,
      skills: (c.skills || []).map(clean).filter(Boolean),
      sections,
      date: new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
    };
  }

  // ── PDF (jsPDF) ──────────────────────────────────────────────────────────────
  function buildPdf(data, logoPng, logoDims, watermarkPng, wmDims) {
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const PW = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const M = 48;
    let y = M;

    const NAVY = [16, 58, 51], BLUE = [18, 184, 134], GREY = [80, 95, 118], DARK = [25, 30, 48];

    function watermark() {
      if (!watermarkPng) return;
      const w = PW * 0.6, h = w * (wmDims.h / wmDims.w);
      try { doc.addImage(watermarkPng, "PNG", (PW - w) / 2, (PH - h) / 2, w, h); } catch (e) {}
    }
    function newPage() { doc.addPage(); y = M; watermark(); }
    function need(h) { if (y + h > PH - M) newPage(); }
    function rule() { doc.setDrawColor(195, 197, 217); doc.setLineWidth(0.8); doc.line(M, y, PW - M, y); y += 14; }
    function heading(t) {
      need(34); y += 6;
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...BLUE);
      doc.text(t.toUpperCase(), M, y); y += 6;
      doc.setDrawColor(...BLUE); doc.setLineWidth(1.2); doc.line(M, y, M + 38, y); y += 14;
    }
    function para(t, opts) {
      opts = opts || {};
      doc.setFont("helvetica", opts.bold ? "bold" : "normal");
      doc.setFontSize(opts.size || 10.5);
      doc.setTextColor(...(opts.color || DARK));
      const indent = opts.indent || 0;
      const lines = doc.splitTextToSize(t, PW - 2 * M - indent);
      const lh = (opts.size || 10.5) * 1.4;
      lines.forEach((line, i) => {
        need(lh);
        if (opts.bullet && i === 0) { doc.setTextColor(...BLUE); doc.text("•", M, y); doc.setTextColor(...(opts.color || DARK)); }
        doc.text(line, M + indent, y); y += lh;
      });
    }

    watermark();

    // header: logo
    if (logoPng) {
      const lw = 150, lh = lw * (logoDims.h / logoDims.w);
      try { doc.addImage(logoPng, "PNG", M, y, lw, lh); } catch (e) {}
      y += lh + 10;
    }
    // name + role
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(...NAVY);
    doc.text(data.name, M, y); y += 22;
    if (data.roleLine) { doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(...GREY); doc.text(data.roleLine, M, y); y += 16; }
    if (data.contact.length) { doc.setFontSize(9.5); doc.setTextColor(...GREY); doc.text(data.contact.join("   ·   "), M, y); y += 12; }
    y += 4; rule();

    if (data.summary) { heading("Professional Summary"); para(data.summary); y += 4; }
    if (data.skills.length) { heading("Core Skills"); para(data.skills.join("   ·   ")); y += 4; }
    (data.sections || []).forEach(sec => {
      if (!sec.bullets || !sec.bullets.length) return;
      heading(sec.title);
      sec.bullets.forEach(b => { para(b, { bullet: true, indent: 14 }); y += 3; });
      y += 4;
    });

    // footer on every page
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GREY);
      doc.text(`Reformatted by RydeQuest · ${data.date}${data.id ? " · Ref " + data.id : ""}`, M, PH - 24);
      doc.text(`${i} / ${pages}`, PW - M, PH - 24, { align: "right" });
    }
    return doc.output("blob");
  }

  // ── DOCX (docx) — pure builder so it can be unit-tested in Node ──────────────
  function buildDocxDocument(docx, data, logoBytes, logoDims, wmBytes, wmDims) {
    const {
      Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
      ImageRun, BorderStyle, Header, Footer,
    } = docx;
    const NAVY = "123A33", BLUE = "12B886", GREY = "505F76";

    const children = [];
    children.push(new Paragraph({ children: [new TextRun({ text: data.name, bold: true, size: 40, color: NAVY })] }));
    if (data.roleLine) children.push(new Paragraph({ children: [new TextRun({ text: data.roleLine, size: 22, color: GREY })] }));
    if (data.contact.length) children.push(new Paragraph({ children: [new TextRun({ text: data.contact.join("   ·   "), size: 18, color: GREY })], spacing: { after: 160 } }));

    function sectionHead(title) {
      children.push(new Paragraph({
        spacing: { before: 200, after: 80 },
        border: { bottom: { color: BLUE, style: BorderStyle.SINGLE, size: 6 } },
        children: [new TextRun({ text: title.toUpperCase(), bold: true, color: BLUE, size: 20 })],
      }));
    }
    function section(title, paras) {
      sectionHead(title);
      paras.forEach(p => children.push(new Paragraph({
        spacing: { after: 100 }, children: [new TextRun({ text: p, size: 21, color: "191E30" })],
      })));
    }
    function bulletSection(title, bullets) {
      sectionHead(title);
      bullets.forEach(b => children.push(new Paragraph({
        bullet: { level: 0 }, spacing: { after: 60 },
        children: [new TextRun({ text: b, size: 21, color: "191E30" })],
      })));
    }
    if (data.summary) section("Professional Summary", [data.summary]);
    if (data.skills.length) section("Core Skills", [data.skills.join("   ·   ")]);
    (data.sections || []).forEach(sec => { if (sec.bullets && sec.bullets.length) bulletSection(sec.title, sec.bullets); });

    // header logo (branding on every page)
    const headerChildren = [];
    if (logoBytes) headerChildren.push(new Paragraph({
      children: [new ImageRun({ data: logoBytes, transformation: { width: 150, height: Math.round(150 * (logoDims.h / logoDims.w)) } })],
    }));
    // watermark: faded logo floating behind the text, centred
    if (wmBytes) headerChildren.push(new Paragraph({
      children: [new ImageRun({
        data: wmBytes,
        transformation: { width: 360, height: Math.round(360 * (wmDims.h / wmDims.w)) },
        floating: {
          horizontalPosition: { relative: "page", align: "center" },
          verticalPosition: { relative: "page", align: "center" },
          behindDocument: true,
        },
      })],
    }));

    const footer = new Footer({
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `Reformatted by RydeQuest · ${data.date}${data.id ? " · Ref " + data.id : ""}`, size: 16, color: GREY })],
      })],
    });

    return new Document({
      creator: "RydeQuest", title: `${data.name} — CV`,
      sections: [{
        properties: {},
        headers: { default: new Header({ children: headerChildren.length ? headerChildren : [new Paragraph("")] }) },
        footers: { default: footer },
        children,
      }],
    });
  }

  async function buildDocxBlob(data, logoPngDataUrl, logoDims, wmPngDataUrl, wmDims) {
    const docx = global.docx;
    const toBytes = async (u) => u ? new Uint8Array(await (await fetch(u)).arrayBuffer()) : null;
    const logoBytes = await toBytes(logoPngDataUrl);
    const wmBytes = await toBytes(wmPngDataUrl);
    const doc = buildDocxDocument(docx, data, logoBytes, logoDims, wmBytes, wmDims);
    return docx.Packer.toBlob(doc);
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  const blobToDataUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  const slug = (s) => String(s || "candidate").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  // ── public API ──────────────────────────────────────────────────────────────
  const RQCV = {
    setLogo(dataUrl) { try { localStorage.setItem(LOGO_KEY, dataUrl); } catch (e) {} },
    clearLogo() { try { localStorage.removeItem(LOGO_KEY); } catch (e) {} },
    hasCustomLogo() { try { return !!localStorage.getItem(LOGO_KEY); } catch (e) { return false; } },

    async generate(candidate, opts) {
      opts = opts || {};
      const wantPdf = !!opts.includePdf;            // Word (.docx) is the default deliverable
      await ensureLibs(wantPdf);
      const data = prepareData(candidate);
      const src = getLogoSource();
      const logo = await rasterize(src, 600);                 // crisp header logo
      const wm = await rasterize(src, 600, 0.08);             // faded watermark
      const logoDims = logo ? { w: logo.w, h: logo.h } : { w: 1, h: 1 };
      const wmDims = wm ? { w: wm.w, h: wm.h } : { w: 1, h: 1 };

      const docxBlob = await buildDocxBlob(data, logo && logo.dataUrl, logoDims, wm && wm.dataUrl, wmDims);
      const pdfBlob = wantPdf ? buildPdf(data, logo && logo.dataUrl, logoDims, wm && wm.dataUrl, wmDims) : null;

      const base = slug(data.name) + "_RydeQuest_CV";
      if (opts.download !== false) { download(docxBlob, base + ".docx"); if (pdfBlob) download(pdfBlob, base + ".pdf"); }

      const out = { docxBlob, pdfBlob, filenameBase: base };
      if (opts.wantDataUrls) { out.docxDataUrl = await blobToDataUrl(docxBlob); if (pdfBlob) out.pdfDataUrl = await blobToDataUrl(pdfBlob); }
      return out;
    },

    // exposed for tests
    _prepareData: prepareData,
    _buildDocxDocument: buildDocxDocument,
    _buildPdf: buildPdf,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = RQCV;
  global.RQCV = RQCV;
})(typeof window !== "undefined" ? window : globalThis);
