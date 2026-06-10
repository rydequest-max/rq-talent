/* Shared CV parser — extracted from index.html so admin.html can reuse the exact
   same extraction + profile heuristics for bulk add. Exposes window.RQParse. */
(function () {
"use strict";
const COUNTRIES = ["Afghanistan","Albania","Algeria","Andorra","Angola","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada","Cape Verde","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo (Brazzaville)","Congo (DRC)","Costa Rica","Côte d'Ivoire","Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hong Kong","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Macao","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Puerto Rico","Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"];
const readAsDataURL = file => new Promise((res, rej) => { const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
const readAsArrayBuffer = file => new Promise((res, rej) => { const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsArrayBuffer(file); });
const readAsText = file => new Promise((res, rej) => { const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsText(file); });
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load a required component (' + src.split('/').pop() + '). Check your connection and retry.')); document.head.appendChild(s); });

/* Set during PDF extraction: the text of the largest-font line near the top of
   page 1. On almost every CV template that line is the candidate's name. */
let cvNameHint = '';

function groupLines(items) {
  const pts = items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], h: it.height || Math.abs(it.transform[3]) || 10 }));
  pts.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = []; let cur = null, curY = null;
  for (const p of pts) {
    const tol = Math.max(2, (p.h || 10) * 0.6);
    if (curY === null || Math.abs(p.y - curY) > tol) { cur = { items: [], y: p.y, h: 0 }; lines.push(cur); curY = p.y; }
    cur.items.push(p); cur.h = Math.max(cur.h, p.h);
  }
  return lines;
}

/* The biggest-font line in the top ~45% of the page — the name on most CVs. */
function topBiggestLine(items) {
  const lines = groupLines(items);
  if (!lines.length) return '';
  const ys = lines.map(l => l.y), maxY = Math.max(...ys), minY = Math.min(...ys);
  const cut = maxY - (maxY - minY) * 0.45;
  const pool = lines.filter(l => l.y >= cut);
  const use = pool.length ? pool : lines.slice(0, 3);
  use.sort((a, b) => b.h - a.h);
  const best = use[0];
  if (!best) return '';
  // Keep only the largest-font fragments on that line — drops a smaller location or
  // contact prefix sharing the same baseline (e.g. "Doha, Qatar  HATZIDI RIVAS").
  const big = best.items.filter(p => p.h >= best.h * 0.82);
  const keep = (big.length ? big : best.items).slice().sort((a, b) => a.x - b.x);
  return keep.map(p => p.s).join(' ').replace(/\s+/g, ' ').trim();
}

/* pdf.js returns text items in PDF content-stream order, which on designed CVs
   (sidebars, headers, two-column layouts) is jumbled. Reconstruct visual reading
   order from each item's x/y position so the name/header lands at the top. */
function itemsToReadingOrder(items) {
  const pts = items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], h: it.height || Math.abs(it.transform[3]) || 10 }));
  if (!pts.length) return '';
  pts.sort((a, b) => (b.y - a.y) || (a.x - b.x));   // top-to-bottom, then left-to-right
  const lines = []; let cur = null, curY = null;
  for (const p of pts) {
    const tol = Math.max(2, (p.h || 10) * 0.6);
    if (curY === null || Math.abs(p.y - curY) > tol) { cur = []; lines.push(cur); curY = p.y; }
    cur.push(p);
  }
  return lines
    .map(line => { line.sort((a, b) => a.x - b.x); return line.map(p => p.s).join(' ').replace(/\s+/g, ' ').trim(); })
    .filter(Boolean)
    .join('\n');
}

