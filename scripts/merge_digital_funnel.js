#!/usr/bin/env node
/**
 * Merge Digital_Funnel_*.xlsx daily exports into one cumulative dataset.
 *
 * Each file is a SINGLE-DAY snapshot -- one sheet, named after the date
 * (e.g. "2026-09-27"), containing:
 *   - A 2-row headline summary block: DigitalBookings, TotalBookings,
 *     PctDigitalOfTotalBookings, OnlineSubmissions,
 *     PctDigitalOfOnlineSubmissions.
 *   - A blank separator row.
 *   - An event-log table (Section, CustomerType, EventName, Result, Note)
 *     -- one row per named event in the online journey (eligibility ->
 *     identity -> account -> offer -> fulfillment), split by New/Existing
 *     customer. Some Results are blank ("Client only - not stored") --
 *     kept as null, not coerced to 0, so the dashboard can distinguish
 *     "genuinely zero" from "not tracked server-side".
 *
 * Unlike Acquisition/SNB Referral, this is NOT a cumulative snapshot --
 * each file covers only its own day, so merging is simply "one record per
 * date, last file for that date wins" with no need to reconstruct history
 * from a single file. Confirmed 2026-09-27: the file's own summary row
 * (OnlineSubmissions=942) is single-day-sized, consistent with this.
 *
 * Like merge_snb_referral.js, this scans BOTH the project root and the
 * archive folder every run, so it always has memory of every file it has
 * ever processed, not just what happens to be in the root right now.
 *
 * Usage: node scripts/merge_digital_funnel.js
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { loadConfig } = require('./pipeline_config.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'digital_funnel_all_merged.json');
const FILE_RE = /^Digital_Funnel_(\d{4}-\d{2}-\d{2})\.xlsx$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const config = loadConfig();
const archiveDir = config.digitalFunnelArchiveDir;

function findFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => FILE_RE.test(f))
    .map(f => ({ name: f, full: path.join(dir, f), date: f.match(FILE_RE)[1] }));
}

const rootFiles = findFiles(ROOT);
const archiveFiles = archiveDir ? findFiles(archiveDir) : [];
const byDate = new Map();
archiveFiles.forEach(f => byDate.set(f.date, f));
rootFiles.forEach(f => byDate.set(f.date, f)); // root copy wins if somehow both exist
const files = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

if (!files.length) {
  console.log('No Digital_Funnel_*.xlsx files found in the project root or archive folder. Nothing to do.');
  process.exit(0);
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function parseFile(full, expectedDate) {
  const wb = XLSX.readFile(full);
  // The sheet is named after the date -- use it if present, else fall back
  // to the filename's date (already known as expectedDate).
  const sheetName = wb.SheetNames.find(n => DATE_RE.test(n)) || wb.SheetNames[0];
  if (sheetName !== expectedDate) {
    console.warn(`  WARN: sheet name "${sheetName}" doesn't match filename date "${expectedDate}" -- using filename date.`);
  }
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Row 0 = summary headers, row 1 = summary values.
  const summaryHeaders = rows[0] || [];
  const summaryValues = rows[1] || [];
  const summary = {};
  summaryHeaders.forEach((h, i) => { if (h) summary[h] = num(summaryValues[i]); });

  // Find the event-table header row (contains 'Section','CustomerType','EventName','Result','Note').
  let headerIdx = rows.findIndex(r => r[0] === 'Section' && r[2] === 'EventName');
  if (headerIdx < 0) headerIdx = 3; // fallback to the known layout
  const events = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    events.push({
      section: String(r[0] || '').trim(),
      customerType: String(r[1] || '').trim(),
      event: String(r[2] || '').trim(),
      result: num(r[3]),
      note: String(r[4] || '').trim(),
    });
  }
  return { date: expectedDate, summary, events };
}

console.log(`Merging ${files.length} file(s) …`);
files.forEach(f => console.log(`  ${f.name}${f.full.startsWith(ROOT) ? '' : ' (archive)'}`));

const byDateRecord = new Map();
files.forEach(f => {
  try {
    const rec = parseFile(f.full, f.date);
    byDateRecord.set(f.date, rec);
    console.log(`  ${f.name}: ${rec.events.length} events, OnlineSubmissions=${rec.summary.OnlineSubmissions}, DigitalBookings=${rec.summary.DigitalBookings}`);
  } catch (e) {
    console.error(`  ERROR parsing ${f.name}: ${e.message} -- skipped, file left in place`);
  }
});

const merged = [...byDateRecord.values()].sort((a, b) => a.date.localeCompare(b.date));
if (!merged.length) {
  console.error('ERROR: no files parsed successfully -- stopping without writing.');
  process.exit(1);
}

fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
console.log(`\n✅ Wrote ${merged.length} day(s) to ${path.basename(OUT_FILE)} (${merged[0].date} → ${merged[merged.length - 1].date})`);

if (archiveDir) {
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
  rootFiles.forEach(f => {
    const dest = path.join(archiveDir, f.name);
    if (path.resolve(f.full) === path.resolve(dest)) return;
    try {
      fs.renameSync(f.full, dest);
    } catch (e) {
      fs.copyFileSync(f.full, dest);
      fs.unlinkSync(f.full);
    }
    console.log(`  Archived: ${f.name} → ${path.basename(archiveDir)}/`);
  });
} else {
  console.warn('WARN: digitalFunnelArchiveDir not set in pipeline.config.json -- files left in the project root. Run node scripts/setup_config.js to set it.');
}
