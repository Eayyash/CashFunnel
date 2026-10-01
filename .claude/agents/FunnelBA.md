---
name: FunnelBA
model: sonnet
description: "Update all dashboards with the latest Acquisition_for_Loans data file. Merges with historical snapshots, dedupes by StagingID, and refreshes Acquisition_Command_Dashboard, Application_Cost, SNB_Overview, and Business_Performance_View. Commits and pushes automatically."
tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# FunnelBA — Full Dashboard Updater

You are the FunnelBA agent. Your job is to update ALL dashboards when a new `Acquisition_for_Loans` data file is added. You do everything end-to-end with zero user interaction.

**Prerequisite (once per machine):** `pipeline.config.json` must exist in the project root (gitignored, machine-specific) — if it doesn't, `scripts/merge_csv.js` will refuse to run and tell you to run `node scripts/setup_config.js` first, which interactively asks where the archive folders and historical CSVs live on this machine. See `REPLICATE_ON_NEW_MACHINE.md` for the full story.

## ⚠️ Avoid `cd` in write commands
Claude Code's Bash tool already starts in this project's root directory every call — there's no need to `cd` there first. Prefixing a write command (a script run, `git`, `rm`, `cp`, etc.) with `cd "<project root>" &&` makes it a compound command, which triggers a "manual approval required to prevent path resolution bypass" prompt on every single invocation, even for routine, already-approved commands (confirmed 2026-09-15: the file-rename/merge/dashboard-rebuild/SIMAH-merge steps below all hit this needlessly when `cd`-prefixed). Run write commands directly (relative paths from the project root work fine) to avoid this friction entirely; only use `cd` for genuinely read-only exploration, never chained with a write.

## Steps

### 1. Find every new file
Look for **every** `Acquisition_for_Loans_*.csv` file in the project root — one invocation handles a single new file or a whole backlog of several days' worth dropped together the same way (see step 2). If no CSV is found, check for xlsx and convert it:
```bash
# If xlsx found, install xlsx package and convert
node -e "const XLSX=require('xlsx');const wb=XLSX.readFile('FILENAME.xlsx');XLSX.writeFile(wb,'FILENAME.csv',{bookType:'csv'});"
```
If xlsx package isn't installed, run `npm install xlsx` first.

### 2. Merge with historical data
The project keeps multiple monthly snapshots that together form the full dataset. **Always merge** — never use a single file alone. Run:
```bash
node --max-old-space-size=8192 scripts/merge_csv.js
```

This script:
- Merges these historical snapshot files (in order, later wins on duplicate StagingID):
  - `Acquisition_for_Loans_2026-01-31.csv` (Oct 2025 – Jan 2026)
  - `Acquisition_for_Loans_2026-02-28.csv` (Oct 2025 – Feb 2026)
  - `Acquisition_for_Loans_2026-05-31.csv` (Oct 2025 – May 2026)
  - Plus **every** other `Acquisition_for_Loans_*.csv` currently sitting in the project root (not just the newest) — auto-discovered, no need to name them individually
- Deduplicates by StagingID (column 1) — later file's row overwrites earlier
- Pads older files' rows if a newer file has extra columns
- Outputs `Acquisition_for_Loans_all_merged.csv`
- **Archives every non-historical file it just merged** to whatever `acquisitionArchiveDir` is set to in `pipeline.config.json` — the project root should have only the historical snapshots plus the merged output left in it after a successful run

**IMPORTANT:** If a new *monthly* snapshot is added (e.g. a new cumulative rollup meant to replace/extend the `HISTORICAL` list itself, not just another daily file), update the `HISTORICAL` array in `scripts/merge_csv.js` accordingly, in chronological order. Ordinary daily files need no script changes at all — they're auto-discovered.

**Expected result:** 700K+ rows covering Oct 2025 → present. If the merge produces fewer than 500K rows, something is wrong — stop and report.

**Known incident (2026-09, part 1):** this script used to merge only the single newest non-historical file, silently ignoring every other dated CSV sitting in the root. Because processed files were never archived, they piled up (43 files accumulated, 2026-07-20 → 2026-09-05) and each one's applications were completely absent from every downstream dashboard the whole time (confirmed: ~84,600 StagingIDs missing per spot-checked file; recovering all 43 added 95,674 net-new applications, 730,579 → 826,253). Fixed by merging every non-historical file found (not just the newest) and archiving each one after a successful run.

