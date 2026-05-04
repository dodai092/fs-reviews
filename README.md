# Reviews Extract — Chrome Extension

A Chrome extension that scrapes customer reviews from popular platforms and sends them directly to Google Sheets via a webhook.

## Supported Platforms

Airbnb · Freetour.com · GetYourGuide · Google Maps · Guruwalk · Viator

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
4. Click the button for the current platform.
5. Wait for **"Done! N reviews sent to Sheets."** — reviews are automatically written to Google Sheets.

The extension auto-detects the active platform, expands truncated reviews where needed, and filters results to the selected month before sending.

## Project Structure

```text
manifest.json       Extension config, permissions, and popup definition
popup.html          Popup UI
popup.css           Popup UI styles
popup.js            Button logic and script injection
logo.png            Extension icon
scripts/
  common.js         Shared utilities (guide registry, date helpers, webhook)
  airbnb.js
  freetour.js
  getyourguide.js
  google.js
  guruwalk.js
  viator.js
```

Each platform script handles element selection, field extraction, and delegates sending to `common.js`.

## License

TODO
