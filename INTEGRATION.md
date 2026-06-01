# RQ Talent — Live Jobs module

A **"Live jobs" tab inside your internal portal** that shows a daily **UAE, all-sector**
job feed — hospitality, construction, finance, healthcare, technology, energy — and, for
every posting, ranks the best-fit candidates from your talent pool using the *same*
matching engine as your existing "Match a job" button. Each job is tagged with its
industry, and the tab has sector filter chips.

Nothing new to host or pay for: a GitHub Actions cron runs the scraper daily and
commits the results, and the portal reads them.

**Real data, no key.** The bundled `jobs.json` already holds genuine UAE roles pulled
live from open employer APIs (no key, no signup):

| Sector | Source (verified Jun 2026) |
|---|---|
| Finance | Citi, Mastercard (Workday) |
| Technology | Cisco (Workday) |
| Construction | AECOM (SmartRecruiters — 140+ live UAE roles) |
| Healthcare | Cleveland Clinic Abu Dhabi (Workday) |
| Energy | Baker Hughes, Aggreko (Workday) |
| Hospitality | *no open feed — comes via the aggregator keys below* |

## What changed

- **`admin.html`** — this is your existing file with a new **Live jobs** nav item
  added. Everything else (pipeline, kanban, analytics, matcher, passcode) is untouched.
  Just replace your current `admin.html` with this one.
- **`jobs.json`** + **`jobs.js`** — the job feed. `jobs.json` is read via `fetch` on
  GitHub Pages; `jobs.js` is the same data as a `<script>` so the tab also works when
  you open `admin.html` directly from your computer (`file://`, where `fetch` is blocked).
  Both are overwritten by the scraper each run.
- **`scraper/`** + **`.github/workflows/scrape-jobs.yml`** — the daily scraper and cron.

## How it works

```
GitHub Actions (daily cron) → scraper/scrape.py
        │ writes jobs.json + jobs.js, commits them
        ▼
GitHub Pages serves them next to admin.html
        ▼
admin.html "Live jobs" tab → loads the feed, matches each job vs your pool
```

The scraper uses **official JSON APIs**, not HTML scraping. Datacenter IPs (including
GitHub's runners) get blocked by job boards, so HTML scraping is unreliable and against
most boards' ToS. The adapter types:

| Adapter | Needs a key? | Notes |
|---|---|---|
| **Workday** | **No** | Open employer API. Pre-loaded with Citi, Mastercard, Cisco, Cleveland Clinic, Baker Hughes, Aggreko — verified live UAE roles (Jun 2026). |
| **SmartRecruiters** | **No** | Open employer API. Pre-loaded with AECOM (construction). |
| **Jooble API** | Free key | Aggregator across all sectors incl. hospitality. Widens coverage a lot. No IP restriction — works on GitHub Actions. |
| **Careerjet API (v4)** | API key | Aggregator across all sectors, BUT requires a pre-declared static server IP — so it won't run on GitHub Actions (only from a fixed-IP host). |
| **Greenhouse / Lever / RSS** | No | Left empty / optional. Add only if you confirm a source. |

So the tab shows **genuine UAE jobs across five sectors the moment you deploy**, no key.
Adding the aggregator keys (below) brings in many more companies and fills the one gap —
**hospitality**, which has no open employer feed in the UAE.

## Setup (~10 minutes)

### 1. Add the files to your repo
Copy into the root of `rq-talent`, replacing `admin.html`:

```
admin.html            ← replaces your current one (Live jobs tab + ATS CV button)
index.html            ← replaces your current one (stores CV text + candidate CV download)
cv-generator.js       ← NEW — the branded ATS CV reformatter (PDF + Word)
jobs.json             ← real UAE feed; overwritten by the scraper
jobs.js               ← same data for local (file://) use; overwritten too
scraper/              ← scrape.py, config.json, seed_jobs.py
.github/workflows/scrape-jobs.yml
```

(`jobs.html` is just a redirect to `admin.html` now, since Live Jobs lives inside the
portal. You can delete it or keep it — harmless either way.)

Commit and push.

### 2. Let the workflow commit results
GitHub → repo → **Settings → Actions → General → Workflow permissions** →
**Read and write permissions** → Save.

### 3. Add the free API keys (optional — widens coverage)
The feed already works without keys (Workday: Baker Hughes + Aggreko). Adding these two
free aggregator keys brings in many more companies across UAE / Qatar / KSA.

GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**:

- **`JOOBLE_API_KEY`** — register at <https://jooble.org/api/about> (they email you the
  key). No IP restriction, so it works on GitHub Actions directly. The free tier is
  **500 requests** and the scraper uses **1 per run** (UAE only), so at the **daily**
  schedule below that lasts **~500 days (~16 months)**. Hourly would burn it in ~3 weeks —
  which is why the cron is set to once a day.
- **`CAREERJET_API_KEY`** — from your Careerjet publisher dashboard (Access API page).
- **`CAREERJET_PROXY`** — a static-IP proxy URL so Careerjet's v4 API works from GitHub
  Actions (see below).

Skip any of these and that source is simply skipped; everything else still runs.

#### Careerjet on GitHub Actions — the static-IP proxy

Careerjet's v4 API authenticates by the **caller's IP**, which you must pre-declare in
the publisher dashboard. GitHub runners get a random IP each run, so calls go through a
**static-IP proxy** instead:

