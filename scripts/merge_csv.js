#!/usr/bin/env node
/**
 * Merge multiple Acquisition_for_Loans CSVs, dedup by StagingID (latest file wins).
 * Memory-efficient: stores only StagingID → raw line string.
 * Output: Acquisition_for_Loans_all_merged.csv
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const dir = path.resolve(__dirname, '..');

// Files in chronological order — later file wins on duplicates
const files = [
  'Acquisition_for_Loans_2026-01-31.csv',  // Oct 2025 – Jan 2026
  'Acquisition_for_Loans_2026-02-28.csv',  // Oct 2025 – Feb 2026
  'Acquisition_for_Loans_2026-05-31.csv',  // Oct 2025 – May 2026
  'Acquisition_for_Loans_2026-08-05.csv',  // Apr 2026 – Aug 2026
];

// All files have the same columns except the last 3 in Aug-05.
// We'll use the longest header (Aug-05) as master and pad older rows.

async function main() {
  console.log('Merging %d files …', files.length);

  // Determine master header from latest file (has most columns)
  const latestFp = path.join(dir, files[files.length - 1]);
  const latestHeader = fs.readFileSync(latestFp, 'utf8').split('\n')[0].trim();
  const masterCols = latestHeader.split(',');
  const masterColCount = masterCols.length;
  console.log('  Master header: %d columns (from %s)', masterColCount, files[files.length - 1]);

  // Map: StagingID → raw CSV line (padded to master column count)
  const rows = new Map();

  for (const fn of files) {
    const fp = path.join(dir, fn);
    if (!fs.existsSync(fp)) { console.log('  SKIP: %s', fn); continue; }

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
}

main().catch(e => { console.error(e); process.exit(1); });
