async function getExtensionWorker(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
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

      const now = new Date();
      const targetMonth = now.getMonth();
      const targetYear = now.getFullYear();

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