1. Get a proxy with a fixed egress IP — e.g. **Fixie**, **QuotaGuard Static**, or your own
   tiny VPS running a proxy (Squid/tinyproxy). They give you a URL like
   `http://user:pass@proxy-host:port` and a static IP.
2. In your Careerjet dashboard → **Access API → Server IP addresses**, enter that static
   IP and Save.
3. Add the proxy URL as the GitHub secret **`CAREERJET_PROXY`**. The scraper routes only
   the Careerjet calls through it (set `careerjet_referer` in `config.json` to your
   declared publisher site, already defaulted to `https://www.rydequest.com/find-jobs/`).

Without `CAREERJET_PROXY` set, the Careerjet adapter still runs but will be rejected by
Careerjet from the Action's IP — so leave it off until the proxy + declared IP are ready.

### 4. (Optional) Add more companies — no key needed
The fastest way to add a whole company's UAE roles. In `scraper/config.json`:

**Workday** → `workday_boards`. Open the company's careers page and read the URL, e.g.
`https://citi.wd5.myworkdayjobs.com/2` → `host = citi.wd5.myworkdayjobs.com`,
`tenant = citi`, `site = 2`. Add `industry` so its jobs are tagged:

```json
{ "host": "<x>.wdN.myworkdayjobs.com", "tenant": "<x>", "site": "<SiteName>",
  "company": "Display Name", "type": "employer", "industry": "Technology / Software" }
```

**SmartRecruiters** → `smartrecruiters_boards`. The `company` is the id in
`careers.smartrecruiters.com/<id>`:

```json
{ "company": "<id>", "display": "Name", "industry": "Hospitality / Tourism" }
```

`industry` must be one of the portal's names: `Hospitality / Tourism`,
`Construction / Infrastructure`, `Financial Services / Fintech`, `Healthcare / Pharma`,
`Technology / Software`, `Energy / Oil & Gas`. (Leave it off and the scraper guesses from
the text.)

### 5. Run it once
GitHub → **Actions → "Scrape UAE jobs" → Run workflow**. Confirm a new commit to
`jobs.json` / `jobs.js`, then open the portal and click **Live jobs**. After that it runs
once a day on its own (cron `0 2 * * *` = 06:00 Gulf time).

## How candidate matching works

Each scraped posting is turned into a job-description and run through your existing engine
— `parseJD()` → `scoreCandidate()` → `tierFor()` — so it uses the same 100-point scale,
skill-alias map, and **Strong fit / Good fit / Possible** tiers as "Match a job", across
every sector. Click any suggested candidate to jump to their profile. If no candidate
clears the bar, the tab shows the **three closest** (greyed, "below bar") so it's never
blank.

## Branded ATS CV reformatter

`cv-generator.js` turns a candidate's parsed profile (plus the raw text from their
uploaded CV) into a clean, **ATS-friendly Word CV (.docx)**, branded with the RydeQuest
logo and a subtle watermark. No server — it runs in the browser. (A PDF builder is also
included; pass `{ includePdf:true }` to `RQCV.generate` if you ever want one — the
default download is Word only.)

**Where it shows up**

- **Admin → candidate profile → "RydeQuest CV (Word)"** button. Generates and downloads
  the .docx on the spot. Works for any candidate.
- **Public site → after a candidate submits** → a "Get my RydeQuest CV" button on the
  confirmation screen gives the candidate their reformatted Word CV.
- New uploads now store the CV's extracted text (`cvText`), so the recruiter can
  regenerate the branded CV anytime from the admin — even months later.

**The logo.** Drop in your real logo two ways: click **"Set RydeQuest logo"** in the admin
footer (stores it on that device), or replace `DEFAULT_LOGO_SVG` at the top of
`cv-generator.js` with your logo (a data-URL PNG/SVG) so it's the default everywhere,
including the candidate-facing public site. Until then it uses a generated RydeQuest
wordmark.

**ATS-safety note.** The body of the CV is plain, single-column text with standard
headings (Professional Summary, Core Skills, Experience & Background) — exactly what ATS
parsers want. The logo sits in the header and the watermark is a faint background image,
both of which parsers ignore, so the branding doesn't hurt parse-ability.

## Tuning

Everything is in `scraper/config.json` — no code changes:

- `target_countries` — currently `["United Arab Emirates"]`. Add Qatar / Saudi Arabia to widen.
- `keywords` — the broad, all-sector terms the aggregators search.
- `workday_boards` / `smartrecruiters_boards` — the no-key employer feeds.
- `retention_days` — how long a vanished posting lingers before being dropped (21).

The industry keyword map and skill vocabulary live near the top of `scrape.py`.

## Honest limitations

- **"Hourly" is best-effort** — GitHub cron can be delayed or occasionally skip a run.
- **Hospitality needs the aggregator keys** — Marriott / Hilton / Jumeirah use closed
  ATSes with no open API, so hospitality roles come through Jooble / Careerjet, not the
  no-key employer feeds.
- **LinkedIn is not scraped** — against their ToS and blocks automation. A manual
  paste-field can be added later.
- **Contact info is usually company + apply link**, not a named recruiter — most postings
  route through an ATS. The scraper captures an email when the JD contains one.
- **Scrapers rot** — if a source changes, that adapter quietly returns nothing; the others
  keep working and the feed never wipes (it merges + retains).
