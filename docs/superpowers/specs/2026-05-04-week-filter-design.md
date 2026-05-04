# Week Filter Design

## Context

The extension currently supports filtering reviews by month. Users need finer control — specifically the ability to extract reviews from a single calendar week within a month. Week boundaries must not be cut at month edges (e.g. Apr 27 – May 3 is a valid week even though it spans two months).

Platforms in scope for week filtering: Freetour, GetYourGuide, Google, Guruwalk, Viator.  
Excluded from week filtering (insufficient date precision): Airbnb, TripAdvisor.

**Airbnb month filter bug (fixed in this same change):** Airbnb's review date element contains "April 2026 · 9:30 AM". `new Date("April 2026")` returns `Invalid Date` in Chrome V8, so `formatDate` falls back to the raw string and no month comparison is ever made — all visible reviews are sent regardless of the selected month. Fixed by adding a `parseMonthYear` helper to `common.js` and using it in `airbnb.js`.

---

## UI

**`popup.html`**  
Add a labeled week select block immediately below the month select block:
```html
<div style="margin-bottom: 15px; text-align: center;">
  <label for="week-select" style="font-weight: bold; display: block; margin-bottom: 5px;">Scrape Week:</label>
  <select id="week-select" style="width: 100%; padding: 6px; font-size: 14px;"></select>
</div>
```

**`popup.js`**  
- Add `weekSupported: false` to the Airbnb and TripAdvisor entries in the `PLATFORMS` array.
- On DOMContentLoaded and on every `change` event of the month select: repopulate the week dropdown.
  - First option: `"All weeks"` (value `"null"`).
  - Remaining options: one per Mon–Sun week that overlaps the selected month.
    - Find the Monday of the week containing day 1 of the month (step back to the previous Monday if day 1 is not a Monday).
    - Advance by 7-day increments until the Monday is past the last day of the month.
    - Label format: `"Mar 30 – Apr 5"` (3-letter month abbreviation, no leading zero on day).
    - Value: `JSON.stringify({ start: <ms timestamp of Monday midnight>, end: <ms timestamp of Sunday midnight> })`.
  - Reset selection to "All weeks" whenever the month changes.
- When the auto-detected active platform has `weekSupported: false`, set `weekSelect.disabled = true`.
- In `injectScript`, extend the existing executeScript call that sets month/year to also set week vars:
  ```js
  func: (m, y, ws, we) => {
    window.__targetMonth = m;
    window.__targetYear = y;
    window.__targetWeekStart = ws; // ms timestamp or null
    window.__targetWeekEnd = we;   // ms timestamp or null
  },
  args: [targetData.month, targetData.year, weekStart, weekEnd]
  ```
  `weekStart`/`weekEnd` are `null` when "All weeks" is selected.

---

## common.js

**Add `parseMonthYear(text)`** — parses "April 2026" → `{ month: 3, year: 2026 }` (month 0-indexed). Returns `null` if unparseable. Uses the existing `MONTH_FULL_TO_IDX` map.

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

**Add `getTargetWeek()`** — returns `null` when no week is selected, or `{ start: Date, end: Date }` (end is set to 23:59:59.999 of Sunday in local time).

```js
function getTargetWeek() {
  if (window.__targetWeekStart == null) return null;
  const start = new Date(window.__targetWeekStart);
  const end = new Date(window.__targetWeekEnd);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
```

Expose both in the `window.__re = { ... }` block.

---

## Platform Script Changes

### Airbnb (`scripts/airbnb.js`) — month filter fix only, no week filtering

- At the top of `scrapeData()`, resolve target month/year:
  ```js
  const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
  ```
- Inside the `reviewNodes.forEach`, after extracting `parts[0]`:
  ```js
  const rawDateStr = parts.length > 0 ? parts[0].trim() : "";
  const parsedMY = window.__re.parseMonthYear(rawDateStr);
  if (parsedMY && (parsedMY.month !== targetMonth || parsedMY.year !== targetYear)) return;
  dateVal = window.__re.formatDate(rawDateStr); // keeps existing formatting path
  ```
- No week filter is applied. The week dropdown is disabled on Airbnb pages.

### Freetour (`scripts/freetour.js`)

- After resolving `targetMonth`/`targetYear`, call:
  ```js
  const targetWeek = window.__re.getTargetWeek();
  ```
- Change `cutoffDate` (used against review submission dates for pagination):
  ```js
  const cutoffDate = targetWeek ? targetWeek.start : new Date(targetYear, targetMonth, 1);
  ```
