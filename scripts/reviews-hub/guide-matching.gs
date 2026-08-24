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
  var checkboxRange = sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1);
  checkboxRange.insertCheckboxes();
  return sheet;
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

var GUIDE_MATCHING_RULES =
  'You are an expert data auditor. Your task is to review a dataset of tour bookings and ' +
  'correct the Guide column based on the text in the Review column.\n\n' +
  'Rules:\n\n' +
  'Analyze the Review: Read the Review text carefully to see if a specific tour guide\'s name ' +
  'is mentioned. Account for typos, phonetic spellings, translated names (e.g., Peter = Pero, ' +
  'Catherine = Katarina, Zara = Sara, Nikoletta = Nikolina), or partial names.\n\n' +
  'Compare: Compare the name found in the Review against the name in the Guide column.\n\n' +
  'Keep Existing (Default): If the review does NOT mention a name, or if the name mentioned ' +
  'matches the Guide column (even with slight misspellings), do NOT change anything — do not ' +
  'propose a correction for this row.\n\n' +
  'Update if Contradictory: If the review explicitly names a guide that is clearly different ' +
  'from the one in the Guide column, you must propose the correct one.\n\n' +
  'Cross-Reference: When proposing a correction, you MUST pick the valid full name from the ' +
  'Master Guide List below. Ensure the new guide matches the City code in the data (du = ' +
  'Dubrovnik, zg = Zagreb, zd = Zadar, st = Split).\n\n' +
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

// Verified against ai.google.dev/gemini-api/docs/models on 2026-08-24: gemini-2.0-flash is
// deprecated (shut down June 1, 2026); gemini-3.7-flash is the current stable flash-tier model.
var GEMINI_MODEL = 'gemini-3.7-flash';

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
