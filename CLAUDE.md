# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Chrome extension (Manifest V3) that scrapes customer reviews from tour booking platforms and sends them to Google Sheets via a Google Apps Script webhook. No build step, no npm, no bundler — plain JavaScript loaded directly by Chrome.

## Loading the Extension

No build required. To reload after changes:

1. Go to `chrome://extensions`
2. Click the reload button on "Reviews Extract"

To test: navigate to a supported platform's review page, click the extension icon, select a month, click the platform button.

## Architecture

**Injection flow:**
1. `popup.js` sets `window.__targetMonth` / `window.__targetYear` on the active tab
2. Injects `scripts/common.js` (establishes `window.__re` namespace)
3. Injects the platform-specific script (e.g. `scripts/airbnb.js`)
4. Platform script calls `window.__re.sendDataToWebhook(rows, platformName)` and returns `{ success, count }`

**`scripts/common.js`** exposes `window.__re` with:
- Guide registry (`GUIDES`) — regex patterns per guide per city; `extractGuideName(text, city)`
- City/tour mapping — `guessCity(text)`, `mapTourName(rawName)`
- Date/time formatters — `formatDate`, `parseDashDate`, `parseLongDate`, `parseRelativeDate`
- `sendDataToWebhook(rows, platform)` — POSTs JSON to the hardcoded Google Apps Script URL with `mode: 'no-cors'`
- `waitForDOMSettle(timeout)` — MutationObserver-based helper for dynamic pages
- `getTargetMonthYear()` — reads `window.__targetMonth/__targetYear` set by popup

**Platform scripts** (`scripts/*.js`) are IIFEs that:
- Query DOM selectors specific to that platform
- Extract: Date, Time, Guide, Rating, Tour, City, Language, Platform, Review
- Filter to the selected month where needed
- Return `{ success: bool, count: number }`

**Row schema** (TSV_HEADERS order): `Date | Time | Guide | Rating | Tour | City | Language | Platform | Review`

## Adding a New Platform

1. Create `scripts/<platform>.js` as an IIFE calling `window.__re.*`
2. Add an entry to the `PLATFORMS` array in `popup.js` with `{ id, script, domains }`
3. Add a button in `popup.html` with the matching `id`
4. Add host permissions in `manifest.json` if the platform's domain isn't covered

## Maintaining the Guide Registry

`GUIDES` in `common.js` is the source of truth for guide name resolution. Each entry has:
- `fullName` — canonical display name
- `city` — two-letter code (`zg`, `zd`, `st`, `du`)
- `patterns` — primary regex matches (word-boundary `\b`)
- `aliases` — common misspellings / alternate spellings

When a guide name can't be resolved, `extractGuideName` returns `"N/A"`.

## Webhook

The Google Apps Script webhook URL is hardcoded in `common.js` `sendDataToWebhook`. It uses `mode: 'no-cors'` with `Content-Type: text/plain` to avoid CORS preflight; responses are opaque (no error feedback on failure).

## Supported Platforms

Airbnb, Freetour, GetYourGuide, Google Maps, Guruwalk, Viator, TripAdvisor
