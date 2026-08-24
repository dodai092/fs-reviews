# Scheduled Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the Reviews Extract extension's scraping flow unattended, on a weekly schedule, for all 7 platforms, driving the real extension via Playwright instead of a manual popup click.

**Architecture:** A standalone Node script (`automation/`) launches Chromium via Playwright's `launchPersistentContext`, pointed at the existing "Free Spirit" Chrome profile with the extension loaded (`--load-extension`). For each platform it navigates to a configured reviews URL, gets a handle on the extension's background service worker via `context.serviceWorkers()`, and calls `chrome.scripting.executeScript` from inside that worker — the same calls `popup.js`/`background.js` already make — to set target dates and inject `scripts/common.js` + the platform script unmodified. Results are logged to a file and summarized in one email sent via Gmail SMTP. A `launchd` LaunchAgent triggers a run weekly.

**Tech Stack:** Node.js (v26, already installed), Playwright (`playwright` npm package, Chromium only), `nodemailer` for email, `node:test` + `node:assert` for unit tests (no new test framework dependency), macOS `launchd`.

**Spec:** `docs/superpowers/specs/2026-08-24-scheduled-automation-design.md`
**ADR:** `docs/adr/0001-automation-drives-service-worker-not-popup.md`

## Global Constraints

- No login flow is ever driven programmatically for any platform — session reuse only. (spec: "Per-platform auth strategy")
- No changes to `popup.js` or any `scripts/*.js` file. The only extension file changed is `manifest.json` (`host_permissions`). (ADR-0001 Consequences)
- Playwright must point at the real "Free Spirit" managed Chrome profile's actual folder on disk — never a copy or a fresh profile. (spec: Context)
- Automation runs on the user's own Mac via `launchd`, weekly, targeting the previous Mon–Sun week by default. (spec: Scheduling)
- Failure/status reporting is one summary email per run, sent to the user, plus a local log file with full detail. (spec: Failure detection & notification)
- No IMAP/Gmail-API OTP retrieval or any credential auto-fill — out of scope for this plan entirely. (spec: Per-platform auth strategy)
- Real per-platform reviews-page URLs are business-specific (listing IDs, supplier IDs) and must never be hardcoded into committed source — they live in a gitignored config file the user fills in. (new constraint, established in Task 3 below)

---

## File Structure

```
reviews-extract/
├── manifest.json                        [MODIFY] host_permissions expanded to all 7 domains
├── .gitignore                           [CREATE] ignore automation/node_modules, logs, real config/secrets
└── automation/
    ├── package.json                     [CREATE] playwright + nodemailer deps, npm scripts
    ├── platforms.example.json           [CREATE] committed template — placeholder URLs
    ├── platforms.json                   [gitignored — user fills in real URLs, not created by this plan]
    ├── secrets.example.json             [CREATE] committed template — Gmail app-password shape
    ├── secrets.json                     [gitignored — user fills in real credentials]
    ├── lib/
    │   ├── config.js                    [CREATE] loads + validates platforms.json / secrets.json
    │   ├── weekRange.js                 [CREATE] computes previous Mon–Sun week as ms timestamps
    │   ├── serviceWorker.js             [CREATE] gets extension's service worker, drives chrome.scripting.executeScript
    │   ├── authWall.js                  [CREATE] detects login/verification walls
    │   ├── logger.js                    [CREATE] writes automation/logs/YYYY-MM-DD.log
    │   └── report.js                    [CREATE] builds + sends the summary email via nodemailer
    ├── smoke-test.js                    [CREATE] throwaway-but-kept verification script (Rollout plan step 1)
    ├── run.js                           [CREATE] orchestrates the full weekly run
    └── test/
        ├── weekRange.test.js            [CREATE]
        ├── authWall.test.js             [CREATE]
        └── report.test.js               [CREATE]
└── com.dodai.reviews-extract.plist.example  [CREATE] committed launchd template
```

