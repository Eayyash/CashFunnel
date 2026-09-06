#!/usr/bin/env node
/**
 * Merge multiple Acquisition_for_Loans CSVs, dedup by StagingID (latest file wins).
 * Memory-efficient: stores only StagingID → raw line string.
 * Output: Acquisition_for_Loans_all_merged.csv
 *
 * Historical monthly snapshots are listed below. The script automatically
 * discovers the newest daily/monthly file and appends it to the merge list.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const dir = path.resolve(__dirname, '..');

// Every non-historical daily/monthly CSV this script has ever merged gets
// moved here afterward -- mirroring DailyBA's Tawarruq Funnel archive and
// SIMAHDaily's SIMAH Qarar JSON archive. Before this existed, processed
// files just piled up in the project root indefinitely (confirmed live:
// ~40 of them, 2026-07-20 through 2026-09-01, each 100MB+) -- and because
// the old merge logic only ever used the single newest one, the OTHER ~39
// files' applications were silently absent from every downstream dashboard
// the whole time (confirmed live: ~84,600 StagingIDs per checked file
// missing from Acquisition_for_Loans_all_merged.csv). Archiving processed
// files keeps the root clean so future runs stay fast (one new file, not
// dozens) and keeps this exact silent-data-loss failure mode from
// recurring.
const ARCHIVE_DIR = path.join('C:', 'Users', 'Emad.Ayyash', 'OneDrive - tasheelfinance', 'Documents', 'EIA Work', 'AI-Work', 'Acquisition for Loans');

// ── Historical monthly snapshots (chronological order) ──
// These are cumulative extracts that together cover Oct 2025 onward.
// Add new monthly snapshots here as they arrive.
const HISTORICAL = [
  'Acquisition_for_Loans_2026-01-31.csv',  // Oct 2025 – Jan 2026
  'Acquisition_for_Loans_2026-02-28.csv',  // Oct 2025 – Feb 2026
  'Acquisition_for_Loans_2026-05-31.csv',  // Oct 2025 – May 2026
];

async function main() {
  // Find the newest file that isn't already in HISTORICAL
  const allCsvs = fs.readdirSync(dir)
    .filter(f => /^Acquisition_for_Loans_\d{4}-\d{2}-\d{2}\.csv$/i.test(f))
    .sort();

  const historicalSet = new Set(HISTORICAL);
  const extras = allCsvs.filter(f => !historicalSet.has(f));

  if (extras.length === 0) {
    console.error('No new Acquisition_for_Loans file found beyond the historical snapshots.');
    process.exit(1);
  }

  // Merge EVERY non-historical file found, not just the newest one -- if
  // multiple daily files land at once (e.g. a backlog of several days'
  // worth dropped together), each one must still get merged. `extras` is
  // already sorted ascending (filenames are YYYY-MM-DD, so lexicographic
  // sort is chronological), so later files still correctly win on
  // duplicate StagingID via the existing dedup loop below.
  const newestFile = extras[extras.length - 1];
  const files = [...HISTORICAL, ...extras];

  console.log('Merging %d files …', files.length);
  console.log('  Historical: %s', HISTORICAL.join(', '));
  console.log('  New (%d):    %s', extras.length, extras.join(', '));

  // Determine master header from the newest file (has most columns)
  const latestFp = path.join(dir, newestFile);
  const latestHeader = fs.readFileSync(latestFp, 'utf8').split('\n')[0].trim();
  const masterCols = latestHeader.split(',');
  const masterColCount = masterCols.length;
  console.log('  Master header: %d columns', masterColCount);

  // Map: StagingID → raw CSV line (padded to master column count)
  const rows = new Map();

  for (const fn of files) {
    const fp = path.join(dir, fn);
    if (!fs.existsSync(fp)) { console.log('  SKIP (not found): %s', fn); continue; }

    const fileHeader = fs.readFileSync(fp, 'utf8').split('\n')[0].trim();
    const fileCols = fileHeader.split(',').length;
    const needsPadding = fileCols < masterColCount;
    const padSuffix = needsPadding ? ','.repeat(masterColCount - fileCols) : '';

    let added = 0, updated = 0, lineNum = 0;

    const rl = readline.createInterface({
      input: fs.createReadStream(fp, { encoding: 'utf8' }),
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      lineNum++;
      if (lineNum === 1) continue; // skip header
      if (!line.trim()) continue;

      const commaIdx = line.indexOf(',');
      const id = commaIdx > 0 ? line.substring(0, commaIdx) : line;
      if (!id) continue;

      const paddedLine = needsPadding ? line + padSuffix : line;

      if (rows.has(id)) { updated++; } else { added++; }
      rows.set(id, paddedLine);
    }

    console.log('  %s: +%d new, %d updated, total now %d', fn, added, updated, rows.size);
  }

  if (rows.size < 500000) {
    console.error('\n⚠️  WARNING: Only %d rows merged — expected 700K+. Check if historical files are present.', rows.size);
  }

  // Write merged CSV
  const outPath = path.join(dir, 'Acquisition_for_Loans_all_merged.csv');
  const ws = fs.createWriteStream(outPath);
  ws.write(latestHeader + '\n');

  let written = 0;
  for (const line of rows.values()) {
    ws.write(line + '\n');
    written++;
  }

  await new Promise(resolve => ws.end(resolve));
  console.log('\n✅ Wrote %d rows to %s', written, path.basename(outPath));

  // Archive every processed non-historical file so it doesn't pile up in
  // the root and get silently skipped (or, under the old logic, silently
  // drop everyone else's applications) on the next run.
  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  for (const fn of extras) {
    const src = path.join(dir, fn);
    const dest = path.join(ARCHIVE_DIR, fn);
    try {
      if (fs.existsSync(src)) {
        fs.renameSync(src, dest);
        console.log('  Archived: %s → Acquisition for Loans/', fn);
      }
    } catch (e) {
      console.warn('  Could not archive %s: %s (safe to move manually)', fn, e.message);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
