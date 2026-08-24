const { chromium } = require('playwright');
const path = require('node:path');
const { loadConfig } = require('./lib/config');
const { previousWeekRange } = require('./lib/weekRange');
const { isAuthWall } = require('./lib/authWall');
const { buildReportText, sendReport } = require('./lib/report');
const { createLogger } = require('./lib/logger');
const { getExtensionWorker, injectAndScrape } = require('./lib/serviceWorker');

// Set from Task 9's smoke test — the mode that succeeded.
const HEADLESS = true; // flip to false if the smoke test required a headed browser
const USER_DATA_DIR = '/Users/antunzebec/Library/Application Support/Google/Chrome';
const PROFILE_DIRECTORY = 'REPLACE_WITH_REAL_PROFILE_FOLDER_NAME'; // from Task 9 Step 1
const EXTENSION_PATH = path.join(__dirname, '..');

function assertProfileDirectoryConfigured(profileDirectory) {
  if (profileDirectory.includes('REPLACE_WITH_REAL')) {
    throw new Error(
      'PROFILE_DIRECTORY is still a placeholder. Open the dedicated Chrome profile, ' +
        'navigate to chrome://version, and copy the folder name from "Profile Path" ' +
        '(e.g. "Profile 5") into PROFILE_DIRECTORY in run.js — see automation/README.md.'
    );
  }
}

async function runPlatform({ context, worker, platform, weekStart, weekEnd, log }) {
  const page = await context.newPage();
  try {
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // let client-side redirects/DOM settle

    // Check all auth-wall selectors upfront and build a lookup set. Require visibility,
    // not just DOM presence — a hidden/collapsed sign-in modal is always in the markup.
    const presentSelectors = new Set();
    if (platform.authWallSelectors && platform.authWallSelectors.length > 0) {
      for (const selector of platform.authWallSelectors) {
        if ((await page.locator(`${selector}:visible`).count()) > 0) {
          presentSelectors.add(selector);
        }
      }
    }

    // Pass a synchronous lookup function to isAuthWall
    if (isAuthWall({ url: page.url(), hasSelector: (selector) => presentSelectors.has(selector) }, platform)) {
      log(`${platform.id}: auth wall detected at ${page.url()}`);
      return { id: platform.id, status: 'needsReauth' };
    }

    const weekArgs = platform.weekSupported ? { weekStart, weekEnd } : { weekStart: null, weekEnd: null };
    let result = await injectAndScrape({ worker, page, scriptFile: platform.script, ...weekArgs });

    // GetYourGuide/Viator apply their date filter via a server-side redirect: the first
    // injectAndScrape() call just kicks off window.location.href and returns a placeholder
    // result immediately, before the reload (and background.js's own re-injection) happens.
    // Wait for the redirected page to actually load, then re-run injectAndScrape() so we get
    // the real {success, count} — the URL now already carries the correct date params, so
    // ensurePreviousMonthFilter() will see isFilterSet = true this time and actually scrape.
    if (result && typeof result.message === 'string' && result.message.toLowerCase().includes('reloading')) {
      log(`${platform.id}: redirected to apply date filter, waiting for reload...`);
      await page.waitForTimeout(1500); // give window.location.href time to actually start navigating
      await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      result = await injectAndScrape({ worker, page, scriptFile: platform.script, ...weekArgs });
    }

    if (result && result.success) {
      log(`${platform.id}: success, ${result.count} reviews`);
      return { id: platform.id, status: 'success', count: result.count };
    }

    // success:false with count:0 and no thrown error/auth-wall means the scraper ran fine
    // but there simply were no reviews in the target period — not an error.
    if (result && result.success === false && result.count === 0) {
      log(`${platform.id}: no reviews this period`);
      return { id: platform.id, status: 'noReviews' };
    }

    log(`${platform.id}: script ran but reported no success (result=${JSON.stringify(result)})`);
    return { id: platform.id, status: 'error', message: 'scraper returned no reviews / success:false' };
  } catch (err) {
    log(`${platform.id}: error - ${err.message}`);
    return { id: platform.id, status: 'error', message: err.message };
  } finally {
    await page.close();
  }
}

async function main() {
  const { platforms, secrets } = loadConfig();
  const { log, filePath } = createLogger();
  const { start: weekStart, end: weekEnd } = previousWeekRange();

  log(`Starting run. Target week: ${new Date(weekStart).toDateString()} - ${new Date(weekEnd).toDateString()}`);

  let results;
  try {
    assertProfileDirectoryConfigured(PROFILE_DIRECTORY);

    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: HEADLESS,
      args: [
        `--profile-directory=${PROFILE_DIRECTORY}`,
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

    results = [];
    try {
      const worker = await getExtensionWorker(context);
      log(`Extension service worker ready: ${worker.url()}`);

      for (const platform of platforms) {
        const result = await runPlatform({ context, worker, platform, weekStart, weekEnd, log });
        results.push(result);
      }
    } finally {
      await context.close();
    }
  } catch (err) {
    // Browser launch or service-worker attach failed before any platform could run — this is a
    // silent total failure unless we send a report ourselves, since nothing further will run.
    log(`FATAL: run failed to start - ${err.message}`);
    await sendReport({
      secrets,
      subject: `Reviews Extract weekly run — FAILED TO START — ${new Date().toDateString()}`,
      text:
        `The weekly automation run failed to start before any platform could be scraped.\n\n` +
        `Error: ${err.message}\n\n` +
        `Full log: ${filePath}`,
    });
    process.exitCode = 1;
    return;
  }

  const reportText = buildReportText(results);
  log(`Run complete:\n${reportText}`);

  await sendReport({
    secrets,
    subject: `Reviews Extract weekly run — ${new Date().toDateString()}`,
    text: `${reportText}\n\nFull log: ${filePath}`,
  });

  // noReviews is a legitimate outcome (nothing to report for the period), not an error.
  // needsReauth still counts toward the exit code since it needs the user's attention.
  const hadErrors = results.some((r) => r.status !== 'success' && r.status !== 'noReviews');
  process.exitCode = hadErrors ? 1 : 0;
}

main().catch((err) => {
  console.error('Fatal error in automation run:', err);
  process.exitCode = 1;
});