Each `lib/` file has one responsibility and is independently testable without a real browser, except `serviceWorker.js` (needs a live Playwright context) and `smoke-test.js`/`run.js` (orchestration — verified by manual runs per the spec's Verification section, not unit tests).

---

## Task 1: Repo scaffolding for `automation/`

**Files:**
- Create: `reviews-extract/.gitignore`
- Create: `reviews-extract/automation/package.json`

**Interfaces:**
- Produces: an `automation/` directory with `npm install` working, and `node_modules`/logs/real config kept out of git.

- [ ] **Step 1: Create `.gitignore`**

```gitignore
automation/node_modules/
automation/logs/
automation/platforms.json
automation/secrets.json
```

- [ ] **Step 2: Create `automation/package.json`**

```json
{
  "name": "reviews-extract-automation",
  "version": "1.0.0",
  "private": true,
  "description": "Unattended weekly runner for the Reviews Extract Chrome extension.",
  "type": "commonjs",
  "scripts": {
    "smoke-test": "node smoke-test.js",
    "run": "node run.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "playwright": "^1.48.0",
    "nodemailer": "^6.9.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd "/Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract/automation" && npm install`
Expected: `node_modules/` created, `package-lock.json` created, no errors.

- [ ] **Step 4: Install Playwright's Chromium browser binary**

Run: `cd "/Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract/automation" && npx playwright install chromium`
Expected: downloads and installs the Chromium build Playwright drives (separate from the user's actual installed Chrome — this is only used for its automation APIs; the actual browser executable used will be overridden to the user's real Chrome in Task 4, since we need the real "Free Spirit" profile's Chrome, not a fresh Playwright-managed Chromium).

- [ ] **Step 5: Commit**

```bash
git add .gitignore automation/package.json automation/package-lock.json
git commit -m "Scaffold automation/ package for scheduled runs"
```

---

## Task 2: Expand `manifest.json` host_permissions

**Files:**
- Modify: `reviews-extract/manifest.json:11-16`

**Interfaces:**
- Produces: `chrome.scripting.executeScript` works on all 7 platform domains without requiring `activeTab`'s live-gesture grant, per ADR-0001.

- [ ] **Step 1: Update `host_permissions` in `manifest.json`**

Replace the existing `host_permissions` array:

```json
  "host_permissions": [
    "https://script.google.com/",
    "https://script.googleusercontent.com/",
    "https://supplier.getyourguide.com/*",
    "https://supplier.viator.com/*"
  ],
```

with:

```json
  "host_permissions": [
    "https://script.google.com/",
    "https://script.googleusercontent.com/",
    "https://supplier.getyourguide.com/*",
    "https://supplier.viator.com/*",
    "https://www.airbnb.com/*",
    "https://www.airbnb.co.uk/*",
    "https://www.freetour.com/*",
    "https://www.getyourguide.com/*",
    "https://www.google.com/maps/*",
    "https://guruwalk.com/*",
    "https://www.guruwalk.com/*",
    "https://www.viator.com/*",
    "https://www.tripadvisor.com/*"
  ],
```

- [ ] **Step 2: Verify the extension still loads unpacked**

Run: open `chrome://extensions` in the "Free Spirit" Chrome profile, click the reload button on "Reviews Extract".
Expected: no manifest errors shown; the extension card still shows version 1.0 loaded successfully.

- [ ] **Step 3: Verify manual scraping still works on one platform**

Navigate to a Google Maps or TripAdvisor reviews page in that profile, open the popup, click the platform button.
Expected: `"Done! N reviews sent to Sheets."` — confirms the permission change didn't break the existing manual flow.

- [ ] **Step 4: Commit**

```bash
git add manifest.json
git commit -m "Expand host_permissions to all 7 platform domains for unattended automation"
```

---

## Task 3: Platform config (`platforms.example.json` + loader)

**Files:**
- Create: `reviews-extract/automation/platforms.example.json`
- Create: `reviews-extract/automation/secrets.example.json`
- Create: `reviews-extract/automation/lib/config.js`
- Test: `reviews-extract/automation/test/config.test.js` (inline in this task, not a separate task — see Task Right-Sizing)

**Interfaces:**
- Produces: `loadConfig()` returning `{ platforms: Array<PlatformConfig>, secrets: { gmailUser, gmailAppPassword, reportTo } }`, where `PlatformConfig = { id: string, script: string, url: string, needsLogin: boolean, weekSupported: boolean, authWallSelectors: string[], authWallUrlContains: string[] }`.
- Consumes: nothing (first lib module).

- [ ] **Step 1: Create `automation/platforms.example.json`**

Copy this to `automation/platforms.json` and fill in real URLs before running automation for real (see Task 3 Step 4).

```json
[
  {
    "id": "airbnb",
    "script": "airbnb.js",
    "url": "https://www.airbnb.com/REPLACE_WITH_REAL_REVIEWS_URL",
    "needsLogin": true,
    "weekSupported": false,
    "authWallSelectors": ["input[type=password]", "input[name=email]"],
    "authWallUrlContains": ["/login"]
  },
  {
    "id": "freetour",
    "script": "freetour.js",
    "url": "https://www.freetour.com/REPLACE_WITH_REAL_REVIEWS_URL",
    "needsLogin": true,
    "weekSupported": true,
    "authWallSelectors": ["input[type=password]"],
    "authWallUrlContains": ["/login", "/signin"]
  },
  {
    "id": "getyourguide",
    "script": "getyourguide.js",
    "url": "https://supplier.getyourguide.com/REPLACE_WITH_REAL_REVIEWS_URL",
    "needsLogin": true,
    "weekSupported": true,
    "authWallSelectors": ["input[type=password]"],
    "authWallUrlContains": ["/login", "/auth"]
  },
  {
    "id": "google",
    "script": "google.js",
    "url": "https://www.google.com/maps/REPLACE_WITH_REAL_REVIEWS_URL",
    "needsLogin": false,
    "weekSupported": true,
    "authWallSelectors": [],
    "authWallUrlContains": []
  },
  {
    "id": "guruwalk",
    "script": "guruwalk.js",
    "url": "https://guruwalk.com/REPLACE_WITH_REAL_REVIEWS_URL",
    "needsLogin": true,
    "weekSupported": true,
    "authWallSelectors": ["input[type=password]"],
    "authWallUrlContains": ["/login", "/signin"]
  },
  {
    "id": "viator",
    "script": "viator.js",
    "url": "https://supplier.viator.com/REPLACE_WITH_REAL_REVIEWS_URL",
    "needsLogin": true,
    "weekSupported": true,
    "authWallSelectors": ["input[type=password]"],
    "authWallUrlContains": ["/login", "/auth"]
  },
  {
    "id": "tripadvisor",
    "script": "tripadvisor.js",
    "url": "https://www.tripadvisor.com/REPLACE_WITH_REAL_REVIEWS_URL",
    "needsLogin": false,
    "weekSupported": false,
    "authWallSelectors": [],
    "authWallUrlContains": []
  }
]
```

- [ ] **Step 2: Create `automation/secrets.example.json`**

Copy this to `automation/secrets.json` and fill in real values before running automation for real. `gmailAppPassword` is a Gmail [app password](https://myaccount.google.com/apppasswords), not the account's normal login password.

```json
{
  "gmailUser": "antun@dodai.io",
  "gmailAppPassword": "REPLACE_WITH_REAL_APP_PASSWORD",
  "reportTo": "antun@dodai.io"
}
```

- [ ] **Step 3: Write `automation/lib/config.js`**

```js
const fs = require('node:fs');
const path = require('node:path');

function loadConfig({ dir = __dirname + '/..' } = {}) {
  const platformsPath = path.join(dir, 'platforms.json');
  const secretsPath = path.join(dir, 'secrets.json');

  if (!fs.existsSync(platformsPath)) {
    throw new Error(
      `Missing ${platformsPath} — copy platforms.example.json to platforms.json and fill in real reviews-page URLs.`
    );
  }
  if (!fs.existsSync(secretsPath)) {
    throw new Error(
      `Missing ${secretsPath} — copy secrets.example.json to secrets.json and fill in real Gmail credentials.`
    );
  }

  const platforms = JSON.parse(fs.readFileSync(platformsPath, 'utf8'));
  const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));

  for (const p of platforms) {
    if (!p.url || p.url.includes('REPLACE_WITH_REAL')) {
      throw new Error(`platforms.json: "${p.id}" still has a placeholder URL — fill in the real reviews-page URL.`);
    }
  }
  if (!secrets.gmailAppPassword || secrets.gmailAppPassword.includes('REPLACE_WITH_REAL')) {
    throw new Error('secrets.json: gmailAppPassword is still a placeholder.');
  }

  return { platforms, secrets };
}

module.exports = { loadConfig };
```

- [ ] **Step 4: Write the failing test**

```js
// automation/test/config.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../lib/config');

function makeTempConfigDir({ platforms, secrets }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 're-config-test-'));
  fs.writeFileSync(path.join(dir, 'platforms.json'), JSON.stringify(platforms));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify(secrets));
  return dir;
}

test('loadConfig throws when platforms.json is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 're-config-test-'));
  assert.throws(() => loadConfig({ dir }), /Missing.*platforms\.json/);
});

test('loadConfig throws when a platform URL is still a placeholder', () => {
  const dir = makeTempConfigDir({
    platforms: [{ id: 'airbnb', url: 'https://x/REPLACE_WITH_REAL_REVIEWS_URL' }],
    secrets: { gmailAppPassword: 'realpassword123' },
  });
  assert.throws(() => loadConfig({ dir }), /still has a placeholder URL/);
});

test('loadConfig returns platforms and secrets when both are filled in', () => {
  const dir = makeTempConfigDir({
    platforms: [{ id: 'tripadvisor', url: 'https://real.example/reviews' }],
    secrets: { gmailAppPassword: 'realpassword123' },
  });
  const { platforms, secrets } = loadConfig({ dir });
  assert.strictEqual(platforms.length, 1);
  assert.strictEqual(platforms[0].id, 'tripadvisor');
  assert.strictEqual(secrets.gmailAppPassword, 'realpassword123');
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd automation && npm test`
Expected: FAIL — `Cannot find module '../lib/config'` (file doesn't exist yet if steps done out of order; if Step 3 was already done, this should instead PASS — reorder so Step 3 happens after seeing the failure if strict TDD is wanted, otherwise proceed to Step 6).

- [ ] **Step 6: Run test to verify it passes**

Run: `cd automation && npm test`
Expected: all 3 tests in `config.test.js` PASS.

- [ ] **Step 7: Commit**

```bash
git add automation/platforms.example.json automation/secrets.example.json automation/lib/config.js automation/test/config.test.js
git commit -m "Add automation config loader with placeholder-URL/credential validation"
```

---

## Task 4: Week-range helper

**Files:**
- Create: `reviews-extract/automation/lib/weekRange.js`
- Test: `reviews-extract/automation/test/weekRange.test.js`

**Interfaces:**
- Produces: `previousWeekRange(now = new Date())` returning `{ start: number, end: number }` — ms timestamps of the previous Monday 00:00:00 and Sunday 23:59:59.999, matching the shape `popup.js`'s `weekSelect` values and `common.js`'s `getTargetWeek()` expect for `window.__targetWeekStart`/`__targetWeekEnd`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```js
// automation/test/weekRange.test.js
const test = require('node:test');
const assert = require('node:assert');
const { previousWeekRange } = require('../lib/weekRange');

test('previousWeekRange returns the Mon-Sun week before a mid-week date', () => {
  // Wednesday, 2026-08-19
  const now = new Date(2026, 7, 19, 10, 0, 0);
  const { start, end } = previousWeekRange(now);
  const startDate = new Date(start);
  const endDate = new Date(end);
  assert.strictEqual(startDate.getDay(), 1); // Monday
  assert.strictEqual(startDate.getDate(), 10); // Mon 2026-08-10
  assert.strictEqual(endDate.getDay(), 0); // Sunday
  assert.strictEqual(endDate.getDate(), 16); // Sun 2026-08-16
  assert.strictEqual(endDate.getHours(), 23);
  assert.strictEqual(endDate.getMinutes(), 59);
});

test('previousWeekRange handles a Monday correctly (previous week, not current)', () => {
  // Monday, 2026-08-24
  const now = new Date(2026, 7, 24, 6, 0, 0);
  const { start } = previousWeekRange(now);
  const startDate = new Date(start);
  assert.strictEqual(startDate.getDate(), 17); // Mon 2026-08-17, not 08-24
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd automation && npm test`
Expected: FAIL — `Cannot find module '../lib/weekRange'`

- [ ] **Step 3: Write `automation/lib/weekRange.js`**

```js
function previousWeekRange(now = new Date()) {
  const dow = now.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(thisMonday.getDate() - 7);
  const prevSunday = new Date(prevMonday);
  prevSunday.setDate(prevMonday.getDate() + 6);
  prevSunday.setHours(23, 59, 59, 999);
  return { start: prevMonday.getTime(), end: prevSunday.getTime() };
}

module.exports = { previousWeekRange };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd automation && npm test`
Expected: both tests in `weekRange.test.js` PASS.

- [ ] **Step 5: Commit**

```bash
git add automation/lib/weekRange.js automation/test/weekRange.test.js
git commit -m "Add previous-Mon-Sun-week helper for automation target dates"
```

---

## Task 5: Auth-wall detection

**Files:**
- Create: `reviews-extract/automation/lib/authWall.js`
- Test: `reviews-extract/automation/test/authWall.test.js`

**Interfaces:**
- Produces: `isAuthWall({ url, hasSelector }, platformConfig)` — a pure function taking the current page URL and a `hasSelector(selector: string) => boolean` predicate (so it's testable without a real page), returning `boolean`. `run.js` (Task 8) calls this via a thin adapter that wraps a real Playwright `page`.
- Consumes: `PlatformConfig.authWallUrlContains: string[]`, `PlatformConfig.authWallSelectors: string[]` from Task 3.

- [ ] **Step 1: Write the failing test**

```js
// automation/test/authWall.test.js
const test = require('node:test');
const assert = require('node:assert');
const { isAuthWall } = require('../lib/authWall');

const platform = {
  authWallUrlContains: ['/login', '/signin'],
  authWallSelectors: ['input[type=password]'],
};

test('detects an auth wall by URL', () => {
  const result = isAuthWall(
    { url: 'https://www.freetour.com/login?next=/reviews', hasSelector: () => false },
    platform
  );
  assert.strictEqual(result, true);
});

test('detects an auth wall by selector presence', () => {
  const result = isAuthWall(
    { url: 'https://www.freetour.com/reviews', hasSelector: (sel) => sel === 'input[type=password]' },
    platform
  );
  assert.strictEqual(result, true);
});

test('returns false on a normal reviews page', () => {
  const result = isAuthWall(
    { url: 'https://www.freetour.com/reviews', hasSelector: () => false },
    platform
  );
  assert.strictEqual(result, false);
});

test('returns false when platform has no login (empty selector/url lists)', () => {
  const noLoginPlatform = { authWallUrlContains: [], authWallSelectors: [] };
  const result = isAuthWall(
    { url: 'https://www.tripadvisor.com/anything', hasSelector: () => true },
    noLoginPlatform
  );
  assert.strictEqual(result, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd automation && npm test`
Expected: FAIL — `Cannot find module '../lib/authWall'`

- [ ] **Step 3: Write `automation/lib/authWall.js`**

```js
function isAuthWall({ url, hasSelector }, platformConfig) {
  const { authWallUrlContains = [], authWallSelectors = [] } = platformConfig;
  if (authWallUrlContains.length === 0 && authWallSelectors.length === 0) return false;

  const urlMatch = authWallUrlContains.some((fragment) => url.includes(fragment));
  if (urlMatch) return true;

  return authWallSelectors.some((selector) => hasSelector(selector));
}

module.exports = { isAuthWall };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd automation && npm test`
Expected: all 4 tests in `authWall.test.js` PASS.

- [ ] **Step 5: Commit**

```bash
git add automation/lib/authWall.js automation/test/authWall.test.js
git commit -m "Add pure auth-wall detection logic"
```

---

## Task 6: Report builder + email sending

**Files:**
- Create: `reviews-extract/automation/lib/report.js`
- Test: `reviews-extract/automation/test/report.test.js`

**Interfaces:**
- Produces: `buildReportText(results: PlatformResult[]) => string` (pure, testable) and `sendReport({ secrets, subject, text }) => Promise<void>` (uses `nodemailer`, not unit-tested — exercised in Task 9's real run). `PlatformResult = { id: string, status: 'success' | 'needsReauth' | 'error', count?: number, message?: string }`.
- Consumes: `secrets.gmailUser`, `secrets.gmailAppPassword`, `secrets.reportTo` from Task 3's `loadConfig()`.

- [ ] **Step 1: Write the failing test**

```js
// automation/test/report.test.js
const test = require('node:test');
const assert = require('node:assert');
const { buildReportText } = require('../lib/report');

test('buildReportText lists a success line with count', () => {
  const text = buildReportText([{ id: 'tripadvisor', status: 'success', count: 12 }]);
  assert.match(text, /tripadvisor: 12 reviews sent/);
});

test('buildReportText flags a platform needing re-login', () => {
  const text = buildReportText([{ id: 'guruwalk', status: 'needsReauth' }]);
  assert.match(text, /guruwalk: needs re-login/);
});

test('buildReportText includes the error message for a failed platform', () => {
  const text = buildReportText([{ id: 'airbnb', status: 'error', message: 'selector not found' }]);
  assert.match(text, /airbnb: error - selector not found/);
});

test('buildReportText handles a mixed run', () => {
  const text = buildReportText([
    { id: 'tripadvisor', status: 'success', count: 12 },
    { id: 'guruwalk', status: 'needsReauth' },
  ]);
  assert.match(text, /tripadvisor: 12 reviews sent/);
  assert.match(text, /guruwalk: needs re-login/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd automation && npm test`
Expected: FAIL — `Cannot find module '../lib/report'`

- [ ] **Step 3: Write `automation/lib/report.js`**

```js
const nodemailer = require('nodemailer');

function buildReportText(results) {
  return results
    .map((r) => {
      if (r.status === 'success') return `${r.id}: ${r.count} reviews sent`;
      if (r.status === 'needsReauth') return `${r.id}: needs re-login`;
      return `${r.id}: error - ${r.message}`;
    })
    .join('\n');
}

async function sendReport({ secrets, subject, text }) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: secrets.gmailUser, pass: secrets.gmailAppPassword },
  });
  await transporter.sendMail({
    from: secrets.gmailUser,
    to: secrets.reportTo,
    subject,
    text,
  });
}

module.exports = { buildReportText, sendReport };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd automation && npm test`
Expected: all 4 tests in `report.test.js` PASS.

- [ ] **Step 5: Commit**

```bash
git add automation/lib/report.js automation/test/report.test.js
git commit -m "Add report text builder and Gmail SMTP sender"
```

---

## Task 7: Logger

**Files:**
- Create: `reviews-extract/automation/lib/logger.js`

**Interfaces:**
- Produces: `createLogger() => { log(line: string): void, filePath: string }`. Appends timestamped lines to `automation/logs/YYYY-MM-DD.log`, creating `automation/logs/` if missing.
- Consumes: nothing.

- [ ] **Step 1: Write `automation/lib/logger.js`**

```js
const fs = require('node:fs');
const path = require('node:path');

function createLogger({ dir = path.join(__dirname, '..', 'logs') } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${new Date().toISOString().slice(0, 10)}.log`);

  function log(line) {
    const stamped = `[${new Date().toISOString()}] ${line}\n`;
    fs.appendFileSync(filePath, stamped);
  }

  return { log, filePath };
}

module.exports = { createLogger };
```

- [ ] **Step 2: Manually verify**

Run: `node -e "const { createLogger } = require('./automation/lib/logger'); const { log, filePath } = createLogger(); log('test line'); console.log(filePath);"`
Expected: prints a path under `automation/logs/`, and that file contains a line like `[2026-08-24T...] test line`.

- [ ] **Step 3: Commit**

```bash
git add automation/lib/logger.js
git commit -m "Add file logger for automation runs"
```

---

## Task 8: Service-worker-driven injection

**Files:**
- Create: `reviews-extract/automation/lib/serviceWorker.js`

**Interfaces:**
- Produces: `getExtensionWorker(context) => Promise<Worker>` and `injectAndScrape({ worker, page, scriptFile, weekStart, weekEnd }) => Promise<{ success: boolean, count: number } | null>` — this is where ADR-0001's core mechanism lives: no popup UI, no raw `addScriptTag`, just `chrome.scripting.executeScript` called from inside the extension's own service worker.
- Consumes: a Playwright `BrowserContext` (`context`) with the extension already loaded via `--load-extension` (wired up in Task 9), and a Playwright `Page` (`page`) already navigated to the target URL.
- No unit test — this requires a real loaded extension and real browser; it is exercised for real in Task 9's smoke test and Task 10's end-to-end run, per the spec's Verification section.

- [ ] **Step 1: Write `automation/lib/serviceWorker.js`**

```js
async function getExtensionWorker(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }
  return worker;
}

async function injectAndScrape({ worker, page, scriptFile, weekStart, weekEnd }) {
  const url = page.url();

  const result = await worker.evaluate(
    async ({ url, scriptFile, weekStart, weekEnd }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url === url);
      if (!tab) return { error: `No tab found matching URL: ${url}` };
      const tabId = tab.id;

      const now = new Date();
      const targetMonth = now.getMonth();
      const targetYear = now.getFullYear();

      await chrome.scripting.executeScript({
        target: { tabId },
        func: (m, y, ws, we) => {
          window.__targetMonth = m;
          window.__targetYear = y;
          window.__targetWeekStart = ws;
          window.__targetWeekEnd = we;
        },
        args: [targetMonth, targetYear, weekStart, weekEnd],
      });

      await chrome.scripting.executeScript({ target: { tabId }, files: ['scripts/common.js'] });
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        files: [`scripts/${scriptFile}`],
      });
      return results?.[0]?.result ?? null;
    },
    { url, scriptFile, weekStart, weekEnd }
  );

  if (result && result.error) throw new Error(result.error);
  return result;
}

