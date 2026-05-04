/**
 * common.js — Shared utilities for Reviews Extract
 *
 * Injected before every platform script. Exposes a single namespace:
 * window.__re = {
 * // Logging
 * log, warn, error,
 * // Guide / City / Tour
 * extractGuideName, getGuideCity, guessCity, mapTourName,
 * // Date & Time
 * formatDate, formatTime, formatTime12,
 * parseDashDate, parseLongDate, parseRelativeDate,
 * // Language
 * formatLang,
 * // DOM
 * waitForDOMSettle,
 * // Output
 * sendDataToWebhook, buildTSV,
 * // Registry references (for debugging)
 * GUIDES, CITY_MAP, TOUR_MAP,
 * }
 *
 * Platform scripts must NOT be wrapped in an IIFE that shadows window — they simply
 * call window.__re.* to access these helpers.
 */
(function () {

  // ─── 0. RE-INJECTION GUARD ──────────────────────────────────────────────────
  if (window.__re) {
    console.log("[RE] common.js already loaded, skipping.");
    return;
  }

  // ─── 1. LOGGING HELPERS ─────────────────────────────────────────────────────
  function log(...args) { console.log("[RE]", ...args); }
  function warn(...args) { console.warn("[RE]", ...args); }
  function error(...args) { console.error("[RE]", ...args); }

  // ─── 2. GUIDE REGISTRY ──────────────────────────────────────────────────────
  const GUIDES = [
    // ── Zagreb ──────────────────────────────────────────────────────────────────
    { fullName: "Luka Pelicarić", city: "zg", patterns: [/\bluka\b/i, /\bluca\b/i], aliases: [/\blooka\b/i, /\blucca\b/i, /\blukka\b/i] },
    { fullName: "Vid Dorić", city: "zg", patterns: [/\bvid\b/i, /\bveed\b/i], aliases: [/\bvidd\b/i] },
    { fullName: "Diana Bolić", city: "zg", patterns: [/\bdiana\b/i, /\bdiane\b/i], aliases: [/\bdianna\b/i, /\bdyana\b/i] },
    { fullName: "Ivana Čakarić", city: "zg", patterns: [/\bivana\b/i], aliases: [/\bivanna\b/i, /\bčakarić\b/i, /\bcakaric\b/i] },
    { fullName: "Darko Crnolatac", city: "zg", patterns: [/\bdarko\b/i], aliases: [/\bdarco\b/i, /\bdarkko\b/i] },
    { fullName: "Katarina Novoselac", city: "zg", patterns: [/\bkatarina\b/i], aliases: [/\bcatherina\b/i, /\bkatharina\b/i, /\bcatarina\b/i, /\bkaterina\b/i, /\bkatrina\b/i] },
    { fullName: "Nikolina Folnović", city: "zg", patterns: [/\bnikolina(\s+f)?\b/i], aliases: [/\bnickolina\b/i, /\bnicolina\b/i, /\bnikolena\b/i, /\bnikolin\b/i] },
    { fullName: "Iva Pavlović", city: "zg", patterns: [/\biva\b/i], aliases: [] },
    { fullName: "Doris Cvetko Pavišić", city: "zg", patterns: [/\bdoris\b/i], aliases: [/\bdoriz\b/i, /\bdorris\b/i] },
    { fullName: "Katija Crnčević", city: "zg", patterns: [/\bkatija\b/i, /\bkatia\b/i], aliases: [/\bkatiya\b/i] },
    { fullName: "Kristina Božić", city: "zg", patterns: [/\bkristina\b/i, /\bchristina\b/i], aliases: [/\bcristina\b/i] },
    { fullName: "Nadir Ivanović", city: "zg", patterns: [/\bnadir\b/i], aliases: [/\bivanović\b/i, /\bivanovic\b/i] },
    { fullName: "Dominik Filipčić", city: "zg", patterns: [/\bdominik\b/i], aliases: [/\bfilipčić\b/i, /\bfilipcic\b/i] },
    { fullName: "Dora Mlinarek Dominik", city: "zg", patterns: [/\bdora\b/i], aliases: [/\bmlinarek\b/i] },
    { fullName: "Ena Matacun", city: "zg", patterns: [/\bena\b/i], aliases: [/\benna\b/i] },
    // ── Zadar ───────────────────────────────────────────────────────────────────
    { fullName: "Iva Zaplatić", city: "zd", patterns: [/\biva\b/i, /\biva\s+z\b/i, /\bzaplatić\b/i, /\bzaplatic\b/i], aliases: [] },
    { fullName: "Andrija Grubić", city: "zd", patterns: [/\bandrija\b/i], aliases: [] },
    { fullName: "Matea Duka", city: "zd", patterns: [/\bmatea\b/i], aliases: [/\bduka\b/i] },
    { fullName: "Tonka Baričević", city: "zd", patterns: [/\btonka\b/i], aliases: [/\bbaričević\b/i, /\bbaricevic\b/i] },
    // ── Split ───────────────────────────────────────────────────────────────────
    { fullName: "Marina Krolo", city: "st", patterns: [/\bmarina\b/i], aliases: [/\bkrolo\b/i] },
    { fullName: "Marija Močić", city: "st", patterns: [/\bmarija\b/i], aliases: [/\bmočić\b/i, /\bmocic\b/i] },
    { fullName: "Ivana Čagalj", city: "st", patterns: [/\bčagalj\b/i, /\bcagalj\b/i], aliases: [/\bivana\s+č/i] },
    { fullName: "Petra Lučev", city: "st", patterns: [/\bpetra\b/i], aliases: [/\blučev\b/i, /\blucev\b/i] },
    { fullName: "Bruno Beara", city: "st", patterns: [/\bbruno\b/i], aliases: [/\bbeara\b/i] },
    { fullName: "Lorena Ćelić", city: "st", patterns: [/\blorena\b/i], aliases: [/\bćelić\b/i, /\bcelic\b/i] },
    { fullName: "Boris Čerina", city: "st", patterns: [/\bboris\b/i], aliases: [/\bčerina\b/i, /\bcerina\b/i] },
    // ── Dubrovnik ───────────────────────────────────────────────────────────────
    { fullName: "Pero Kusalo", city: "du", patterns: [/\bpero\b/i], aliases: [/\bkusalo\b/i] },
    { fullName: "Marin Kalauz", city: "du", patterns: [/\bmarin\b/i], aliases: [/\bkalauz\b/i] },
    { fullName: "Andrea Rendulić", city: "du", patterns: [/\bandrea\b/i], aliases: [/\brendulić\b/i, /\brendulic\b/i] },
    { fullName: "Maja Musulin", city: "du", patterns: [/\bmaja\b/i], aliases: [/\bmusulin\b/i] },
    { fullName: "Sara Žanetić", city: "du", patterns: [/\bsara\b/i], aliases: [/\bžanetić\b/i, /\bzanetic\b/i] },
    { fullName: "Nikolina Vidojević", city: "du", patterns: [/\bnikolina\s+v\b/i, /\bvidojević\b/i, /\bvidojevic\b/i], aliases: [] },
    { fullName: "Ivo Miličić", city: "du", patterns: [/\bivo\b/i], aliases: [/\bmiličić\b/i, /\bmilicic\b/i] },
    { fullName: "Lorena Arias", city: "du", patterns: [/\blorena\s+a\b/i, /\barias\b/i], aliases: [] },
  ];

  function extractGuideName(text, city = null) {
    if (!text) return "N/A";
    // When city is known, only consider guides registered in that city.
    // This prevents a guide from one city matching a review from another city.
    const candidates = city ? GUIDES.filter(g => g.city === city) : GUIDES;
    for (const guide of candidates) {
      const allPatterns = [...guide.patterns, ...guide.aliases];
      for (const re of allPatterns) {
        if (re.test(text)) return guide.fullName;
      }
    }
    return "N/A";
  }

  function getGuideCity(guideName) {
    const guide = GUIDES.find(g => g.fullName === guideName);
    return guide ? guide.city : "";
  }

  // ─── 3. CITY MAP ────────────────────────────────────────────────────────────
  const CITY_MAP = [
    { keyword: "dubrovnik", code: "du" },
    { keyword: "rovinj", code: "rv" },
    { keyword: "pula", code: "pu" },
    { keyword: "split", code: "st" },
    { keyword: "zadar", code: "zd" },
    { keyword: "zagreb", code: "zg" },
  ];

  function guessCity(text) {
    if (!text) return "";
    const lower = text.toLowerCase();
    for (const { keyword, code } of CITY_MAP) {
      if (lower.includes(keyword)) return code;
    }
    return "";
  }

  // ─── 4. TOUR MAP ────────────────────────────────────────────────────────────
  const TOUR_MAP = [
    { keywords: ["zagreb: communism and croatian homeland war", "croatian homeland war", "communism", "homeland war"], shortName: "war" },
    { keywords: ["free spirit walking tour", "free spirit"], shortName: "free" },
    { keywords: ["zagreb food tour", "food tour"], shortName: "food" },
    { keywords: ["guided city tour with wwii tunnels", "Zagreb Highlights: Old Town, WWII tunnels, Funicular & Tastings", "Guided City Tour with WWII Tunnels (Free Tour)", "best zagreb", "zagreb must-sees", "best of zagreb"], shortName: "best" },
    { keywords: ["big zagreb private"], shortName: "big" },
    { keywords: ["old zagreb private"], shortName: "old" },
  ];

  function mapTourName(rawName) {
    if (!rawName) return "";
    const lower = rawName.toLowerCase();
    for (const { keywords, shortName } of TOUR_MAP) {
      for (const kw of keywords) {
        if (lower.includes(kw)) return shortName;
      }
    }
    return rawName;
  }

  // ─── 5. DATE & TIME FORMATTERS ──────────────────────────────────────────────
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH_FULL_TO_IDX = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

  function formatDate(value) {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    const day = String(d.getDate()).padStart(2, "0");
    return `${day}/${MONTH_NAMES[d.getMonth()]}/${d.getFullYear()}`;
  }

  function formatTime(value) {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return "";
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function formatTime12(timeString) {
    if (!timeString) return "";
    const [time, modifier] = timeString.split(" ");
    if (!time) return "";
    let [hours, minutes] = time.split(":");
    hours = parseInt(hours, 10);
    const mod = (modifier || "").toUpperCase();
    if (mod === "AM" && hours === 12) hours = 0;
    if (mod === "PM" && hours !== 12) hours += 12;
    return `${String(hours).padStart(2, "0")}:${minutes}`;
  }

  function parseDashDate(dateStr) {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length === 3) {
      const monthIdx = parseInt(parts[1], 10) - 1;
      if (monthIdx < 0 || monthIdx > 11) return dateStr;
      return `${parts[2]}/${MONTH_NAMES[monthIdx]}/${parts[0]}`;
    }
    return dateStr;
  }

  function parseLongDate(dateStr) {
    if (!dateStr) return "";
    const cleaned = dateStr.replace(/,/g, "").trim();
    const parts = cleaned.split(" ");
    if (parts.length !== 3) return dateStr;
    const [monthFull, day, year] = parts;
    const monthIdx = MONTH_FULL_TO_IDX[monthFull.toLowerCase()];
    if (monthIdx === undefined) return dateStr;
    return `${String(parseInt(day, 10)).padStart(2, "0")}/${MONTH_NAMES[monthIdx]}/${year}`;
  }

  function formatISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function parseRelativeDate(relativeText) {
    if (!relativeText) return null;
    const now = new Date();
    const text = relativeText.toLowerCase().trim();

    const singleMap = {
      "a minute ago": () => { now.setMinutes(now.getMinutes() - 1); },
      "an hour ago": () => { now.setHours(now.getHours() - 1); },
      "a day ago": () => { now.setDate(now.getDate() - 1); },
      "a week ago": () => { now.setDate(now.getDate() - 7); },
      "a month ago": () => { now.setMonth(now.getMonth() - 1); },
      "a year ago": () => { now.setFullYear(now.getFullYear() - 1); },
    };
    for (const [phrase, mutate] of Object.entries(singleMap)) {
      if (text.startsWith(phrase)) { mutate(); return now.toISOString(); }
    }

    const match = text.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/);
    if (match) {
      const num = parseInt(match[1], 10);
      const unit = match[2];
      const d = new Date(now);
      switch (unit) {
        case "minute": d.setMinutes(d.getMinutes() - num); break;
        case "hour": d.setHours(d.getHours() - num); break;
        case "day": d.setDate(d.getDate() - num); break;
        case "week": d.setDate(d.getDate() - num * 7); break;
        case "month": d.setMonth(d.getMonth() - num); break;
        case "year": d.setFullYear(d.getFullYear() - num); break;
      }
      return d.toISOString();
    }
    return null;
  }

  // ─── 6. LANGUAGE FORMATTER ──────────────────────────────────────────────────
  const LANG_MAP = { EN: "eng", ES: "esp", DE: "deu", FR: "fra", IT: "ita", PT: "por", HR: "hrv", NL: "nld", PL: "pol", RU: "rus", ZH: "zho", JA: "jpn" };

  function formatLang(code) {
    if (!code) return "";
    return LANG_MAP[code.toUpperCase()] || code.toLowerCase();
  }

  // ─── 7. DOM UTILITY ─────────────────────────────────────────────────────────
  function waitForDOMSettle(timeout = 3000) {
    return new Promise(resolve => {
      let timer;
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => { observer.disconnect(); resolve(); }, 300);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timer = setTimeout(() => { observer.disconnect(); resolve(); }, timeout);
    });
  }

  // ─── 8. TARGET MONTH HELPER ─────────────────────────────────────────────────
  function getTargetMonthYear() {
    if (typeof window.__targetMonth !== "undefined" && typeof window.__targetYear !== "undefined") {
      return { month: window.__targetMonth, year: window.__targetYear };
    }
    const now = new Date();
    let month = now.getMonth() - 1, year = now.getFullYear();
    if (month < 0) { month = 11; year--; }
    return { month, year };
  }

  // ─── 9. WEBHOOK INTEGRATION ─────────────────────────────────────────────────
  /**
   * sendDataToWebhook(rows, platformName)
   * Sends the scraped JSON data directly to a Google Apps Script Web App.
   */
  async function sendDataToWebhook(rows, platformName) {
    const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbyLsr0L3-h459HOJVZOtN86oBL7b8xDc3ZeG9SW3iBEr-94d47cQvZaCmpLEK20oAsi/exec';

    const payload = JSON.stringify({
      platform: platformName,
      reviews: rows
    });

    try {
      log(`Sending ${rows.length} reviews from ${platformName} to Webhook...`);
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors', // Essential for Google Apps Script to bypass CORS preflight
        headers: {
          'Content-Type': 'text/plain', // Prevents browser from dropping payload
        },
        body: payload
      });
      log("Data successfully dispatched to Webhook.");
    } catch (e) {
      error("Failed to send data to Webhook.", e);
    }
  }

  // ─── 10. TSV BUILDER (Kept for fallback formatting) ─────────────────────────
  const TSV_HEADERS = ["Date", "Time", "Guide", "Rating", "Tour", "City", "Language", "Platform", "Review"];

  function _formatCell(value) {
    if (value === null || value === undefined) return "";
    let s = String(value).replace(/\t/g, "    ").trim();
    if (s.includes("\n") || s.includes('"')) {
      s = s.replace(/"/g, '""');
      return `"${s}"`;
    }
    return s;
  }

  function buildTSV(rows) {
    const header = TSV_HEADERS.join("\t");
    const lines = rows.map(row =>
      TSV_HEADERS.map(col => _formatCell(row[col] ?? "")).join("\t")
    );
    return [header, ...lines].join("\n");
  }

  // ─── 11. EXPOSE NAMESPACE ────────────────────────────────────────────────────
  window.__re = {
    log, warn, error,
    extractGuideName, getGuideCity, guessCity, mapTourName,
    formatDate, formatTime, formatTime12, formatISODate, parseDashDate, parseLongDate, parseRelativeDate,
    formatLang,
    getTargetMonthYear,
    waitForDOMSettle,
    sendDataToWebhook,
    buildTSV,
    GUIDES, CITY_MAP, TOUR_MAP, MONTH_NAMES,
  };

  log("common.js loaded — window.__re is ready.");
})();