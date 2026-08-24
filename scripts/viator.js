(async function () {
    window.__re.log("Viator Review Scraper Started…");

    // --- 1. Auto-Filter Logic ---
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
        
        // Note: If Viator uses different URL parameters for their date filter, update these keys!
        const paramStart = 'startDate'; 
        const paramEnd = 'endDate';

        const currentFrom = currentUrl.searchParams.get(paramStart);
        const currentTo = currentUrl.searchParams.get(paramEnd);

        if (currentFrom !== targetFrom || currentTo !== targetTo) {
            window.__re.log(`Filter not set correctly. Redirecting to: ${targetFrom} - ${targetTo}`);
            currentUrl.searchParams.set(paramStart, targetFrom);
            currentUrl.searchParams.set(paramEnd, targetTo);

            // Hand off the target month/week to the background script so it can
            // re-inject and resume scraping automatically once this tab finishes reloading.
            chrome.runtime.sendMessage({
                action: 'schedule-continue',
                script: 'viator.js',
                targetMonth: window.__targetMonth,
                targetYear: window.__targetYear,
                targetWeekStart: window.__targetWeekStart,
                targetWeekEnd: window.__targetWeekEnd,
            });

            window.location.href = currentUrl.toString();
            return false;
        }

        window.__re.log("Date filter is correct. Proceeding with extraction.");
        return true;
    }

    // --- 2. SCRAPE CURRENT PAGE ---
    async function scrapeCurrentPage() {
        // Expand "Show all" / "Read more" buttons and wait for content to render
        const allButtons = document.querySelectorAll('div[class*="ReviewView__reviewContent"] button');
        let clickedCount = 0;
        for (const btn of allButtons) {
            if (btn.innerText.includes("Show all") || btn.innerText.includes("Read more")) { btn.click(); clickedCount++; }
        }
        if (clickedCount > 0) await window.__re.waitForDOMSettle(2000);

        const allElements = document.querySelectorAll('div[data-automation^="review-"]');
        const reviewCards = Array.from(allElements).filter(
            el => /\d+$/.test(el.getAttribute("data-automation"))
        );

        const rows = [];
        reviewCards.forEach(card => {
            try {
                const dateRaw = card.querySelector('[class*="ReviewHeader__reviewDate"]')?.innerText || "";
                const dateFormatted = window.__re.formatDate(dateRaw);

                const rating = card.querySelectorAll("svg.jumpstart_ui__Rating__rating").length || "";

                const rawTourText = card.querySelector('[class*="ReviewHeader__reviewEntity"]')?.innerText || "";
                const tour = window.__re.mapTourName(rawTourText);

                const contentDiv = card.querySelector('[class*="ReviewView__reviewContent___"]');
                let reviewText = "";
                if (contentDiv) {
                    const clone = contentDiv.cloneNode(true);
                    clone.querySelectorAll("button").forEach(b => b.remove());
                    reviewText = clone.innerText || "";
                }
                reviewText = reviewText.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

                const city = window.__re.guessCity(rawTourText) || window.__re.guessCity(document.title);
                const guide = window.__re.extractGuideName(reviewText, city);
                rows.push({
                    Date: dateFormatted,
                    Time: "",
                    Guide: guide,
                    Rating: rating,
                    Tour: tour,
                    City: city || window.__re.getGuideCity(guide),
                    Language: "",
                    Platform: "Viator",
                    Review: reviewText,
                });
            } catch (innerError) {
                window.__re.error("Viator Scraper: Error parsing a card", innerError);
            }
        });
        return rows;
    }

    // --- 3. PAGINATE AND SCRAPE ALL PAGES ---
    async function scrapeAllPages() {
        const allRows = [];
        let pageNum = 1;

        while (true) {
            window.__re.log(`Scraping page ${pageNum}...`);

            const pageRows = await scrapeCurrentPage();
            allRows.push(...pageRows);
            window.__re.log(`Page ${pageNum}: found ${pageRows.length} reviews.`);

            const nextBtn = document.querySelector('[data-automation="pagination-NextPage"]');
            if (!nextBtn || nextBtn.disabled || nextBtn.hasAttribute('disabled')) break;

            // Snapshot before clicking next — card is in post-expand state, consistent baseline
            const firstCard = document.querySelector('div[data-automation^="review-"]');
            const firstCardText = firstCard?.innerText || "";

            nextBtn.click();
            pageNum++;

            // Poll until first card changes (max 10s)
            let elapsed = 0;
            let loaded = false;
            while (elapsed < 10000) {
                await new Promise(r => setTimeout(r, 500));
                elapsed += 500;
                const newFirst = document.querySelector('div[data-automation^="review-"]');
                if (newFirst && newFirst.innerText !== firstCardText) { loaded = true; break; }
            }

            if (!loaded) {
                window.__re.warn("Next page didn't load in time. Stopping.");
                break;
            }
        }

        if (allRows.length === 0) {
            window.__re.warn("No reviews found.");
            return { success: false, count: 0, platform: "Viator" };
        }

        window.__re.sendDataToWebhook(allRows, "Viator");
        window.__re.log(`Viator Scraper: Dispatched ${allRows.length} reviews to webhook.`);
        return { success: true, count: allRows.length, platform: "Viator" };
    }

    // --- 4. RUN ---
    const isFilterSet = await ensurePreviousMonthFilter();

    if (isFilterSet) {
        return await scrapeAllPages();
    } else {
        return { success: false, count: 0, platform: "Viator", message: "Applying filters and reloading..." };
    }
})();