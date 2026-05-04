(async function () {
  window.__re.log("Google Maps Review Scraper Started…");

  // ─── 1. Utilities ─────────────────────────────────────────────────────────────
  function cleanReviewText(text) {
    if (!text) return "";
    return text
      .replace(/\b(TRUE|FALSE)\b/g, "")
      .replace(/\t/g, " ")
      .replace(/\n/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function expandAllReviews() {
    const moreButtons = document.querySelectorAll("button.w8nwRe.kyuRq");
    moreButtons.forEach(btn => btn.click());
    window.__re.log(`Expanded ${moreButtons.length} truncated reviews`);
  }

  // ─── 2. Calculate Target Dates (Month Picker Integration) ─────────────────────
  const { month: targetMonth, year: targetYear } = window.__re.getTargetMonthYear();
  window.__re.log(`Target date: Month ${targetMonth}, Year ${targetYear}`);

  const cutoffDate = new Date(targetYear, targetMonth, 1);
  const targetWeek = window.__re.getTargetWeek();
  const scrollCutoff = targetWeek ? targetWeek.start : cutoffDate;

  // ─── 3. Auto-Scroll Logic ─────────────────────────────────────────────────────
  async function autoScrollToTarget() {
    return new Promise((resolve) => {
      let scrollContainer = document.querySelector('.m6QErb.DxyBCb.kA9KIf.dS8AEf') || document.querySelector('.m6QErb[aria-label]');
      
      if (!scrollContainer) {
        window.__re.warn("Could not find Google Maps scroll container. Trying to extract visible only.");
        resolve();
        return;
      }

      window.__re.log(`Scrolling until we hit a review older than ${window.__re.formatDate(cutoffDate)}...`);

      let lastElementCount = 0;
      let noNewElementsCount = 0;

      const scrollInterval = setInterval(() => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;

        const dateElements = document.querySelectorAll(".rsqaWe");
        const currentElementCount = dateElements.length;

        if (currentElementCount === lastElementCount) {
            noNewElementsCount++;
            if (noNewElementsCount > 10) { 
                window.__re.log("Hit bottom or stopped loading. Stopping scroll.");
                clearInterval(scrollInterval);
                resolve();
                return;
            }
        } else {
            noNewElementsCount = 0;
            lastElementCount = currentElementCount;
        }

        if (currentElementCount > 0) {
            const lastDateText = dateElements[currentElementCount - 1].textContent.trim();
            const parsedISODate = window.__re.parseRelativeDate(lastDateText);
            
            if (parsedISODate) {
                const oldestLoadedDate = new Date(parsedISODate);
                
                if (oldestLoadedDate < scrollCutoff) {
                    window.__re.log(`Reached review older than target (${lastDateText}). Stopping scroll.`);
                    clearInterval(scrollInterval);
                    resolve();
                }
            }
        }
      }, 1500); 
    });
  }

  // ─── 4. Extract Data ──────────────────────────────────────────────────────────
  function parseReviews() {
    const reviewElements = document.querySelectorAll(".jftiEf[data-review-id]");
    const reviews = [];

    reviewElements.forEach(el => {
      const starsEl = el.querySelector('.kvMYJc[role="img"]');
      const starsLabel = starsEl ? starsEl.getAttribute("aria-label") : "";
      const starsMatch = starsLabel.match(/(\d+)/);
      const stars = starsMatch ? parseInt(starsMatch[1], 10) : "";

      const dateEl = el.querySelector(".rsqaWe");
      const publishAt = dateEl ? dateEl.textContent.trim() : null;
      const publishedAtISO = window.__re.parseRelativeDate(publishAt);

      const textEl = el.querySelector(".wiI7pd");
      const text = textEl ? textEl.textContent.trim() : "";

      reviews.push({ publishedAtISO, stars, text });
    });

    return reviews;
  }

  // ─── 5. Run & Filter ──────────────────────────────────────────────────────────
  await autoScrollToTarget();
  expandAllReviews();
  await window.__re.waitForDOMSettle(3000);

  const rawReviews = parseReviews();
  
  // Strict Filtering: Keep only the ones inside the requested month
  const validReviews = rawReviews.filter(r => {
      if (!r.publishedAtISO) return true;
      const d = new Date(r.publishedAtISO);
      if (targetWeek) return d >= targetWeek.start && d <= targetWeek.end;
      return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
  });

  const rows = validReviews.map(r => {
    const city = window.__re.guessCity(r.text) || window.__re.guessCity(document.title);
    const guide = window.__re.extractGuideName(r.text, city);
    return {
      Date: window.__re.formatDate(r.publishedAtISO),
      Time: "",
      Guide: guide,
      Rating: r.stars != null ? r.stars : "",
      Tour: "",
      City: city || window.__re.getGuideCity(guide),
      Language: "",
      Platform: "Google",
      Review: cleanReviewText(r.text),
    };
  });

  if (rows.length === 0) {
    window.__re.warn("No reviews found for the strictly selected month.");
    return { success: false, count: 0, platform: "Google" };
  }

  window.__re.sendDataToWebhook(rows, "Google");
  window.__re.log(`Total filtered reviews sent to webhook: ${rows.length}`);
  return { success: true, count: rows.length, platform: "Google" };
})();