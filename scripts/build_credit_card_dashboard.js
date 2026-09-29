#!/usr/bin/env node
/**
 * Build Credit_Card_Dashboard.html's DAILY_DEFAULT from a raw
 * Acquisition-schema CSV export (e.g. YTD_Credit_Cards.csv).
 *
 * This dashboard has never had a Node build script before -- it was
 * designed to be updated by hand, in-browser, via its own "Upload Excel"
 * button (client-side buildDaily() in the page's own <script>, reading an
 * xlsx via SheetJS). This script is a faithful, line-for-line port of
 * that SAME buildDaily() function to Node, so a large CSV (this one is
 * 83MB / 137K rows -- too slow/risky to push through a browser file-input
 * + FileReader + client-side aggregation loop) can be processed
 * server-side instead, producing byte-identical output to what the
 * in-browser uploader would have produced for the same rows.
 *
 * IMPORTANT: keep this in sync with Credit_Card_Dashboard.html's own
 * buildDaily()/CONFIG/DIMCOL/LONGCOL/BOOKED_SET/toYMD/gv if those ever
 * change -- this script does not read them from the HTML, it duplicates
 * them (confirmed 2026-09-29 against the live file before writing this).
 *
 * Data-quality fix applied here that the ORIGINAL in-browser version
 * didn't need: this raw CSV export uses the literal string "NULL" for
 * missing values (not a true blank/empty cell, unlike the xlsx exports
 * the dashboard was originally built against). Confirmed 2026-09-29:
 * CurrentDBRBand is 27.5% literal "NULL" strings -- left unhandled, the
 * DBR band chart would show a misleading "NULL" slice instead of
 * "Unknown". gv() below treats literal "NULL" the same as blank.
 *
 * Usage: node scripts/build_credit_card_dashboard.js <path-to-csv>
 */
