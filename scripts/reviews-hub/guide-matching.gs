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

var GUIDE_REVIEW_HEADERS = [
  'Approve?', 'Sheet', 'Row', 'Current Guide', 'Suggested Guide', 'Review Text', 'Reason'
];

function getOrCreateGuideReviewSheet_(ss) {
  var sheet = ss.getSheetByName('Guide Review');
  if (sheet) return sheet;

  sheet = ss.insertSheet('Guide Review');
  sheet.appendRow(GUIDE_REVIEW_HEADERS);
  sheet.getRange(1, 1, 1, GUIDE_REVIEW_HEADERS.length).setFontWeight('bold');
  return sheet;
}

// Appends a suggestion row and gives it a live checkbox in column A — checkboxes are added
// per-row on write, not pre-filled across the sheet (a pre-filled checkbox writes an actual
// FALSE value into every cell, which made getLastRow() see 1000 rows of "data" and pushed every
// appendRow() past row 1000 instead of right after the real rows).
function appendGuideReviewRow_(sheet, rowValues) {
  sheet.appendRow(rowValues);
  sheet.getRange(sheet.getLastRow(), 1).insertCheckboxes();
}

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

// City display names, in the fixed order the Master Guide List is presented — this part rarely
// changes and stays hardcoded; the guide names per city are pulled live from Help!A:B below,
// so a guide joining/leaving/changing city needs updating in exactly one place (the sheet).
var CITY_DISPLAY_NAMES_ = { zg: 'Zagreb', zd: 'Zadar', st: 'Split', du: 'Dubrovnik' };
var CITY_ORDER_ = ['zg', 'zd', 'st', 'du'];

// Reads Help!A:B (Guide, City) and formats it exactly like the Master Guide List block used to
// be hardcoded — one line per city, "City (code): Name1, Name2, ...". A guide row with a city
// code outside CITY_ORDER_ (a typo) is silently dropped from the list rather than erroring the
// whole prompt build — low-probability, low-severity (one guide temporarily unmatched, easily
// noticed and fixed), not worth the complexity of surfacing it here.
function buildMasterGuideListText_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Help');
  if (!sheet) {
    throw new Error('Master Guide List unavailable: no "Help" sheet found.');
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error('Master Guide List unavailable: "Help" sheet has no guide rows in A:B.');
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues(); // A:B — Guide, City
  var byCity = {};
  values.forEach(function (row) {
    var name = row[0], city = row[1];
    if (!name || !city) return; // Help has other columns; skip rows with no guide/city here
    if (!byCity[city]) byCity[city] = [];
    byCity[city].push(name);
  });

  return CITY_ORDER_.map(function (code) {
    var names = (byCity[code] || []).slice().sort();
    return CITY_DISPLAY_NAMES_[code] + ' (' + code + '): ' + names.join(', ');
  }).join('\n');
}

function buildGuideMatchingRulesText_() {
  return 'You are an expert data auditor. Your task is to review a dataset of tour bookings and ' +
    'correct the Guide column based on the text in the Review column.\n\n' +
    'Rules:\n\n' +
    'Analyze the Review: Read the Review text carefully to see if a specific tour guide\'s name ' +
    'is mentioned. Account for typos, phonetic spellings, translated names (e.g., Peter = Pero, ' +
    'Catherine = Katarina, Zara = Sara, Nikoletta = Nikolina), or partial names.\n\n' +
    'Compare: Compare the name found in the Review against the name in the Guide column.\n\n' +
    'Keep Existing (Default): If the review does NOT mention a name, or if the name mentioned ' +
    'matches the Guide column (even with slight misspellings), do NOT change anything — do not ' +
    'propose a correction for this row.\n\n' +
    'Update if Contradictory or Filling a Blank: If the review explicitly names a guide that is ' +
    'clearly different from the one in the Guide column — including when the Guide column is ' +
    '"N/A" and the review names anyone at all — you must propose the correct one.\n\n' +
    'External Guides: If the review describes a guide who is clearly external, subcontracted, ' +
    'or freelance (not a member of the regular team, per the review\'s own wording) rather than ' +
    'a typo or alias of someone on the Master Guide List, propose "vanjski" as the corrected ' +
    'value instead of picking a name from the list.\n\n' +
    'Cross-Reference: When proposing a correction, you MUST pick the valid full name from the ' +
    'Master Guide List below, unless the External Guides rule above applies. Ensure the new ' +
    'guide matches the City code in the data (du = Dubrovnik, zg = Zagreb, zd = Zadar, st = ' +
    'Split).\n\n' +
    'Master Guide List:\n\n' +
    buildMasterGuideListText_() + '\n\n' +
    'Output Format: Respond with ONLY a JSON array, no markdown fences, no commentary. Include ' +
    'an entry ONLY for rows where you are proposing a change — omit rows where the existing ' +
    'Guide value should be kept as-is. Each entry: ' +
    '{"row": <the Row number from the input>, "currentGuide": <string>, ' +
    '"suggestedGuide": <string, must be a full name from the Master Guide List, or "vanjski" ' +
    'for an external guide>, ' +
    '"reason": <short string explaining what in the review text justified the change>}. ' +
    'If no rows need a change, respond with an empty JSON array: []';
}

