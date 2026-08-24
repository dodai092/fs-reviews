# Guide Name Correction Prompt

> **Note:** This manual chat prompt is a fallback. The normal path is Review Tools → **Open
> Gemini** in the live Apps Script project (`scripts/reviews-hub/guide-matching.gs`,
> `GUIDE_MATCHING_RULES_MANUAL`) — it copies this exact prompt with your sheet's actual rows
> already appended, and opens a new Gemini chat tab, in one click. Use this document only if
> that menu item is unavailable (e.g. no Apps Script editor access at all). Note this is a
> different prompt from the one behind Review Tools → **Guide Names From Text**, which uses a
> JSON output contract instead of a table — the two are deliberately different, not out of sync:
> a human reading a chat response wants a table, the automated flow needs machine-parseable JSON.

**Purpose:** Cross-checks the `Guide` column in a batch of scraped reviews against the actual review text, and fixes it when the reviewer names a different guide than the one currently recorded.

**Used for:** the `Review HUB` sheet, across all platforms. Run alongside review extraction — currently weekly during high season, less often off-season.

**Source:** `00. Review HUB.xlsx` → `Help` sheet → cell `J2` historically; the live text now lives in `GUIDE_MATCHING_RULES_MANUAL` in `scripts/reviews-hub/guide-matching.gs` — treat that constant as canonical and keep this file in sync with it. Two earlier drafts (`G2` "Names from Schedule" and `H2` "Names from Schedule and Review Text") exist in the same `Help` sheet but are a different, broader feature — they cross-reference the weekly guide schedule to fill in blank (`N/A`) guides, which this prompt does not attempt.

**How to use:** paste this prompt into a claude.ai (or similar) chat, then paste the full rows to check (all original sheet columns, tab-separated) after "Data to Process:". The response is a corrected table with a "Correction Note" column appended — drop that column, then paste the remaining columns back over the original row range in the Review HUB sheet.

---

## Prompt

```
Role & Task:

You are an expert data auditor. Your task is to review a dataset of tour bookings and correct the Guide column based on the text in the Review column.

Rules:

Analyze the Review: Read the Review text carefully to see if a specific tour guide's name is mentioned. Account for typos, phonetic spellings, translated names (e.g., Peter = Pero, Catherine = Katarina, Zara = Sara, Nikoletta = Nikolina), or partial names.

Compare: Compare the name found in the Review against the name in the Guide column.

Keep Existing (Default): If the review does NOT mention a name, or if the name mentioned matches the Guide column (even with slight misspellings), do NOT change anything. Output the existing Guide name.

Update if Contradictory: If the review explicitly names a guide that is clearly different from the one in the Guide column, you must update the Guide name to the correct one.

Cross-Reference: When correcting a name, you MUST pick the valid full name from the provided "Master Guide List" below. Ensure the new guide matches the City code in the data (du = Dubrovnik, zg = Zagreb, zd = Zadar, st = Split).

Output Format: Provide a final, corrected table. Add a brief column at the end called "Correction Note" detailing what you changed and why (e.g., "Changed from Lorena Arias to Marin Kalauz based on review").

Master Guide List:

Zagreb (zg): Antonio Sičić, Darko Crnolatac, Diana Bolić, Dora Mlinarek Dominik, Doris Cvetko Pavišić, Ena Matacun, Iva Pavlović, Ivana Čakarić, Josipa Šiklić, Katarina Novoselac, Katija Crnčević, Kristina Božić, Luka Pelicarić, Nadir Ivanović, Nikolina Folnović, Vid Dorić

Zadar (zd): Andrija Grubić, Tonka Baričević, Matea Duka, Iva Zaplatić, Nikolina Kuzman

Split (st): Bruno Beara, Ivana Čagalj, Boris Čerina, Lorena Ćelić, Marina Krolo, Petra Lučev, Marija Močić

Dubrovnik (du): Lorena Arias, Marin Kalauz, Pero Kusalo, Ivo Miličić, Maja Musulin, Andrea Rendulić, Nikolina Vidojević, Sara Žanetić, Romana Tomičić

Data to Process:
```

## Maintenance

The Master Guide List embedded in this prompt must match `Help!A:B` in `00. Review HUB.xlsx`, the `GUIDES` registry in `scripts/common.js`, and `GUIDE_MATCHING_RULES` (the JSON-contract sibling of this prompt) in `scripts/reviews-hub/guide-matching.gs`. Update all four together when the roster changes.
