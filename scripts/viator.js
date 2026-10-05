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
        const allButtons = document.querySelectorAll('div[data-automation^="review-"] button');
        let clickedCount = 0;
        for (const btn of allButtons) {
            const t = btn.innerText || "";
            if (t.includes("Show all") || t.includes("Read more") || t.includes("Show more")) { btn.click(); clickedCount++; }
        }
        if (clickedCount > 0) await window.__re.waitForDOMSettle(2000);

        const allElements = document.querySelectorAll('div[data-automation^="review-"]');
        const reviewCards = Array.from(allElements).filter(
            el => /\d+$/.test(el.getAttribute("data-automation"))
        );

        const rows = [];
        reviewCards.forEach(card => {
            try {
                const dateRaw = card.querySelector('[class*="ReviewHeader-module__reviewDate"], [class*="ReviewHeader__reviewDate"]')?.innerText || "";
                const dateFormatted = window.__re.formatDate(dateRaw);
                const rawDateObj = new Date(dateRaw);

                const rating = card.querySelectorAll("svg.jumpstart_ui__Rating__rating").length || "";

                const rawTourText = card.querySelector('[class*="ReviewHeader-module__reviewEntity"], [class*="ReviewHeader__reviewEntity"]')?.innerText || "";
                const tour = window.__re.mapTourName(rawTourText);

                const contentDiv = card.querySelector('[class*="ReviewView-module__reviewContent___"], [class*="ReviewView__reviewContent___"]');
                let reviewText = "";
                if (contentDiv) {
                    const clone = contentDiv.cloneNode(true);
                    clone.querySelectorAll("button").forEach(b => b.remove());
                    reviewText = clone.innerText || "";
                }
                reviewText = reviewText.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

                // Skip hollow cards — if selectors ever break again, don't ship empty rows to the sheet
                if (!dateFormatted && !reviewText) {
                    window.__re.warn("Skipping review card with no date and no text (selectors may be stale).");
                    return;
                }

                const city = window.__re.guessCity(rawTourText) || window.__re.guessCity(document.title);
                const guide = window.__re.extractGuideName(reviewText, city);
                rows.push({
                    _rawDateObj: rawDateObj,
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
    // Ids of the real review cards (data-automation="review-<digits>"), same filter as
    // scrapeCurrentPage. A bare [data-automation^="review-"] can also match non-card wrappers
    // whose id never changes between pages.
    function currentCardIds() {
        return Array.from(document.querySelectorAll('div[data-automation^="review-"]'))
            .map(el => el.getAttribute("data-automation"))
            .filter(id => /\d+$/.test(id))
            .join("|");
    }

    // Viator may ignore the URL date params, so the script enforces the range itself.
    const MAX_PAGES = 15;
    const targetWeek = window.__re.getTargetWeek();
    const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
    const rangeStart = targetWeek ? targetWeek.start : new Date(targetYear, targetMonth, 1);
    const rangeEnd = targetWeek ? targetWeek.end : new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);

    function isDated(row) {
        return row._rawDateObj && !isNaN(row._rawDateObj.getTime());
    }
    function isInRange(row) {
        return row._rawDateObj >= rangeStart && row._rawDateObj <= rangeEnd;
    }

    async function scrapeAllPages() {
        const allRows = [];
        let pageNum = 1;

        const foundCards = await window.__re.waitForSelector('div[data-automation^="review-"]');
        if (!foundCards) {
            window.__re.warn("Timed out waiting for review cards to render.");
        }

        while (true) {
            window.__re.log(`Scraping page ${pageNum}...`);

            const pageRows = await scrapeCurrentPage();
            allRows.push(...pageRows);
            window.__re.log(`Page ${pageNum}: found ${pageRows.length} reviews.`);

            const nextBtn = document.querySelector('[data-automation="pagination-NextPage"]');
            if (!nextBtn || nextBtn.disabled || nextBtn.hasAttribute('disabled')) break;

            // Reviews are newest first: once a whole page is older than the range, stop.
            const dated = pageRows.filter(isDated);
            if (dated.length > 0 && dated.every(r => r._rawDateObj < rangeStart)) {
                window.__re.log(`Page ${pageNum} is entirely before the target range. Stopping.`);
                break;
            }
            if (pageNum >= MAX_PAGES) {
                window.__re.warn(`Reached the ${MAX_PAGES}-page cap. Stopping (date filter may not be applied).`);
                break;
            }

            // Snapshot the page's card ids — a stable signal that the page actually turned
            const firstId = currentCardIds();

            nextBtn.click();
            pageNum++;

            // Poll until the first card's review id changes (max 15s)
            let elapsed = 0;
            let loaded = false;
            while (elapsed < 15000) {
                await new Promise(r => setTimeout(r, 500));
                elapsed += 500;
                const newId = currentCardIds();
                if (newId && newId !== firstId) { loaded = true; break; }
            }

            if (!loaded) {
                window.__re.warn(`Next page didn't load in time. Stopping. Card ids before: [${firstId}] after: [${currentCardIds()}]`);
                break;
            }
        }

        // Keep undated rows (parse failures), drop dated rows outside the target range
        const validRows = allRows
            .filter(r => !isDated(r) || isInRange(r))
            .map(r => { delete r._rawDateObj; return r; });

        if (validRows.length === 0) {
            window.__re.warn("No reviews found for the target period.");
            return { success: false, count: 0, platform: "Viator" };
        }

        await window.__re.sendDataToWebhook(validRows, "Viator");
        window.__re.log(`Viator Scraper: Dispatched ${validRows.length} reviews to webhook.`);
        return { success: true, count: validRows.length, platform: "Viator" };
    }

    // --- 4. RUN ---
    const isFilterSet = await ensurePreviousMonthFilter();

    if (isFilterSet) {
        return await scrapeAllPages();
    } else {
        return { success: false, count: 0, platform: "Viator", message: "Applying filters and reloading..." };
    }
})();