function buildGuideMatchingPrompt_(rows) {
  var dataLines = rows.map(function (r) {
    return 'Row ' + r.row + ' | Current Guide: ' + r.guide + ' | Review: ' + r.review;
  });
  return buildGuideMatchingRulesText_() + '\n\nData to Process:\n\n' + dataLines.join('\n');
}

// Manual-chat variant of the prompt — a genuinely different output contract from
// buildGuideMatchingRulesText_ above, not a copy that drifted. A human reading a Gemini chat
// response wants a corrected table with a "Correction Note" column they can read and paste
// straight back over the original range; the automated flow needs machine-parseable JSON
// instead. Kept separate deliberately, matching guides/prompts/guide-name-correction.md.
function buildGuideMatchingRulesManualText_() {
  return 'Role & Task:\n\n' +
    'You are an expert data auditor. Your task is to review a dataset of tour bookings and ' +
    'correct the Guide column based on the text in the Review column.\n\n' +
    'Rules:\n\n' +
    'Analyze the Review: Read the Review text carefully to see if a specific tour guide\'s name ' +
    'is mentioned. Account for typos, phonetic spellings, translated names (e.g., Peter = Pero, ' +
    'Catherine = Katarina, Zara = Sara, Nikoletta = Nikolina), or partial names.\n\n' +
    'Compare: Compare the name found in the Review against the name in the Guide column.\n\n' +
    'Keep Existing (Default): If the review does NOT mention a name, or if the name mentioned ' +
    'matches the Guide column (even with slight misspellings), do NOT change anything. Output ' +
    'the existing Guide name.\n\n' +
    'Update if Contradictory or Filling a Blank: If the review explicitly names a guide that is ' +
    'clearly different from the one in the Guide column — including when the Guide column is ' +
    '"N/A" and the review names anyone at all — you must update the Guide name to the correct ' +
    'one.\n\n' +
    'External Guides: If the review describes a guide who is clearly external, subcontracted, ' +
    'or freelance (not a member of the regular team) rather than a typo or alias of someone on ' +
    'the Master Guide List, write "vanjski" as the corrected value instead of picking a name ' +
    'from the list.\n\n' +
    'Cross-Reference: When correcting a name, you MUST pick the valid full name from the ' +
    'provided "Master Guide List" below, unless the External Guides rule above applies. Ensure ' +
    'the new guide matches the City code in the data (du = Dubrovnik, zg = Zagreb, zd = Zadar, ' +
    'st = Split).\n\n' +
    'Output Format: Provide a final, corrected table. Add a brief column at the end called ' +
    '"Correction Note" detailing what you changed and why (e.g., "Changed from Lorena Arias to ' +
    'Marin Kalauz based on review").\n\n' +
    'Master Guide List:\n\n' +
    buildMasterGuideListText_();
}

// Full original rows (all 9 sheet columns, tab-separated), not the reduced Row/Guide/Review
// triplet buildGuideMatchingPrompt_ uses — the table this returns is meant to be pasted
// straight back over the source range, so it needs the same shape as what was pasted in.
function buildGuideMatchingPromptManual_(rows) {
  var dataLines = rows.map(function (r) {
    return r.fullRow.join('\t');
  });
  return buildGuideMatchingRulesManualText_() + '\n\nData to Process:\n\n' + dataLines.join('\n');
}

