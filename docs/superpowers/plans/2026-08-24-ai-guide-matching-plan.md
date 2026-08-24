# AI-Assisted Guide-Name Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual copy/paste-into-claude.ai guide-name-correction workflow with a
menu-driven Apps Script flow that calls the Gemini API directly and stages suggestions in a new
"Guide Review" tab for human approval before anything writes to the Review HUB sheet.

**Architecture:** One new Apps Script file, `scripts/reviews-hub/guide-matching.gs`, adds two
functions bound to two new "Review Tools" menu items (the menu itself is built in the existing
`dedup.gs`'s `onOpen()`, which must be extended, not duplicated — Apps Script only runs one
`onOpen()` per project). A per-sheet cursor stored in `PropertiesService` tracks which rows have
already been checked, so re-runs only process newly-appended rows. Corrections are never written
directly to the Review HUB — they land in a staging tab first.

**Tech Stack:** Google Apps Script (`.gs`, V8 runtime), `UrlFetchApp` for the Gemini API,
`PropertiesService` for the cursor, `SpreadsheetApp` for all sheet I/O. No build step, no
package manager, no local test runner — this whole project is manually copy-pasted into the live
Apps Script editor (script.google.com) and redeployed, per this repo's existing CLAUDE.md note
that `scripts/reviews-hub/` is a local reference copy, not a clasp-deployed one.

**Spec:** `docs/superpowers/specs/2026-08-24-ai-guide-matching-design.md`

## Global Constraints

