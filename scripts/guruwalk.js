(async function () {
    window.__re.log("Guruwalk Auto-Pagination Scraper Started…");

    const allRows = [];
    let hasMorePages = true;

    // --- 1. Calculate Target Dates ---
    const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
    window.__re.log(`Target date: Month ${targetMonth}, Year ${targetYear}`);

    const targetWeek = window.__re.getTargetWeek();

    function isInTargetRange(row) {
        if (!row._rawDateObj || isNaN(row._rawDateObj.getTime())) return false;
        if (targetWeek) return row._rawDateObj >= targetWeek.start && row._rawDateObj <= targetWeek.end;
        return row._rawDateObj.getFullYear() === targetYear && row._rawDateObj.getMonth() === targetMonth;
    }

    // Cards are <li><div role="article">. The visible "Sep 2026" date has no day, so the
    // real tour date/time/language come from the gurus-only line inside the card:
    // "<emoji> Tour name / EN / September 19, 2026 at 11:00 AM".
    function findReviewCards() {
        return Array.from(document.querySelectorAll('[role="article"]'))
            .filter(c => c.querySelector('[data-testid="private-rating"]'));
    }

    function parseTourLine(card) {
        const line = Array.from(card.querySelectorAll("div.text-sm"))
            .find(d => /\d{4}/.test(d.textContent) && d.textContent.split("/").length >= 3);
        if (!line) return { tour: "", lang: "", date: null };
        const parts = line.textContent.trim().split(/\s+\/\s+/);
        const dateText = parts.pop().replace(/\s+at\s+/i, " ");
        const lang = parts.pop() || "";
        const tour = parts.join(" / ").replace(/^[^\p{L}\p{N}]+/u, "").trim();
        const date = new Date(dateText);
        return { tour, lang, date: isNaN(date.getTime()) ? null : date };
    }

    // Filled stars share one icon path; the header grid holds the review's rating.
    function countStars(card) {
        const grid = card.querySelector(".flex-none .grid.grid-flow-col");
        if (!grid) return 0;
        return Array.from(grid.querySelectorAll("svg path"))
            .filter(p => (p.getAttribute("d") || "").startsWith("m12 17.275")).length;
    }

    // Pagination bar: [<button prev>?] <div><p>Page N</p></div> [<button next>]
    // The icons are plain inline SVGs with no identifying class, so anchor on the
    // "Page N" <p> and take the button AFTER its wrapper as "next". Page 1 has only the
    // next button; taking "the last button" could pick prev on the final page.
    function findPageP() {
        return Array.from(document.querySelectorAll("p")).find(p => /^Page\s+\d+$/i.test(p.textContent.trim()));
    }

    function findNextButton() {
        const btn = findPageP()?.parentElement?.nextElementSibling;
        if (btn?.tagName !== "BUTTON") return null;
        return (!btn.disabled && btn.getAttribute("aria-disabled") !== "true") ? btn : null;
    }

    // el.click() only fires a synthetic 'click' event — some component libraries (Radix,
    // ariakit, etc.) listen on pointerdown/mousedown instead and ignore a bare click(),
    // so dispatch the full pointer/mouse sequence a real click produces.
    function simulateClick(el) {
        const rect = el.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
        el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1, isPrimary: true }));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1, isPrimary: true }));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));
    }

    function getPageNumberText() {
        const m = findPageP()?.textContent.trim().match(/\d+/);
        return m ? m[0] : null;
    }

    // --- 2. Pagination Loop ---
    // Guruwalk's review list isn't sorted purely by date (it interleaves tours/cities), so
    // a single old review on a page doesn't mean later pages hold nothing more of interest.
    // Only stop once a few pages in a row come up empty for the target range.
    let consecutiveEmptyPages = 0;
    const MAX_EMPTY_PAGES = 3;

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

                const stars = countStars(card);
                const ratingVal = stars ? stars.toFixed(1) : "";

                let dateVal = "", timeVal = "", tourVal = "", langVal = "", cityVal = "";

                const { tour: tourRaw, lang: langRaw, date: parsedDate } = parseTourLine(card);
                if (parsedDate) {
                    dateVal = window.__re.formatDate(parsedDate);
                    if (parsedDate < oldestDateOnPage) {
                        oldestDateOnPage = parsedDate;
                    }
                }

                if (langRaw) langVal = window.__re.formatLang(langRaw);

                cityVal = window.__re.guessCity(tourRaw) || window.__re.guessCity(text);
                tourVal = window.__re.mapTourName(tourRaw);

                let guideVal = "";
                const guideEl = Array.from(card.querySelectorAll("span"))
                    .find(s => /^Guided by\s/i.test(s.textContent.trim()));
                if (guideEl) {
                    const guideRaw = guideEl.textContent.replace(/^Guided by\s*/i, "").trim();
                    const extracted = window.__re.extractGuideName(guideRaw, cityVal);
                    guideVal = extracted !== "N/A" ? extracted : "";
                }
                if (!cityVal) cityVal = window.__re.getGuideCity(guideVal);

                let reviewVal = "";
                const reviewP = card.querySelector(":scope > p");
                if (reviewP) reviewVal = reviewP.textContent.trim();

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
        const pageTargetHits = allRows.slice(-pageExtractedCount).filter(isInTargetRange).length;
        if (pageTargetHits > 0) {
            consecutiveEmptyPages = 0;
        } else {
            consecutiveEmptyPages++;
            window.__re.log(`No reviews in target range on this page (${consecutiveEmptyPages}/${MAX_EMPTY_PAGES} empty pages).`);
            if (consecutiveEmptyPages >= MAX_EMPTY_PAGES) {
                window.__re.log("Reached several consecutive pages with no reviews in target range. Stopping pagination.");
                break;
            }
        }

        // --- 4. Find and Click "Next" ---
        const nextBtn = findNextButton();
        const pageNumBefore = getPageNumberText();

        if (nextBtn) {
            window.__re.log(`Clicking 'Next' page... (currently on page ${pageNumBefore ?? "?"})`);
            nextBtn.scrollIntoView({ block: "center" });
            simulateClick(nextBtn);

            // --- SMART POLLING WAITER ---
            // Instead of guessing when it's done, check every 500ms until the reviews actually change!
            let timeElapsed = 0;
            let pageSuccessfullyLoaded = false;

            while (timeElapsed < 10000) { // Wait a maximum of 10 seconds
                await new Promise(r => setTimeout(r, 500));
                timeElapsed += 500;

                const checkCards = findReviewCards();
                const cardsChanged = checkCards.length > 0 && checkCards[0].innerText !== firstCardText;
                const pageNumChanged = getPageNumberText() && getPageNumberText() !== pageNumBefore;
                if (cardsChanged || pageNumChanged) {
                    pageSuccessfullyLoaded = true;
                    window.__re.log(`New page successfully detected in DOM (now page ${getPageNumberText() ?? "?"}).`);
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
        return isInTargetRange(r);
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