/**
 * Menu-bound. Manual fallback for when the Gemini API flow is unavailable. Pulls the exact same
 * rows resolveGuideNamesViaAI would send (new rows since the cursor on the active sheet, same
 * "already checked — re-check?" prompt if there is nothing new), builds the manual-format prompt
 * via buildGuideMatchingPromptManual_, and opens a dialog with a button that copies the whole
 * thing — rules and data together — to the clipboard and opens a new Gemini chat tab in one
 * click.
 *
 * Deliberately does NOT advance the cursor: unlike a successful automated run, there is no way
 * to know whether the user actually finished the manual check in Gemini (they might close the
 * tab without pasting). Leaving the cursor untouched means these rows still show up next time
 * "Guide Names From Text" runs — the safe failure mode, at the cost of a possible redundant
 * re-send if the manual check WAS completed.
 */
function openGeminiFallbackPrompt() {
  var ui = SpreadsheetApp.getUi();
  var context = getRowsToCheck_(ui);
  if (!context) return;

  if (context.rows.length === 0) {
    setLastProcessedRow_(context.sheetName, context.lastRow);
    ui.alert('Nothing To Check', 'No rows with review text in the new range — cursor advanced anyway.', ui.ButtonSet.OK);
    return;
  }

  var promptText = buildGuideMatchingPromptManual_(context.rows);
  var escaped = promptText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  var html = HtmlService.createHtmlOutput(
    '<div style="font-family: Arial, sans-serif; padding: 4px;">' +
    '<p style="margin-top:0;">Click the button to copy the prompt (with your sheet\'s rows already ' +
    'included below it) and open Gemini in a new tab — then just paste.</p>' +
    '<button id="copyBtn" style="padding:8px 16px; font-size:14px; cursor:pointer;">Copy | Gemini</button>' +
    '<p id="status" style="color:#188038; font-size:12px; min-height:16px;"></p>' +
    '<p style="font-size:12px; color:#5f6368;">If the automatic copy does not work, the text below is pre-selected — press Ctrl/Cmd+C to copy it manually.</p>' +
    '<textarea id="promptBox" readonly style="width:100%; height:220px; font-family:monospace; font-size:11px;">' + escaped + '</textarea>' +
    '<script>' +
    'var promptText = document.getElementById("promptBox").value;' +
    'document.getElementById("copyBtn").addEventListener("click", function() {' +
    '  var status = document.getElementById("status");' +
    '  window.open("https://gemini.google.com/app", "_blank");' + // opened synchronously in the click handler so popup blockers allow it regardless of the clipboard promise below
    '  function fallbackCopy() {' +
    '    var box = document.getElementById("promptBox");' +
    '    box.select();' +
    '    var ok = false;' +
    '    try { ok = document.execCommand("copy"); } catch (e) {}' +
    '    status.textContent = ok' +
    '      ? "Copied! Paste it into the new Gemini tab."' +
    '      : "Could not auto-copy \\u2014 text is selected below, press Ctrl/Cmd+C, then paste it into the new Gemini tab.";' +
    '  }' +
    '  if (navigator.clipboard && navigator.clipboard.writeText) {' +
    '    navigator.clipboard.writeText(promptText).then(function() {' +
    '      status.textContent = "Copied! Paste it into the new Gemini tab.";' +
    '    }).catch(fallbackCopy);' +
    '  } else {' +
    '    fallbackCopy();' +
    '  }' +
    '});' +
    '</script>' +
    '</div>'
  ).setWidth(480).setHeight(420);

  SpreadsheetApp.getUi().showModalDialog(html, 'Fallback Prompt (Gemini)');
}

// gemini-2.0-flash is shut down. gemini-2.5-flash 404s on newly-created projects ("no longer
// available to new users" per the API's own error, which contradicted the general docs — that
// error is the authoritative source for what a given project can actually call). The live API
// itself pointed to gemini-3.6-flash as the replacement. Tried in order; a 503 (model
// overloaded) on one falls through to the next rather than failing the whole run.
var GEMINI_MODELS = ['gemini-3.7-flash', 'gemini-3.6-flash'];

