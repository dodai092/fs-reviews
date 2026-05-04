# TripAdvisor Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a TripAdvisor review scraper script to the Reviews Extract Chrome extension that paginates through all pages, filters by target month, and sends results to the webhook.

**Architecture:** A single injected script `scripts/tripadvisor.js` follows the same pattern as `scripts/viator.js` — it calls `window.__re` helpers from `common.js`, loops through pages by clicking the Next pagination link, stops when reviews fall outside the target month, and dispatches rows via `sendDataToWebhook`. Two small changes wire it into the popup (one HTML line, one JS array entry).

**Tech Stack:** Vanilla JS (ES2020), Chrome Extension MV3 scripting API, `window.__re` helper namespace from `common.js`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `scripts/tripadvisor.js` | Create | Full scraper: expand/read/paginate/filter/send |
| `popup.html` | Modify | Add TripAdvisor button |
| `popup.js` | Modify | Register TripAdvisor in PLATFORMS array |

---

### Task 1: Add TripAdvisor button to popup

**Files:**
- Modify: `popup.html` (after line 25, the Viator button)
- Modify: `popup.js` (PLATFORMS array, after the viator entry)

- [ ] **Step 1: Add the button to `popup.html`**

Open `popup.html`. After the line:
```html
<button id="btn-viator" class="btn-secondary">Viator Reviews</button>
```
Add:
```html
<button id="btn-tripadvisor" class="btn-secondary">TripAdvisor Reviews</button>
```

- [ ] **Step 2: Register the platform in `popup.js`**

Open `popup.js`. In the `PLATFORMS` array, after the viator entry:
```js
{ id: 'btn-viator', script: 'viator.js', domains: ['viator.com'] },
```
Add:
```js
{ id: 'btn-tripadvisor', script: 'tripadvisor.js', domains: ['tripadvisor.com'] },
```

- [ ] **Step 3: Verify button appears in popup**

Load the extension in Chrome (`chrome://extensions` → Load unpacked → select project folder). Open the popup. Confirm "TripAdvisor Reviews" button appears. Clicking it will show "Error (Check Console)" until Task 2 is done — that's expected.

- [ ] **Step 4: Commit**

```bash
git add popup.html popup.js
git commit -m "feat: add TripAdvisor button to popup"
```

---

### Task 2: Create `scripts/tripadvisor.js` — skeleton and field extraction

**Files:**
- Create: `scripts/tripadvisor.js`

This task builds the per-card extraction logic on a single page (no pagination yet). Pagination is added in Task 3.

- [ ] **Step 1: Create the file with the IIFE wrapper and helper functions**

Create `scripts/tripadvisor.js` with this content:

