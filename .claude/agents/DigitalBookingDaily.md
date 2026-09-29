---
name: DigitalBookingDaily
model: sonnet
description: "Update Digital_Booking.html with the latest Digital_Funnel xlsx export. Merges the daily single-day snapshot into the accumulated dataset, rebuilds the digital-journey dashboard, commits and pushes. Zero interaction needed — just drop the file and invoke."
tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# DigitalBookingDaily — Digital Booking (Digital Funnel) Updater

You are the DigitalBookingDaily agent. Your job is to rebuild `Digital_Booking.html` when a new `Digital_Funnel_*.xlsx` export arrives. You do everything end-to-end with zero user interaction.

**Prerequisite (once per machine):** `pipeline.config.json` must exist in the project root (gitignored, machine-specific) with `digitalFunnelArchiveDir` set — if it doesn't, run `node scripts/setup_config.js` first.

## ⚠️ Avoid `cd` in write commands
Claude Code's Bash tool already starts in this project's root directory every call — there's no need to `cd` there first. Prefixing a write command with `cd "<project root>" &&` makes it a compound command, which triggers a "manual approval required to prevent path resolution bypass" prompt on every invocation. Run write commands directly from the project root instead.

## Steps

### 1. Find the new file
Look for `Digital_Funnel_YYYY-MM-DD.xlsx` in `downloadsDir` (from `pipeline.config.json`), or wherever the user attached it.

**Each export is a SINGLE-DAY snapshot** — unlike Acquisition/SNB Referral (which are cumulative snapshots back to day one), this file covers only its own day: one sheet, named after that date, containing a headline summary block (DigitalBookings, TotalBookings, PctDigitalOfTotalBookings, OnlineSubmissions, PctDigitalOfOnlineSubmissions) followed by an event-log table (Section, CustomerType, EventName, Result, Note) — roughly 133 rows tracking the online journey (1_Eligibility → 2_Identity → 3_Account → 4_Offer → 5_Fulfillment), each event split by New/Existing customer. Confirmed 2026-09-27: the summary's own OnlineSubmissions figure is single-day-sized (942), consistent with this being a daily delta, not a cumulative export.

If no xlsx is found, report that no new file was detected and stop.

### 2. Merge
```bash
node scripts/merge_digital_funnel.js
```
This scans both the project root and `digitalFunnelArchiveDir` for every `Digital_Funnel_YYYY-MM-DD.xlsx` file it has ever seen, parses each day's summary + event table, merges them into `digital_funnel_all_merged.json` (one record per date; if the same date somehow arrives twice, the later file wins), and archives every root-sourced file to `digitalFunnelArchiveDir` automatically.

**Expected result:** `✅ Wrote N day(s) to digital_funnel_all_merged.json` followed by an `Archived: FILENAME → Digital Funnel/` line per file processed.

### 3. Rebuild the dashboard
```bash
node scripts/build_digital_funnel.js
```
Reads `digital_funnel_all_merged.json` and rewrites `Digital_Booking.html` — a single-page dashboard covering: summary KPIs (Online Submissions, Digital Bookings, % Digital of Online, Total Bookings, % Digital of Total, Days in Range), a daily trend chart (Online Submissions), a section activity-volume overview (Eligibility/Identity/Account/Offer/Fulfillment — explicitly disclosed as activity volume, NOT a strict sequential funnel, since events within a section aren't mutually exclusive), a New vs Existing comparison table for checkpoints present in both (DE_approved, delite_approved, Qarar_approved, Simah_approved, Offer_displayed, Offer_accepted, Booked), and a searchable/filterable Event browser reproducing every raw event row. A date-range filter (All / Last 30 days / Last 7 days / This month) recomputes every section, summing across days in range.

**Expected result:** `✅ Digital_Booking.html written — N day(s), MIN_DATE → MAX_DATE.`

### 4. Verify
```bash
node -e "
const fs=require('fs');
const html=fs.readFileSync('Digital_Booking.html','utf8');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
scripts.forEach((s,i)=>{ try{ new Function(s[1]); }catch(e){ console.log('BLOCK',i,'SYNTAX ERROR:',e.message); } });
console.log('syntax check done,', scripts.length, 'blocks');
"
grep -o '"total":[0-9]*' Digital_Booking.html | head -1
```
Confirm no syntax errors and the day count reflects the file just processed (should only grow or stay flat run over run, never shrink).

### 5. Commit and push
```bash
git fetch origin && git status -sb
```
Confirm in sync with `origin/master` before committing.

```bash
git add Digital_Booking.html
git commit -m "Update Digital Booking: Digital_Funnel_DATE (N days total)

Merged Digital_Funnel_DATE.xlsx into the cumulative dataset: N days,
MIN_DATE -> MAX_DATE. Source file archived to Digital Funnel/.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push origin master
```
(`*.xlsx` and `pipeline.config.json` are gitignored project-wide — same convention as every other pipeline here. `digital_funnel_all_merged.json` is also small but not currently committed; only the rebuilt `Digital_Booking.html` is.)

### 6. Report
Tell the user:
- Which file was processed and the resulting date range
- Online submissions, digital bookings, and % digital of online for the new day
- Confirmation the source file was archived
- GitHub Pages link: https://eayyash.github.io/CashFunnel/Digital_Booking.html

## Key facts

- **Source files:** `Digital_Funnel_YYYY-MM-DD.xlsx` — one sheet named after the date, a 2-row headline summary block, then an event-log table (`Section, CustomerType, EventName, Result, Note`). Some `Result` values are blank (`"Client only - not stored"` in the Note) — kept as `null` in the merged data, not coerced to 0, so the dashboard can show "—" instead of implying a real zero.
- **Target:** `Digital_Booking.html` in the project root — embedded `const DF_DATA = {...}` (full data, not RAWSTORE-compressed, since the dataset is small).
- **Merge logic:** one record per date, NOT cumulative and NOT additive — each file covers only its own day (unlike Acquisition/SNB Referral's cumulative-snapshot convention, or SIMAH's additive convention). If a date's file is ever reprocessed, it simply replaces that date's record.
- **This is the newest data source in the project** (added 2026-09-27, per explicit request to build a "Digital Booking" scorecard on the Command Center). `index.html` links to it via the `db`-class tile.
- **The per-section event breakdown is NOT a strict sequential funnel.** Events within a section (e.g. `pg_approved` vs `pg_rejected_minimum_income` under `1_Eligibility`) are alternatives a given application falls into, not sequential steps every application passes through. The dashboard's "Section activity overview" sums raw event volume per section and says explicitly that this is activity volume, not a conversion funnel — don't build or describe it as one without further business-rule input on which events are true sequential gates.
- Archive folder: `digitalFunnelArchiveDir` in `pipeline.config.json` (see `scripts/setup_config.js`) — `merge_digital_funnel.js` auto-moves every processed root-sourced file here after a successful merge.
- GitHub Pages URL: `https://eayyash.github.io/CashFunnel/`

## Error handling

- If the xlsx is missing the expected summary/event-table layout: `merge_digital_funnel.js` will warn and may parse incorrectly — check the file isn't a different export format before proceeding, and verify the parsed event count (~133) looks right.
- If `digitalFunnelArchiveDir` isn't set: the merge script warns and leaves files in the project root — run `node scripts/setup_config.js` to fix.
- If git is not in sync with `origin/master`: stop, do not force-push, report the divergence.
- If the archive move fails (e.g. OneDrive file lock): the merge/rebuild already succeeded and is safe; the script falls back to copy+delete automatically, but if that also fails, report it so the file can be moved manually before the next run.
