(async function () {
    window.__re.log("Guruwalk Auto-Pagination Scraper Started…");

    const allRows = [];
    let hasMorePages = true;

    // --- 1. Calculate Target Dates ---
    const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
    window.__re.log(`Target date: Month ${targetMonth}, Year ${targetYear}`);

    const targetWeek = window.__re.getTargetWeek();
    const cutoffDate = targetWeek ? targetWeek.start : new Date(targetYear, targetMonth, 1);

    const FULL_INFO_REGEX = /(.*?) \/ ([A-Z]{2}) \/ (.*?) at (.*)/;

    function findReviewCards() {
        const allDivs = document.querySelectorAll("div");
        let cards = Array.from(allDivs).filter(div => {
            return div.innerText.includes("Content visible only for gurus") &&
                   div.innerText.includes("Guided by") &&
                   div.innerText.length < 2000;
        });
        cards = cards.filter(card => !cards.some(other => other !== card && card.contains(other)));
        if (cards.length === 0) {
            const gridContainers = document.querySelectorAll(".grid.gap-y-4");
            if (gridContainers.length > 0) cards = Array.from(gridContainers[0].children);
        }
        return cards;
    }

    // --- 2. Pagination Loop ---
    while (hasMorePages) {
        let cards = findReviewCards();

        if (cards.length === 0) {
            window.__re.warn("No review cards found on this page.");
            break;
        }

        let oldestDateOnPage = new Date();
        let pageExtractedCount = 0;
        
        // Memorize the first card on the current page to detect when the next page ACTUALLY loads
        const firstCardText = cards[0] ? cards[0].innerText : "";

        cards.forEach(card => {
            try {
                const text = card.innerText;
                if (!text.includes("Content visible only for gurus")) return;

                let ratingVal = "";
                const starWrappers = Array.from(card.querySelectorAll(".grid.grid-flow-col"));
                const mainRatingWrapper = starWrappers.find(w => w.querySelector("svg"));
                if (mainRatingWrapper) {
                    ratingVal = Array.from(mainRatingWrapper.querySelectorAll("svg"))
                        .filter(svg => svg.classList.contains("text-secondary-500"))
                        .length.toString();
                }

                const lines = text.split("\n").map(l => l.trim());
                const markerIdx = lines.indexOf("Content visible only for gurus");
                const fullLine = markerIdx > -1 && lines[markerIdx + 1] ? lines[markerIdx + 1] : "";

                let dateVal = "", timeVal = "", tourVal = "", langVal = "", cityVal = "";
                let parsedDate = null;

                const fullMatch = fullLine.match(FULL_INFO_REGEX);
                if (fullMatch) {
                    tourVal = fullMatch[1].trim();
                    langVal = window.__re.formatLang(fullMatch[2].trim());

                    const dateTimeStr = `${fullMatch[3]} ${fullMatch[4]}`;
                    parsedDate = new Date(dateTimeStr);
                    
                    if (!isNaN(parsedDate.getTime())) {
                        dateVal = window.__re.formatDate(parsedDate);
                        timeVal = window.__re.formatTime(parsedDate);
                        
                        if (parsedDate < oldestDateOnPage) {
                            oldestDateOnPage = parsedDate;
                        }
                    }
                }

                cityVal = window.__re.guessCity(tourVal) || window.__re.guessCity(text);
                tourVal = window.__re.mapTourName(tourVal);

                let guideVal = "";
                const guideMatch = text.match(/Guided by (.*?)(?:\n|\|)/);
                if (guideMatch) {
                    const extracted = window.__re.extractGuideName(guideMatch[1].trim(), cityVal);
                    guideVal = extracted !== "N/A" ? extracted : guideMatch[1].trim();
                }
                if (!cityVal) cityVal = window.__re.getGuideCity(guideVal);

                let reviewVal = "";
                const reviewMatch = text.match(/-\s[A-Z][a-z]{2}\s\d{4}\n([\s\S]*?)Content visible only for gurus/);
                if (reviewMatch) reviewVal = reviewMatch[1].trim();

                allRows.push({
                    Date: dateVal,
                    Time: timeVal,
                    Guide: guideVal,
                    Rating: ratingVal,
                    Tour: tourVal,
                    City: cityVal,
                    Language: langVal,
                    Platform: "Guruwalk",
                    Review: reviewVal,
                    _rawDateObj: parsedDate 
                });
                pageExtractedCount++;
            } catch (e) {
                window.__re.error("Error processing Guruwalk card", e);
            }
        });

        window.__re.log(`Extracted ${pageExtractedCount} reviews from current page. Oldest date: ${window.__re.formatDate(oldestDateOnPage)}`);

        // --- 3. Check Date Boundary ---
        if (oldestDateOnPage < cutoffDate) {
            window.__re.log(`Reached reviews older than target month (Cutoff: ${window.__re.formatDate(cutoffDate)}). Stopping pagination.`);
            break; 
        }

        // --- 4. Find and Click "Next" ---
        // The pagination bar is: <div><p>Page N</p></div> <button>→</button>
        const pageEl = Array.from(document.querySelectorAll('p')).find(p => /^Page \d+$/.test(p.textContent.trim()));
        const nextBtn = pageEl?.parentElement?.nextElementSibling;

        if (nextBtn && nextBtn.tagName === 'BUTTON' && !nextBtn.disabled && !nextBtn.hasAttribute('disabled')) {
            window.__re.log("Clicking 'Next' page...");
            nextBtn.click();
            
            // --- SMART POLLING WAITER ---
            // Instead of guessing when it's done, check every 500ms until the reviews actually change!
            let timeElapsed = 0;
            let pageSuccessfullyLoaded = false;
            
            while (timeElapsed < 10000) { // Wait a maximum of 10 seconds
                await new Promise(r => setTimeout(r, 500));
                timeElapsed += 500;
                
                const checkCards = findReviewCards();
                if (checkCards.length > 0 && checkCards[0].innerText !== firstCardText) {
                    pageSuccessfullyLoaded = true;
                    window.__re.log("New page successfully detected in DOM.");
                    break; 
                }
            }
            
            if (!pageSuccessfullyLoaded) {
                window.__re.warn("Waited 10 seconds but the new reviews never appeared. Stopping to prevent infinite loop.");
                hasMorePages = false;
            }

        } else {
            window.__re.log("No more pages found or next button is disabled.");
            hasMorePages = false;
        }
    }

    // --- 5. Final Output & Filtering ---
    const validRows = allRows.filter(r => {
        if (!r._rawDateObj || isNaN(r._rawDateObj.getTime())) return true; // keep undated rows
        if (targetWeek) return r._rawDateObj >= targetWeek.start && r._rawDateObj <= targetWeek.end;
        return r._rawDateObj.getFullYear() === targetYear && r._rawDateObj.getMonth() === targetMonth;
    }).map(r => {
        delete r._rawDateObj;
        return r;
    });

    if (validRows.length === 0) {
        window.__re.warn("No reviews found for the target period.");
        return { success: false, count: 0, platform: "Guruwalk" };
    }

    window.__re.sendDataToWebhook(validRows, "Guruwalk");
    window.__re.log(`Dispatched ${validRows.length} perfectly filtered reviews from Guruwalk to webhook.`);
    return { success: true, count: validRows.length, platform: "Guruwalk" };
})();