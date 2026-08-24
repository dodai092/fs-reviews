# Scheduled automation drives the extension's background service worker, not the popup UI

**Status:** accepted

Unattended weekly automation ([[2026-08-24-scheduled-automation-design]]) needs to trigger the
same scraping flow the popup button click does, with no human present. Two alternatives were
considered and rejected: (1) raw-injecting `scripts/common.js` + a platform script into the page
via Playwright's `page.addScriptTag()`, outside any extension context — rejected because
`getyourguide.js` and `viator.js` call `chrome.runtime.sendMessage(...)` unconditionally to hand
off a server-side-redirect continuation to `background.js`, which throws immediately with no
extension loaded; (2) opening `chrome-extension://<id>/popup.html` as a normal tab and clicking
the platform button to run the real `popup.js` — rejected because `popup.js` finds its target
tab via `chrome.tabs.query({active: true, currentWindow: true})`, which depends on state that's
only reliable when a human just clicked the toolbar icon on a focused tab, and reproducing that
from Playwright is fragile and would require adding the broader `"tabs"` permission.

Instead, automation loads the real unpacked extension into the Playwright-launched browser and
uses Playwright's `context.serviceWorkers()` to get a handle into the extension's own already-
running background service worker, then calls `chrome.scripting.executeScript` directly from
inside that context — the same two calls (`common.js`, then the platform script) that
`popup.js`/`background.js` already make, targeting the `tabId` of the page Playwright navigated
to directly. This requires `manifest.json`'s `host_permissions` to be expanded to cover all 7
platform domains (currently only `script.google.com`, `script.googleusercontent.com`,
`supplier.getyourguide.com`, and `supplier.viator.com` are listed — everything else works today
only via `activeTab`'s temporary per-gesture grant, which does not apply to programmatically
triggered clicks). With explicit `host_permissions`, `chrome.scripting.executeScript` no longer
needs a live user gesture at all, for either manual or automated use.

## Consequences

- `manifest.json` gains `host_permissions` entries for `airbnb.com`, `airbnb.co.uk`,
  `freetour.com`, `getyourguide.com`, `google.com/maps`, `maps.google.*`, `guruwalk.com`,
  `viator.com`, and `tripadvisor.com` — a permanent grant, not scoped to `activeTab`'s temporary
  window. This is a real (if minor) increase in what the extension can silently do on those
  domains, worth being aware of if the extension is ever reviewed for a store listing.
- `background.js`'s existing `chrome.tabs.onUpdated` redirect-continuation logic for GetYourGuide
  and Viator keeps working unmodified, since it's a global listener independent of what triggered
  the initial injection.
- No changes are needed to `popup.js` or any `scripts/*.js` file — the popup UI keeps working
  exactly as today for manual/ad-hoc use.
