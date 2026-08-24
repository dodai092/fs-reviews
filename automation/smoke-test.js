const { chromium } = require('playwright');
const path = require('node:path');
const { getExtensionWorker } = require('./lib/serviceWorker');

// Fill these in from Step 1 before running.
const USER_DATA_DIR = '/Users/antunzebec/Library/Application Support/Google/Chrome';
const PROFILE_DIRECTORY = 'REPLACE_WITH_REAL_PROFILE_FOLDER_NAME'; // e.g. "Profile 5"
const EXTENSION_PATH = path.join(__dirname, '..');

async function main() {
  for (const headless of [true, false]) {
    console.log(`\n--- Trying headless=${headless} ---`);
    let context;
    try {
      context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless,
        args: [
          `--profile-directory=${PROFILE_DIRECTORY}`,
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
        ],
      });
    } catch (err) {
      console.error(`Failed to launch (headless=${headless}):`, err.message);
      continue;
    }

    try {
      const worker = await getExtensionWorker(context);
      console.log('Got extension service worker:', worker.url());

      const page = await context.newPage();
      await page.goto('https://www.tripadvisor.com/', { waitUntil: 'domcontentloaded' });

      const tabCheck = await worker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        return { tabCount: tabs.length, matched: tabs.some((t) => t.url === url) };
      }, page.url());
      console.log('chrome.tabs.query from service worker:', tabCheck);

      console.log(`SUCCESS with headless=${headless}. Use this mode in run.js.`);
      await context.close();
      return;
    } catch (err) {
      console.error(`Service worker / chrome.scripting check failed (headless=${headless}):`, err.message);
      await context.close();
    }
  }

  console.error('\nBoth headless and headed attempts failed — see ADR-0001 and the spec\'s Known risks section. Enterprise policy on the managed profile may be blocking extension loading or CDP.');
  process.exitCode = 1;
}

main();
