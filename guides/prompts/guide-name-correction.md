# Guide Name Correction Prompt

> **Note:** This manual claude.ai prompt is now a fallback. The normal path is the Apps Script
> flow — Review Tools → Resolve Guide Names via AI (`scripts/reviews-hub/guide-matching.gs`) —
> which runs the same rules against the Review HUB directly, no manual claude.ai round trip
> required. Use this prompt only if that flow is unavailable.

**Purpose:** Cross-checks the `Guide` column in a batch of scraped reviews against the actual review text, and fixes it when the reviewer names a different guide than the one currently recorded (including filling in `N/A` rows where the text names someone).

**Used for:** the `Review HUB` sheet, across all platforms. Run alongside review extraction — currently weekly during high season, less often off-season.

**Source:** `00. Review HUB.xlsx` → `Help` sheet → cell `J2`. This is the current, in-use version. Two earlier drafts (`G2` "Names from Schedule" and `H2` "Names from Schedule and Review Text") exist in the same sheet but are superseded — they matched primarily against the weekly schedule; this version trusts the review text first and treats the schedule as unnecessary, which is simpler to run since it doesn't require a freshly reformatted schedule as an input.

**How to use:** paste this prompt into Claude, then paste the batch of review rows to check after "Data to Process:". Paste the corrected table back over the reviewed rows in the Review HUB sheet.

---

## Prompt

```
Role & Task:

You are an expert data auditor. Your task is to review a dataset of tour bookings and correct the Guide column based on the text in the Review column.

Rules:

Analyze the Review: Read the Review text carefully to see if a specific tour guide's name is mentioned. Account for typos, phonetic spellings, translated names (e.g., Peter = Pero, Catherine = Katarina, Zara = Sara, Nikoletta = Nikolina), or partial names.

Compare: Compare the name found in the Review against the name in the Guide column.

Keep Existing (Default): If the review does NOT mention a name, or if the name mentioned matches the Guide column (even with slight misspellings), do NOT change anything. Output the existing Guide name.

Update if Contradictory: If the review explicitly names a guide that is clearly different from the one in the Guide column, you must propose the correct one.

Cross-Reference: When proposing a correction, you MUST pick the valid full name from the Master Guide List below. Ensure the new guide matches the City code in the data (du = Dubrovnik, zg = Zagreb, zd = Zadar, st = Split).

Master Guide List:

Zagreb (zg): Antonio Sičić, Darko Crnolatac, Diana Bolić, Dora Mlinarek Dominik, Doris Cvetko Pavišić, Ena Matacun, Iva Pavlović, Ivana Čakarić, Josipa Šiklić, Katarina Novoselac, Katija Crnčević, Kristina Božić, Luka Pelicarić, Nadir Ivanović, Nikolina Folnović, Vid Dorić

Zadar (zd): Andrija Grubić, Tonka Baričević, Matea Duka, Iva Zaplatić, Nikolina Kuzman

Split (st): Bruno Beara, Ivana Čagalj, Boris Čerina, Lorena Ćelić, Marina Krolo, Petra Lučev, Marija Močić

Dubrovnik (du): Lorena Arias, Marin Kalauz, Pero Kusalo, Ivo Miličić, Maja Musulin, Andrea Rendulić, Nikolina Vidojević, Sara Žanetić, Romana Tomičić

Output Format: Respond with ONLY a JSON array, no markdown fences, no commentary. Include an entry ONLY for rows where you are proposing a change — omit rows where the existing Guide value should be kept as-is. Each entry: {"row": <the Row number from the input>, "currentGuide": <string>, "suggestedGuide": <string, must be a full name from the Master Guide List>, "reason": <short string explaining what in the review text justified the change>}. If no rows need a change, respond with an empty JSON array: []

Data to Process:
```

## Maintenance

The Master Guide List embedded in this prompt must match `Help!A:B` in `00. Review HUB.xlsx` and the `GUIDES` registry in `scripts/common.js`. Update all three together when the roster changes.
