# TripAdvisor Scraper — Design Spec
Date: 2026-04-22

## Overview

Add a TripAdvisor review scraper to the Reviews Extract Chrome extension, matching the pattern of existing platform scripts (Viator, Airbnb, etc.). The scraper handles multi-page review listings by clicking through pagination in a loop within a single script execution (TripAdvisor uses client-side/SPA navigation — the URL does not change on page turn).

---

## Files Changed

| File | Change |
|---|---|
| `scripts/tripadvisor.js` | New file — scraper script |
| `popup.html` | Add `<button id="btn-tripadvisor">` |
| `popup.js` | Register TripAdvisor in `PLATFORMS` array |

---

## Selectors

All selectors derived from live TripAdvisor HTML (confirmed April 2026).

| Data | Selector | Notes |
|---|---|---|
| Review card | `[data-automation="reviewCard"]` | One per review |
| Rating | `svg[data-automation="bubbleRatingImage"] title` | Text: "5 of 5 bubbles" → parse first number |
| Written date | `.BNelO .biGQs.ncFvv` (first match) | Text: "Written April 4, 2026" → `parseLongDate` |
| Experience month | `.jXCrq` | Text: "Apr 2026 • Couples" → strip trip-type suffix |
| Review text | `.yCeTE` | May be split across spans; join inner text |
| Read more button | `button.UikNM` with text "Read more" | Expand before scraping |
| Next page link | `a[aria-label="Next page"]` | Absent on last page |

---

## Scraping Logic

### Target Month Filtering

- Uses `window.__re.getTargetMonthYear()` — same mechanism as all other scripts.
- **Filter by**: experience month (`.jXCrq`) — this is when the tour happened.
- **Stop paginating when**: a card's **written date** is more than 2 months before the target month. Written date is used (not experience month) because experience month can lag written date by several months; stopping on experience month alone risks cutting off valid recent reviews.
- Collect only rows where experience month matches target month/year exactly.

### Per-Page Flow

1. Find all `button.UikNM` with text "Read more" and click them.
2. If any were clicked, call `waitForDOMSettle(2000)`.
3. Query all `[data-automation="reviewCard"]`.
4. For each card:
   - Parse written date → check stop condition.
   - Parse experience month → check if matches target.
   - If matches: extract all fields and push to accumulator.
5. If stop condition met → break loop.
6. Find `a[aria-label="Next page"]`. If absent → break loop.
7. Click Next, call `waitForDOMSettle(3000)`, repeat from step 1.

### Field Extraction

| Output Field | How |
|---|---|
| `Date` | Written date via `parseLongDate` |
| `Time` | `""` |
| `Guide` | `extractGuideName(reviewText, city)` |
| `Rating` | First word of SVG title text, parsed as integer |
| `Tour` | `mapTourName(document.title)` — page-level, same for all cards |
| `City` | `guessCity(document.title)` → fallback `guessCity(location.href)` → fallback `getGuideCity(guide)` |
| `Language` | `""` |
| `Platform` | `"TripAdvisor"` |
| `Review` | `.yCeTE` innerText, `<br>` and newlines collapsed to single space |

---

## Pagination Detail

- After clicking `a[aria-label="Next page"]`, TripAdvisor replaces the review cards in-place (SPA/XHR).
- Before scraping the new page, verify that the first card on the new page is different from the last known first card (compare review title text) to avoid re-scraping stale DOM.
- If the verification fails after a 3 s wait, break and send whatever was collected.

---

## Output

- Send accumulated rows via `window.__re.sendDataToWebhook(rows, "TripAdvisor")`.
- Return `{ success: true, count: rows.length, platform: "TripAdvisor" }` on success.
- Return `{ success: false, count: 0, platform: "TripAdvisor" }` if no rows found.

---

## Popup Registration

**popup.html** — add before the `<hr class="divider">`:
```html
<button id="btn-tripadvisor" class="btn-secondary">TripAdvisor Reviews</button>
```

**popup.js** — add to `PLATFORMS` array:
```js
{ id: 'btn-tripadvisor', script: 'tripadvisor.js', domains: ['tripadvisor.com'] },
```

---

## Edge Cases

| Case | Handling |
|---|---|
| No reviews on page | Warn and return `success: false` |
| Already on last page | No Next link → loop exits naturally |
| All reviews on first page are outside target month | Stop condition triggers immediately, send 0 rows |
| DOM doesn't update after Next click | Stale-card check fails → break, send what we have |
| Review text truncated (no Read More clicked) | Read More buttons are clicked before scraping each page |
