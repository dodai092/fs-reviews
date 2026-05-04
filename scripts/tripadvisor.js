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
