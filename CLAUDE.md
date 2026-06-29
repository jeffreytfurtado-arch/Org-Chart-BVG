# BVG Org Chart — Claude Code Handoff

## Project Overview

Single-page org chart + job board + RACI matrix + bus factor register for **Big Viking Games**.
All frontend code lives in one `index.html` file (~3813 lines, ~290KB). Backend is Netlify Functions + Netlify Blobs.

**Live site:** https://bvg-org-chart.netlify.app
**Netlify site ID:** `f0db5f7d-1921-4846-9c81-87833f095457`
**Google OAuth client ID:** `561637209357-n74f7l9n0qrkqq7e37sja2ags5o6ak2e.apps.googleusercontent.com`
**Allowed domain:** `bigvikinggames.com`

---

## Repository Structure

```
C:\Users\jeffr\OneDrive\Desktop\Projects\Org Chart\
├── index.html                          ← ENTIRE frontend (~3813 lines, ~290KB)
├── careers.html                        ← Public careers page
├── netlify.toml                        ← Build config (DO NOT MODIFY)
├── package.json                        ← Just @netlify/blobs dependency
├── jds/                                ← 10 PDF job descriptions
└── netlify/functions/
    ├── state.js                        ← Org chart state CRUD (CommonJS)
    ├── admin.js                        ← Admin config CRUD (CommonJS)
    ├── jobs.js                         ← Job listings CRUD (CommonJS)
    ├── raci.js                         ← RACI matrix CRUD (CommonJS)
    ├── busfactor.js                    ← Bus factor register CRUD (CommonJS)
    ├── ask.js                          ← AI "ask the org" endpoint (DO NOT TOUCH)
    └── comp.js                         ← Compensation endpoint (DO NOT TOUCH)
```

---

## HARD CONSTRAINTS — READ THESE FIRST

1. **DO NOT delete or modify any employee data, org structure, jobs, or server-side data** unless explicitly asked.
2. **DO NOT touch `ask.js` or `comp.js`** — they work and are off-limits.
3. **The `netlify.toml` build command must remain exactly:**
   ```toml
   [build]
     command = "mkdir -p site && cp index.html site/ && cp careers.html site/ 2>/dev/null; cp -r jds site/ 2>/dev/null; true"
     publish = "site"
   [functions]
     directory = "netlify/functions"
   ```
4. **All Netlify Functions are CommonJS** (`.js`, `exports.handler`). Do NOT convert to ESM/`.mjs`.

---

## Authentication & Authorization

- Google OAuth with domain restriction (`bigvikinggames.com`).
- **EDITOR_EMAILS** (client-side, can edit org chart):
  ```
  albert@bigvikinggames.com
  jfurtado@bigvikinggames.com
  rslager@bigvikinggames.com
  ```
- **JOBS_EDITOR_EMAILS** (client-side, can edit jobs/roles):
  ```
  albert@bigvikinggames.com
  jfurtado@bigvikinggames.com
  rslager@bigvikinggames.com
  smadjunkov@bigvikinggames.com
  ggill@bigvikinggames.com
  sbendes@bigvikinggames.com
  ```
- Server-side editor check: loads roles from config blob, falls back to `FALLBACK_EDITORS` Set in each function file.
- The `aud` (audience) check was removed from `state.js`, `admin.js`, `jobs.js`, `raci.js`, and `busfactor.js` — only `ask.js` and `comp.js` still have it (and are not to be touched).

---

## Netlify Blobs Stores

| Store       | Key(s)       | Purpose                                    |
|-------------|-------------|---------------------------------------------|
| `orgchart`  | `state`     | `{employees, secondaryLinks, rev, updatedBy, updatedAt}` |
| `config`    | `settings`  | Admin config: roles, auth, company, features |
| `jobs`      | `listings`  | Job/role listings array                     |
| `raci`      | `data`      | RACI domains + processes                    |
| `busfactor` | `data`      | Bus factor register entries                 |
| `jobfiles`  | `<id>`      | Uploaded JD PDFs (binary)                   |

Each store uses a `rev` counter for optimistic concurrency. The client sends `baseRev` on POST; the server increments and returns the new `rev`.

---

## index.html Architecture (line references approximate)