async function extractCVText(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'txt') return await readAsText(file);
  if (ext === 'pdf') {
    if (!window.pdfjsLib) {
      // pdf.js v4+ is ESM-only (no pdf.min.js UMD build on cdnjs -> 404). Pin to the
      // last v3 release, which ships the classic script that exposes window.pdfjsLib.
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const buf = await readAsArrayBuffer(file);
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const parts = [];
    cvNameHint = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const c = await page.getTextContent();
      if (i === 1) cvNameHint = topBiggestLine(c.items);
      parts.push(itemsToReadingOrder(c.items));
    }
    return parts.join('\n');
  }
  if (ext === 'docx' || ext === 'doc') {
    if (!window.mammoth) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
    const buf = await readAsArrayBuffer(file);
    const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
    return result.value || '';
  }
  return '';
}

/* Local heuristic CV parser */
const KNOWN_SKILLS = ["AWS","GCP","Azure","Kubernetes","Docker","Terraform","Ansible","Python","Java","Go","JavaScript","TypeScript","React","Next.js","Node.js","Vue","Swift","Kotlin","SQL","PostgreSQL","MySQL","MongoDB","Snowflake","BigQuery","dbt","Airflow","TensorFlow","PyTorch","LLM","LLMs","Selenium","Cypress","Playwright","Git","Linux","Prometheus","Grafana","Datadog","Tableau","Power BI","Looker","SAP","Salesforce","HubSpot","Workday","Oracle","R","Excel","Figma","Sketch","BIM","AutoCAD","Revit","Tekla","Petrel","ECLIPSE","NEBOSH","IOSA","PCI-DSS","SOC 2","HIPAA","GDPR","AML","KYC","CFA","CPA","ACCA","PMP","Prince2","PRINCE2","Scrum","Agile","Lean","Six Sigma","Reservoir engineering","Process safety","LNG","Solar PV","Wind","Renewable","Project finance","Programme management","Project management","Operations","Supply chain","Procurement","Logistics","Last-mile","P&L","M&A","Corporate finance","Equity","Treasury","FX","Risk","Compliance","Sanctions","Payments","Cards","Stripe","Paystack","Flutterwave","M-Pesa","Mobile money","Performance marketing","Meta Ads","Google Ads","SEO","SEM","Brand","CRM","Marketing automation","D2C","Shopify","Salesforce CRM","Arabic","French","Spanish","German","Italian","Portuguese","Mandarin","Cantonese","Hindi","Urdu","Bengali","Tamil","Swahili","Yoruba","Hausa","Igbo","Amharic","Farsi","Turkish","Hebrew","Russian","Japanese","Korean","Vietnamese","Thai","Malay","Indonesian","Turbomachinery","Turbine","Compressor","Rotating equipment","Pump","QA/QC","Quality Control","Quality Assurance","NDT","Radiography","Ultrasonic","Magnetic particle","Dye penetrant","ASNT","CSWIP","NACE","AWS CWI","Visual inspection","Dimensional inspection","CMM","FARO","Micrometer","Fits and tolerances","Machining","CNC","Machine shop","Welding inspection","Welding","Piping","Structural","Mechanical","Hydrotest","Shutdown","Turnaround","Pressure vessel","Heat treatment","Coating inspection","API 510","API 570","API 653","API 1104","API 5CT","ASME","Thread inspection"];
const INDUSTRY_KEYWORDS = {
  "Technology / Software": ["software","engineer","developer","programmer","architect","aws","kubernetes","cloud","backend","frontend","full-stack","devops","sre","machine learning","ml engineer","data scientist","ai","tech lead","cto"],
  "Financial Services / Fintech": ["fintech","payments","banking","bank","trading","quant","credit","loans","compliance","aml","kyc","cfa","wealth","insurance","actuary","treasury","investment"],
  "Energy / Oil & Gas": ["oil","gas","petroleum","upstream","downstream","drilling","reservoir","lng","refinery","hse","permit-to-work","wellhead","subsea"],
  "Renewables / Cleantech": ["renewable","solar","wind","cleantech","photovoltaic","pv","green hydrogen","carbon","sustainability","ev","battery"],
  "Construction / Infrastructure": ["construction","civil engineer","structural","contractor","fidic","tekla","autocad","revit","bim","mega-project","infrastructure","concrete","quantity surveyor","qs"],
  "Real Estate / PropTech": ["real estate","property","leasing","valuation","brokerage","reit","proptech"],
  "Healthcare / Pharma": ["medical","doctor","physician","nurse","clinical","pharmacy","pharmacist","pharma","hospital","gcp","trial","biotech","healthcare"],
  "Education / EdTech": ["teacher","educator","curriculum","instructional","university","school","edtech","faculty","lecturer","training"],
  "Manufacturing / Industrial": ["manufacturing","production","plant","factory","lean","six sigma","quality engineer","industrial","assembly"],
  "Logistics / Supply Chain": ["logistics","supply chain","warehouse","procurement","fleet","last-mile","freight","forwarding","sap"],
  "Retail / E-commerce": ["retail","e-commerce","ecommerce","d2c","shopify","store manager","merchandising","buying","wholesale"],
  "Hospitality / Tourism": ["hospitality","hotel","resort","food & beverage","f&b","tourism","concierge","chef","restaurant"],
  "Telecommunications": ["telecom","telco","5g","4g","ran","fiber","fttx","network engineer","optical"],
  "Media / Marketing / Advertising": ["marketing","advertising","brand","creative","copywriter","social media","seo","sem","performance marketing","content","journalist","editor"],
  "Aviation / Aerospace": ["pilot","airline","aviation","aerospace","aircraft","cabin crew","iosa","flight"],
  "Public Sector / Government": ["government","ministry","public sector","policy","civil service","municipality"],
  "NGO / Development": ["ngo","non-profit","nonprofit","development","unicef","unhcr","humanitarian","cso"],
  "Consulting / Professional Services": ["consultant","consulting","strategy","advisory","big four","big 4","mckinsey","bcg","bain","ey","kpmg","pwc","deloitte"],
  "Agriculture / Food": ["agriculture","agritech","farming","crops","livestock","food production"],
  "Legal": ["lawyer","attorney","solicitor","barrister","paralegal","counsel","llb","jd"],
};
const DEMONYM_TO_COUNTRY = {"emirati":"United Arab Emirates","saudi":"Saudi Arabia","qatari":"Qatar","kuwaiti":"Kuwait","bahraini":"Bahrain","omani":"Oman","egyptian":"Egypt","moroccan":"Morocco","tunisian":"Tunisia","nigerian":"Nigeria","ghanaian":"Ghana","kenyan":"Kenya","ethiopian":"Ethiopia","cameroonian":"Cameroon","south african":"South Africa","lebanese":"Lebanon","jordanian":"Jordan","indian":"India","pakistani":"Pakistan","british":"United Kingdom","american":"United States","german":"Germany","italian":"Italy","singaporean":"Singapore","malaysian":"Malaysia"};
const MAJOR_CITY_TO_COUNTRY = {"dubai":"United Arab Emirates","abu dhabi":"United Arab Emirates","sharjah":"United Arab Emirates","riyadh":"Saudi Arabia","jeddah":"Saudi Arabia","dammam":"Saudi Arabia","doha":"Qatar","ras laffan":"Qatar","kuwait city":"Kuwait","manama":"Bahrain","muscat":"Oman","cairo":"Egypt","alexandria":"Egypt","casablanca":"Morocco","rabat":"Morocco","marrakech":"Morocco","tunis":"Tunisia","khartoum":"Sudan","lagos":"Nigeria","abuja":"Nigeria","accra":"Ghana","dakar":"Senegal","douala":"Cameroon","nairobi":"Kenya","mombasa":"Kenya","addis ababa":"Ethiopia","kampala":"Uganda","dar es salaam":"Tanzania","johannesburg":"South Africa","cape town":"South Africa","durban":"South Africa","beirut":"Lebanon","amman":"Jordan","mumbai":"India","new delhi":"India","delhi":"India","bengaluru":"India","bangalore":"India","chennai":"India","hyderabad":"India","pune":"India","karachi":"Pakistan","lahore":"Pakistan","london":"United Kingdom","manchester":"United Kingdom","new york":"United States","san francisco":"United States","berlin":"Germany","hamburg":"Germany","paris":"France","rome":"Italy","madrid":"Spain","amsterdam":"Netherlands","singapore":"Singapore","kuala lumpur":"Malaysia"};

