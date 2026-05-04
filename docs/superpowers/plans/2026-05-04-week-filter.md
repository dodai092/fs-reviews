# Week Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a week-granularity filter to the Reviews Extract extension (Mon–Sun, not cut at month boundaries), fix the Airbnb month filter bug, and expose a week-aware UI that is disabled for Airbnb and TripAdvisor.

**Architecture:** Two new helpers (`parseMonthYear`, `getTargetWeek`) are added to `common.js` and exposed on `window.__re`. The popup grows a week `<select>` whose Mon–Sun ranges are computed from the selected month; the selected week is passed as ms timestamps alongside the existing month/year vars. Each supported platform script checks `getTargetWeek()` and branches to a date-range filter instead of the month/year equality check.

**Tech Stack:** Plain JavaScript (no bundler), Chrome Extension Manifest V3, `chrome.scripting.executeScript`.

---

## Files Changed

| File | Change |
|---|---|
| `scripts/common.js` | Add `parseMonthYear`, `getTargetWeek`; expose both on `window.__re` |
| `scripts/airbnb.js` | Add month filter using `parseMonthYear` + `getTargetMonthYear` |
| `popup.html` | Add labeled `<select id="week-select">` block |
| `popup.js` | Add `weekSupported` flag, week generation, populate/disable logic, extend injection args |
| `scripts/freetour.js` | Add `getTargetWeek`; branch `cutoffDate` and final filter |
| `scripts/guruwalk.js` | Same as Freetour (keeps `return true` for undated rows) |
| `scripts/google.js` | Branch scroll-stop cutoff and final filter |
| `scripts/getyourguide.js` | Branch `date_from`/`date_to` URL params in `ensurePreviousMonthFilter` |
| `scripts/viator.js` | Same as GetYourGuide |

---

## Task 1: Add `parseMonthYear` and `getTargetWeek` to `common.js`

**Files:**
- Modify: `scripts/common.js`

- [ ] **Step 1: Add `parseMonthYear` after the existing date formatters**

In `common.js`, after the `parseRelativeDate` function (around line 230, before `// ─── 6. LANGUAGE FORMATTER`), insert:

```js
function parseMonthYear(text) {
  if (!text) return null;
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const month = MONTH_FULL_TO_IDX[parts[0].toLowerCase()];
  const year = parseInt(parts[1], 10);
  if (month === undefined || isNaN(year)) return null;
  return { month, year };
}
```

- [ ] **Step 2: Add `getTargetWeek` after `getTargetMonthYear`**

In `common.js`, after the closing brace of `getTargetMonthYear` (around line 262, before `// ─── 9. WEBHOOK INTEGRATION`), insert:

```js
function getTargetWeek() {
  if (window.__targetWeekStart == null) return null;
  const start = new Date(window.__targetWeekStart);
  const end = new Date(window.__targetWeekEnd);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
```

- [ ] **Step 3: Expose both functions on `window.__re`**

In `common.js`, in the `window.__re = { ... }` block (around line 315), add `parseMonthYear` and `getTargetWeek` to the object:

```js
window.__re = {
  log, warn, error,
  extractGuideName, getGuideCity, guessCity, mapTourName,
  formatDate, formatTime, formatTime12, formatISODate, parseDashDate, parseLongDate, parseRelativeDate,
  parseMonthYear,          // ← new
  formatLang,
  getTargetMonthYear,
  getTargetWeek,           // ← new
  waitForDOMSettle,
  sendDataToWebhook,
  buildTSV,
  GUIDES, CITY_MAP, TOUR_MAP, MONTH_NAMES,
};
```

- [ ] **Step 4: Manually verify helpers are available**

