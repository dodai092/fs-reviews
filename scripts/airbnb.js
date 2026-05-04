(function () {
    window.__re.log("Airbnb Review Scraper Started…");

    // ─── Main ────────────────────────────────────────────────────────────────────
    function scrapeData() {
        const reviewNodes = document.querySelectorAll('button[aria-label="Opens detailed review"]');

        if (reviewNodes.length === 0) {
            window.__re.warn("No reviews found. Check selectors.");
            return { success: false, count: 0, platform: "Airbnb" };
        }

        // Tour name
        let rawTourName = "";
        try {
            const titleEl = document.querySelector("h1");
            if (titleEl) rawTourName = titleEl.innerText.split("·")[0].trim();
        } catch (e) {
            rawTourName = "Tour Name Not Found";
        }
        const finalTourName = window.__re.mapTourName(rawTourName);

        // City: Auto-detect without prompting
        let finalCityName = window.__re.guessCity(rawTourName);
        if (!finalCityName) {
            // Fallback: try to guess from the URL if the H1 didn't contain the city name
            finalCityName = window.__re.guessCity(window.location.href);
        }

        const rows = [];

        reviewNodes.forEach(node => {
            try {
                // Date & Time
                const metaDiv = node.querySelector(".d1ylbvwr");
                let dateVal = "", timeVal = "";
                if (metaDiv) {
                    const parts = metaDiv.innerText.split("·");
                    if (parts.length > 0) dateVal = window.__re.formatDate(parts[0].trim());
                    if (parts.length > 1) timeVal = window.__re.formatTime12(parts[1].trim());
                }

                // Rating (count of star SVGs)
                const ratingContainer = node.querySelector(".scbur3z");
                const rating = ratingContainer ? ratingContainer.querySelectorAll("svg").length : "";

                // Review text
                const textDiv = node.querySelector(".cwk6og9");
                const reviewText = textDiv
                    ? textDiv.innerText.replace(/(\r\n|\n|\r)/gm, " ")
                    : "";

                // Guide
                const guide = window.__re.extractGuideName(reviewText, finalCityName);

                rows.push({
                    Date: dateVal,
                    Time: timeVal,
                    Guide: guide,
                    Rating: rating,
                    Tour: finalTourName,
                    City: (finalCityName || window.__re.getGuideCity(guide)).trim().toLowerCase(),
                    Language: "",
                    Platform: "Airbnb",
                    Review: reviewText,
                });
            } catch (err) {
                window.__re.error("Error parsing a review row", err);
            }
        });

        // Send data directly to the Webhook instead of clipboard
        window.__re.sendDataToWebhook(rows, "Airbnb");
        
        window.__re.log(`Dispatched ${rows.length} Airbnb reviews to webhook.`);
        return { success: true, count: rows.length, platform: "Airbnb" };
    }

    return scrapeData();
})();