function callGeminiForCorrections_(promptText) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in Script Properties.');
  }

  var lastError;
  for (var m = 0; m < GEMINI_MODELS.length; m++) {
    var model = GEMINI_MODELS[m];
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model +
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
    if (status === 503) {
      lastError = new Error('Gemini API returned HTTP 503 for model "' + model + '": ' + response.getContentText());
      continue; // model overloaded — try the next one
    }
    if (status !== 200) {
      throw new Error('Gemini API returned HTTP ' + status + ' for model "' + model + '": ' + response.getContentText());
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

  throw new Error('All Gemini models returned 503 (overloaded): ' + GEMINI_MODELS.join(', ') +
    '. Last error: ' + lastError);
}

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

function logGuideMatchingError_(ss, message) {
  var errorSheet = ss.getSheetByName('Error Log') || ss.insertSheet('Error Log');
  errorSheet.appendRow(['Guide Matching Error', '', '', '', message]);
}

/**
 * Shared row-gathering logic for both the automated Gemini call (resolveGuideNamesViaAI) and
 * the manual fallback dialog (openGeminiFallbackPrompt) — both need the exact same "which rows
 * count as new, and does the user want to re-check an already-fully-checked sheet" behavior.
 * Returns null if the caller should stop (an alert covering why has already been shown).
 */
function getRowsToCheck_(ui) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var sheetName = sheet.getName();

  if (sheetName === 'Error Log' || sheetName === 'Guide Review') {
    ui.alert('Invalid Sheet', 'Switch to a month tab (e.g. "8") before running this.', ui.ButtonSet.OK);
    return null;
  }

  var lastRow = sheet.getLastRow();
  var startRow = getLastProcessedRow_(sheetName) + 1;
  if (startRow > lastRow) {
    if (lastRow < 2) {
      ui.alert('Nothing To Check', 'Sheet "' + sheetName + '" has no data rows.', ui.ButtonSet.OK);
      return null;
    }
    var response = ui.alert(
      'Already Checked',
      'This sheet has already been fully checked. Re-check all rows from the top?',
      ui.ButtonSet.YES_NO
    );
    if (response !== ui.Button.YES) return null;
    startRow = 2; // re-check every data row, not just rows past the old cursor
  }

  var numRows = lastRow - startRow + 1;
  var values = sheet.getRange(startRow, 1, numRows, 9).getValues(); // A:I — Date..Review
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var actualRow = startRow + i;
    var guide = values[i][2] || '';   // column C
    var review = values[i][8] || '';  // column I
    if (!review) continue; // nothing to match a name against
    rows.push({ row: actualRow, guide: guide, review: review, fullRow: values[i] });
  }

  return { ss: ss, sheetName: sheetName, lastRow: lastRow, rows: rows };
}

function resolveGuideNamesViaAI() {
  var ui = SpreadsheetApp.getUi();
  var context = getRowsToCheck_(ui);
  if (!context) return;
  var ss = context.ss, sheetName = context.sheetName, lastRow = context.lastRow, rows = context.rows;

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

  var stagedCount = 0;
  if (corrections.length > 0) {
    var reviewSheet = getOrCreateGuideReviewSheet_(ss);
    var rowsByNumber = {};
    rows.forEach(function (r) { rowsByNumber[r.row] = r; });

    corrections.forEach(function (c) {
      var source = rowsByNumber[c.row];
      if (!source) {
        logGuideMatchingError_(ss, 'Gemini returned row ' + c.row + ' which was not in the batch — skipped.');
        return;
      }
      var reviewText = String(source.review).slice(0, 200);
      appendGuideReviewRow_(reviewSheet, [
        false, sheetName, c.row, c.currentGuide, c.suggestedGuide, reviewText, c.reason,
      ]);
      stagedCount++;
    });
  }

  setLastProcessedRow_(sheetName, lastRow);
  ui.alert(
    'Resolve Complete',
    'Checked ' + rows.length + ' row(s) on "' + sheetName + '". ' +
      stagedCount + ' suggestion(s) added to "Guide Review".',
    ui.ButtonSet.OK
  );
}

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

    if (typeof sourceRow !== 'number' || isNaN(sourceRow) || sourceRow < 2 || sourceRow > sourceSheet.getLastRow()) {
      logGuideMatchingError_(ss, 'applyApprovedCorrections: invalid source row "' + data[i][2] + '" at staged row ' + (i + 2));
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
