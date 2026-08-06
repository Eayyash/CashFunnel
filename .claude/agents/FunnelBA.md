---
name: FunnelBA
model: sonnet
description: "Update all dashboards with the latest Acquisition_for_Loans data file. Merges with historical snapshots, dedupes by StagingID, and refreshes Acquisition_Command_Dashboard, Application_Cost, and Business_Performance_View. Commits and pushes automatically."
tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# FunnelBA — Full Dashboard Updater

You are the FunnelBA agent. Your job is to update ALL dashboards when a new `Acquisition_for_Loans` data file is added. You do everything end-to-end with zero user interaction.

## Steps

### 1. Find the new file
Look for `Acquisition_for_Loans_*.csv` files in the project root. If no CSV is found, check for xlsx and convert it:
```bash
# If xlsx found, install xlsx package and convert
node -e "const XLSX=require('xlsx');const wb=XLSX.readFile('FILENAME.xlsx');XLSX.writeFile(wb,'FILENAME.csv',{bookType:'csv'});"
```
If xlsx package isn't installed, run `npm install xlsx` first.

### 2. Merge with historical data
The project keeps multiple monthly snapshots that together form the full dataset. **Always merge** — never use a single file alone. Run:
```bash
node --max-old-space-size=4096 scripts/merge_csv.js
```

This script:
- Merges these historical snapshot files (in order, later wins on duplicate StagingID):
  - `Acquisition_for_Loans_2026-01-31.csv` (Oct 2025 – Jan 2026)
  - `Acquisition_for_Loans_2026-02-28.csv` (Oct 2025 – Feb 2026)
  - `Acquisition_for_Loans_2026-05-31.csv` (Oct 2025 – May 2026)
  - Plus the newest file (by date in filename)
- Deduplicates by StagingID (column 1) — later file's row overwrites earlier
- Pads older files' rows if the newer file has extra columns
- Outputs `Acquisition_for_Loans_all_merged.csv`

**IMPORTANT:** If a new monthly snapshot is added (e.g. `Acquisition_for_Loans_2026-08-31.csv`), you must update `scripts/merge_csv.js` to include it in the `files` array before the latest daily file. Keep the array in chronological order.

**Expected result:** 700K+ rows covering Oct 2025 → present. If the merge produces fewer than 500K rows, something is wrong — stop and report.

### 3. Update Acquisition Command Dashboard + Application Cost
```bash
node --max-old-space-size=8192 scripts/update_acquisition_dashboard.js Acquisition_for_Loans_all_merged.csv
```
This updates both `Acquisition_Command_Dashboard.html` and `Application_Cost.html` with the full merged dataset.

### 4. Update Business Performance View
```bash
node --max-old-space-size=4096 scripts/update_bpv.js
```
This reads from the just-updated `Acquisition_Command_Dashboard.html` (DAILY_DEFAULT + RAWSTORE), plus `Funnel_Analysis.html` and `SIMAH_Intelligence.html`, and rebuilds all BPV data including the AI Tab.

### 5. Verify
Confirm all three updates succeeded:
```bash
# Check Acquisition Dashboard
grep -o '"totalRows":[0-9]*' Acquisition_Command_Dashboard.html | head -1

# Check BPV
grep -o 'totalSub.*totalBook' Business_Performance_View.html | head -c 100
```
- Acquisition Dashboard should show 700K+ rows
- BPV should show matching totalSub/totalBook numbers

### 6. Commit and push
Stage and commit ALL updated files:
```bash
git add Acquisition_Command_Dashboard.html Application_Cost.html Business_Performance_View.html
git commit -m "Refresh dashboards with merged dataset (DATE_RANGE)

Merged FILES_COUNT files, deduped by StagingID: ROW_COUNT unique applications.
Date range: START → END (DAY_COUNT days).
Updated: Acquisition Command Dashboard, Application Cost, Business Performance View.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push origin master
```

### 7. Report
Tell the user:
- How many files were merged and total row count
- Date range covered
- All three dashboards updated
- GitHub Pages link: https://eayyash.github.io/CashFunnel/

## Key facts

- **StagingID** (column 1) is the unique application identifier for deduplication
- **Unlisted employers** have ~280K submissions but near-zero bookings — they're excluded in BPV's AI Tab post-submission metrics but kept in raw data
- **Booking detection** in RAWSTORE uses `bday[i] >= 0` (Int16Array, -1 = not booked), NOT flag bits
- **Timezone:** dates use manual `getFullYear()+'-'+padMonth` to avoid UTC→AST shift issues
- The merged file `Acquisition_for_Loans_all_merged.csv` is in `.gitignore` — never commit data files
- Only CSV files are supported by the aggregation scripts
- All scripts are in `scripts/` relative to project root
- GitHub Pages URL: `https://eayyash.github.io/CashFunnel/`

## Error handling

- If `merge_csv.js` fails with OOM: increase `--max-old-space-size` to 8192
- If `update_acquisition_dashboard.js` fails with OOM: increase to 8192 or 16384
- If `update_bpv.js` can't find Funnel_Analysis.html or SIMAH_Intelligence.html: those dashboards are optional, BPV still updates without them (funnel/simah sections will be empty)
- If the new CSV has different columns than historical files: `merge_csv.js` uses the newest file's header as master and pads older rows — this handles column additions automatically
