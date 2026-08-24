# Scheduled Automation Design

## Context

Running this extension today requires manually opening each platform's reviews page, opening
the popup, picking a month/week, and clicking the platform button — for all 7 platforms, every
time reviews should be pulled. The goal is to make this unattended and scheduled (weekly)
instead of manual.

**The core blocker:** 5 of the 7 platforms (Airbnb, Freetour, GetYourGuide, Guruwalk, Viator)
require being logged in, and login often involves an OTP or email-confirmation-link step, not
just a static username/password. Google Maps and TripAdvisor require no login.

**Constraints established during design:**
- Occasional manual touch-up (re-logging in when a session expires) is acceptable — this does
  not need to be 100% hands-off forever. This rules out building IMAP/Gmail-API-based OTP
  automation for MVP.
- Automation runs on the user's own Mac via `launchd`, not a cloud server.
- Schedule is weekly, matching the extension's existing week-filter feature
  ([[2026-05-04-week-filter-design]]).
- There is already a dedicated Chrome profile used only for this extension — a Google
  Workspace **managed** profile ("Free Spirit", `info@freespirittours.eu`), separate from the
  user's personal and work profiles. It is idle/closed most of the time. This is the only
  profile automation is allowed to use.
- Being a managed profile, it may carry enterprise policies that block programmatic control
  (remote debugging / CDP). This is unverified and must be smoke-tested before building
  anything else.
- Failure/status reporting goes out as an email to the user via Gmail.

---

## Architecture

A new standalone Node script, `automation/run.js`, lives alongside the extension. It does
**not** replace the extension — the extension keeps working unchanged for manual/ad-hoc use.

**How injection is triggered — see [[0001-automation-drives-service-worker-not-popup]] for the
full reasoning.** In short: automation loads the real unpacked extension into the
Playwright-launched browser (`--load-extension`) rather than raw-injecting scraping scripts into
a bare page or simulating a popup click, because `getyourguide.js`/`viator.js` depend on
`chrome.runtime.sendMessage` reaching the real `background.js`, and because `popup.js`'s
tab-detection depends on a live user gesture that automation can't reproduce. Automation instead
gets a handle on the extension's own background service worker via Playwright's
`context.serviceWorkers()` and calls `chrome.scripting.executeScript` directly from inside it —
the same two calls `popup.js`/`background.js` already make.

This requires one change to the extension itself: `manifest.json`'s `host_permissions` must be
expanded to cover all 7 platform domains (`airbnb.com`, `airbnb.co.uk`, `freetour.com`,
`getyourguide.com`, `google.com/maps`, `maps.google.*`, `guruwalk.com`, `viator.com`,
`tripadvisor.com`), not just the 4 currently listed. Today, `chrome.scripting.executeScript`
works on the other domains only via `activeTab`'s temporary per-click grant — which a
programmatically triggered call does not receive. This affects **all 7 platforms**, not just the
5 login-required ones — Google Maps and TripAdvisor need the same fix. This is the only change
to any extension file; `popup.js` and all `scripts/*.js` files are otherwise untouched and the
popup UI keeps working exactly as today for manual/ad-hoc use.

`automation/run.js`:

1. Launches Chromium via Playwright's `launchPersistentContext(userDataDir, { headless: true,
   args: ['--disable-extensions-except=<ext path>', '--load-extension=<ext path>'] })`, pointing
   `userDataDir` at the "Free Spirit" profile's actual folder on disk (found via
   `chrome://version` while that profile is open — exact path confirmed during the smoke test,
   not assumed in this spec). Note: loading an extension has traditionally required a headed
   browser; whether Playwright's headless Chromium supports `--load-extension` is unverified and
   must be confirmed by the smoke test — if not, the browser runs headed instead (still fully
   unattended, just with a visible window during scheduled runs).
2. For each of the 7 platforms in sequence: opens a page, navigates to that platform's reviews
   URL, waits for load/settle, then gets the extension's background service worker via
   `context.serviceWorkers()` and calls `chrome.scripting.executeScript` from inside it to set
   `window.__targetMonth` / `__targetYear` / `__targetWeekStart` / `__targetWeekEnd` on the page,
   then inject `scripts/common.js` and `scripts/<platform>.js` — mirroring the exact sequence
   `popup.js`'s `injectScript` performs, targeting the previous Mon–Sun week by default.
3. For GetYourGuide and Viator, the redirect-continuation is handled automatically by
   `background.js`'s existing `chrome.tabs.onUpdated` listener — no special handling is needed in
   `automation/run.js` itself; it just waits for the platform's final `{ success, count }` result
   after the redirect settles.
4. Collects each platform's `{ success, count }` result, or a `needsReauth` / `error` state (see
   below).
5. Closes the context, then sends one summary email via the Gmail API.

---

## Per-platform auth strategy

No login flow is ever driven programmatically, for any platform, in this design.

- **Airbnb, Freetour, GetYourGuide, Guruwalk, Viator** — the user performs one manual login in
  the "Free Spirit" profile before automation is turned on, handling any OTP/email-confirmation
  step by hand at that time, and choosing "remember this device" / "stay signed in" wherever the
  platform offers it. Playwright then reuses that profile's cookies/localStorage on every
  scheduled run.