```js
(async function () {
    window.__re.log("TripAdvisor Review Scraper Started…");

    // ── Helpers ──────────────────────────────────────────────────────────────

    function parseExperienceMonth(jXCrqText) {
        // ".jXCrq" text is e.g. "Apr 2026 • Couples" or "Apr 2026"
        // Returns { month: 3, year: 2026 } (month is 0-indexed)
        const raw = (jXCrqText || "").split("•")[0].trim(); // "Apr 2026"
        const parts = raw.split(" ");
        if (parts.length !== 2) return null;
        const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
        const month = MONTHS[parts[0]];
        const year = parseInt(parts[1], 10);
        if (month === undefined || isNaN(year)) return null;
        return { month, year };
    }

    function parseWrittenDate(bneloDivText) {
        // Text: "Written April 4, 2026"
        const match = (bneloDivText || "").match(/Written (.+)/);
        if (!match) return null;
        return window.__re.parseLongDate(match[1].trim()); // "04/Apr/2026"
    }

    function parseRating(card) {
        const title = card.querySelector('svg[data-automation="bubbleRatingImage"] title');
        if (!title) return "";
        const match = title.textContent.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : "";
    }

    function parseReviewText(card) {
        // Expand "Read more" if not yet done (safety net per-card)
        const readMore = Array.from(card.querySelectorAll("button.UikNM")).find(
            b => b.innerText.includes("Read more")
        );
        if (readMore) readMore.click();

        const spans = card.querySelectorAll(".yCeTE");
        return Array.from(spans)
            .map(s => s.innerText.replace(/\n+/g, " ").trim())
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function parseWrittenDateEl(card) {
        // First .biGQs.ncFvv inside .BNelO that starts with "Written"
        const els = card.querySelectorAll(".BNelO .biGQs");
        for (const el of els) {
            if (el.innerText.startsWith("Written")) return el.innerText;
        }
        return "";
    }

    function scrapeCard(card, city, tour) {
        const writtenRaw = parseWrittenDateEl(card);
        const writtenDate = parseWrittenDate(writtenRaw);
        const expRaw = card.querySelector(".jXCrq")?.innerText || "";
        const expMonth = parseExperienceMonth(expRaw);
        const rating = parseRating(card);
        const reviewText = parseReviewText(card);
        const guide = window.__re.extractGuideName(reviewText, city);
        return {
            writtenDate,
            expMonth,
            row: {
                Date: writtenDate || "",
                Time: "",
                Guide: guide,
                Rating: rating,
                Tour: tour,
                City: city || window.__re.getGuideCity(guide),
                Language: "",
                Platform: "TripAdvisor",
                Review: reviewText,
            }
        };
    }

    // ── Main ─────────────────────────────────────────────────────────────────

    async function run() {
        const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
        const tour = window.__re.mapTourName(document.title);
        const city = window.__re.guessCity(document.title) || window.__re.guessCity(location.href);
        const allRows = [];
        let firstCardTitleOnPage = null;

        window.__re.log(`Target: ${targetMonth + 1}/${targetYear} | Tour: ${tour} | City: ${city}`);

        while (true) {
            // 1. Expand "Read more" buttons on this page
            const readMoreBtns = Array.from(document.querySelectorAll("button.UikNM")).filter(
                b => b.innerText.includes("Read more")
            );
            if (readMoreBtns.length > 0) {
                readMoreBtns.forEach(b => b.click());
                await window.__re.waitForDOMSettle(2000);
            }

            // 2. Scrape cards
            const cards = document.querySelectorAll('[data-automation="reviewCard"]');
            if (cards.length === 0) {
                window.__re.warn("No review cards found on page.");
                break;
            }

            // 3. Stale-page guard: if first card title is same as before, DOM didn't update
            const currentFirstTitle = cards[0].querySelector(".yCeTE")?.innerText || "";
            if (firstCardTitleOnPage && currentFirstTitle === firstCardTitleOnPage) {
                window.__re.warn("DOM did not update after Next click — stopping.");
                break;
            }
            firstCardTitleOnPage = currentFirstTitle;

            // 4. Process cards
            let hitOldReview = false;
            for (const card of cards) {
                const { writtenDate, expMonth, row } = scrapeCard(card, city, tour);

                // Stop condition: written date is more than 2 months before target
                if (writtenDate) {
                    const parts = writtenDate.split("/"); // "04/Apr/2026"
                    if (parts.length === 3) {
                        const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
                        const writtenM = MONTHS[parts[1]];
                        const writtenY = parseInt(parts[2], 10);
                        if (!isNaN(writtenY) && writtenM !== undefined) {
                            const writtenAbs = writtenY * 12 + writtenM;
                            const targetAbs = targetYear * 12 + targetMonth;
                            if (targetAbs - writtenAbs > 2) {
                                window.__re.log("Written date is >2 months before target — stopping pagination.");
                                hitOldReview = true;
                            }
                        }
                    }
                }

                // Collect if experience month matches target
                if (expMonth && expMonth.month === targetMonth && expMonth.year === targetYear) {
                    allRows.push(row);
                }

                if (hitOldReview) break;
            }

            if (hitOldReview) break;

            // 5. Go to next page
            const nextLink = document.querySelector('a[aria-label="Next page"]');
            if (!nextLink) {
                window.__re.log("No Next page link — done.");
                break;
            }
            window.__re.log(`Navigating to next page… (collected ${allRows.length} so far)`);
            nextLink.click();
            await window.__re.waitForDOMSettle(3000);
        }

        // 6. Output
        if (allRows.length === 0) {
            window.__re.warn("No matching reviews found.");
            return { success: false, count: 0, platform: "TripAdvisor" };
        }

        window.__re.sendDataToWebhook(allRows, "TripAdvisor");
        window.__re.log(`TripAdvisor Scraper: Dispatched ${allRows.length} reviews.`);
        return { success: true, count: allRows.length, platform: "TripAdvisor" };
    }

    return await run();
})();
```

- [ ] **Step 2: Reload the extension and test on a TripAdvisor reviews page**

1. Go to `chrome://extensions`, click the refresh icon on Reviews Extract.
2. Navigate to a TripAdvisor attraction reviews page (e.g. the Free Spirit Tours Split page).
3. Select a target month in the popup that has reviews (e.g. April 2026).
4. Click "TripAdvisor Reviews".
5. Open DevTools Console (`F12`) and check for `[RE]` log lines.

**Expected console output:**
```
[RE] common.js already loaded, skipping.   ← (or "loaded" on first run)
[RE] TripAdvisor Review Scraper Started…
[RE] Target: 4/2026 | Tour: <tour name> | City: <city>
[RE] Navigating to next page… (collected N so far)
…
[RE] TripAdvisor Scraper: Dispatched N reviews.
```

**Expected popup:** `Done! N reviews sent to Sheets.`

**If city shows empty:** Check that the page title or URL contains a city name from `CITY_MAP` in `common.js` (e.g. "Split", "Zagreb"). If not, the City field will be filled from the guide match instead.

**If 0 reviews dispatched:** Verify the selected month matches what's visible on the page. Check console for "stop condition" warnings.

- [ ] **Step 3: Verify data in Google Sheets**

Open the connected Google Sheet and confirm rows appear with correct Date, Rating, Guide, Tour, City, Review, Platform = "TripAdvisor".

- [ ] **Step 4: Commit**

```bash
git add scripts/tripadvisor.js
git commit -m "feat: add TripAdvisor scraper with multi-page pagination"
```

---

## Verification Checklist

Before considering this done, confirm all of the following manually:

- [ ] Button appears in popup on any tab
- [ ] Button is auto-highlighted (`.active`) when on a `tripadvisor.com` tab
- [ ] Single-page scrape works (reviews appear in Sheets)
- [ ] Multi-page scrape works (script advances to next page and collects from it)
- [ ] Stop condition works: selecting a month with no reviews returns "No reviews found"
- [ ] "Read more" buttons are expanded before text is captured (long reviews not truncated)
- [ ] Stale-page guard fires if DOM doesn't update (check by throttling network and watching console)