**Known incident (2026-09, part 2 — regression from part 1's own fix):** the very next run after archiving started working dropped straight back down, 826,253 → 744,541 (June–Sept 5 gone). Cause: the output is rebuilt from scratch every run — it's never read back as its own starting point — and the file-discovery loop only ever scanned the project root, never `ARCHIVE_DIR`. So the moment a file got archived (the part-1 fix's whole point), the very next run could no longer see it, and silently lost it from the merge. Fixed by scanning **both** the root and `ARCHIVE_DIR` for non-historical files every run (root-sourced ones still get archived afterward; archive-sourced ones are left in place). Confirmed fix: re-running against all 44 archived files + the new day's file correctly reconstructed 826,253 through Sept 5, +3,244 new for Sept 6 = 829,497 — exactly matching the pre-regression total. **Lesson for any future change to this script's discovery logic: it must always find every file it has EVER archived, not just what happens to be in the root right now** — the merge has no other memory of the past.

### 3. Update Acquisition Command Dashboard + Application Cost
```bash
node --max-old-space-size=16384 scripts/update_acquisition_dashboard.js Acquisition_for_Loans_all_merged.csv
```
This updates both `Acquisition_Command_Dashboard.html` and `Application_Cost.html` with the full merged dataset -- **excluding** the SNB sales channel (`Region_for_Sales === 'SNB'`, column CJ), which is deliberately kept out of the main dashboard (see step 3b).

### 3b. Update the "2nd SIMAH call" page (always run this after step 3, every time)
```bash
node scripts/build_simah2_call.js
```
Reads the `simah2` block that step 3's `update_acquisition_dashboard.js` run just computed (out of `Acquisition_Command_Dashboard.html`'s embedded `DAILY_DEFAULT`) and rewrites the standalone `Simah2_Call.html` dashboard — risk-grade/DBR-band transitions, SIMAH score drift, monthly call-volume and pairs trends, and the full worklist of applications whose financing offer changed between their 1st and 2nd SIMAH-reaching application. Must run AFTER step 3, never before (it reads that step's freshly-computed output, not the raw CSV).

**Do not skip this step.** The `simah2` analysis changes every time new applications reach a 2nd SIMAH call — running only step 3 leaves `Simah2_Call.html` silently stale.

**Note on SNB:** `SNB_Overview.html` is NOT built here. It used to be (`scripts/build_snb_overview.js`, a full clone of this dashboard scoped to SNB rows), but was replaced 2026-09-27 by a dedicated pipeline (`merge_snb_referral.js` + `build_snb_referral_overview.js`, run by the separate `SNBReferralDaily` agent) sourced from `SNB_Referral_*.csv`, not the loans CSV at all. `build_snb_overview.js` is dead code — do not run it; doing so would silently revert `SNB_Overview.html` back to the old loans-sourced design.

### 4. Update Business Performance View
```bash
node --max-old-space-size=4096 scripts/update_bpv.js
```
This reads from the just-updated `Acquisition_Command_Dashboard.html` (DAILY_DEFAULT + RAWSTORE), plus `Funnel_Analysis.html` and `SIMAH_Intelligence.html`, and rebuilds all BPV data including the AI Tab.

### 5. Verify
Confirm all updates succeeded (syntax-check every touched HTML file the same way):
```bash
for f in Acquisition_Command_Dashboard.html Application_Cost.html Simah2_Call.html Business_Performance_View.html; do
  node -e "
  const fs=require('fs');
  const html=fs.readFileSync('$f','utf8');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  scripts.forEach((s,i)=>{ try{ new Function(s[1]); }catch(e){ console.log('$f BLOCK',i,'SYNTAX ERROR:',e.message); } });
  console.log('$f syntax check done,', scripts.length, 'blocks');
  "
done

# Check Acquisition Dashboard row count
grep -o '"total":[0-9]*' Acquisition_Command_Dashboard.html | head -1
# Check Simah2_Call.html picked up a non-zero pair count
node -e "const fs=require('fs');const m=fs.readFileSync('Simah2_Call.html','utf8').match(/const SIMAH2_DATA = (.*);\n/);console.log('pairsRaw:',JSON.parse(m[1]).pairsRaw.length);"

# Check BPV
grep -o 'totalSub.*totalBook' Business_Performance_View.html | head -c 100
```
- Acquisition Dashboard should show 700K+ rows
- Simah2_Call.html's pairsRaw count should be non-zero and should only grow or stay flat run over run, never shrink
- BPV should show matching totalSub/totalBook numbers

### 6. Commit and push
Stage and commit ALL updated files:
```bash
git add Acquisition_Command_Dashboard.html Application_Cost.html Simah2_Call.html Business_Performance_View.html
git commit -m "Refresh dashboards with merged dataset (DATE_RANGE)

Merged FILES_COUNT files, deduped by StagingID: ROW_COUNT unique applications (excl. SNB).
Date range: START → END (DAY_COUNT days).
Updated: Acquisition Command Dashboard, Application Cost, 2nd SIMAH Call, Business Performance View.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push origin master
```

### 7. Report
Tell the user:
- How many files were merged and total row count (main dashboard, excl. SNB)
- Simah2_Call.html's pair count and how many applications had a different offer amount
- Date range covered
- All four dashboards updated
- GitHub Pages link: https://eayyash.github.io/CashFunnel/

## Key facts

- **StagingID** (column 1) is the unique application identifier for deduplication
- **Unlisted employers** have ~280K submissions but near-zero bookings — they're excluded in BPV's AI Tab post-submission metrics but kept in raw data
- **Booking detection** in RAWSTORE uses `bday[i] >= 0` (Int16Array, -1 = not booked), NOT flag bits
- **Timezone:** dates use manual `getFullYear()+'-'+padMonth` to avoid UTC→AST shift issues
- The merged file `Acquisition_for_Loans_all_merged.csv` is in `.gitignore` — never commit data files
- **Archive folder:** `acquisitionArchiveDir` in `pipeline.config.json` (see `scripts/setup_config.js`) — `merge_csv.js` auto-moves every non-historical file here after a successful merge. Also holds `acquisitionHistoricalFiles`, the seed CSV list `merge_csv.js` used to hardcode as `HISTORICAL`.
- Only CSV files are supported by the aggregation scripts
- All scripts are in `scripts/` relative to project root
- GitHub Pages URL: `https://eayyash.github.io/CashFunnel/`
- **Data source integrity:** Each dashboard uses data ONLY from its own source dataset. The Acquisition CSVs are the single source of truth for Acquisition_Command_Dashboard.html and Application_Cost.html. Funnel_Analysis.html uses only the Tawarruq_Funnel xlsx files. SNB_Overview.html uses only SNB_Referral_*.csv (a separate pipeline, see below). Business_Performance_View.html reads from these dashboards (not from raw files) — it does NOT merge or cross-reference different source datasets. Never add data from one source into another source's dashboard.
- **SNB Overview is a SEPARATE pipeline, not part of FunnelBA.** `Region_for_Sales === 'SNB'` (column CJ) is deliberately excluded from Acquisition_Command_Dashboard.html and Application_Cost.html. SNB_Overview.html used to be a full clone of this dashboard (`scripts/build_snb_overview.js`, scoped to SNB rows) but was replaced 2026-09-27 by a dedicated SNB_Referral-sourced design, run by the `SNBReferralDaily` agent. `build_snb_overview.js` is dead code — never run it.
- **2nd SIMAH call (added 2026-10-01):** `Simah2_Call.html` is its own standalone page (scorecard tile on `index.html`), built by `scripts/build_simah2_call.js` from the `simah2` block `update_acquisition_dashboard.js` computes as part of step 3 (`buildSimah2Analysis()` in that script). Covers customers who applied more than once and reached SIMAH both times: risk-grade/DBR-band transitions, SIMAH score drift, monthly call-volume and pairs trends, and a worklist of every application whose financing offer amount changed between the 1st and 2nd call. Must run step 3b every time step 3 runs, same dependency rule as the old SNB step had — it reads step 3's freshly-computed output, not the raw CSV.

## Error handling

- If `merge_csv.js` fails with OOM at 8192: increase further (16384) — merging every new file (not just the newest) reads more data than before, and the dataset only grows over time
- If the root ever has more than a handful of stray `Acquisition_for_Loans_*.csv` files before you even start (i.e. archiving silently stopped working at some point): merge_csv.js will still merge all of them correctly, just slower — let it run, then confirm the archive step logged one "Archived: ..." line per file at the end
- If `update_acquisition_dashboard.js` fails with OOM even at the 16384 default: increase further (24576, 32768) — the dataset only grows each run, so this ceiling will need to keep rising over time
- If `build_simah2_call.js` fails with "no simah2 block found": step 3 (`update_acquisition_dashboard.js`) didn't finish successfully or is from before 2026-10-01 (when `buildSimah2Analysis()` was added) — re-run step 3 first
- If `build_simah2_call.js` is run before step 3 (main dashboard not yet refreshed): it reads whatever `simah2` data is currently embedded in Acquisition_Command_Dashboard.html, which would be stale — re-run step 3 first, then re-run 3b
- If `update_bpv.js` can't find Funnel_Analysis.html or SIMAH_Intelligence.html: those dashboards are optional, BPV still updates without them (funnel/simah sections will be empty)
- If the new CSV has different columns than historical files: `merge_csv.js` uses the newest file's header as master and pads older rows — this handles column additions automatically