module.exports = { getExtensionWorker, injectAndScrape };
```

- [ ] **Step 2: Commit**

```bash
git add automation/lib/serviceWorker.js
git commit -m "Add service-worker-driven script injection (ADR-0001)"
```

---

## Task 9: Smoke test

**Files:**
- Create: `reviews-extract/automation/smoke-test.js`

**Interfaces:**
- Consumes: `getExtensionWorker` from Task 8; the real "Free Spirit" profile path (user-supplied, see Step 1 below).
- Produces: a runnable script that answers the spec's open risk questions before Task 10 is attempted — this is the Rollout plan's step 1.

- [ ] **Step 1: Find the real profile path**

In the "Free Spirit" Chrome profile, navigate to `chrome://version`. Note the "Profile Path" value shown there, e.g. `/Users/antunzebec/Library/Application Support/Google/Chrome/Profile 5`. The **parent** directory (`.../Chrome`) is the `userDataDir` Playwright needs; the profile's own folder name (e.g. `Profile 5`) is passed separately as `--profile-directory`.

Close that Chrome window completely (Cmd+Q Chrome, or close all windows using that profile) before running the smoke test — Chrome locks the profile directory while open (spec: Known risks — Profile locking).

- [ ] **Step 2: Write `automation/smoke-test.js`**