Load extension unpacked (`chrome://extensions` → Reload). Open any tab, open DevTools console, run:
```js
// Inject common.js manually for testing
// (or open popup, click any button, then check console)
```
After clicking any platform button, confirm console shows `[RE] common.js loaded — window.__re is ready.` with no errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/common.js
git commit -m "feat: add parseMonthYear and getTargetWeek helpers to common.js"
```

---

## Task 2: Fix Airbnb Month Filter

**Files:**
- Modify: `scripts/airbnb.js`

Currently Airbnb sends all visible reviews regardless of selected month because `new Date("April 2026")` returns `Invalid Date` in Chrome V8, so `formatDate` falls back to the raw string and no comparison is ever made.

- [ ] **Step 1: Add `getTargetMonthYear` call at top of `scrapeData`**

In `airbnb.js`, at the very start of `function scrapeData()`, before the `reviewNodes` query, insert:

```js
const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
```

- [ ] **Step 2: Add month filter inside the `reviewNodes.forEach` loop**

In `airbnb.js`, inside `reviewNodes.forEach(node => { try {`, replace the existing date extraction block:

```js
// BEFORE:
const metaDiv = node.querySelector(".d1ylbvwr");
let dateVal = "", timeVal = "";
if (metaDiv) {
    const parts = metaDiv.innerText.split("·");
    if (parts.length > 0) dateVal = window.__re.formatDate(parts[0].trim());
    if (parts.length > 1) timeVal = window.__re.formatTime12(parts[1].trim());
}
```

```js
// AFTER:
const metaDiv = node.querySelector(".d1ylbvwr");
let dateVal = "", timeVal = "";
if (metaDiv) {
    const parts = metaDiv.innerText.split("·");
    const rawDateStr = parts.length > 0 ? parts[0].trim() : "";
    const parsedMY = window.__re.parseMonthYear(rawDateStr);
    if (parsedMY && (parsedMY.month !== targetMonth || parsedMY.year !== targetYear)) return;
    dateVal = window.__re.formatDate(rawDateStr);
    if (parts.length > 1) timeVal = window.__re.formatTime12(parts[1].trim());
}
```

- [ ] **Step 3: Manually verify Airbnb month filter**

Navigate to an Airbnb experience reviews page. Open the extension popup:
1. Select a month that has **no visible reviews on screen** (e.g. 2 months ago if the page shows only current month). Click "Airbnb Reviews". Status should show `No reviews found.`
2. Select the month **matching the reviews currently visible on screen**. Click "Airbnb Reviews". Status should show `Done! N reviews sent to Sheets.`

- [ ] **Step 4: Commit**

```bash
git add scripts/airbnb.js
git commit -m "fix: apply month filter to Airbnb reviews using parseMonthYear"
```

---

## Task 3: Add Week Select UI and Disable Logic

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`

- [ ] **Step 1: Add the week select block to `popup.html`**

In `popup.html`, immediately after the closing `</div>` of the month select block (after `</select></div>`), insert:

```html
<div style="margin-bottom: 15px; text-align: center;">
  <label for="week-select" style="font-weight: bold; display: block; margin-bottom: 5px;">Scrape Week:</label>
  <select id="week-select" style="width: 100%; padding: 6px; font-size: 14px;"></select>
</div>
```

- [ ] **Step 2: Add `weekSupported: false` to PLATFORMS in `popup.js`**

In `popup.js`, update the `PLATFORMS` array entries for Airbnb and TripAdvisor:

```js
const PLATFORMS = [
  { id: 'btn-airbnb',      script: 'airbnb.js',      domains: ['airbnb.com', 'airbnb.co.uk'],          weekSupported: false },
  { id: 'btn-freetour',    script: 'freetour.js',     domains: ['freetour.com'] },
  { id: 'btn-gyg',         script: 'getyourguide.js', domains: ['getyourguide.com'] },
  { id: 'btn-google',      script: 'google.js',       domains: ['google.com/maps', 'maps.google'] },
  { id: 'btn-guruwalk',    script: 'guruwalk.js',     domains: ['guruwalk.com'] },
  { id: 'btn-viator',      script: 'viator.js',       domains: ['viator.com'] },
  { id: 'btn-tripadvisor', script: 'tripadvisor.js',  domains: ['tripadvisor.com'],                    weekSupported: false },
];
```

- [ ] **Step 3: Add week generation helpers and `populateWeekSelect` to `popup.js`**

In `popup.js`, after the `const monthSelect = ...` line (and before the month dropdown population block), insert:

```js
const weekSelect = document.getElementById('week-select');

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function getWeeksForMonth(month, year) {
  const firstDay = new Date(year, month, 1);
  const dow = firstDay.getDay(); // 0=Sun, 1=Mon...6=Sat
  const daysToMonday = dow === 0 ? -6 : 1 - dow;
  const firstMonday = new Date(year, month, 1 + daysToMonday);
  const lastDay = new Date(year, month + 1, 0);
  const weeks = [];
  let monday = new Date(firstMonday);
  while (monday <= lastDay) {
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    weeks.push({ start: new Date(monday), end: new Date(sunday) });
    monday = new Date(monday);
    monday.setDate(monday.getDate() + 7);
  }
  return weeks;
}

function formatWeekLabel(start, end) {
  return `${MONTH_ABBR[start.getMonth()]} ${start.getDate()} – ${MONTH_ABBR[end.getMonth()]} ${end.getDate()}`;
}

function populateWeekSelect() {
  if (!weekSelect || !monthSelect) return;
  const target = JSON.parse(monthSelect.value);
  const weeks = getWeeksForMonth(target.month, target.year);
  weekSelect.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = 'null';
  allOpt.text = 'All weeks';
  weekSelect.appendChild(allOpt);
  weeks.forEach(({ start, end }) => {
    const opt = document.createElement('option');
    opt.value = JSON.stringify({ start: start.getTime(), end: end.getTime() });
    opt.text = formatWeekLabel(start, end);
    weekSelect.appendChild(opt);
  });
}
```

- [ ] **Step 4: Call `populateWeekSelect` on load and on month change**

In `popup.js`, immediately after the existing month dropdown population block (after the closing `}` of the `if (monthSelect)` block that populates months), insert:

```js
populateWeekSelect();

if (monthSelect) {
  monthSelect.addEventListener('change', () => {
    populateWeekSelect();
  });
}
```

- [ ] **Step 5: Disable week select for unsupported platforms in the auto-detect callback**

In `popup.js`, inside `chrome.tabs.query(...)`, after `if (btn) btn.classList.add('active');`, insert:

```js
if (weekSelect && platform.weekSupported === false) {
  weekSelect.disabled = true;
}
```

The full updated auto-detect callback becomes:

```js
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  cachedTab = tabs[0] || null;
  const url = cachedTab?.url || '';
  for (const platform of PLATFORMS) {
    if (platform.domains.some(domain => url.includes(domain))) {
      const btn = document.getElementById(platform.id);
      if (btn) btn.classList.add('active');
      if (weekSelect && platform.weekSupported === false) {
        weekSelect.disabled = true;
      }
      break;
    }
  }
});
```

- [ ] **Step 6: Manually verify UI**

Reload extension. Open popup on a neutral tab:
- Confirm "Scrape Week:" label and dropdown appear below "Scrape Reviews For:".
- Confirm dropdown shows "All weeks" then Mon–Sun week ranges for the selected month (e.g. for May 2026: "Apr 27 – May 3", "May 4 – May 10", "May 11 – May 17", "May 18 – May 24", "May 25 – May 31").
- Change month to April 2026 — confirm weeks reset and show "Mar 30 – Apr 5", "Apr 6 – Apr 12", "Apr 13 – Apr 19", "Apr 20 – Apr 26", "Apr 27 – May 3".

Open popup on an Airbnb tab:
- Confirm week dropdown is grayed out (disabled).

Open popup on a TripAdvisor tab:
- Confirm week dropdown is grayed out.

Open popup on a Freetour/GYG/Guruwalk/Viator/Google tab:
- Confirm week dropdown is enabled.

- [ ] **Step 7: Commit**

```bash
git add popup.html popup.js
git commit -m "feat: add week select UI with Mon-Sun week generation and disable for unsupported platforms"
```

---

## Task 4: Wire Week Variables to Script Injection

**Files:**
- Modify: `popup.js`

- [ ] **Step 1: Read week selection and extend the executeScript call**

In `popup.js`, inside `const injectScript = (scriptFile) => {`, immediately after the `const targetData = ...` line, insert:

```js
const weekVal = weekSelect ? weekSelect.value : 'null';
const weekData = weekVal === 'null' ? null : JSON.parse(weekVal);
const weekStart = weekData ? weekData.start : null;
const weekEnd = weekData ? weekData.end : null;
```

Then replace the existing executeScript call that sets month/year vars:

```js
// BEFORE:
chrome.scripting.executeScript({
  target: { tabId },
  func: (m, y) => { window.__targetMonth = m; window.__targetYear = y; },
  args: [targetData.month, targetData.year]
}, injectCommon);
```

```js
// AFTER:
chrome.scripting.executeScript({
  target: { tabId },
  func: (m, y, ws, we) => {
    window.__targetMonth = m;
    window.__targetYear = y;
    window.__targetWeekStart = ws;
    window.__targetWeekEnd = we;
  },
  args: [targetData.month, targetData.year, weekStart, weekEnd]
}, injectCommon);
```

- [ ] **Step 2: Manually verify vars are set**

Reload extension. Navigate to any supported platform page. Open DevTools on that tab. Click a platform button. After injection, run in console:

```js
console.log(window.__targetMonth, window.__targetYear, window.__targetWeekStart, window.__targetWeekEnd);
```

Expected with "All weeks" selected: `<month> <year> null null`  
Expected with a specific week selected: `<month> <year> <ms timestamp> <ms timestamp>`

- [ ] **Step 3: Commit**

```bash
git add popup.js
git commit -m "feat: pass week start/end timestamps to injected platform scripts"
```

---

## Task 5: Add Week Filter to Freetour

**Files:**
- Modify: `scripts/freetour.js`

- [ ] **Step 1: Resolve target week and update `cutoffDate`**

In `freetour.js`, after line 7 (`const cutoffDate = new Date(targetYear, targetMonth, 1);`), replace that line and add the week lookup:

```js
const targetWeek = window.__re.getTargetWeek();
const cutoffDate = targetWeek ? targetWeek.start : new Date(targetYear, targetMonth, 1);
```

- [ ] **Step 2: Update the final filter**

In `freetour.js`, replace the existing `validRows` filter (around lines 149–156):

```js
// BEFORE:
const validRows = allRows.filter(r => {
    if (!r._rawDateObj || isNaN(r._rawDateObj.getTime())) return false; 
    return r._rawDateObj.getFullYear() === targetYear && r._rawDateObj.getMonth() === targetMonth;
}).map(r => {
    const cleaned = { ...r };
    delete cleaned._rawDateObj; 
    return cleaned;
});
```

```js
// AFTER:
const validRows = allRows.filter(r => {
    if (!r._rawDateObj || isNaN(r._rawDateObj.getTime())) return false;
    if (targetWeek) return r._rawDateObj >= targetWeek.start && r._rawDateObj <= targetWeek.end;
    return r._rawDateObj.getFullYear() === targetYear && r._rawDateObj.getMonth() === targetMonth;
}).map(r => {
    const cleaned = { ...r };
    delete cleaned._rawDateObj;
    return cleaned;
});
```

- [ ] **Step 3: Manually verify**

Navigate to a Freetour review page. Select a specific week in the popup. Click "Freetour Reviews". Confirm Sheets only receives reviews with tour dates within that Mon–Sun range. Then select "All weeks" and confirm behaviour is identical to before.

- [ ] **Step 4: Commit**

```bash
git add scripts/freetour.js
git commit -m "feat: add week filter to Freetour scraper"
```

---

## Task 6: Add Week Filter to Guruwalk

**Files:**
- Modify: `scripts/guruwalk.js`

- [ ] **Step 1: Resolve target week and update `cutoffDate`**

In `guruwalk.js`, after line 11 (`const cutoffDate = new Date(targetYear, targetMonth, 1);`), replace that line:

```js
const targetWeek = window.__re.getTargetWeek();
const cutoffDate = targetWeek ? targetWeek.start : new Date(targetYear, targetMonth, 1);
```

- [ ] **Step 2: Update the final filter**

In `guruwalk.js`, replace the existing `validRows` filter (around lines 174–180). Note: Guruwalk **keeps** undated rows (`return true`), unlike Freetour.

```js
// BEFORE:
const validRows = allRows.filter(r => {
    if (!r._rawDateObj || isNaN(r._rawDateObj.getTime())) return true; 
    return r._rawDateObj.getFullYear() === targetYear && r._rawDateObj.getMonth() === targetMonth;
}).map(r => {
    delete r._rawDateObj; 
    return r;
});
```

```js
// AFTER:
const validRows = allRows.filter(r => {
    if (!r._rawDateObj || isNaN(r._rawDateObj.getTime())) return true; // keep undated rows
    if (targetWeek) return r._rawDateObj >= targetWeek.start && r._rawDateObj <= targetWeek.end;
    return r._rawDateObj.getFullYear() === targetYear && r._rawDateObj.getMonth() === targetMonth;
}).map(r => {
    delete r._rawDateObj;
    return r;
});
```

- [ ] **Step 3: Manually verify**

Navigate to a Guruwalk review page. Select a specific week. Click "Guruwalk Reviews". Confirm Sheets only receives reviews from that week. Select "All weeks" — confirm unchanged behaviour.

- [ ] **Step 4: Commit**

```bash
git add scripts/guruwalk.js
git commit -m "feat: add week filter to Guruwalk scraper"
```

---

## Task 7: Add Week Filter to Google

**Files:**
- Modify: `scripts/google.js`

- [ ] **Step 1: Resolve target week and update scroll-stop cutoff**

In `google.js`, after line 25 (`const cutoffDate = new Date(targetYear, targetMonth, 1);`), insert:

```js
const targetWeek = window.__re.getTargetWeek();
const scrollCutoff = targetWeek ? targetWeek.start : cutoffDate;
```

Then in `autoScrollToTarget()`, replace the cutoff comparison (line 69):

```js
// BEFORE:
if (oldestLoadedDate < cutoffDate) {
    window.__re.log(`Reached review older than target month (${lastDateText}). Stopping scroll.`);
    clearInterval(scrollInterval);
    resolve();
}
```

```js
// AFTER:
if (oldestLoadedDate < scrollCutoff) {
    window.__re.log(`Reached review older than target (${lastDateText}). Stopping scroll.`);
    clearInterval(scrollInterval);
    resolve();
}
```

- [ ] **Step 2: Update the final filter**

In `google.js`, replace the `validReviews` filter (lines 112–116):

```js
// BEFORE:
const validReviews = rawReviews.filter(r => {
    if (!r.publishedAtISO) return true; 
    const d = new Date(r.publishedAtISO);
    return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
});
```

```js
// AFTER:
const validReviews = rawReviews.filter(r => {
    if (!r.publishedAtISO) return true;
    const d = new Date(r.publishedAtISO);
    if (targetWeek) return d >= targetWeek.start && d <= targetWeek.end;
    return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
});
```

- [ ] **Step 3: Manually verify**

Navigate to a Google Maps review page (the kind that shows guide reviews). Select a specific week. Click "Google Reviews". Confirm Sheets only receives reviews from that week. Select "All weeks" — confirm unchanged behaviour.

- [ ] **Step 4: Commit**

```bash
git add scripts/google.js
git commit -m "feat: add week filter to Google Maps scraper"
```

---

## Task 8: Add Week Filter to GetYourGuide

**Files:**
- Modify: `scripts/getyourguide.js`

- [ ] **Step 1: Branch `date_from`/`date_to` by week in `ensurePreviousMonthFilter`**

In `getyourguide.js`, replace lines 6–8 inside `ensurePreviousMonthFilter`:

```js
// BEFORE:
const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
const targetFrom = window.__re.formatISODate(new Date(targetYear, targetMonth, 1));
const targetTo = window.__re.formatISODate(new Date(targetYear, targetMonth + 1, 0));
```

```js
// AFTER:
const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
const targetWeek = window.__re.getTargetWeek();
const targetFrom = targetWeek
    ? window.__re.formatISODate(targetWeek.start)
    : window.__re.formatISODate(new Date(targetYear, targetMonth, 1));
const targetTo = targetWeek
    ? window.__re.formatISODate(targetWeek.end)
    : window.__re.formatISODate(new Date(targetYear, targetMonth + 1, 0));
```

No other changes needed — GYG filters server-side via URL params.

- [ ] **Step 2: Manually verify**

Navigate to a GetYourGuide review page. Select a specific week (e.g. "Apr 27 – May 3"). Click "GetYourGuide Reviews". The extension should redirect to a URL containing `date_from=2026-04-27&date_to=2026-05-03`. Click the button again after redirect — confirm Sheets receives only reviews in that week. Select "All weeks" — confirm URL uses first-to-last of month.

- [ ] **Step 3: Commit**

```bash
git add scripts/getyourguide.js
git commit -m "feat: add week filter to GetYourGuide scraper via URL params"
```

---

## Task 9: Add Week Filter to Viator

**Files:**
- Modify: `scripts/viator.js`

- [ ] **Step 1: Branch `startDate`/`endDate` by week in `ensurePreviousMonthFilter`**

In `viator.js`, replace lines 6–8 inside `ensurePreviousMonthFilter`:

```js
// BEFORE:
const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
const targetFrom = window.__re.formatISODate(new Date(targetYear, targetMonth, 1));
const targetTo = window.__re.formatISODate(new Date(targetYear, targetMonth + 1, 0));
```

```js
// AFTER:
const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
const targetWeek = window.__re.getTargetWeek();
const targetFrom = targetWeek
    ? window.__re.formatISODate(targetWeek.start)
    : window.__re.formatISODate(new Date(targetYear, targetMonth, 1));
const targetTo = targetWeek
    ? window.__re.formatISODate(targetWeek.end)
    : window.__re.formatISODate(new Date(targetYear, targetMonth + 1, 0));
```

- [ ] **Step 2: Manually verify**

Navigate to a Viator review page. Select a specific week. Click "Viator Reviews". Confirm URL redirect includes the week's `startDate` and `endDate`. Click again after redirect — confirm Sheets receives only that week's reviews.

- [ ] **Step 3: Commit**

```bash
git add scripts/viator.js
git commit -m "feat: add week filter to Viator scraper via URL params"
```

---

## Final Verification Checklist

- [ ] Airbnb: selecting a non-matching month returns 0 reviews; selecting the correct month returns reviews
- [ ] Week dropdown shows correct Mon–Sun ranges including cross-month weeks (e.g. "Apr 27 – May 3" for April or May)
- [ ] Week dropdown resets to "All weeks" when month is changed
- [ ] Week dropdown is disabled on Airbnb and TripAdvisor pages
- [ ] Week dropdown is enabled on Freetour, GYG, Google, Guruwalk, Viator pages
- [ ] "All weeks" selected on any platform → identical behaviour to before this change
- [ ] Specific week selected on Freetour/Guruwalk/Google → only reviews from that Mon–Sun in Sheets
- [ ] Specific week selected on GYG/Viator → URL redirects to week range, reviews filtered server-side
- [ ] Cross-month week (e.g. Apr 27–May 3) selected → reviews from both months in that range included