| Section | Lines | Description |
|---------|-------|-------------|
| `<style>` | 1–550 | All CSS (~28KB). Sidebar layout, org cards, modals, RACI/BF tables, AI panel, alumni |
| HTML body | 550–1198 | Sidebar nav, main content areas for each view, all modals (edit employee, RACI, BF, offboard) |
| `<script>` | 1198–3811 | All JavaScript in one block |
| Employee seed data | 1199 | `let EMPLOYEES = [...]` — 68 employees, JSON array on a single line |
| `SEED_EMPLOYEES` | 1202 | Deep copy of initial employees for reset |
| `PHOTOS` | 1205–1250 | Slack avatar URLs keyed by email |
| State management | 1420–1460 | `saveState()`, `loadState()`, `initTree()` |
| `pushState()` | ~2160 | POST to server, includes read-after-write verification |
| `fetchState()` | ~2140 | GET from server, only on login/conflict |
| Auto-refresh | ~2184–2210 | Runs every 30s, rev-guarded, 60s staleness guard |
| `reassign()` | ~1763 | Drag-drop handler: updates `EMPLOYEES`, calls `saveState()` |
| `setView()` | ~2241 | Tab switching: calls `initTree(); render();` — NO refetch |
| RACI seed data | ~3100–3165 | `RACI_SEED_DOMAINS` and `RACI_SEED_PROCESSES` arrays |
| Bus factor seed | ~3359–3387 | `BF_SEED` array (27 ranked entries) |
| RACI render/edit | ~3241–3547 | Table rendering, modals, CSV/PDF export |
| BF render/edit | ~3389–3627 | Table rendering, modals, CSV/PDF export |
| Alumni/Offboarding | ~3629–3764 | Previous employees tracking, offboard workflow |
| AI panel toggle | ~3769–3793 | Collapsible AI panels with BVG logo injection |
| `init()` | ~3795–3809 | Entry point: loadState, loadAlumni, buildDeptPills, initTree, render, initAuth |

### Key globals
- `EMPLOYEES` — the live array of employee objects. Mutated by reassign, edit modal, offboard.
- `STATE_REV` — current revision from server. Used for optimistic concurrency.
- `STATE_LOADED` — boolean gate. Saves are blocked until first successful fetch.
- `IS_EDITOR` — set during login if user's email is in EDITOR_EMAILS.
- `CURRENT_TOKEN` — Google OAuth access token for API calls.
- `CURRENT_EMAIL` — logged-in user's email.

### All locations where EMPLOYEES is reassigned (7 total)
1. Line 1199: `var EMPLOYEES = [...]` — initial baked-in seed
2. Line 1202: `const SEED_EMPLOYEES = JSON.parse(JSON.stringify(EMPLOYEES));`
3. Line ~1447: `EMPLOYEES=s.employees;` — loadState from localStorage (init only)
4. Line ~1706: `EMPLOYEES=JSON.parse(JSON.stringify(SEED_EMPLOYEES));` — resetChanges
5. Line ~1916: `EMPLOYEES=EMPLOYEES.filter(...)` — edit modal delete
6. Line ~2148: `EMPLOYEES=d.state.employees;` — fetchState (login/conflict)
7. Line ~2196: `EMPLOYEES=d.state.employees;` — auto-refresh (rev-guarded)
8. Line ~3702: `EMPLOYEES=EMPLOYEES.filter(...)` — offboard

---

## Current Version: v26.4

Debug bar shows `v26.4 | <status>` in the bottom-left corner. Changes in v26.4:

1. **Read-after-write verification** — both client (`pushState`) and server (`state.js`) verify writes by reading back immediately after POST.
2. **Auto-refresh staleness guard increased from 10s to 60s** — prevents auto-refresh from overwriting a recent save.
3. **`console.trace` on EMPLOYEES overwrite** — `autoRefresh` logs a full stack trace if it overwrites EMPLOYEES, making it possible to diagnose the revert bug from browser console.
4. **Enhanced `setView('org')` logging** — logs EMPLOYEES.length, STATE_REV, and all reports_to values when switching to org view.

### Known Issue: Card Revert When Switching Tabs

**Symptom:** Move an org chart card (drag to new manager), see "Saved ✓", switch to Jobs & Roles tab, switch back to Org Chart — card is back in original position.

**Status:** Not definitively root-caused. v26.4 adds diagnostic logging. Next time it happens, the browser console (F12) will show exactly which code path overwrote EMPLOYEES via the `console.trace`.

**Hypotheses:**
- Auto-refresh firing within the staleness window and reading stale server data (mitigated by 60s guard)
- Netlify Blobs eventual consistency (write succeeds but subsequent read returns old data — tested with read-after-write verification)
- Unknown code path overwriting EMPLOYEES (traced with console.trace)

**To test:** Log in as editor, open F12 console, move a card, wait for "Saved ✓", switch tabs, switch back. Check console for `[autoRefresh] OVERWRITING EMPLOYEES` or `[VERIFY] MISMATCH`.

---

## How to Deploy

### The OneDrive Mount Truncation Problem (CRITICAL)

The project folder is on OneDrive. When accessed from the bash sandbox:
- **OneDrive mount** (`/sessions/.../mnt/Org Chart/`) truncates `index.html` at **~239793 bytes / line 3148**
- **Outputs mount** (`/sessions/.../mnt/outputs/`) truncates at **~287940 bytes / line ~3788**
- **Read/Edit/Write tools** (Windows API paths) see the **FULL file correctly**

This means **you cannot deploy directly from the OneDrive mount** — the deployed file will be truncated, breaking login (the `init()` function and closing `</script></body></html>` tags will be missing).

### Deploy Procedure (Workaround)

1. **Build a deploy directory on the native bash filesystem** (`/tmp/deploy-site/`):
   ```bash
   mkdir -p /tmp/deploy-site/netlify/functions
   ```

