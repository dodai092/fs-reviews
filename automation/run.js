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

async function runPlatform({ context, worker, platform, weekStart, weekEnd, log }) {
  const page = await context.newPage();
  try {
    await page.goto(platform.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // let client-side redirects/DOM settle

    // Check all auth-wall selectors upfront and build a lookup set
    const presentSelectors = new Set();
    if (platform.authWallSelectors && platform.authWallSelectors.length > 0) {
      for (const selector of platform.authWallSelectors) {
        if ((await page.locator(selector).count()) > 0) {
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
    const result = await injectAndScrape({ worker, page, scriptFile: platform.script, ...weekArgs });

    if (result && result.success) {
      log(`${platform.id}: success, ${result.count} reviews`);
      return { id: platform.id, status: 'success', count: result.count };
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

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: HEADLESS,
    args: [
      `--profile-directory=${PROFILE_DIRECTORY}`,
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  const results = [];
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

  const reportText = buildReportText(results);
  log(`Run complete:\n${reportText}`);

  await sendReport({
    secrets,
    subject: `Reviews Extract weekly run — ${new Date().toDateString()}`,
    text: `${reportText}\n\nFull log: ${filePath}`,
  });

  const hadErrors = results.some((r) => r.status !== 'success');
  process.exitCode = hadErrors ? 1 : 0;
}

main().catch((err) => {
  console.error('Fatal error in automation run:', err);
  process.exitCode = 1;
});
