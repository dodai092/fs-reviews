document.addEventListener('DOMContentLoaded', () => {

  const PLATFORMS = [
    { id: 'btn-airbnb',      script: 'airbnb.js',      domains: ['airbnb.com', 'airbnb.co.uk'],          weekSupported: false },
    { id: 'btn-freetour',    script: 'freetour.js',     domains: ['freetour.com'] },
    { id: 'btn-gyg',         script: 'getyourguide.js', domains: ['getyourguide.com'] },
    { id: 'btn-google',      script: 'google.js',       domains: ['google.com/maps', 'maps.google'] },
    { id: 'btn-guruwalk',    script: 'guruwalk.js',     domains: ['guruwalk.com'] },
    { id: 'btn-viator',      script: 'viator.js',       domains: ['viator.com'] },
    { id: 'btn-tripadvisor', script: 'tripadvisor.js',  domains: ['tripadvisor.com'],                    weekSupported: false },
  ];

  const statusDiv = document.getElementById('status');
  const monthSelect = document.getElementById('month-select');
  const weekSelect = document.getElementById('week-select');

  const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function getWeeksForMonth(month, year) {
    const firstDay = new Date(year, month, 1);
    const dow = firstDay.getDay(); // 0=Sun, 1=Mon...6=Sat
    const daysToMonday = dow === 0 ? -6 : 1 - dow;
    const firstMonday = new Date(year, month, 1 + daysToMonday);
    const lastDay = new Date(year, month + 1, 0);
    const weeks = [];
    let monday = new Date(firstMonday);
    while (monday <= lastDay) {
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      weeks.push({ start: new Date(monday), end: new Date(sunday) });
      monday = new Date(monday);
      monday.setDate(monday.getDate() + 7);
    }
    return weeks;
  }

  function formatWeekLabel(start, end) {
    return `${MONTH_ABBR[start.getMonth()]} ${start.getDate()} – ${MONTH_ABBR[end.getMonth()]} ${end.getDate()}`;
  }

  function populateWeekSelect() {
    if (!weekSelect || !monthSelect) return;
    const target = JSON.parse(monthSelect.value);
    const weeks = getWeeksForMonth(target.month, target.year);
    weekSelect.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = 'null';
    allOpt.text = 'All weeks';
    weekSelect.appendChild(allOpt);
    weeks.forEach(({ start, end }) => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ start: start.getTime(), end: end.getTime() });
      opt.text = formatWeekLabel(start, end);
      weekSelect.appendChild(opt);
    });
  }

  // ─── Auto-Populate the Month Dropdown (+3 to -3 months) ─────────────────────
  if (monthSelect) {
    const now = new Date();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    for (let i = 3; i >= -3; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const option = document.createElement('option');
      option.value = JSON.stringify({ month: d.getMonth(), year: d.getFullYear() });
      option.text = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
        option.selected = true;
      }
      monthSelect.appendChild(option);
    }
  }

  populateWeekSelect();

  if (monthSelect) {
    monthSelect.addEventListener('change', () => {
      populateWeekSelect();
    });
  }

  // ─── Single tab query — cached for both auto-detect and injection ────────────
  let cachedTab = null;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    cachedTab = tabs[0] || null;
    const url = cachedTab?.url || '';
    for (const platform of PLATFORMS) {
      if (platform.domains.some(domain => url.includes(domain))) {
        const btn = document.getElementById(platform.id);
        if (btn) btn.classList.add('active');
        if (weekSelect && platform.weekSupported === false) {
          weekSelect.disabled = true;
        }
        break;
      }
    }
  });

  // ─── Inject common.js then platform script ──────────────────────────────────
  const injectScript = (scriptFile) => {
    if (!cachedTab?.id) return;
    const tabId = cachedTab.id;
    statusDiv.innerText = 'Scraping';
    const targetData = monthSelect ? JSON.parse(monthSelect.value) : null;
    const weekVal = weekSelect ? weekSelect.value : 'null';
    const weekData = weekVal === 'null' ? null : JSON.parse(weekVal);
    const weekStart = weekData ? weekData.start : null;
    const weekEnd = weekData ? weekData.end : null;

    function injectCommon() {
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['scripts/common.js'] },
        () => {
          if (chrome.runtime.lastError) {
            statusDiv.innerText = 'Error (Check Console)';
            console.error(chrome.runtime.lastError);
            return;
          }
          chrome.scripting.executeScript(
            { target: { tabId }, files: [`scripts/${scriptFile}`] },
            (results) => {
              if (chrome.runtime.lastError) {
                statusDiv.innerText = 'Error (Check Console)';
                console.error(chrome.runtime.lastError);
                return;
              }
              const result = results?.[0]?.result;
              if (result?.success) {
                statusDiv.innerText = `Done! ${result.count} reviews sent to Sheets.`;
              } else if (result) {
                statusDiv.innerText = `No reviews found.`;
              } else {
                statusDiv.innerText = 'Done! Sent to Sheets.';
              }
              setTimeout(() => (statusDiv.innerText = 'Ready'), 4000);
            }
          );
        }
      );
    }

    if (targetData) {
      chrome.scripting.executeScript({
        target: { tabId },
        func: (m, y, ws, we) => {
          window.__targetMonth = m;
          window.__targetYear = y;
          window.__targetWeekStart = ws;
          window.__targetWeekEnd = we;
        },
        args: [targetData.month, targetData.year, weekStart, weekEnd]
      }, injectCommon);
    } else {
      injectCommon();
    }
  };

  // ─── Register click handlers ─────────────────────────────────────────────────
  for (const platform of PLATFORMS) {
    const btn = document.getElementById(platform.id);
    if (btn) {
      btn.addEventListener('click', () => injectScript(platform.script));
    }
  }
});