/* Words that are never part of a person's name — job titles, CV section headers,
   contact labels. Used to stop name detection from swallowing the role that often
   sits right after the name on the same line (e.g. "SEYED HIFAZ Materials Planner"). */
const NAME_STOP = new Set(['curriculum','vitae','resume','cv','profile','personal','contact','address','phone','email','mobile','tel','telephone','nationality','dob','date','birth','gender','objective','summary','professional','career','experience','education','skills','skill','work','employment','history','references','reference','certification','certifications','certificate','languages','language','projects','project','achievements','interests','hobbies','declaration','technical','key','areas','area','expertise','competencies','competency','about','me','manager','engineer','senior','junior','lead','principal','staff','director','officer','specialist','analyst','consultant','developer','designer','executive','coordinator','supervisor','technician','administrator','accountant','architect','planner','materials','operations','sales','marketing','finance','financial','procurement','logistics','programme','program','head','chief','president','vice','assistant','associate','intern','trainee','nurse','doctor','physician','teacher','professor','driver','agent','representative','surveyor','quantity','civil','mechanical','electrical','process','petroleum','chemical','structural','site','field','plant','warehouse','supply','chain','business','development','human','resources','talent','acquisition','recruiter','recruitment','operator','floorman','roustabout','derrickman','rigger','welder','fabricator','fitter','foreman','station','acting','attendant','cashier','receptionist','waiter','steward','storekeeper','helper','labourer','laborer','controller','consulting','solutions','solution','partner','partnerships']);