```js
const { chromium } = require('playwright');
const path = require('node:path');
const { getExtensionWorker } = require('./lib/serviceWorker');

// Fill these in from Step 1 before running.
const USER_DATA_DIR = '/Users/antunzebec/Library/Application Support/Google/Chrome';
const PROFILE_DIRECTORY = 'REPLACE_WITH_REAL_PROFILE_FOLDER_NAME'; // e.g. "Profile 5"
const EXTENSION_PATH = path.join(__dirname, '..');

async function main() {
  for (const headless of [true, false]) {
    console.log(`\n--- Trying headless=${headless} ---`);
    let context;
    try {
      context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless,
        args: [
          `--profile-directory=${PROFILE_DIRECTORY}`,
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
        ],
      });
    } catch (err) {
      console.error(`Failed to launch (headless=${headless}):`, err.message);
      continue;
    }

    try {
      const worker = await getExtensionWorker(context);
      console.log('Got extension service worker:', worker.url());

      const page = await context.newPage();
      await page.goto('https://www.tripadvisor.com/', { waitUntil: 'domcontentloaded' });

      const tabCheck = await worker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        return { tabCount: tabs.length, matched: tabs.some((t) => t.url === url) };
      }, page.url());
      console.log('chrome.tabs.query from service worker:', tabCheck);

      console.log(`SUCCESS with headless=${headless}. Use this mode in run.js.`);
      await context.close();
      return;
    } catch (err) {
      console.error(`Service worker / chrome.scripting check failed (headless=${headless}):`, err.message);
      await context.close();
    }
  }

  console.error('\nBoth headless and headed attempts failed — see ADR-0001 and the spec\'s Known risks section. Enterprise policy on the managed profile may be blocking extension loading or CDP.');
  process.exitCode = 1;
}

main();
```

