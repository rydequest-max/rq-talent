# RQ Talent

A two-page careers portal for the Middle East, Africa, and South Asia.

- **`index.html`** — public careers portal. Candidates drop their CV, the page parses it into a structured profile (PDF/DOCX), they confirm, they submit. They get an application ID and can check their status later.
- **`admin.html`** — internal pipeline tool. Passcode-gated. Tabbed list and kanban views, "Today's actions" with cold-flag and dedup detection, JD-to-candidate matcher with calibrated tiers, pipeline analytics, and a quick-search chatbot. Optional Claude API key unlocks AI re-ranking on the matcher.

Both files are self-contained HTML — no build step, no dependencies installed locally. They share data through `localStorage` on the user's device (key: `rq_talent_pool_v1`).

## Live URLs

After GitHub Pages is enabled on the repo:

- Public portal: `https://<your-username>.github.io/<repo-name>/`
- Internal admin: `https://<your-username>.github.io/<repo-name>/admin.html`

## Changing the admin passcode

The default passcode is `admin2026`. Anyone reading the source can decode SHA-256 lookups for short common passcodes — change it before letting anyone use the site.

1. Open the live admin page in a browser
2. Open DevTools (F12, or Cmd+Opt+I on Mac) → Console tab
3. Paste this with your new passcode in the quotes:
   ```js
   sha256Hex("YourNewPasscodeHere").then(console.log)
   ```
4. Copy the hex string it prints
5. In `admin.html`, find `HR_PASSCODE_HASH:` near the top of the `<script>` block and replace the value with your new hash
6. Commit the change. GitHub Pages will redeploy in a minute or two.

## Optional: Claude API key

If you paste an Anthropic API key into `CONFIG.ANTHROPIC_API_KEY` at the top of `admin.html`, two features get smarter:

- The quick-search chatbot uses Claude Haiku for semantic search
- The "Match a job" modal gets an **AI re-rank** toggle that asks Claude to re-rank the top heuristic matches semantically

⚠ The key is visible to anyone who views the page source. Use a restricted key (limit it to the Anthropic messages endpoint and set a low monthly spending cap).

The same key works in `index.html` for richer CV parsing during applications.

## Data storage

By default, everything lives in `localStorage` on whichever device opens the page. That means:

- Applications submitted on the public portal only appear in the admin if both are opened on the **same browser on the same device**.
- For a real multi-device deployment, wire up a backend (a Google Apps Script + Sheets is the lightest option — Apps Script `doPost` endpoint with shared-secret header and rate limiting).

The shared storage key between the two files is `rq_talent_pool_v1`.

## Tech notes

- Vanilla HTML/CSS/JS — no framework, no build step
- Inter + JetBrains Mono fonts via Google Fonts
- Material Symbols icons via Google Fonts
- PDF text extraction via `pdf.js` (loaded on demand from cdnjs)
- DOCX text extraction via `mammoth.js` (loaded on demand from cdnjs)
- Drag-and-drop kanban using the native HTML5 DnD API
