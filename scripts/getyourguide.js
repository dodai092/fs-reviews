(async function () {
    window.__re.log("GetYourGuide Review Scraper Started…");

    // ─── 1. Auto-Filter Logic ──────────────────────────────────────────────────
    async function ensurePreviousMonthFilter() {
        const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
        const targetWeek = window.__re.getTargetWeek();
        const targetFrom = targetWeek
            ? window.__re.formatISODate(targetWeek.start)
            : window.__re.formatISODate(new Date(targetYear, targetMonth, 1));
        const targetTo = targetWeek
            ? window.__re.formatISODate(targetWeek.end)
            : window.__re.formatISODate(new Date(targetYear, targetMonth + 1, 0));

        const currentUrl = new URL(window.location.href);
        const currentFrom = currentUrl.searchParams.get('date_from');
        const currentTo = currentUrl.searchParams.get('date_to');

        // Check if the URL already has the correct filter
        if (currentFrom !== targetFrom || currentTo !== targetTo) {
            window.__re.log(`Filter not set correctly. Redirecting to: ${targetFrom} - ${targetTo}`);
            
            // Add or update the URL parameters
            currentUrl.searchParams.set('date_from', targetFrom);
            currentUrl.searchParams.set('date_to', targetTo);
            
            // Redirect the browser. The user will need to click the extension again after it loads.
            window.location.href = currentUrl.toString();
            return false; // Indicate that we are reloading, so stop scraping.
        }

        window.__re.log("Date filter is correct. Proceeding with extraction.");
        return true;
    }

    // ─── 2. Parsing Logic ──────────────────────────────────────────────────────
    function scrapeData() {
        const cards = document.querySelectorAll('[data-testid="review-card"]');

        if (cards.length === 0) {
            window.__re.warn("No review cards found.");
            return { success: false, count: 0, platform: "GetYourGuide" };
        }

        const rows = [];

        cards.forEach(card => {
            try {
                // Date
                const dateRow = card.querySelector('[data-testid="Travel date"] .text-body');
                const dateRaw = dateRow
                    ? dateRow.innerText.trim()
                    : card.querySelector('.absolute.top-4.right-4')?.innerText.trim();
                const date = window.__re.parseLongDate(dateRaw || "");

                // Rating
                const rating = card.querySelector('.c-user-rating__rating')?.innerText.trim() || "";

                // Tour & City (computed before guide so city can inform guide matching)
                const tourRaw = card.querySelector('.text-ellipsis')?.innerText.trim() || "";
                const city = window.__re.guessCity(tourRaw);

                // Review & Guide
                const reviewRaw = card.querySelector('[data-testid="review-card-comment"]')?.innerText || "";
                const review = reviewRaw.replace(/(\r\n|\n|\r)/gm, " ");
                const guide = window.__re.extractGuideName(reviewRaw, city);
                const tour = window.__re.mapTourName(tourRaw);

                // Language (extracted from option text)
                const optionText = card.querySelector('[data-testid="Option"] .text-body span')?.innerText || "";
                let language = "";
                if (optionText) {
                    const parts = optionText.split("|")[0].trim().split(" ");
                    language = parts[parts.length - 1] || "";
                }

                rows.push({
                    Date: date,
                    Time: "",
                    Guide: guide,
                    Rating: rating,
                    Tour: tour,
                    City: city || window.__re.getGuideCity(guide),
                    Language: language,
                    Platform: "GYG",
                    Review: review,
                });
            } catch (e) {
                window.__re.error("Error parsing a GYG card:", e);
            }
        });

        if (rows.length === 0) {
            window.__re.warn("No valid reviews parsed.");
            return { success: false, count: 0, platform: "GetYourGuide" };
        }

        // Send to Webhook
        window.__re.sendDataToWebhook(rows, "GetYourGuide");
        window.__re.log(`Dispatched ${rows.length} GetYourGuide reviews to webhook.`);
        return { success: true, count: rows.length, platform: "GetYourGuide" };
    }

    async function expandAndScrape() {
        const expandButtons = document.querySelectorAll('button[data-testid="review-card-expand"]');
        let clickedCount = 0;
        expandButtons.forEach(btn => {
            if (btn.innerText.includes("Show details")) {
                btn.click();
                clickedCount++;
            }
        });

        window.__re.log(`Expanded ${clickedCount} reviews. Waiting for content to load…`);
        if (clickedCount > 0) await window.__re.waitForDOMSettle(3000);
        return scrapeData();
    }

    // ─── 3. Run ────────────────────────────────────────────────────────────────
    const isFilterSet = await ensurePreviousMonthFilter();
    
    // Only scrape if the filter was already correct. If it wasn't, the page is reloading.
    if (isFilterSet) {
        return await expandAndScrape();
    } else {
        // Return a specific status to the popup so the user knows it's reloading
        window.__re.log("Reloading page with correct filters...");
        return { success: false, count: 0, platform: "GetYourGuide", message: "Applying filters and reloading..." };
    }
})();