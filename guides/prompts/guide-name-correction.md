# Guide Name Correction Prompt

> **Note:** This manual chat prompt is a fallback. The normal path is Review Tools → **Open
> Gemini** in the live Apps Script project (`scripts/reviews-hub/guide-matching.gs`,
> `buildGuideMatchingRulesManualText_`) — it copies this exact prompt (Master Guide List read
> live from the `Help` sheet, always current) with your sheet's actual rows already appended,
> and opens a new Gemini chat tab, in one click. Use this document only if that menu item is
> unavailable (e.g. no Apps Script editor access at all). Note this is a different prompt from
> the one behind Review Tools → **Guide Names From Text**, which uses a JSON output contract
> instead of a table — the two are deliberately different, not out of sync: a human reading a
> chat response wants a table, the automated flow needs machine-parseable JSON.

**Purpose:** Cross-checks the `Guide` column in a batch of scraped reviews against the actual review text, and fixes it when the reviewer names a different guide than the one currently recorded — including filling in `N/A` rows when the review names someone, and proposing `vanjski` when the review clearly describes an external/subcontracted guide not on the roster.

**Used for:** the `Review HUB` sheet, across all platforms. Run alongside review extraction — currently weekly during high season, less often off-season.

**Source:** `00. Review HUB.xlsx` → `Help` sheet → cell `J2` historically; the live text now lives in `buildGuideMatchingRulesManualText_` in `scripts/reviews-hub/guide-matching.gs` — treat that function as canonical and keep this file in sync with it. Its Master Guide List section is generated at runtime from `Help!A:B`, so it can't go stale the way this static copy can — re-copy the Master Guide List below whenever the roster changes. Two earlier drafts (`G2` "Names from Schedule" and `H2` "Names from Schedule and Review Text") exist in the same `Help` sheet but are a different, broader feature — they cross-reference the weekly guide schedule as a second signal, which this prompt does not use (review text is the only signal here).

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

Update if Contradictory or Filling a Blank: If the review explicitly names a guide that is clearly different from the one in the Guide column — including when the Guide column is "N/A" and the review names anyone at all — you must update the Guide name to the correct one.

External Guides: If the review describes a guide who is clearly external, subcontracted, or freelance (not a member of the regular team) rather than a typo or alias of someone on the Master Guide List, write "vanjski" as the corrected value instead of picking a name from the list.

Cross-Reference: When correcting a name, you MUST pick the valid full name from the provided "Master Guide List" below, unless the External Guides rule above applies. Ensure the new guide matches the City code in the data (du = Dubrovnik, zg = Zagreb, zd = Zadar, st = Split).

Output Format: Provide a final, corrected table. Add a brief column at the end called "Correction Note" detailing what you changed and why (e.g., "Changed from Lorena Arias to Marin Kalauz based on review").

Master Guide List:

Zagreb (zg): Antonio Sičić, Darko Crnolatac, Diana Bolić, Dominik Filipčić, Dora Mlinarek Dominik, Doris Cvetko Pavišić, Ena Matacun, Iva Pavlović, Ivana Čakarić, Josipa Šiklić, Katarina Novoselac, Katija Crnčević, Kristina Božić, Luka Pelicarić, Nadir Ivanović, Nikolina Folnović, Vid Dorić

Zadar (zd): Andrija Grubić, Iva Zaplatić, Matea Duka, Nikolina Kuzman, Tonka Baričević

Split (st): Boris Čerina, Bruno Beara, Ivana Čagalj, Lorena Ćelić, Marija Močić, Marina Krolo, Petra Lučev

Dubrovnik (du): Andrea Rendulić, Ivo Miličić, Lorena Arias, Maja Musulin, Marin Kalauz, Nikolina Vidojević, Pero Kusalo, Romana Tomičić, Sara Žanetić

Data to Process:
```

## Maintenance

This static copy's Master Guide List is a snapshot — the live prompt in `scripts/reviews-hub/guide-matching.gs` generates it from `Help!A:B` at runtime and never goes stale, but this file needs manual re-copying whenever the roster changes. Also keep the `GUIDES` registry in `scripts/common.js` and `buildGuideMatchingRulesText_` (the JSON-contract sibling of this prompt) in sync with `Help!A:B`.

**Found while wiring up the live Master Guide List reader:** `Help!A:B` in `00. Review HUB.xlsx` had "Dominik Filipčić" (Zagreb) — a real guide already known to `schedule-reformat.md`'s name table — missing from this file's hardcoded list entirely. Now added. Also, the live `Help` sheet spells his name "Dominik FIlipčić" (capital I mid-word) — worth fixing that typo directly in the sheet.