- The Review HUB sheet must stay at exactly 10 columns (per the sheet's documented shape) — the
  cursor must NOT be stored as a visible or hidden column on it.
- No API key may ever be hardcoded in `.gs` source — it's read from
  `PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')`, set manually once via
  the Apps Script editor's Project Settings → Script Properties UI.
- Corrections never write to the Review HUB directly from `resolveGuideNamesViaAI` — only
  `applyApprovedCorrections`, and only for rows the user has checked, may write to it.
- Apps Script has no local test runner. "Tests" in this plan are runnable diagnostic functions
  you execute via the Apps Script editor's Run button, checking output via **View → Logs**
  (or the Execution log panel) and by inspecting sheet state directly — this is the closest
  equivalent to an automated test cycle this platform offers.
- This codebase has no automated deploy — after each task, the changed `.gs` file(s) must be
  manually pasted into the live Apps Script project (bound to "00. Review HUB") and saved before
  the manual verification steps will actually reflect the change. Say so explicitly in each
  task's verification step; don't assume it's implicit.

---

### Task 1: Cursor storage and the "Guide Review" staging sheet

**Files:**
- Create: `scripts/reviews-hub/guide-matching.gs`

**Interfaces:**
- Produces: `getLastProcessedRow_(sheetName)` → number (1 if nothing processed yet, meaning
  "start after the header row")
- Produces: `setLastProcessedRow_(sheetName, rowNumber)` → void
- Produces: `getOrCreateGuideReviewSheet_(ss)` → Sheet — returns the "Guide Review" tab,
  creating it with the header row and checkbox data validation on column A if it doesn't exist
  yet. Does NOT clear existing rows if the sheet already exists (later tasks append to it).

- [ ] **Step 1: Write `guide-matching.gs` with the cursor functions**

```javascript
/**
 * Row-tracking cursor per source sheet, stored in script properties — NOT a sheet column.
 * Returns 1 (the header row) if this sheet has never been processed.
 */
function getLastProcessedRow_(sheetName) {
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty('lastProcessedRow_' + sheetName);
  return stored ? parseInt(stored, 10) : 1;
}

function setLastProcessedRow_(sheetName, rowNumber) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('lastProcessedRow_' + sheetName, String(rowNumber));
}
```

- [ ] **Step 2: Add a runnable diagnostic function for the cursor**

```javascript
function test_cursorRoundTrip() {
  setLastProcessedRow_('__test__', 42);
  var result = getLastProcessedRow_('__test__');
  Logger.log('Expected 42, got: ' + result);
  if (result !== 42) throw new Error('Cursor round-trip failed');

  var fresh = getLastProcessedRow_('__never_seen__');
  Logger.log('Expected 1 (never processed), got: ' + fresh);
  if (fresh !== 1) throw new Error('Fresh sheet should default to row 1');

  Logger.log('test_cursorRoundTrip: PASS');
}
```

- [ ] **Step 3: Paste `guide-matching.gs` into the live Apps Script project**

Open the Apps Script editor bound to "00. Review HUB" (script.google.com, or Extensions → Apps
Script from the sheet). Create a new script file named `guide-matching`, paste in the full
contents of `scripts/reviews-hub/guide-matching.gs`, save.

- [ ] **Step 4: Run `test_cursorRoundTrip` and verify it passes**

In the Apps Script editor, select `test_cursorRoundTrip` from the function dropdown, click Run.
Open **View → Logs**. Expected: both log lines show matching numbers, and the final line reads
`test_cursorRoundTrip: PASS` with no thrown error.

- [ ] **Step 5: Add `getOrCreateGuideReviewSheet_`**

```javascript
var GUIDE_REVIEW_HEADERS = [
  'Approve?', 'Sheet', 'Row', 'Current Guide', 'Suggested Guide', 'Review Text', 'Reason'
];

function getOrCreateGuideReviewSheet_(ss) {
  var sheet = ss.getSheetByName('Guide Review');
  if (sheet) return sheet;

  sheet = ss.insertSheet('Guide Review');
  sheet.appendRow(GUIDE_REVIEW_HEADERS);
  var checkboxRange = sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1);
  checkboxRange.insertCheckboxes();
  return sheet;
}
```

- [ ] **Step 6: Add a runnable diagnostic function for the staging sheet**

```javascript
function test_guideReviewSheetSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateGuideReviewSheet_(ss);
  var headerRow = sheet.getRange(1, 1, 1, GUIDE_REVIEW_HEADERS.length).getValues()[0];
  Logger.log('Header row: ' + JSON.stringify(headerRow));
  for (var i = 0; i < GUIDE_REVIEW_HEADERS.length; i++) {
    if (headerRow[i] !== GUIDE_REVIEW_HEADERS[i]) {
      throw new Error('Header mismatch at column ' + i + ': expected "' +
        GUIDE_REVIEW_HEADERS[i] + '", got "' + headerRow[i] + '"');
    }
  }
  Logger.log('test_guideReviewSheetSetup: PASS — check the spreadsheet tabs for "Guide Review"');
}
```

- [ ] **Step 7: Re-paste the updated file, run the new diagnostic, verify by hand**

Paste the updated `guide-matching.gs` contents into the live editor's `guide-matching` file
(replace entirely), save, run `test_guideReviewSheetSetup`. Expected: PASS in the log, AND a new
"Guide Review" tab is now visible in the spreadsheet with the 7 header columns and checkboxes
already rendered in column A starting from row 2.

- [ ] **Step 8: Commit**

```bash
cd /Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract
git add scripts/reviews-hub/guide-matching.gs
git commit -m "Add cursor storage and Guide Review staging sheet setup"
```

---

### Task 2: Gemini API prompt builder and caller

**Files:**
- Modify: `scripts/reviews-hub/guide-matching.gs`

**Interfaces:**
- Consumes: nothing from Task 1 directly (this task is the Gemini call itself, independent of
  sheet I/O).
- Produces: `buildGuideMatchingPrompt_(rows)` → string, where `rows` is
  `Array<{row: number, guide: string, review: string}>`.
- Produces: `callGeminiForCorrections_(promptText)` →
  `Array<{row: number, currentGuide: string, suggestedGuide: string, reason: string}>` — throws
  on any failure (network error, non-200 response, unparseable JSON), so callers must wrap it in
  try/catch.

- [ ] **Step 1: Read the current prompt text this replaces**

Read `guides/prompts/guide-name-correction.md` in full — the Master Guide List and matching
rules in that file are copied verbatim into `buildGuideMatchingPrompt_`'s output; only the
"Output Format" instruction changes (JSON array instead of a TSV table + Correction Note
column).

- [ ] **Step 2: Add the prompt builder**

```javascript
var GUIDE_MATCHING_RULES =
  'You are an expert data auditor. Your task is to review a dataset of tour bookings and ' +
  'correct the Guide column based on the text in the Review column.\n\n' +
  'Rules:\n\n' +
  'Analyze the Review: Read the Review text carefully to see if a specific tour guide\'s name ' +
  'is mentioned. Account for typos, phonetic spellings, translated names (e.g., Peter = Pero, ' +
  'Catherine = Katarina, Zara = Sara, Nikoletta = Nikolina), or partial names.\n\n' +
  'Compare: Compare the name found in the Review against the name in the Guide column.\n\n' +
  'Keep Existing (Default): If the review does NOT mention a name, or if the name mentioned ' +
  'matches the Guide column (even with slight misspellings), do NOT propose a change.\n\n' +
  'Update if Contradictory: If the review explicitly names a guide that is clearly different ' +
  'from the one in the Guide column, propose the correct one.\n\n' +
  'Cross-Reference: When proposing a correction, you MUST pick the valid full name from the ' +
  'Master Guide List below. Ensure the new guide matches the City code implied by context.\n\n' +
  'Master Guide List:\n\n' +
  'Zagreb (zg): Antonio Sičić, Darko Crnolatac, Diana Bolić, Dora Mlinarek Dominik, Doris ' +
  'Cvetko Pavišić, Ena Matacun, Iva Pavlović, Ivana Čakarić, Josipa Šiklić, Katarina ' +
  'Novoselac, Katija Crnčević, Kristina Božić, Luka Pelicarić, Nadir Ivanović, Nikolina ' +
  'Folnović, Vid Dorić\n' +
  'Zadar (zd): Andrija Grubić, Tonka Baričević, Matea Duka, Iva Zaplatić, Nikolina Kuzman\n' +
  'Split (st): Bruno Beara, Ivana Čagalj, Boris Čerina, Lorena Ćelić, Marina Krolo, Petra ' +
  'Lučev, Marija Močić\n' +
  'Dubrovnik (du): Lorena Arias, Marin Kalauz, Pero Kusalo, Ivo Miličić, Maja Musulin, Andrea ' +
  'Rendulić, Nikolina Vidojević, Sara Žanetić, Romana Tomičić\n\n' +
  'Output Format: Respond with ONLY a JSON array, no markdown fences, no commentary. Include ' +
  'an entry ONLY for rows where you are proposing a change — omit rows where the existing ' +
  'Guide value should be kept as-is. Each entry: ' +
  '{"row": <the Row number from the input>, "currentGuide": <string>, ' +
  '"suggestedGuide": <string, must be a full name from the Master Guide List>, ' +
  '"reason": <short string explaining what in the review text justified the change>}. ' +
  'If no rows need a change, respond with an empty JSON array: []';

function buildGuideMatchingPrompt_(rows) {
  var dataLines = rows.map(function (r) {
    return 'Row ' + r.row + ' | Current Guide: ' + r.guide + ' | Review: ' + r.review;
  });
  return GUIDE_MATCHING_RULES + '\n\nData to Process:\n\n' + dataLines.join('\n');
}
```

- [ ] **Step 3: Add the Gemini caller**

Check ai.google.dev for the current recommended flash-tier model name before filling in
`GEMINI_MODEL` below — model availability changes over time, so don't assume the value here is
still current at implementation time.

```javascript
var GEMINI_MODEL = 'gemini-2.0-flash'; // verify against ai.google.dev before first use

function callGeminiForCorrections_(promptText) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in Script Properties.');
  }

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL +
    ':generateContent?key=' + apiKey;

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  var status = response.getResponseCode();
  if (status !== 200) {
    throw new Error('Gemini API returned HTTP ' + status + ': ' + response.getContentText());
  }

  var body = JSON.parse(response.getContentText());
  var text = body.candidates && body.candidates[0] && body.candidates[0].content &&
    body.candidates[0].content.parts && body.candidates[0].content.parts[0] &&
    body.candidates[0].content.parts[0].text;
  if (!text) {
    throw new Error('Gemini response had no text content: ' + response.getContentText());
  }

  var corrections;
  try {
    corrections = JSON.parse(text);
  } catch (e) {
    throw new Error('Could not parse Gemini response as JSON: ' + text);
  }
  if (!Array.isArray(corrections)) {
    throw new Error('Expected a JSON array from Gemini, got: ' + text);
  }
  return corrections;
}
```

- [ ] **Step 4: Add a runnable diagnostic function using a known, unambiguous case**

```javascript
function test_geminiCorrectionCall() {
  var rows = [
    { row: 2, guide: 'Lorena Arias', review: 'A special thanks to our guide Peter, who was fantastic.' },
    { row: 3, guide: 'Diana Bolić', review: 'Diana was amazing, learned so much about Zagreb!' },
  ];
  var prompt = buildGuideMatchingPrompt_(rows);
  var corrections = callGeminiForCorrections_(prompt);
  Logger.log('Corrections: ' + JSON.stringify(corrections));

  var row2 = corrections.filter(function (c) { return c.row === 2; })[0];
  if (!row2) throw new Error('Expected a correction for row 2 (Peter = Pero Kusalo), got none');
  if (row2.suggestedGuide !== 'Pero Kusalo') {
    throw new Error('Expected row 2 suggestedGuide "Pero Kusalo", got "' + row2.suggestedGuide + '"');
  }

  var row3 = corrections.filter(function (c) { return c.row === 3; })[0];
  if (row3) throw new Error('Row 3 matches its existing guide, should have no correction, got: ' + JSON.stringify(row3));

  Logger.log('test_geminiCorrectionCall: PASS');
}
```

- [ ] **Step 5: Set the API key in the live project**

In the Apps Script editor: Project Settings (gear icon) → Script Properties → Add script
property → name `GEMINI_API_KEY`, value from console.cloud.google.com / ai.google.dev. This is a
one-time manual step; do not put the key in any file in this repo.

- [ ] **Step 6: Paste the updated file, run the diagnostic, verify by hand**

Paste the updated `guide-matching.gs` into the live editor, save, run `test_geminiCorrectionCall`.
Expected: log shows a `Pero Kusalo` correction for row 2 and nothing for row 3, ending with
`test_geminiCorrectionCall: PASS`. If the model rejects the request or returns malformed JSON,
re-check the model name from Step 3 against ai.google.dev's current docs.

- [ ] **Step 7: Commit**

```bash
cd /Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract
git add scripts/reviews-hub/guide-matching.gs
git commit -m "Add Gemini API prompt builder and correction caller"
```

---

### Task 3: `resolveGuideNamesViaAI` orchestration and menu wiring

**Files:**
- Modify: `scripts/reviews-hub/guide-matching.gs`
- Modify: `scripts/reviews-hub/dedup.gs` (the `onOpen()` menu)

**Interfaces:**
- Consumes: `getLastProcessedRow_`, `setLastProcessedRow_`, `getOrCreateGuideReviewSheet_`
  (Task 1); `buildGuideMatchingPrompt_`, `callGeminiForCorrections_` (Task 2).
- Produces: `resolveGuideNamesViaAI()` → void, menu-bound, operates on
  `SpreadsheetApp.getActiveSpreadsheet().getActiveSheet()`.
- Produces: `logGuideMatchingError_(ss, message)` → void — appends to the "Error Log" sheet,
  matching `code.gs`'s existing `errorSheet.appendRow([...])` pattern.

- [ ] **Step 1: Add the error logger, matching the existing convention in `code.gs`**

```javascript
function logGuideMatchingError_(ss, message) {
  var errorSheet = ss.getSheetByName('Error Log') || ss.insertSheet('Error Log');
  errorSheet.appendRow(['Guide Matching Error', '', '', '', message]);
}
```

- [ ] **Step 2: Add `resolveGuideNamesViaAI`**

```javascript
function resolveGuideNamesViaAI() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var sheetName = sheet.getName();

  if (sheetName === 'Error Log' || sheetName === 'Guide Review') {
    ui.alert('Invalid Sheet', 'Switch to a month tab (e.g. "8") before running this.', ui.ButtonSet.OK);
    return;
  }

  var lastRow = sheet.getLastRow();
  var startRow = getLastProcessedRow_(sheetName) + 1;
  if (startRow > lastRow) {
    ui.alert('Nothing New', 'No new rows since the last run on "' + sheetName + '".', ui.ButtonSet.OK);
    return;
  }

  var numRows = lastRow - startRow + 1;
  var values = sheet.getRange(startRow, 1, numRows, 9).getValues(); // A:I — Date..Review
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var actualRow = startRow + i;
    var guide = values[i][2] || '';   // column C
    var review = values[i][8] || '';  // column I
    if (!review) continue; // nothing to match a name against
    rows.push({ row: actualRow, guide: guide, review: review });
  }

  if (rows.length === 0) {
    setLastProcessedRow_(sheetName, lastRow);
    ui.alert('Nothing To Check', 'No rows with review text in the new range — cursor advanced anyway.', ui.ButtonSet.OK);
    return;
  }

  var corrections;
  try {
    var prompt = buildGuideMatchingPrompt_(rows);
    corrections = callGeminiForCorrections_(prompt);
  } catch (e) {
    logGuideMatchingError_(ss, e.toString());
    ui.alert('Gemini Call Failed', e.toString() + '\n\nCursor was NOT advanced — safe to retry.', ui.ButtonSet.OK);
    return;
  }

  if (corrections.length > 0) {
    var reviewSheet = getOrCreateGuideReviewSheet_(ss);
    var rowsByNumber = {};
    rows.forEach(function (r) { rowsByNumber[r.row] = r; });

    corrections.forEach(function (c) {
      var source = rowsByNumber[c.row];
      var reviewText = source ? String(source.review).slice(0, 200) : '';
      reviewSheet.appendRow([
        false, sheetName, c.row, c.currentGuide, c.suggestedGuide, reviewText, c.reason,
      ]);
    });
  }

  setLastProcessedRow_(sheetName, lastRow);
  ui.alert(
    'Resolve Complete',
    'Checked ' + rows.length + ' row(s) on "' + sheetName + '". ' +
      corrections.length + ' suggestion(s) added to "Guide Review".',
    ui.ButtonSet.OK
  );
}
```

- [ ] **Step 3: Extend the existing menu in `dedup.gs`**

Modify `dedup.gs`'s `onOpen()` — do not add a second `onOpen()` function anywhere, Apps Script
only executes one per project and a second one silently wins or loses depending on file order.

```javascript
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("Review Tools")
    .addItem("Find Duplicates in Active Sheet", "findDuplicatesInActiveSheet")
    .addItem("Resolve Guide Names via AI", "resolveGuideNamesViaAI")
    .addToUi();
}
```

(`applyApprovedCorrections` is added to this same menu in Task 4, once it exists.)

- [ ] **Step 4: Paste both updated files into the live project**

Paste the updated `guide-matching.gs` contents into the live editor's `guide-matching` file, and
the updated `onOpen()` into the live editor's `dedup` file. Save both.

- [ ] **Step 5: Manually verify end-to-end on a real month tab**

Reload the spreadsheet (menu changes require a fresh page load — running `onOpen` manually via
the editor also works without reloading). Confirm "Review Tools → Resolve Guide Names via AI"
appears. Open a month tab with at least a few review rows, run it. Expected: an alert reporting
how many rows were checked and how many suggestions were added; if any were added, the "Guide
Review" tab has new rows with checkboxes unchecked in column A. Run it again immediately on the
same tab — expected: "Nothing New" alert, since the cursor already advanced past every row.

- [ ] **Step 6: Commit**

```bash
cd /Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract
git add scripts/reviews-hub/guide-matching.gs scripts/reviews-hub/dedup.gs
git commit -m "Add resolveGuideNamesViaAI orchestration and menu entry"
```

---

### Task 4: `applyApprovedCorrections`

**Files:**
- Modify: `scripts/reviews-hub/guide-matching.gs`
- Modify: `scripts/reviews-hub/dedup.gs` (the `onOpen()` menu)

**Interfaces:**
- Consumes: the "Guide Review" sheet's shape from Task 1
  (`GUIDE_REVIEW_HEADERS` = `['Approve?', 'Sheet', 'Row', 'Current Guide', 'Suggested Guide', 'Review Text', 'Reason']`).
- Produces: `applyApprovedCorrections()` → void, menu-bound.

- [ ] **Step 1: Add `applyApprovedCorrections`**

```javascript
function applyApprovedCorrections() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var reviewSheet = ss.getSheetByName('Guide Review');
  if (!reviewSheet) {
    ui.alert('Nothing To Apply', 'No "Guide Review" tab exists yet — run "Resolve Guide Names via AI" first.', ui.ButtonSet.OK);
    return;
  }

  var lastRow = reviewSheet.getLastRow();
  if (lastRow < 2) {
    ui.alert('Nothing To Apply', 'The "Guide Review" tab has no pending suggestions.', ui.ButtonSet.OK);
    return;
  }

  var data = reviewSheet.getRange(2, 1, lastRow - 1, GUIDE_REVIEW_HEADERS.length).getValues();
  var applied = 0;
  var rowsToDelete = []; // staging-sheet row numbers, collected top-to-bottom

  for (var i = 0; i < data.length; i++) {
    var approve = data[i][0];
    if (!approve) continue;

    var sourceSheetName = data[i][1];
    var sourceRow = data[i][2];
    var suggestedGuide = data[i][4];
    var sourceSheet = ss.getSheetByName(sourceSheetName);
    if (!sourceSheet) {
      logGuideMatchingError_(ss, 'applyApprovedCorrections: source sheet "' + sourceSheetName + '" not found for staged row ' + (i + 2));
      continue;
    }

    sourceSheet.getRange(sourceRow, 3).setValue(suggestedGuide); // column C = Guide
    applied++;
    rowsToDelete.push(i + 2); // +2: 1-indexed, plus the header row
  }

  // Delete bottom-to-top so earlier indices in rowsToDelete stay valid as rows shift up.
  for (var d = rowsToDelete.length - 1; d >= 0; d--) {
    reviewSheet.deleteRow(rowsToDelete[d]);
  }

  ui.alert('Apply Complete', applied + ' correction(s) written back to the Review HUB.', ui.ButtonSet.OK);
}
```

- [ ] **Step 2: Add `applyApprovedCorrections` to the menu in `dedup.gs`**

```javascript
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("Review Tools")
    .addItem("Find Duplicates in Active Sheet", "findDuplicatesInActiveSheet")
    .addItem("Resolve Guide Names via AI", "resolveGuideNamesViaAI")
    .addItem("Apply Approved Corrections", "applyApprovedCorrections")
    .addToUi();
}
```

- [ ] **Step 3: Paste both updated files into the live project**

Paste the updated `guide-matching.gs` and `dedup.gs` contents into the live editor's respective
files. Save both.

- [ ] **Step 4: Manually verify end-to-end**

On the "Guide Review" tab (populated from Task 3's verification), check the box in column A for
one suggestion row, note its `Sheet`/`Row`/`Suggested Guide` values. Run "Review Tools → Apply
Approved Corrections". Expected: an alert reporting 1 correction applied; the checked row is now
gone from "Guide Review"; the source month tab's Guide column (C) at the noted row now shows the
suggested name. Any unchecked rows remain in "Guide Review" untouched.

- [ ] **Step 5: Commit**

```bash
cd /Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract
git add scripts/reviews-hub/guide-matching.gs scripts/reviews-hub/dedup.gs
git commit -m "Add applyApprovedCorrections and wire up full Review Tools menu"
```

---

### Task 5: Update the prompt doc and point the manual guide at the new flow

**Files:**
- Modify: `guides/prompts/guide-name-correction.md`
- Modify: `guides/Guide Matching - N-A Resolution (EN).docx`
- Modify: `guides/Guide Matching - N-A Resolution (HR).docx`

**Interfaces:** None — this task is documentation only, no code dependencies.

- [ ] **Step 1: Update `guides/prompts/guide-name-correction.md`'s output format**

Read the file first. Replace its "Output Format" section (the part instructing a TSV table with
a "Correction Note" column) with the JSON-array contract that matches `GUIDE_MATCHING_RULES` in
`guide-matching.gs` exactly — output an entry only for rows proposing a change, with
`{"row", "currentGuide", "suggestedGuide", "reason"}` fields, empty array `[]` if nothing needs a
change. Keep the Master Guide List and matching-rule prose above that section unchanged — those
still apply verbatim to both the manual claude.ai flow and the new Apps Script flow.

- [ ] **Step 2: Note the new flow at the top of the markdown file**

Add a short note near the top: this manual prompt is now a fallback for when the Apps Script
flow (Review Tools → Resolve Guide Names via AI, in `scripts/reviews-hub/guide-matching.gs`) is
unavailable; the normal path no longer requires a manual claude.ai round trip.

- [ ] **Step 3: Update both `Guide Matching - N-A Resolution` docx files**

Use the `docx` skill (unzip → edit `word/document.xml` → rezip, per that skill's instructions —
docx-js cannot open existing files). In both the EN and HR versions: add a short note under the
"What This Is" section pointing at the new "Review Tools → Resolve Guide Names via AI" menu item
as the normal path, with the existing documented steps kept below as the manual fallback. Mirror
the English wording change into Croatian for the HR file rather than leaving it in English.

- [ ] **Step 4: Verify rendering**

Per the `docx` skill's verification instructions: convert each edited docx to PDF
(`soffice.py --headless --convert-to pdf`) and render to JPEG (`pdftoppm`), then view the page(s)
containing the new note to confirm it reads cleanly and isn't cut off or malformed.

- [ ] **Step 5: Commit**

```bash
cd /Users/antunzebec/Work/01.Clients/FreeSpirit/Projects/active/reviews-extract
git add guides/prompts/guide-name-correction.md "guides/Guide Matching - N-A Resolution (EN).docx" "guides/Guide Matching - N-A Resolution (HR).docx"
git commit -m "Point guide-matching docs at the new Apps Script flow"
```
