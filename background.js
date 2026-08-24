// Resumes a scrape after a platform script (getyourguide.js, viator.js, ...) redirects
// the tab to apply a server-side date filter (date_from/date_to, startDate/endDate, ...).
// Content scripts die on navigation, so the platform script hands off the target
// month/week and its own script filename here before redirecting, and this listener
// re-injects that script once the reload finishes.

const pendingScrapes = new Map(); // tabId -> { script, targetMonth, targetYear, targetWeekStart, targetWeekEnd }

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.action === 'schedule-continue' && sender.tab?.id != null && message.script) {
    pendingScrapes.set(sender.tab.id, {
      script: message.script,
      targetMonth: message.targetMonth,
      targetYear: message.targetYear,
      targetWeekStart: message.targetWeekStart,
      targetWeekEnd: message.targetWeekEnd,
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;

  const data = pendingScrapes.get(tabId);
  if (!data) return;
  pendingScrapes.delete(tabId); // one-shot: avoids retry loops if the filter still doesn't match

  chrome.action.setBadgeText({ tabId, text: '…' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#f39c12' });

  chrome.scripting.executeScript({
    target: { tabId },
    func: (m, y, ws, we) => {
      window.__targetMonth = m;
      window.__targetYear = y;
      window.__targetWeekStart = ws;
      window.__targetWeekEnd = we;
    },
    args: [data.targetMonth, data.targetYear, data.targetWeekStart, data.targetWeekEnd],
  })
    .then(() => chrome.scripting.executeScript({ target: { tabId }, files: ['scripts/common.js'] }))
    .then(() => chrome.scripting.executeScript({ target: { tabId }, files: [`scripts/${data.script}`] }))
    .then((results) => {
      const result = results?.[0]?.result;
      chrome.action.setBadgeText({ tabId, text: result?.success ? '✓' : '!' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: result?.success ? '#2ecc71' : '#e74c3c' });
      setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 5000);
    })
    .catch((err) => {
      console.error(`Auto-continue failed for ${data.script}:`, err);
      chrome.action.setBadgeText({ tabId, text: '!' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#e74c3c' });
      setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }), 5000);
    });
});