- **Google Maps, TripAdvisor** — no login required; unaffected by any of this.
- **Session-expiry detection** — after navigating to a platform's reviews page, before
  injecting scripts, the run checks whether the page looks like a login/verification wall
  rather than a reviews page: URL redirected to a login path, or a known selector (password
  field, "verify it's you" / "enter code" text) is present. If so, that platform is marked
  `needsReauth: true` and skipped — no attempt is made to fill in credentials or guess a code.
- Given weekly runs and "remember me" sessions typically lasting weeks to months, expirations
  are expected to be infrequent. When one happens, the user opens the Free Spirit profile in a
  normal Chrome window, logs back in once, closes it, and the next scheduled run picks up the
  refreshed session automatically.

This is an intentional scope boundary: fully unattended re-authentication (IMAP/Gmail-API OTP
retrieval, driving each platform's distinct login UI) is not part of this design. If session
expiries turn out to be frequent enough in practice to be annoying, that would be a follow-up
design, scoped per-platform, after real usage data shows which platforms actually need it.

---

## Failure detection & notification

After each run, one email is sent to the user via Gmail summarizing, per platform:
- Reviews sent count, on success.
- `needsReauth` with a note to re-login, if a login/verification wall was detected.
- `error` with a short reason, if navigation/injection failed for any other cause (e.g. a
  selector no longer matches after a site redesign — the same class of failure the Guruwalk
  scraper hit before its recent fix).

A local log file (`automation/logs/YYYY-MM-DD.log`) captures full detail (page URLs visited,
raw error stacks, per-platform timing) that the summary email omits.

---

## Scheduling

A macOS `launchd` LaunchAgent (`~/Library/LaunchAgents/com.dodai.reviews-extract.plist`) runs
`node automation/run.js` weekly (e.g. Monday 06:00 local time). `launchd` is used rather than
cron because it can also fire on wake if the Mac was asleep at the scheduled time — relevant
since this runs on a laptop, not an always-on server.

---

## Known risks / open questions to resolve during implementation

- **Enterprise policy risk (unverified):** the "Free Spirit" profile is a Google Workspace
  managed profile. Managed profiles can have policies that block remote debugging (CDP), which
  Playwright depends on. This must be confirmed with a smoke test before any further work is
  built on this design — see Rollout plan below.
- **Profile locking:** Chrome locks a profile's directory while it's open. If the user opens the
  Free Spirit profile manually at the same time a scheduled run fires, the run will fail to
  attach. Accepted as low-risk since the profile is idle/closed most of the time; not solved
  architecturally in this design.
- **Exact userDataDir path** is not yet known — must be read from `chrome://version` in that
  profile during implementation, not assumed.
- **Headless extension loading (unverified):** whether `--load-extension` works with Playwright's
  headless Chromium is not yet confirmed — see Architecture and Rollout plan. If not, the run
  goes headed instead; this doesn't block the design, just changes whether a window is visible
  during scheduled runs.
- **Gmail sending mechanism** — whether the summary email is sent via direct Gmail API call from
  `automation/run.js`, or via a separate small helper — is an implementation detail to settle
  during planning, not a design decision that affects the architecture above.

---

## Rollout plan

1. **Smoke test first.** A throwaway script that launches Playwright against the real "Free
   Spirit" profile folder with `--load-extension` pointed at this repo, and confirms (a) the
   browser opens at all — headless or headed, (b) the profile's existing cookies are intact
   (e.g. a logged-in platform loads without a login wall), and (c) a service-worker handle can be
   obtained and used to call `chrome.scripting.executeScript` successfully against a tab. If
   enterprise policy blocks any of this, stop and reconsider the approach before building
   anything further.
2. Add `host_permissions` for all 7 platform domains to `manifest.json`.
3. Build the injection loop for the 2 no-login platforms (Google Maps, TripAdvisor) first —
   validates the service-worker-driven `chrome.scripting.executeScript` approach independent of
   the auth question.
4. Add the 5 login-required platforms one at a time, verifying real session reuse and building
   login-wall detection per platform.
5. Add email reporting (success/needsReauth/error summary) and the local log file.
6. Wire up the `launchd` LaunchAgent. Trigger one run manually first, then let it fire on
   schedule and watch the first couple of real weekly runs before considering this done.

---

## Verification

1. Smoke test passes: Playwright attaches to the Free Spirit profile and confirms existing
   sessions are intact for at least one login-required platform.
2. Manually triggering `node automation/run.js` produces the same reviews in the Google Sheet
   that a manual popup run would, for all 7 platforms, for a known past week.
3. Simulate a session expiry (log out of one platform manually in the profile) — confirm the run
   marks that platform `needsReauth`, skips it without crashing the rest of the run, and the
   summary email reflects it correctly.
4. Simulate a DOM/selector failure (temporarily rename a selector in a scratch copy of a
   platform script) — confirm the run reports `error` for that platform without crashing the
   rest of the run.
5. `launchd` LaunchAgent fires at the scheduled time without the user present, and the summary
   email arrives.
6. Let it run unattended for 2–3 real weekly cycles and confirm the Sheet stays current with no
   manual intervention beyond any reported `needsReauth` platforms.