function guessName(t, email) {
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  const titleWord = w => (w === w.toUpperCase() || w === w.toLowerCase())
    ? (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : w;   // SEYED -> Seyed, keep McDonald
  const toTitle = s => s.split(/\s+/).map(p => p.split('-').map(titleWord).join('-')).join(' ');
  const isNameWord = w => /^[\p{Lu}][\p{L}'\-]*$/u.test(w) && !NAME_STOP.has(w.toLowerCase());
  const leadingName = L => {                 // take 2-4 leading name words off a line
    const got = []; let caseClass = null;
    for (const tok of (L || '').replace(/^(?:Dr|Mr|Ms|Mrs|Eng|Prof|Capt|Captain)\.?\s+/i, '').split(/\s+/)) {
      if (!isNameWord(tok)) break;
      const isUpper = tok === tok.toUpperCase();
      if (tok.length > 1) {
        if (got.length >= 2 && caseClass !== null && isUpper !== caseClass) break;
        if (caseClass === null) caseClass = isUpper;
      }
      got.push(tok);
      if (got.length >= 4) break;
    }
    return (got.length >= 2 && got.length <= 4) ? toTitle(got.join(' ')) : '';
  };
  // (0) The largest-font line near the top of the page — the name on most CV templates.
  if (typeof cvNameHint === 'string' && cvNameHint) { const h = leadingName(cvNameHint); if (h) return h; }
  // (1) A line that is ENTIRELY a name (well-formatted CVs).
  for (let i = 0; i < Math.min(12, lines.length); i++) {
    const L = lines[i]; if (L.length > 60) continue;
    if (/@|\+?\d{7,}|linkedin|www\./i.test(L)) continue;
    if (/^(cv|curriculum vitae|resume|profile)$/i.test(L)) continue;
    const cleaned = L.replace(/^(?:Dr|Mr|Ms|Mrs|Eng|Prof|Capt|Captain)\.?\s+/i, '');
    const m = cleaned.match(/^([\p{Lu}][\p{L}'\-]+(?:\s+[\p{Lu}](?:[\p{L}'\-]*\.?)){1,3})$/u);  // allow initials e.g. "Ajith V Gopal"
    if (m && m[1].split(/\s+/).every(isNameWord)) return toTitle(m[1]);
  }
  // (2) Leading name words at the start of an early line, even if the role / contact
  //     details got flattened onto the same line (common after PDF text extraction).
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    const L = lines[i].replace(/^(?:Dr|Mr|Ms|Mrs|Eng|Prof|Capt|Captain)\.?\s+/i, '');
    const got = []; let caseClass = null;   // names are one case style; a switch to
    for (const tok of L.split(/\s+/)) {      // ALL-CAPS often marks the role that follows
      if (!isNameWord(tok)) break;
      const isUpper = tok === tok.toUpperCase();
      if (tok.length > 1) {                  // ignore single-letter initials (e.g. "V")
        if (got.length >= 2 && caseClass !== null && isUpper !== caseClass) break;
        if (caseClass === null) caseClass = isUpper;
      }
      got.push(tok);
      if (got.length >= 4) break;
    }
    if (got.length >= 2 && got.length <= 4) return toTitle(got.join(' '));
  }
  // (3) Last resort: derive from a first.last / first_last email local-part.
  if (email) {
    const lp = email.split('@')[0].replace(/\d+/g, '');
    if (/[._]/.test(lp)) {
      const parts = lp.split(/[._]+/).filter(p => p.length > 1);
      if (parts.length >= 2 && parts.length <= 3) return parts.map(toTitle).join(' ');
    }
  }
  return '';
}

