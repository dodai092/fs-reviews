function findExtensionWorker(context) {
  return context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
}

async function getExtensionWorker(context) {
  let worker = findExtensionWorker(context);
  if (!worker) {
    const event = await context.waitForEvent('serviceworker', { timeout: 15000 });
    worker = event.url().startsWith('chrome-extension://') ? event : findExtensionWorker(context);
  }
  return worker;
}

async function injectAndScrape({ worker, page, scriptFile, weekStart, weekEnd }) {
  const url = page.url();

  const result = await worker.evaluate(
    async ({ url, scriptFile, weekStart, weekEnd }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url === url);
      if (!tab) return { error: `No tab found matching URL: ${url}` };
      const tabId = tab.id;

      // For weekSupported:false platforms (Airbnb, TripAdvisor) run.js passes
      // weekStart: null, so we fall back to "now" as a reasonable default — a known
      // limitation (it means "current month," not the target week) that isn't solved here.
      // When weekStart IS provided, derive month/year from the target week, not from
      // whatever day the automation happens to run on.
      const monthYearSource = weekStart ? new Date(weekStart) : new Date();
      const targetMonth = monthYearSource.getMonth();
      const targetYear = monthYearSource.getFullYear();

      await chrome.scripting.executeScript({
        target: { tabId },
        func: (m, y, ws, we) => {
          window.__targetMonth = m;
          window.__targetYear = y;
          window.__targetWeekStart = ws;
          window.__targetWeekEnd = we;
        },
        args: [targetMonth, targetYear, weekStart, weekEnd],
      });

      await chrome.scripting.executeScript({ target: { tabId }, files: ['scripts/common.js'] });
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        files: [`scripts/${scriptFile}`],
      });
      return results?.[0]?.result ?? null;
    },
    { url, scriptFile, weekStart, weekEnd }
  );

  if (result && result.error) throw new Error(result.error);
  return result;
}

module.exports = { getExtensionWorker, injectAndScrape };
