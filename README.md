# Reviews Extract — Chrome Extension

A Chrome extension that scrapes customer reviews from popular platforms and sends them directly to Google Sheets via a webhook.

## Supported Platforms

Airbnb · Freetour.com · GetYourGuide · Google Maps · Guruwalk · Viator · TripAdvisor

## Extracted Fields

Date · Time · Rating · Review text · Tour/product name · Guide name · City · Language · Platform

## Installation

1. Download or clone this repo and unzip it.
2. Go to `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder.

> Optionally, pin the extension via the puzzle piece icon in your toolbar.

## Usage

1. Navigate to a supported platform's review page.
2. Click the **Reviews Extract** icon in your toolbar.
3. Select the target month from the dropdown.
4. Optionally, select a specific week (Mon–Sun) from the **Scrape Week** dropdown. Leave it on "All weeks" to scrape the full month.
5. Click the button for the current platform.
6. Wait for **"Done! N reviews sent to Sheets."** — reviews are automatically written to Google Sheets.

The extension auto-detects the active platform, expands truncated reviews where needed, and filters results to the selected month or week before sending.

> **Week filter notes:**
> - Airbnb and TripAdvisor do not support week filtering — the week dropdown is disabled on those pages.
> - GetYourGuide and Viator apply the week filter via server-side URL parameters; you may need to click the button twice (once to redirect, once to scrape).
> - Freetour, Guruwalk, and Google Maps filter client-side after scraping.

## Project Structure

```text
manifest.json       Extension config, permissions, and popup definition
popup.html          Popup UI (month + week dropdowns, platform buttons)
popup.css           Popup UI styles
popup.js            Button logic, week generation, and script injection
logo.png            Extension icon
scripts/
  common.js         Shared utilities (guide registry, date helpers, webhook,
                    getTargetMonthYear, getTargetWeek)
  airbnb.js
  freetour.js
  getyourguide.js
  google.js
  guruwalk.js
  tripadvisor.js
  viator.js
```

Each platform script handles element selection, field extraction, and delegates sending to `common.js`.

## License

TODO
