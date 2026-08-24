/**
 * Creates a custom menu when the spreadsheet opens.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("Review Tools")
    .addItem("Find Duplicates in Active Sheet", "findDuplicatesInActiveSheet")
    .addItem("Resolve Guide Names via AI", "resolveGuideNamesViaAI")
    .addItem("Apply Approved Corrections", "applyApprovedCorrections")
    .addToUi();
}

/**
 * Scans ONLY the currently open sheet for duplicates based on the robust fingerprint logic,
 * highlights them in light red, and displays a summary popup.
 */
function findDuplicatesInActiveSheet() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet(); // Gets the sheet you are currently looking at
  var sheetName = sheet.getName();

  // Prevent scanning the Error Log
  if (sheetName === "Error Log") {
    ui.alert(
      "Invalid Sheet",
      "You cannot scan the Error Log sheet.",
      ui.ButtonSet.OK,
    );
    return;
  }

  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();

  // Ensure the sheet has enough columns (needs at least 9 columns A through I) and rows
  if (values.length < 2 || values[0].length < 9) {
    ui.alert(
      "Invalid Sheet",
      "This sheet does not have enough data or columns to scan for reviews.",
      ui.ButtonSet.OK,
    );
    return;
  }

  var seenFingerprints = {};
  var sheetDuplicates = 0;
  var duplicateRows = [];

  // Clear previous background colors to reset the view for this specific sheet
  sheet
    .getRange(2, 1, sheet.getLastRow(), Math.max(sheet.getLastColumn(), 9))
    .setBackground(null);

  // Start at r = 1 to skip the header row
  for (var r = 1; r < values.length; r++) {
    var row = values[r];

    // Map to your column structure
    var date = row[0] || ""; // Column A (Index 0)
    var guide = row[2] || ""; // Column C (Index 2)
    var rating = row[3] || ""; // Column D (Index 3)
    var tour = row[4] || ""; // Column E (Index 4)
    var language = row[6] || ""; // Column G (Index 6)
    var platform = row[7] || ""; // Column H (Index 7)
    var reviewText = row[8] || ""; // Column I (Index 8)

    // The robust fingerprint
    var fingerprint =
      platform +
      "||" +
      date +
      "||" +
      guide +
      "||" +
      rating +
      "||" +
      tour +
      "||" +
      language +
      "||" +
      reviewText;

    // Check if we've seen this exact fingerprint in this sheet already
    if (seenFingerprints[fingerprint]) {
      sheetDuplicates++;

      var actualRowNumber = r + 1;
      duplicateRows.push(actualRowNumber);

      // Highlight the duplicate row in light red
      sheet
        .getRange(actualRowNumber, 1, 1, sheet.getLastColumn())
        .setBackground("#ffcccc");
    } else {
      seenFingerprints[fingerprint] = true;
    }
  }

  // Display the results for the active sheet
  if (sheetDuplicates === 0) {
    ui.alert(
      "Scan Complete",
      "No duplicates found in sheet: " + sheetName,
      ui.ButtonSet.OK,
    );
  } else {
    var message =
      "Found " +
      sheetDuplicates +
      " duplicate(s) in sheet: " +
      sheetName +
      ".\n\n";
    message += "Duplicate rows: " + duplicateRows.join(", ") + "\n\n";
    message +=
      "Duplicate rows have been highlighted in light red for easy removal.";

    ui.alert("Scan Complete", message, ui.ButtonSet.OK);
  }
}
