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
