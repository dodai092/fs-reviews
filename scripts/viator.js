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
            
            window.location.href = currentUrl.toString();
            return false;
        }

        window.__re.log("Date filter is correct. Proceeding with extraction.");
        return true;
    }

    // --- 2. MAIN SCRAPING LOGIC ---
    async function scrapeData() {
        try {
            // A. EXPAND "SHOW ALL" BUTTONS
            const allButtons = document.querySelectorAll('div[class*="ReviewView__reviewContent"] button');
            let clickedCount = 0;

            for (const btn of allButtons) {
                if (btn.innerText.includes("Show all") || btn.innerText.includes("Read more")) {
                    btn.click();
                    clickedCount++;
                }
            }

            // Only wait if something was expanded
            if (clickedCount > 0) {
                await window.__re.waitForDOMSettle(2000);
            }

            // B. SCRAPE DATA
            const allElements = document.querySelectorAll('div[data-automation^="review-"]');
            // Filter out header/filter row — real review IDs end in a digit
            const reviewCards = Array.from(allElements).filter(
                el => /\d+$/.test(el.getAttribute("data-automation"))
            );

            const rows = [];

            reviewCards.forEach(card => {
                try {
                    // Date
                    const dateRaw = card.querySelector('[class*="ReviewHeader__reviewDate"]')?.innerText || "";
                    const dateFormatted = window.__re.formatDate(dateRaw);

                    // Rating
                    const rating = card.querySelectorAll("svg.jumpstart_ui__Rating__rating").length || "";

                    // Tour
                    const rawTourText = card.querySelector('[class*="ReviewHeader__reviewEntity"]')?.innerText || "";
                    const tour = window.__re.mapTourName(rawTourText);

                    // Review content (remove buttons before extraction)
                    const contentDiv = card.querySelector('[class*="ReviewView__reviewContent___"]');
                    let reviewText = "";

                    if (contentDiv) {
                        const clone = contentDiv.cloneNode(true);
                        clone.querySelectorAll("button").forEach(btn => btn.remove());
                        reviewText = clone.innerText || "";
                    }

                    reviewText = reviewText
                        .replace(/[\r\n]+/g, " ")
                        .replace(/\s+/g, " ")
                        .trim();

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

            // C. OUTPUT
            if (rows.length === 0) {
                window.__re.warn("No reviews found.");
                return { success: false, count: 0, platform: "Viator" };
            }

            window.__re.sendDataToWebhook(rows, "Viator");
            window.__re.log(`Viator Scraper: Dispatched ${rows.length} reviews to webhook.`);
            return { success: true, count: rows.length, platform: "Viator" };

        } catch (e) {
            window.__re.error("Viator Scraper: General Error", e);
            return { success: false, count: 0, platform: "Viator", error: e.message };
        }
    }

    // --- 4. RUN ---
    const isFilterSet = await ensurePreviousMonthFilter();
    
    if (isFilterSet) {
        return await scrapeData();
    } else {
        return { success: false, count: 0, platform: "Viator", message: "Applying filters and reloading..." };
    }
})();