const fs = require('fs');
const path = require('path');
const { readCsv } = require('./update_acquisition_dashboard.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_HTML = path.join(ROOT, 'Credit_Card_Dashboard.html');
const filePath = process.argv[2];

if (!filePath || !fs.existsSync(filePath)) {
  console.error('ERROR: usage: node scripts/build_credit_card_dashboard.js <path-to-csv>');
  process.exit(1);
}

// ── Exact port of Credit_Card_Dashboard.html's own constants ───────────
const CONFIG = { valueLabel: 'Booked value', thirdKpi: 'climit', bookCol: 'StatusLastUpdateMoment_Date', bookedLabel: 'Booked cards in range', filterCol: 'Product_type', filterVal: 'Cards' };
const BOOKED_SET = new Set(['Completed [C]', 'Pending Final Approval']);
const DIMCOL = { employer: 'FinalEmployerType', nationality: 'Nationality_Flag', income: 'DeclaredIncomeBand', risk: 'RiskRating', simah: 'SC_RiskGrade', age: 'AgeBand', gender: 'Gender', marital: 'MaritalStatus', product: 'Product_type', source: 'SubmitSource', scoreband: 'AppScoreBand', dbr: 'CurrentDBRBand' };
const LONGCOL = { store: 'StoreName', city: 'CITY', natdetail: 'NATIONALITY' };

function p2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
// toYMD: CSV values are always strings here (unlike the xlsx path, which
// could hand this Date objects or Excel serial numbers) -- the
// YYYY-MM-DD-prefix regex branch is the one that actually fires for this
// data source, but the others are kept for fidelity with the original.
function toYMD(v) {
  if (v == null || v === '' || v === 'NULL') return null;
  if (v instanceof Date) return isNaN(v) ? null : ymd(v);
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return isNaN(d) ? null : ymd(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d) ? null : ymd(d);
}
// gv: same as the original, PLUS treats the literal string 'NULL' as
// missing (the original never needed this since it only ever saw xlsx
// exports with true blank cells, not the string "NULL").
function gv(r, k) {
  const v = r[k];
  if (v == null || v === '' || v === 'NULL') return 'Unknown';
  const s = String(v).trim();
  return (s === '' || s === 'NULL') ? 'Unknown' : s;
}

console.log(`Reading ${path.basename(filePath)}…`);
let rows = readCsv(filePath);
console.log(`Parsed ${rows.length.toLocaleString()} rows`);

// ── buildDaily(), ported line-for-line from Credit_Card_Dashboard.html ─
function buildDaily(rows, name) {
  if (CONFIG.filterCol) { rows = rows.filter(r => String(r[CONFIG.filterCol]) === CONFIG.filterVal); }
  const cnt = { store: {}, city: {}, natdetail: {} };
  rows.forEach(r => { for (const k in LONGCOL) { const v = gv(r, LONGCOL[k]); cnt[k][v] = (cnt[k][v] || 0) + 1; } });
  const top = {}; for (const k in cnt) top[k] = new Set(Object.entries(cnt[k]).sort((a, b) => b[1] - a[1]).slice(0, 20).map(x => x[0]));
  const ALLD = [...Object.keys(DIMCOL), ...Object.keys(LONGCOL)];
  const days = {};
  const bucket = d => days[d] || (days[d] = { k: { sub: 0, init: 0, final: 0, book: 0, val: 0, tsum: 0, tn: 0, clim_sum: 0, clim_n: 0 }, d: {}, mg: { sub: {}, book: {} }, dec: {} });
  const inc = (m, k) => { if (k != null) m[k] = (m[k] || 0) + 1; };
  let processed = 0;
  rows.forEach(r => {
    const sd = toYMD(r['submitted']);
    const booked = BOOKED_SET.has(String(r['Altitudestatus']));
    const init = r['Approvalflag'] === 'Y', fin = r['FinalApprovalFlag'] === 'Y';
    const reg = (r['is_panda'] == 1 || r['is_panda'] === '1') ? 'Panda' : gv(r, 'Region');
    const dval = {}; for (const k in DIMCOL) dval[k] = gv(r, DIMCOL[k]); dval.region = reg;
    for (const k in LONGCOL) { const v = gv(r, LONGCOL[k]); dval[k] = top[k].has(v) ? v : 'Other'; }
    const emp = dval.employer; const gosi = r['Is_GOSI_Called'], mof = r['Is_MOF_Called'];
    if (sd) {
      const b = bucket(sd); b.k.sub++; if (init) b.k.init++; if (fin) b.k.final++;
      for (const dm of ALLD) { const dd = b.d[dm] || (b.d[dm] = { sub: {}, init: {}, book: {}, bval: {} }); inc(dd.sub, dval[dm]); if (init) inc(dd.init, dval[dm]); }
      const rr = b.d.region || (b.d.region = { sub: {}, init: {}, book: {}, bval: {} }); inc(rr.sub, reg); if (init) inc(rr.init, reg);
      const mgs = b.mg.sub[emp] || (b.mg.sub[emp] = [0, 0, 0, 0]); if (gosi === 'Y') mgs[0]++; else if (gosi === 'N') mgs[1]++; if (mof === 'Y') mgs[2]++; else if (mof === 'N') mgs[3]++;
      const dr = r['SimplifiedDeclinedReason']; if (dr != null && dr !== '' && String(dr) !== 'nan' && String(dr) !== 'NULL') inc(b.dec, String(dr));
    }
    if (booked) {
      const bd = toYMD(r[CONFIG.bookCol]);
      if (bd) {
        const b = bucket(bd); b.k.book++;
        const iv = Number(r['ItemValue']); if (!isNaN(iv)) b.k.val += iv; const tn = Number(r['TENURE']); if (!isNaN(tn)) { b.k.tsum += tn; b.k.tn++; } const cl = Number(r['CREDIT_LIMIT']); if (!isNaN(cl)) { b.k.clim_sum += cl; b.k.clim_n++; }
        for (const dm of ALLD) { const dd = b.d[dm] || (b.d[dm] = { sub: {}, init: {}, book: {}, bval: {} }); inc(dd.book, dval[dm]); }
        const rr = b.d.region || (b.d.region = { sub: {}, init: {}, book: {}, bval: {} }); inc(rr.book, reg); if (!isNaN(iv)) rr.bval[reg] = (rr.bval[reg] || 0) + iv;
        const mgb = b.mg.book[emp] || (b.mg.book[emp] = [0, 0, 0, 0]); if (gosi === 'Y') mgb[0]++; else if (gosi === 'N') mgb[1]++; if (mof === 'Y') mgb[2]++; else if (mof === 'N') mgb[3]++;
      }
    }
    processed++;
    if (processed % 20000 === 0) console.log(`  ${processed.toLocaleString()} / ${rows.length.toLocaleString()} rows…`);
  });
  const dates = Object.keys(days).sort();
  for (const d in days) { days[d].k.val = Math.round(days[d].k.val); for (const dm in days[d].d) { const bv = days[d].d[dm].bval; for (const kk in bv) bv[kk] = Math.round(bv[kk]); } }
  return { meta: { min: dates[0], max: dates[dates.length - 1], total: rows.length, name }, dates, days };
}

console.log('Aggregating (filtered to Product_type=Cards)…');
const nd = buildDaily(rows, path.basename(filePath));
console.log(`Result: ${nd.meta.total.toLocaleString()} rows, ${nd.dates.length} dates (${nd.meta.min} → ${nd.meta.max})`);

if (!nd.dates.length) {
  console.error('ERROR: no dated rows found -- check the "submitted" column. Stopping without writing.');
  process.exit(1);
}
if (nd.meta.total < 1000) {
  console.error(`ERROR: only ${nd.meta.total} rows after filtering to Product_type=Cards -- expected much more. Stopping without writing.`);
  process.exit(1);
}

console.log('Injecting into Credit_Card_Dashboard.html…');
let html = fs.readFileSync(OUT_HTML, 'utf-8');
const newLine = 'const DAILY_DEFAULT = ' + JSON.stringify(nd) + ';';
// The whole declaration is a single line in this file (confirmed 2026-09-29:
// line 348, immediately followed by a SEPARATE line "let cD = DAILY_DEFAULT;
// // active daily-aggregate dataset") -- match that one line exactly via the
// multiline flag rather than a lazy [\s\S]*? span, which would be fragile
// against a 80MB+ single-line JSON blob.
const re = /^const DAILY_DEFAULT = .*;$/m;
if (!re.test(html)) {
  console.error('ERROR: could not find the existing DAILY_DEFAULT line to replace -- aborting without writing.');
  process.exit(1);
}
html = html.replace(re, () => newLine); // function replacer -- avoids $-pattern interpretation in a huge JSON payload
fs.writeFileSync(OUT_HTML, html, 'utf-8');
console.log(`✅ Credit_Card_Dashboard.html updated — ${nd.meta.total.toLocaleString()} rows, ${nd.meta.min} → ${nd.meta.max}, ${nd.dates.length} dates.`);
