(async function () {
    window.__re.log("Freetour Scraper Started…");

    // ─── 1. Target Dates ───────────────────────────────────────────────────────
    const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
    window.__re.log(`Target date: Month ${targetMonth + 1}, Year ${targetYear}`);
    const targetWeek = window.__re.getTargetWeek();
    const cutoffDate = targetWeek ? targetWeek.start : new Date(targetYear, targetMonth, 1);

    // ─── State ────────────────────────────────────────────────────────────────
    const allRows = [];
    let hasMorePages = true;
    let pageCount = 0;
    
    // Use a variable to track the current Document we are parsing (starts with the active page DOM)
    let currentDoc = document;

    // ─── 2. Main Pagination Loop ────────────────────────────────────────────────
    while (hasMorePages) {
        pageCount++;
        window.__re.log(`Processing Page ${pageCount}...`);

        const headerDivs = Array.from(currentDoc.querySelectorAll('div.col-md-12')).filter(div => {
            const txt = div.textContent;
            return txt.includes("/") && txt.includes(":") && txt.includes("by");
        });

        let oldestDateOnPage = new Date(targetYear + 1, 0, 1); // Start in the future
        let pageExtractedCount = 0;

        for (const header of headerDivs) {
            const body = header.nextElementSibling;
            if (!body || !body.classList.contains('col-md-12')) continue;
            
            const headerText = header.textContent.trim();
            const bodyText = body.textContent.trim();

            const lines = headerText.split("\n").map(l => l.trim()).filter(l => l);
            let date = "", time = "", tour = "", city = "", rating = "";
            let parsedDateObj = null;

            // Rating Extraction
            const guiMatch = headerText.match(/Gui\s*(\d)/);
            if (guiMatch) {
                rating = guiMatch[1].trim();
            } else {
                const goldStars = header.querySelectorAll('.fa[style*="#fba749"], .fa[style*="fba749"]');
                if (goldStars.length > 0) rating = goldStars.length;
            }

            // Info Line
            const infoLineIdx = lines.findIndex(l => l.match(/\d{4}-\d{2}-\d{2}/) && l.includes("/"));
            if (infoLineIdx > -1) {
                const parts = lines[infoLineIdx].split(" / ");
                if (parts.length >= 2) {
                    const rawTourName = parts[0].trim();
                    city = window.__re.guessCity(rawTourName);
                    tour = window.__re.mapTourName(rawTourName);
                    
                    const rawDate = parts[1].trim(); 
                    date = window.__re.parseDashDate(rawDate);
                    if (parts[2]) time = parts[2].split("#")[0].trim();

                    const dParts = rawDate.split("-");
                    if (dParts.length === 3) {
                        parsedDateObj = new Date(parseInt(dParts[0]), parseInt(dParts[1]) - 1, parseInt(dParts[2]));
                    }
                }
            }

            // Review Submission Date (used for pagination stopping because list is sorted by this)
            const reviewDateMatch = headerText.match(/on\s+(\d{2})\.(\d{2})\.(\d{4})/);
            if (reviewDateMatch) {
                const rDay = parseInt(reviewDateMatch[1], 10);
                const rMonth = parseInt(reviewDateMatch[2], 10) - 1;
                const rYear = parseInt(reviewDateMatch[3], 10);
                const reviewDateObj = new Date(rYear, rMonth, rDay);
                
                if (!isNaN(reviewDateObj.getTime()) && reviewDateObj < oldestDateOnPage) {
                    oldestDateOnPage = reviewDateObj;
                }
            } else if (parsedDateObj && !isNaN(parsedDateObj.getTime()) && parsedDateObj < oldestDateOnPage) {
                // Fallback to tour date if review date is missing
                oldestDateOnPage = parsedDateObj;
            }

            if (!date && !tour) continue;

            const bodyClone = body.cloneNode(true);
            bodyClone.querySelectorAll("button, a").forEach(el => el.remove());
            const review = bodyClone.textContent.replace(/\s+/g, " ").trim();
            const guide = window.__re.extractGuideName(`${headerText} ${review}`, city);
            if (!city) city = window.__re.getGuideCity(guide);

            allRows.push({
                Date: date, 
                Time: time, 
                Guide: guide, 
                Rating: rating, 
                Tour: tour, 
                City: city, 
                Language: "", 
                Platform: "freetour com", 
                Review: review,
                _rawDateObj: parsedDateObj
            });
            pageExtractedCount++;
        }

        window.__re.log(`Page ${pageCount}: Found ${pageExtractedCount} reviews. Oldest date: ${window.__re.formatDate(oldestDateOnPage)}`);

        // Check if we reached the cutoff
        if (oldestDateOnPage < cutoffDate) {
            window.__re.log(`Reached reviews older than target month (Cutoff: ${window.__re.formatDate(cutoffDate)}). Stopping loop.`);
            hasMorePages = false;
        } else {
            // Find "Next" button in the generic parsed document wrapper
            let nextBtn = currentDoc.querySelector('a[rel="next"]') ||
                          Array.from(currentDoc.querySelectorAll('.pagination a, .pager a, li a')).find(a =>
                             a.textContent.trim() === '»' || a.textContent.toLowerCase().includes('next')
                          );

            if (nextBtn && nextBtn.href && !nextBtn.closest('li')?.classList.contains('disabled')) {
                const nextUrl = nextBtn.href;
                window.__re.log(`Fetching next page: ${nextUrl} ...`);
                
                try {
                    const response = await fetch(nextUrl);
                    if (!response.ok) {
                        window.__re.warn(`Failed to fetch next page (status ${response.status}). Stopping.`);
                        hasMorePages = false;
                    } else {
                        const htmlText = await response.text();
                        const parser = new DOMParser();
                        currentDoc = parser.parseFromString(htmlText, "text/html");
                        
                        // We intentionally slow down to be polite to the server
                        await new Promise(r => setTimeout(r, 1000));
                    }
                } catch (e) {
                    window.__re.error("Error fetching next page: ", e);
                    hasMorePages = false;
                }
            } else {
                window.__re.log("No more pages found or 'Next' button is disabled/missing link.");
                hasMorePages = false;
            }
        }
    }

    // ─── 5. Strict Filtering & Output ───────────────────────────────────────────
    const validRows = allRows.filter(r => {
        if (!r._rawDateObj || isNaN(r._rawDateObj.getTime())) return false;
        if (targetWeek) return r._rawDateObj >= targetWeek.start && r._rawDateObj <= targetWeek.end;
        return r._rawDateObj.getFullYear() === targetYear && r._rawDateObj.getMonth() === targetMonth;
    }).map(r => {
        const cleaned = { ...r };
        delete cleaned._rawDateObj;
        return cleaned;
    });

    if (validRows.length === 0) {
        window.__re.warn("No reviews found for the strictly selected month.");
        return { success: false, count: 0, platform: "Freetour" };
    }

    window.__re.sendDataToWebhook(validRows, "Freetour");
    window.__re.log(`Dispatched ${validRows.length} strictly filtered Freetour reviews to webhook.`);
    return { success: true, count: validRows.length, platform: "Freetour" };
})();