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

    // Experience/background: prefer the extracted CV text, cleaned into paragraphs.
    let bodyParas = [];
    if (c.cvText && c.cvText.trim().length > 40) {
      bodyParas = c.cvText
        .replace(/\r/g, "")
        .split(/\n{2,}|(?<=\.)\s*\n/)        // blank lines / hard breaks after sentences
        .map(p => clean(p.replace(/\n/g, " ")))
        .filter(p => p.length > 1);
    } else {
      bodyParas = [
        `Most recent role: ${clean(c.job) || "—"}${c.industry ? " (" + clean(c.industry) + ")" : ""}.`,
        c.years ? `Experience: ${clean(c.years).replace("-", "–")} years${c.seniority ? ", " + clean(c.seniority) + " level" : ""}.` : "",
      ].filter(Boolean);
    }

    return {
      id: c.appId || c.id || "",
      name: clean(c.name) || "Candidate",
      roleLine,
      contact,
      summary: clean(c.bio),
      skills: (c.skills || []).map(clean).filter(Boolean),
      body: bodyParas,
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
      const lines = doc.splitTextToSize(t, PW - 2 * M);
      const lh = (opts.size || 10.5) * 1.4;
      lines.forEach(line => { need(lh); doc.text(line, M, y); y += lh; });
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
    if (data.body.length) { heading("Experience & Background"); data.body.forEach(p => { para(p); y += 6; }); }

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

    function section(title, paras) {
      children.push(new Paragraph({
        spacing: { before: 200, after: 80 },
        border: { bottom: { color: BLUE, style: BorderStyle.SINGLE, size: 6 } },
        children: [new TextRun({ text: title.toUpperCase(), bold: true, color: BLUE, size: 20 })],
      }));
      paras.forEach(p => children.push(new Paragraph({
        spacing: { after: 100 }, children: [new TextRun({ text: p, size: 21, color: "191E30" })],
      })));
    }
    if (data.summary) section("Professional Summary", [data.summary]);
    if (data.skills.length) section("Core Skills", [data.skills.join("   ·   ")]);
    if (data.body.length) section("Experience & Background", data.body);

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