- Change the final filter (applied against tour date `_rawDateObj`):
  ```js
  const validRows = allRows.filter(r => {
    if (!r._rawDateObj || isNaN(r._rawDateObj.getTime())) return false;
    if (targetWeek) return r._rawDateObj >= targetWeek.start && r._rawDateObj <= targetWeek.end;
    return r._rawDateObj.getFullYear() === targetYear && r._rawDateObj.getMonth() === targetMonth;
  });
  ```

### Guruwalk (`scripts/guruwalk.js`)

Same structural changes as Freetour, but **Guruwalk keeps undated rows** (its existing behaviour). The updated filter:

```js
const validRows = allRows.filter(r => {
  if (!r._rawDateObj || isNaN(r._rawDateObj.getTime())) return true; // keep undated rows
  if (targetWeek) return r._rawDateObj >= targetWeek.start && r._rawDateObj <= targetWeek.end;
  return r._rawDateObj.getFullYear() === targetYear && r._rawDateObj.getMonth() === targetMonth;
});
```

`cutoffDate` changes identically to Freetour.

### Google (`scripts/google.js`)

- Call `getTargetWeek()` after resolving target month/year.
- Change the scroll-stop condition:
  ```js
  const cutoff = targetWeek ? targetWeek.start : cutoffDate;
  if (oldestLoadedDate < cutoff) { ... stop scrolling ... }
  ```
- Change the final filter:
  ```js
  const validReviews = rawReviews.filter(r => {
    if (!r.publishedAtISO) return true;
    const d = new Date(r.publishedAtISO);
    if (targetWeek) return d >= targetWeek.start && d <= targetWeek.end;
    return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
  });
  ```

### GetYourGuide (`scripts/getyourguide.js`)

In `ensurePreviousMonthFilter()`, after resolving target month/year:
```js
const targetWeek = window.__re.getTargetWeek();
const targetFrom = targetWeek
  ? window.__re.formatISODate(targetWeek.start)
  : window.__re.formatISODate(new Date(targetYear, targetMonth, 1));
const targetTo = targetWeek
  ? window.__re.formatISODate(targetWeek.end)
  : window.__re.formatISODate(new Date(targetYear, targetMonth + 1, 0));
```
No other changes — filtering is done server-side via URL params.

### Viator (`scripts/viator.js`)

Same change as GetYourGuide in `ensurePreviousMonthFilter()`.

---

## Known Limitations

- **Freetour/Guruwalk pagination cutoff uses submission date, not tour date.** The cutoff that stops pagination is compared against the review *submission* date, while the final filter uses the *tour* date. For a week-range that starts near a month boundary, the scraper may stop a page or two early if submission dates dip below the cutoff before tour dates do. This is the same imprecision as the existing month filter and is acceptable.

- **Cross-month weeks on Freetour/Guruwalk.** These platforms paginate through a single review page URL. If a selected week spans two months (e.g. Apr 27–May 3) but the user is on the April Freetour/Guruwalk page, reviews for May 1–3 tours may live on a separate May URL and will be missed. The user would need to navigate to the May page and run the scrape again.

- **Google Maps relative date approximation.** Google shows dates as relative strings ("3 weeks ago"). `parseRelativeDate` approximates them; the cutoff and filter may be off by ±1 day around week boundaries.

---

## Verification

1. Load the extension unpacked in Chrome (`chrome://extensions` → Load unpacked).
2. **Airbnb fix:** Navigate to an Airbnb experience reviews page. Select a past month with no visible reviews, click "Airbnb Reviews" — confirm 0 reviews are sent. Select the correct month — confirm reviews are sent.
3. Open the popup on a neutral tab — confirm week dropdown is present and enabled, showing "All weeks" for the current month.
4. Open the popup on an Airbnb or TripAdvisor tab — confirm week select is disabled.
5. Navigate to a Freetour/Guruwalk/Google/GYG/Viator review page. Select a month — confirm week dropdown repopulates with correct Mon–Sun ranges including cross-month weeks.
6. Select a mid-month week, run scrape — confirm only reviews from that exact week appear in Sheets.
7. Select a cross-month week (e.g. Apr 27–May 3), run scrape — confirm reviews spanning the month boundary are included.
8. Select "All weeks" — confirm behaviour is identical to the original month filter.
9. Change the month while a week is selected — confirm week dropdown resets to "All weeks" and repopulates.