2. **Copy small files via mount** (these are all under 240KB, so they copy fine):
   ```bash
   cp "/sessions/.../mnt/Org Chart/netlify.toml" /tmp/deploy-site/
   cp "/sessions/.../mnt/Org Chart/careers.html" /tmp/deploy-site/
   cp -r "/sessions/.../mnt/Org Chart/jds" /tmp/deploy-site/
   cp "/sessions/.../mnt/Org Chart/netlify/functions/"*.js /tmp/deploy-site/netlify/functions/
   ```

3. **Reconstruct index.html** (the critical step):
   - Copy first 3148 lines from mount: `head -3148 "/sessions/.../mnt/Org Chart/index.html" > /tmp/deploy-site/index.html`
   - Read lines 3149+ using the **Read tool** (Windows path: `C:\Users\jeffr\OneDrive\Desktop\Projects\Org Chart\index.html`, offset 3149)
   - Write those remaining lines to a temp file using the **Write tool** (outputs path)
   - Append via bash: `cat /sessions/.../mnt/outputs/index_tail.txt >> /tmp/deploy-site/index.html`
   - **Verify**: `tail -3 /tmp/deploy-site/index.html` should show `</script>\n</body>\n</html>`

4. **Add no-cache headers to netlify.toml** (the source file doesn't have them):
   ```bash
   cat >> /tmp/deploy-site/netlify.toml << 'EOF'

   [[headers]]
     for = "/*"
     [headers.values]
       Cache-Control = "no-cache, no-store, must-revalidate"
       Pragma = "no-cache"
   EOF
   ```

5. **Get a fresh deploy token** by calling the `netlify-deploy-services-updater` MCP tool:
   ```json
   {"operation": "deploy-site", "params": {"siteId": "f0db5f7d-1921-4846-9c81-87833f095457"}}
   ```

6. **Deploy from /tmp/deploy-site/**:
   ```bash
   cd /tmp/deploy-site && npx -y @netlify/mcp@latest \
     --site-id f0db5f7d-1921-4846-9c81-87833f095457 \
     --proxy-path "<token from step 5>"
   ```

7. **Verify**: User does Ctrl+Shift+R. Check login works, debug bar shows correct version.

### Quick Verification After Deploy
```bash
curl -s https://bvg-org-chart.netlify.app/ | tail -5
# Should end with: init();\n</script>\n</body>\n</html>
```

---

## Server Functions Summary

All functions follow the same pattern:
- CommonJS: `exports.handler = async (event) => { ... }`
- Load config blob for roles/auth
- Verify Google OAuth token via `https://oauth2.googleapis.com/tokeninfo`
- Check email domain
- GET returns data + `canEdit` flag
- POST requires editor role, reads current rev, increments, writes

### state.js (v26.4)
- POST includes **read-after-write verification**: after writing, reads back and confirms `rev` matches
- Returns `{ok: true, rev, verified}` on success

### admin.js
- Manages the `config` blob in the `config` store
- Tabs: Roles (sysadmin/admin/jobs editor lists), Auth (domain, client ID), Company (name, logo, brand color), Features, Departments, Custom Fields
- Auto-bootstraps on first sysadmin visit

### jobs.js
- CRUD for job/role listings
- Supports file upload (JD PDFs) to `jobfiles` store
- Ghost cards (roles with `showOnChart: 'yes'`) appear on the org chart

### raci.js / busfactor.js
- Simple GET/POST for their respective data blobs
- Client has seed data baked in; pushes to server on first editor visit if blob is empty

---

## App Views / Tabs

| Tab | Sidebar ID | Content |
|-----|-----------|---------|
| Org Chart | `nav-org` | Interactive tree with drag-to-reassign, collapse/expand, dept filters, zoom |
| Jobs & Roles | `nav-jobs` | Table view of open roles with KPI cards, filters, AI ask bar |
| RACI | `nav-raci` | Domain ownership + process RACI matrix with health score |
| Bus Factor | `nav-bf` | SPOF register ranked by risk with filters |
| Admin | `nav-admin` | Config panel (editors only) |
| Previous Employees | `nav-alumni` | Alumni list (hidden until employees are offboarded) |

---

## Sysadmin / Test Account

**Jeffrey Furtado** — `jfurtado@bigvikinggames.com` — COO, sysadmin, full editor access.

---

## Things That Have Bitten Previous Sessions

1. **Truncated deploys** — Always verify `index.html` ends with `</html>` before deploying. If login is broken, this is the first thing to check.
2. **Stale bash mount** — Never trust `wc -l` or `cat` from the mount for `index.html`. Use the Read tool.
3. **Auto-refresh race** — The 30s auto-refresh can overwrite local changes if the staleness guard is too short (was 10s, now 60s).
4. **Mixed module formats** — All functions are CommonJS. A previous session accidentally converted some to ESM (`.mjs`), which broke them.
5. **`aud` check removed** — Don't re-add audience validation to the token check. It was removed because Netlify's proxy doesn't preserve the audience claim.
6. **CSS is massive** — The `<style>` block is ~28KB. All styles for all views are in there. No external stylesheets.
7. **68 employees on one line** — The `EMPLOYEES` array at line 1199 is a single very long line. Be careful with regex/search on it.
