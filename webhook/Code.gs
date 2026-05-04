function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("No data received from extension. Payload was empty.");
    }

    var data = JSON.parse(e.postData.contents);
    var reviews = data.reviews || [];
    var platform = data.platform || "Unknown";

    var fingerprintCache = {};
    var skipped = 0;

    for (var i = 0; i < reviews.length; i++) {
      var review = reviews[i];
      var dateString = review.Date || "";
      var monthNumber = 1;

      var monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      var foundMonth = false;

      for (var m = 0; m < monthNames.length; m++) {
        if (dateString.indexOf(monthNames[m]) !== -1) {
          monthNumber = m + 1;
          foundMonth = true;
          break;
        }
      }

      if (!foundMonth) {
        var parsedDate = new Date(dateString);
        if (!isNaN(parsedDate.getTime())) {
          monthNumber = parsedDate.getMonth() + 1;
        }
      }

      var sheetName = monthNumber.toString();
      var sheet = ss.getSheetByName(sheetName);

      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        sheet.appendRow(["Date", "Time", "Guide", "Rating", "Tour", "City", "Language", "Platform", "Review"]);
      }

      // Build fingerprint cache for this sheet on first encounter
      if (!fingerprintCache[sheetName]) {
        var fingerprints = {};
        var existingData = sheet.getDataRange().getValues();
        for (var r = 1; r < existingData.length; r++) {
          var row = existingData[r];
          var key = row[7] + "||" + row[0] + "||" + row[8];
          fingerprints[key] = true;
        }
        fingerprintCache[sheetName] = fingerprints;
      }

      // Skip duplicate
      var incoming = platform + "||" + (review.Date || "") + "||" + (review.Review || "");
      if (fingerprintCache[sheetName][incoming]) {
        skipped++;
        continue;
      }
      fingerprintCache[sheetName][incoming] = true;

      sheet.appendRow([
        review.Date,
        review.Time,
        review.Guide,
        review.Rating,
        review.Tour,
        review.City,
        review.Language,
        platform,
        review.Review
      ]);
    }

    return ContentService.createTextOutput(JSON.stringify({"status": "success", "skipped": skipped})).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    var errorSheet = ss.getSheetByName("Error Log") || ss.insertSheet("Error Log");
    errorSheet.appendRow(["Critical Crash", "", "", "", error.toString()]);

    return ContentService.createTextOutput(JSON.stringify({"status": "error"})).setMimeType(ContentService.MimeType.JSON);
  }
}