- [ ] **Step 3: Fill in `PROFILE_DIRECTORY` and run it**

Run: `cd automation && node smoke-test.js`
Expected: one of the two `headless` attempts prints `SUCCESS with headless=<true|false>`. Note which mode succeeded — Task 10 must use that mode.

If **both** fail: stop here. Per the spec's Rollout plan step 1, this means the managed profile's enterprise policy is blocking Playwright/CDP entirely, and the architecture in the spec needs to be reconsidered before continuing — do not proceed to Task 10.

- [ ] **Step 4: Commit**

```bash
git add automation/smoke-test.js
git commit -m "Add smoke test verifying Playwright can drive the Free Spirit profile + extension"
```

---

## Task 10: Orchestration (`run.js`)

**Files:**
- Create: `reviews-extract/automation/run.js`

**Interfaces:**
- Consumes: `loadConfig` (Task 3), `previousWeekRange` (Task 4), `isAuthWall` (Task 5), `buildReportText`/`sendReport` (Task 6), `createLogger` (Task 7), `getExtensionWorker`/`injectAndScrape` (Task 8). The confirmed working `headless` mode from Task 9's smoke test.
- Produces: the full weekly run — this is the script `launchd` will invoke (Task 11).

- [ ] **Step 1: Write `automation/run.js`**