function extractProfileLocal(text) {
  const t = text.replace(/\r/g, '').replace(/ /g, ' ');
  const lower = t.toLowerCase();
  const p = { name:'', email:'', phone:'', country:'', city:'', linkedin:'', industry:'', job:'', years:'6-10', seniority:'Mid', skills:[], bio:'' };
  const em = t.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/); if (em) p.email = em[0];
  const ph = t.match(/(\+?\d[\d\s\-().]{8,}\d)/); if (ph) p.phone = ph[0].replace(/\s+/g, ' ').trim();
  const li = t.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i); if (li) p.linkedin = li[0].replace(/^https?:\/\/(www\.)?/, '');
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  p.name = guessName(t, p.email);
  const headText = lines.slice(0, 6).join('\n');
  const findCity = (txt) => { for (const [c, co] of Object.entries(MAJOR_CITY_TO_COUNTRY)) if (new RegExp('\\b' + c + '\\b', 'i').test(txt)) return { city: c.replace(/\b\w/g, x => x.toUpperCase()), country: co }; return null; };
  const findCountry = (txt) => { for (const c of COUNTRIES) if (new RegExp('\\b' + c.replace(/[^\w\s]/g, '.?') + '\\b', 'i').test(txt)) return c; return null; };
  const findDemonym = (txt) => { for (const [d, c] of Object.entries(DEMONYM_TO_COUNTRY)) if (new RegExp('\\b' + d + '\\b', 'i').test(txt)) return c; return null; };
  const hc = findCity(headText); if (hc) { p.city = hc.city; p.country = hc.country; }
  else {
    const cc = findCountry(headText); if (cc) p.country = cc;
    else {
      const tc = findCity(t); if (tc) { p.city = tc.city; p.country = tc.country; }
      else { const x = findCountry(t) || findDemonym(t); if (x) p.country = x; }
    }
  }
  let bestScore = 0, bestInd = '';
  for (const [ind, kws] of Object.entries(INDUSTRY_KEYWORDS)) {
    let s = 0; for (const kw of kws) { const re = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'); const m = lower.match(re); if (m) s += m.length; }
    if (s > bestScore) { bestScore = s; bestInd = ind; }
  }
  if (bestInd) p.industry = bestInd;
  const titlePat = /\b((?:Senior |Sr\.? |Lead |Principal |Staff |Chief |Head of |VP |Vice President |Director of |Director, |Junior |Jr\.? )?(?:Solutions Architect|Software Engineer|Backend Engineer|Frontend Engineer|Full[- ]?Stack Engineer|Data Engineer|Data Scientist|ML Engineer|DevOps Engineer|SRE|Site Reliability Engineer|Cloud Engineer|Mobile Developer|iOS Developer|Android Developer|QA Engineer|Test Engineer|Product Manager|Project Manager|Programme Manager|Program Manager|Engineering Manager|Operations Manager|Operations Director|Marketing Manager|Brand Manager|Sales Manager|Account Manager|Account Executive|Business Development|Financial Analyst|Quantitative Analyst|Compliance Officer|HR Manager|Talent Acquisition|Recruiter|Designer|UX Designer|UI Designer|Architect|Civil Engineer|Structural Engineer|Mechanical Engineer|Electrical Engineer|Petroleum Engineer|Process Engineer|HSE Manager|Quantity Surveyor|Plant Manager|Warehouse Manager|Supply Chain Analyst|Network Engineer|CTO|CFO|CEO|COO|General Manager|Medical Director|Curriculum Designer|Buying Manager|Hotel General Manager|Airline Operations Manager))\b/i;
  const tm = t.match(titlePat); if (tm) p.job = tm[1].replace(/\s+/g, ' ').trim();
  let yrs = null;
  const ym1 = t.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience/i); if (ym1) yrs = parseInt(ym1[1]);
  if (yrs === null) { const ym2 = t.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s+(?:across|in|building|leading|of|developing|with)/i); if (ym2) yrs = parseInt(ym2[1]); }
  if (yrs !== null) {
    p.years = yrs <= 2 ? '0-2' : yrs <= 5 ? '3-5' : yrs <= 10 ? '6-10' : yrs <= 15 ? '11-15' : '16+';
    p.seniority = yrs <= 2 ? 'Entry' : yrs <= 5 ? 'Mid' : yrs <= 10 ? 'Senior' : yrs <= 15 ? 'Lead' : 'Director';
  }
  if (/\b(cto|ceo|cfo|coo|chief|vp |vice president)\b/i.test(t)) p.seniority = 'Executive';
  else if (/\b(director)\b/i.test(t)) p.seniority = 'Director';
  else if (/\b(head of)\b/i.test(t)) p.seniority = 'Director';
  else if (/\b(manager|programme manager|program manager)\b/i.test(t) && p.seniority === 'Mid') p.seniority = 'Manager';
  else if (/\b(lead|principal|staff)\b/i.test(t) && (p.seniority === 'Mid' || p.seniority === 'Senior')) p.seniority = 'Lead';
  else if (/\b(senior|sr\.)\b/i.test(t) && p.seniority === 'Mid') p.seniority = 'Senior';
  const sk = new Set();
  for (const s of KNOWN_SKILLS) if (new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(t)) sk.add(s);
  const skillsSec = t.match(/skills?\s*[:\n]([^\n]+(?:\n[^\n]+){0,4})/i);
  if (skillsSec) skillsSec[1].split(/[,•|·\n]/).map(s=>s.trim()).filter(s=>s.length>1 && s.length<40).forEach(s=>sk.add(s));
  p.skills = [...sk].slice(0, 15);
  const sm = t.match(/(?:^|\n)\s*(?:professional summary|career summary|summary|profile|about(?:\s+me)?)\s*[:\n]+\s*([\s\S]{40,500}?)(?:\n\s*\n|\n[A-Z][A-Z\s]{4,}\s*[:\n]|\nEXPERIENCE|\nEDUCATION|\nSKILLS|\nWORK|$)/i);
  if (sm) p.bio = sm[1].replace(/\s+/g, ' ').trim().slice(0, 400);
  else {
    const paras = t.slice(0, 2000).split(/\n\s*\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x.length > 50 && x.length < 500 && /[a-z]/.test(x) && !/@|\+\d|linkedin|http/i.test(x));
    if (paras.length) p.bio = paras[0].slice(0, 400);
  }
  return p;
}
  window.RQParse = { extractCVText: extractCVText, parseProfile: extractProfileLocal };
})();
