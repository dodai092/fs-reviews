# Reviews Extract automation — setup runbook

This runs the "Reviews Extract" Chrome extension unattended once a week via a Playwright-driven
browser and a macOS `launchd` LaunchAgent. Follow these steps in order for a first-time setup.

## 1. Install dependencies

```
cd automation
npm install
npx playwright install chromium
```

## 2. Configure the platform list

Copy `platforms.example.json` to `platforms.json` and fill in the 7 real reviews-page URLs
(one per platform: GetYourGuide, Viator, Airbnb, TripAdvisor, FreeTour, GuruWalk, Google Maps).
`platforms.json` is gitignored — it's meant to hold real, account-specific URLs.

## 3. Configure secrets

Copy `secrets.example.json` to `secrets.json` and fill in a real Gmail app password (not your
normal Gmail password — generate one at https://myaccount.google.com/apppasswords) and the
email address that should receive the weekly run report.

## 4. Find your Chrome profile's directory name

The automation needs to launch the *same* Chrome profile you already use to log in to all 7
platforms (so cookies/sessions carry over), not a fresh empty one. Open that Chrome profile,
navigate to `chrome://version`, and look at "Profile Path" — something like
`/Users/you/Library/Application Support/Google/Chrome/Profile 5`. The parent directory
(`.../Google/Chrome`) is `USER_DATA_DIR`; the last path segment (`Profile 5`) is
`PROFILE_DIRECTORY`.

## 5. Fill in the profile settings

Set `PROFILE_DIRECTORY` (and double-check `USER_DATA_DIR`) at the top of both
`smoke-test.js` and `run.js`. Both files throw a clear error at startup if
`PROFILE_DIRECTORY` is left as the `REPLACE_WITH_REAL_PROFILE_FOLDER_NAME` placeholder, so
you can't accidentally run against a bogus profile.

## 6. Close Chrome

Quit that Chrome profile completely before running anything below — Chrome locks its profile
directory while open, and Playwright's `launchPersistentContext` will fail (or silently use a
lock-broken copy) if the real Chrome is still holding it.

## 7. Run the smoke test

```
node smoke-test.js
```

It tries `headless: true` first, then `headless: false`, and reports which mode succeeds in
loading the extension and getting a working service worker handle. Note which mode worked and
set the `HEADLESS` constant at the top of `run.js` to match — some managed/enterprise Chrome
profiles only allow the extension to load in headed mode.

## 8. Logs

`run.js` creates `automation/logs/` automatically on every run (via `createLogger()` in
`lib/logger.js`, which calls `fs.mkdirSync(dir, { recursive: true })`) and writes a
dated log file per day, so there's nothing to set up by hand here — just know where to look
when debugging a run.

## 9. Do one manual dry run

```
node run.js
```

Point it at a known past week and confirm: the report email arrives, and the Google Sheet
gets updated correctly with the expected reviews. Treat this as the final check before handing
the job to `launchd` — it's much easier to debug interactively than after it's running headless
on a schedule.

## 10. Install the LaunchAgent

Copy the example plist into place:

```
cp ../com.dodai.reviews-extract.plist.example ~/Library/LaunchAgents/com.dodai.reviews-extract.plist
```

Then load it with either of these (both work; `bootstrap` is the modern replacement for the
deprecated `load`/`unload` pair, but `load` still works fine on current macOS):

```
launchctl load ~/Library/LaunchAgents/com.dodai.reviews-extract.plist
# or, the modern equivalent:
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.dodai.reviews-extract.plist
```

## 11. Trigger one run through launchd itself

Don't just trust that the schedule is correct — fire it manually once to confirm the
LaunchAgent itself is wired up correctly (right node path, right working directory, logs
landing where expected):

```
launchctl start com.dodai.reviews-extract
```

Check `automation/logs/launchd.out.log` and `automation/logs/launchd.err.log` (paths set in
the plist) plus the dated log file under `automation/logs/` to confirm it ran cleanly.
