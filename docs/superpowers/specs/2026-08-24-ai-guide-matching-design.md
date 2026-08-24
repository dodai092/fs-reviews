# AI-assisted guide-name correction, direct in Apps Script

## Problem

The current guide-name-correction process (`guides/Guide Matching - N-A Resolution (EN).docx`)
requires a human to: copy a batch of rows out of the Review HUB sheet, open a new claude.ai
chat, paste a long prompt plus the data, wait for a response, delete the "Correction Note"
column from the result, and paste the remaining 10 columns back over the original row range —
hoping the rows haven't shifted in the meantime. This runs roughly weekly in high season and is
the most manual, error-prone step in the review pipeline.

## Goal

Replace the copy/paste/copy-back cycle with a menu-driven Apps Script flow, bound to the
existing "00. Review HUB" spreadsheet, that calls the Gemini API directly and stages proposed
corrections for human approval before anything is written to the Guide column.

## Non-goals

- Auto-applying corrections without review (rejected earlier in favor of a review step).
- The Civitatis schedule-reformat prompt — structurally similar, but a separate follow-up, not
  part of this spec.
- Changing the guide-matching logic/rules themselves — the prompt's matching rules (alias table,
  city disambiguation, "only change on contradiction") carry over unchanged; only the output
  contract and delivery mechanism change.

## Design

### New file: `scripts/reviews-hub/guide-matching.gs`

Two new "Review Tools" menu items (added to the existing menu in `dedup.gs`'s `onOpen()`):

1. **"Resolve Guide Names via AI"** — runs against the *active* sheet (the currently open month
   tab), matching the existing "operate on whatever sheet is open" pattern from
   `findDuplicatesInActiveSheet`.
2. **"Apply Approved Corrections"** — reads the staging tab's checked rows and writes them back.

### Incremental processing via a stored cursor

Each sheet's last-processed row is tracked in `PropertiesService.getScriptProperties()` under a
key like `lastProcessedRow_<sheetName>`. A run only sends rows after that cursor to Gemini, then
advances the cursor to the sheet's last row — regardless of whether any of those rows produced a
suggestion. This is intentional: once a row's been checked, it's been checked, and reprocessing
it on a later run adds no value and risks LLM non-determinism silently flipping an
already-correct value. No new column is added to the Review HUB sheet — the cursor lives
entirely in script storage, keeping the sheet at its documented 10 columns.

Manually editing a Guide value on an already-processed row is left alone by future runs, which is
correct — a human already made that call.

### Staging tab: "Guide Review"

Cleared and repopulated on each "Resolve Guide Names via AI" run. Only rows where Gemini proposes
an actual change appear — rows it leaves alone don't show up at all. Columns:

| Approve? | Sheet | Row | Current Guide | Suggested Guide | Review Text (truncated) | Reason |
|---|---|---|---|---|---|---|

`Sheet` and `Row` are the exact source location in the Review HUB (e.g. `8`, `142`) — kept
visible (not hidden) so a human can jump to the original row to see full context if the
truncated review text isn't enough. `Approve?` is a checkbox column, unchecked by default.

"Apply Approved Corrections" iterates the staging tab's checked rows, writes `Suggested Guide`
into column C of the referenced `Sheet`/`Row`, then removes that row from the staging tab.
Unchecked rows are left in place for a future run (they're not re-proposed, since they're
already in the staging tab — re-running "Resolve" only adds newly-processed rows, it doesn't
touch existing staging rows).

### Gemini API call

- `UrlFetchApp.fetch()` against the Gemini API's `generateContent` endpoint. Model name is not
  pinned in this spec — check ai.google.dev for the current recommended flash-tier model at
  implementation time, since model availability changes over time.
- API key read from `PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')` —
  set once manually via the Apps Script editor's Project Settings → Script Properties, never
  hardcoded in `.gs` source.
- The prompt sent is the existing guide-matching prompt's rules (master guide list, alias table,
  disambiguation rules, "only change on explicit contradiction") from
  `guides/prompts/guide-name-correction.md`, with one change to the **output contract**: instead
  of "a TSV table with a Correction Note column," the prompt asks for a strict JSON array,
  responding only for rows that need a change:
  ```json
  [{"row": 142, "currentGuide": "Lorena Arias", "suggestedGuide": "Pero Kusalo", "reason": "..."}]
  ```
  JSON is used instead of free-text table parsing because it's what a script can reliably parse;
  the old TSV-table format was designed for a human to read and paste, which no longer applies
  once nothing round-trips through a chat UI.
- Batch size: send the sheet's un-cursor'd rows in a single request unless testing shows Gemini's
  response gets truncated on large batches (the existing manual doc already warns about this for
  a full month at once) — if so, chunk by e.g. 50 rows per call.
- `guides/prompts/guide-name-correction.md` is updated to reflect the new JSON output contract,
  per the doc's own "Maintenance" rule that the prompt and its guide list must stay in sync
  across the doc, the sheet's Help tab, and this codebase. The manual claude.ai-paste version
  documented in `Guide Matching - N-A Resolution (EN/HR).docx` is left as-is (still usable
  as a manual fallback if the Apps Script flow is ever down) but should get a short note
  pointing at the new menu-driven flow as the normal path going forward.

### Error handling

- Gemini API failures (network error, non-200 response, malformed JSON) are caught, logged to
  the existing "Error Log" sheet (same one `code.gs` already writes to on webhook failures), and
  surfaced via `ui.alert` — the cursor is NOT advanced on failure, so a retry picks up from the
  same point.
- A row with no `Review Text` is skipped before it's even sent to Gemini (nothing to match
  against).

## Testing

Apps Script has no local test runner in this codebase (unlike the Playwright automation's
`node --test` suite) — verification is manual: run "Resolve Guide Names via AI" against a small
range of already-known rows (e.g. copy a month tab to a scratch tab first), confirm the staging
tab's suggestions match what a manual claude.ai run would have produced, check the cursor
advanced correctly, then confirm "Apply Approved Corrections" writes to the right cells and
clears the staging tab.