```js
const { chromium } = require('playwright');
const path = require('node:path');
const { loadConfig } = require('./lib/config');
const { previousWeekRange } = require('./lib/weekRange');
const { isAuthWall } = require('./lib/authWall');
const { buildReportText, sendReport } = require('./lib/report');
const { createLogger } = require('./lib/logger');
const { getExtensionWorker, injectAndScrape } = require('./lib/serviceWorker');

// Set from Task 9's smoke test — the mode that succeeded.
const HEADLESS = true; // flip to false if the smoke test required a headed browser
const USER_DATA_DIR = '/Users/antunzebec/Library/Application Support/Google/Chrome';
const PROFILE_DIRECTORY = 'REPLACE_WITH_REAL_PROFILE_FOLDER_NAME'; // from Task 9 Step 1
const EXTENSION_PATH = path.join(__dirname, '..');

async function runPlatform({ context, worker, platform, weekStart, weekEnd, log }) {
  const page = await context.newPage();
  try {
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // let client-side redirects/DOM settle

    const hasSelector = async (selector) => (await page.locator(selector).count()) > 0;
    const wallCheck = await hasSelector(platform.authWallSelectors[0] || '__none__');
    if (isAuthWall({ url: page.url(), hasSelector: () => wallCheck }, platform)) {
      log(`${platform.id}: auth wall detected at ${page.url()}`);
      return { id: platform.id, status: 'needsReauth' };
    }

    const weekArgs = platform.weekSupported ? { weekStart, weekEnd } : { weekStart: null, weekEnd: null };
    const result = await injectAndScrape({ worker, page, scriptFile: platform.script, ...weekArgs });

    if (result && result.success) {
      log(`${platform.id}: success, ${result.count} reviews`);
      return { id: platform.id, status: 'success', count: result.count };
    }
    log(`${platform.id}: script ran but reported no success (result=${JSON.stringify(result)})`);
    return { id: platform.id, status: 'error', message: 'scraper returned no reviews / success:false' };
  } catch (err) {
    log(`${platform.id}: error - ${err.message}`);
    return { id: platform.id, status: 'error', message: err.message };
  } finally {
    await page.close();
  }
}

async function main() {
  const { platforms, secrets } = loadConfig();
  const { log, filePath } = createLogger();
  const { start: weekStart, end: weekEnd } = previousWeekRange();

  log(`Starting run. Target week: ${new Date(weekStart).toDateString()} - ${new Date(weekEnd).toDateString()}`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    args: [
      `--profile-directory=${PROFILE_DIRECTORY}`,
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  const results = [];
  try {
    const worker = await getExtensionWorker(context);
    log(`Extension service worker ready: ${worker.url()}`);

    for (const platform of platforms) {
      const result = await runPlatform({ context, worker, platform, weekStart, weekEnd, log });
      results.push(result);
    }
  } finally {
    await context.close();
  }

  const reportText = buildReportText(results);
  log(`Run complete:\n${reportText}`);

  await sendReport({
    secrets,
    subject: `Reviews Extract weekly run — ${new Date().toDateString()}`,
    text: `${reportText}\n\nFull log: ${filePath}`,
  });

  const hadErrors = results.some((r) => r.status !== 'success');
  process.exitCode = hadErrors ? 1 : 0;
}

main().catch((err) => {
  console.error('Fatal error in automation run:', err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Fill in `PROFILE_DIRECTORY` and `HEADLESS` from Task 9's result, and real config**

Copy `automation/platforms.example.json` to `automation/platforms.json` and fill in the 7 real reviews-page URLs. Copy `automation/secrets.example.json` to `automation/secrets.json` and fill in the real Gmail app password and report recipient.

- [ ] **Step 3: Dry run against a known past week**

Run: `cd automation && node run.js`
Expected: exits 0 (or 1 with only `needsReauth`/expected errors — not crashes), an email arrives summarizing all 7 platforms, and the Google Sheet ("Review HUB") shows the same reviews for that week that a manual popup run would produce. Compare against a manual run for one platform to confirm counts match (spec: Verification step 2).

- [ ] **Step 4: Commit**

```bash
git add automation/run.js
git commit -m "Add weekly run orchestration script"
```

---

## Task 11: launchd scheduling

**Files:**
- Create: `reviews-extract/com.dodai.reviews-extract.plist.example`

**Interfaces:**
- Consumes: `automation/run.js` (Task 10).
- Produces: a weekly-scheduled, wake-aware trigger, installed by the user (LaunchAgents live under the user's home directory, not this repo, so the plan installs a copy rather than symlinking a committed file with the user's real node path baked in).

- [ ] **Step 1: Create `com.dodai.reviews-extract.plist.example`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.dodai.reviews-extract</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract/automation/run.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract/automation</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>1</integer>
        <key>Hour</key>
        <integer>6</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract/automation/logs/launchd.out.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract/automation/logs/launchd.err.log</string>
</dict>
</plist>
```

`Weekday 1` = Monday, `Hour 6, Minute 0` = 06:00 local time, matching the spec's Scheduling section. Verify `/opt/homebrew/bin/node` matches the real `node` path (confirmed earlier: `which node` → `/opt/homebrew/bin/node`).

- [ ] **Step 2: Install it**

Run:
```bash
cp "/Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract/com.dodai.reviews-extract.plist.example" ~/Library/LaunchAgents/com.dodai.reviews-extract.plist
launchctl load ~/Library/LaunchAgents/com.dodai.reviews-extract.plist
```
Expected: no errors from `launchctl load`.

- [ ] **Step 3: Trigger one run manually to confirm the LaunchAgent itself works**

Run: `launchctl start com.dodai.reviews-extract`
Expected: `automation/logs/launchd.out.log` and the day's `YYYY-MM-DD.log` update within a minute or two, and the summary email arrives — confirming `launchd` invokes `run.js` correctly end-to-end, independent of the weekly schedule timing.

- [ ] **Step 4: Commit**

```bash
git add com.dodai.reviews-extract.plist.example
git commit -m "Add launchd LaunchAgent template for weekly scheduled runs"
```

---

## Self-Review Notes

- **Spec coverage:** Context/constraints → Global Constraints + Tasks 1, 3; Architecture (service-worker injection, host_permissions) → Tasks 2, 8; Per-platform auth strategy (session reuse, no programmatic login, auth-wall detection) → Tasks 3, 5, 10; Failure detection & notification → Tasks 6, 7, 10; Scheduling → Task 11; Known risks (enterprise policy, profile locking, userDataDir path, Gmail mechanism) → Task 9 (policy risk resolved by smoke test), Task 9 Step 1 (path), Task 6 (Gmail resolved as SMTP + app password); Rollout plan steps 1-6 map directly to Tasks 9, 2+3(no-login platforms first is covered by running all platforms through the same code path in Task 10 — no-login platforms simply have empty `authWallSelectors`), 3(login platforms), 6, 11; Verification steps map to Task 9 Step 3 (smoke), Task 10 Step 3 (parity check), Task 10 (needsReauth/error handling built into `run.js`'s try/catch per platform), Task 11 Step 3 (launchd fires without user present).
- **Placeholder scan:** No "TBD"/"implement later" in any step. `REPLACE_WITH_REAL_*` strings are intentional user-supplied data in gitignored config/scripts, not plan placeholders — `config.js` (Task 3) actively rejects them at runtime so a forgotten placeholder fails loudly instead of silently.
- **Type consistency:** `PlatformConfig` fields (`id`, `script`, `url`, `needsLogin`, `weekSupported`, `authWallSelectors`, `authWallUrlContains`) are consistent across Tasks 3, 5, 10. `PlatformResult` (`id`, `status`, `count?`, `message?`) is consistent across Tasks 6 and 10. `injectAndScrape`'s return shape (`{ success, count } | null`) matches what platform scripts already return per `CLAUDE.md`'s Architecture section, and is consumed correctly in Task 10's `runPlatform`.
