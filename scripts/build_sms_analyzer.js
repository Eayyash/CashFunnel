/**
 * SMS Analyzer builder
 *
 * Source: SMS_Campaign_YYYY-MM-DD.xlsx (2 sheets):
 *   - "Raw Data": one row per application created via an SMS campaign link.
 *     Every row has a StagingID (`id`); `SubmittedToMaster` is only
 *     populated once the application actually got pushed to the master
 *     Acquisition system (many rows never make it that far -- they stay
 *     "Rejected"/"Deleted"/"Offered" at the staging level). `Status_In_Master`
 *     mirrors Acquisition_Command_Dashboard.html's Altitudestatus for rows
 *     that did reach master.
 *   - "Summary": a vendor-provided monthly rollup by campaign
 *     (SMS_delivered_month, Campaign_name, Total_submissions,
 *     Total_final_approvals, Total_bookings). Reproduced as-is for
 *     historical trend -- its own Total_bookings figure does NOT match a
 *     plain Status_In_Master==='Completed [C]' count on Raw Data (432 vs
 *     1299 for ABNB in August, confirmed 2026-09-15), almost certainly
 *     because bookings mature over weeks after an SMS send and this
 *     Summary was computed with more elapsed time than this fresh Raw Data
 *     export has had -- so the two tables are presented side by side, never
 *     forced to reconcile.
 *
 * Output: SMS_Analyzer.html (embeds SMS_DATA, all analysis client-side).
 *
 * Each export is a fresh FULL snapshot (Raw Data + Summary both cover
 * everything to date, same convention as the Acquisition/SIMAH daily
 * files) -- so processing is "last file wins", not additive. With no
 * argument, auto-discovers the newest SMS_Campaign_*.xlsx in
 * `downloadsDir` (pipeline.config.json) and archives it to
 * `smsArchiveDir` after a successful build, same pattern as
 * update_funnel.js / update_simah_from_qarar_csv.js.
 *
 * Usage: node scripts/build_sms_analyzer.js ["<path to SMS_Campaign_*.xlsx>"]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const HTML_FILE = path.join(ROOT, 'SMS_Analyzer.html');
const BOOKED_SET = new Set(['Completed [C]', 'Pending Final Approval']);
const NAME_PATTERN = /^SMS_Campaign_\d{4}-\d{2}-\d{2}\.xlsx$/i;

function findLatestInDownloads(downloadsDir) {
  if (!downloadsDir || !fs.existsSync(downloadsDir)) return null;
  const files = fs.readdirSync(downloadsDir).filter(f => NAME_PATTERN.test(f)).sort();
  return files.length ? path.join(downloadsDir, files[files.length - 1]) : null;
}

function archiveProcessedFile(processedPath) {
  let cfg;
  try { cfg = require('./pipeline_config.js').loadConfig(); }
  catch (e) { console.warn(`  (skipping archive -- ${e.message})`); return; }
  if (!cfg.smsArchiveDir) { console.warn('  (skipping archive -- smsArchiveDir not set in pipeline.config.json)'); return; }
  if (!fs.existsSync(cfg.smsArchiveDir)) fs.mkdirSync(cfg.smsArchiveDir, { recursive: true });
  const dest = path.join(cfg.smsArchiveDir, path.basename(processedPath));
  if (path.resolve(processedPath) === path.resolve(dest)) return; // already archived, re-run for testing
  try {
    fs.renameSync(processedPath, dest);
  } catch (e) {
    fs.copyFileSync(processedPath, dest);
    fs.unlinkSync(processedPath);
  }
  console.log(`Archived: ${path.basename(processedPath)} → ${path.basename(cfg.smsArchiveDir)}/`);
}

let filePath = process.argv[2];
if (!filePath) {
  let cfg;
  try { cfg = require('./pipeline_config.js').loadConfig(); }
  catch (e) {
    console.error('No file given and pipeline.config.json could not be loaded.');
    console.error('Either pass a file explicitly: node scripts/build_sms_analyzer.js "<path to SMS_Campaign_*.xlsx>"');
    console.error('or run: node scripts/setup_config.js');
    process.exit(1);
  }
  filePath = findLatestInDownloads(cfg.downloadsDir);
  if (!filePath) {
    console.log(`No SMS_Campaign_*.xlsx file found in ${cfg.downloadsDir}. Nothing to do.`);
    process.exit(0);
  }
} else if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}
const fileName = path.basename(filePath);
console.log(`Reading ${fileName}…`);

const wb = XLSX.readFile(filePath);
if (!wb.SheetNames.includes('Raw Data')) {
  console.error(`ERROR: expected a "Raw Data" sheet, found: ${wb.SheetNames.join(', ')}`);
  process.exit(1);
}
const raw = XLSX.utils.sheet_to_json(wb.Sheets['Raw Data'], { defval: '' });
console.log(`Parsed ${raw.length.toLocaleString()} raw rows`);

function excelSerialToYMD(serial) {
  if (typeof serial !== 'number') return null;
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
function toYMD(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

// --- Cross-reference against the live Acquisition dataset by StagingID
// (the `id` column here IS the Acquisition StagingID) -- per explicit
// request, to answer "did we send an SMS to this person, and what
// actually happened to their application" using the freshest available
// outcome, not just the snapshot frozen into this SMS export at pull
// time. Confirmed 2026-09-15: only ~65% of SMS rows match a StagingID in
// Acquisition (the rest never reached master, consistent with a blank
// SubmittedToMaster), and the live-matched booked count can come out
// LOWER than the export's own Status_In_Master count -- some
// applications that were booked when this SMS file was pulled have
// since reversed to Cancelled (see Acquisition_Command_Dashboard.html's
// "Booked, then Cancelled" KPI for the same phenomenon). Both the
// export's own snapshot status and the live cross-referenced status are
// kept per row so neither is silently discarded.
function loadAcquisitionStagingMap() {
  const acqPath = path.join(ROOT, 'Acquisition_for_Loans_all_merged.csv');
  if (!fs.existsSync(acqPath)) {
    console.warn('  Acquisition_for_Loans_all_merged.csv not found -- skipping live cross-reference (submitted/booked will use only this SMS export\'s own snapshot fields).');
    return null;
  }
  console.log('Reading Acquisition_for_Loans_all_merged.csv for cross-reference…');
  const { readCsv } = require('./update_acquisition_dashboard.js');
  const acqRows = readCsv(acqPath);
  const map = new Map();
  acqRows.forEach(r => {
    const sid = String(r['StagingID'] || '').trim();
    if (!sid) return;
    map.set(sid, r);
  });
  console.log(`  ${acqRows.length.toLocaleString()} Acquisition rows -> ${map.size.toLocaleString()} unique StagingIDs`);
  return map;
}
const stagingMap = loadAcquisitionStagingMap();

// --- Per-row enrichment + per-campaign breakdown ---
const campaigns = {};
const overall = { submitted: 0, submittedToMaster: 0, approved: 0, booked: 0, bookedAmount: 0, cancelled: 0, declined: 0 };
let matchedCount = 0;
const rowsOut = [];
raw.forEach(r => {
  const c = String(r.CampaignName || 'Unknown').trim() || 'Unknown';
  if (!campaigns[c]) campaigns[c] = { submitted: 0, submittedToMaster: 0, approved: 0, booked: 0, bookedAmount: 0, cancelled: 0, declined: 0, byDate: {}, statusBreakdown: {} };
  const b = campaigns[c];
  const staleStatus = String(r.Status_In_Master || '').trim();
  const staleAmount = parseFloat(r.Amount) || 0;
  const stagingId = String(r.id || '').trim();
  const civilId = String(r.CivilId || '').trim();
  const smsDate = excelSerialToYMD(r.SMS_Delivered_Date);

  const acq = stagingMap ? stagingMap.get(stagingId) : null;
  const matched = !!acq;
  if (matched) matchedCount++;
  // Live status wins when a match exists; fall back to this export's own
  // snapshot otherwise (e.g. still Sales Vetting, never reached master).
  const status = matched ? String(acq['Altitudestatus'] || '').trim() : staleStatus;
  const booked = BOOKED_SET.has(status);
  const amount = matched ? (parseFloat(acq['ItemValue']) || 0) : staleAmount;
  const submittedDate = matched ? toYMD(acq['submitted']) : (r.SubmittedToMaster ? excelSerialToYMD(r.SubmittedToMaster) : null);
  const bookedDate = booked ? (matched ? toYMD(acq['SalesCompletedDate']) : null) : null;

  b.submitted++; overall.submitted++;
  if (r.SubmittedToMaster) { b.submittedToMaster++; overall.submittedToMaster++; }
  if (r.FinalApprovalFlag === 'Y') { b.approved++; overall.approved++; }
  if (booked) { b.booked++; b.bookedAmount += amount; overall.booked++; overall.bookedAmount += amount; }
  if (status === 'Cancelled [X]') { b.cancelled++; overall.cancelled++; }
  if (status === 'Declined [D]') { b.declined++; overall.declined++; }

  if (smsDate) b.byDate[smsDate] = (b.byDate[smsDate] || 0) + 1;
  const stKey = status || '(not submitted to master)';
  b.statusBreakdown[stKey] = (b.statusBreakdown[stKey] || 0) + 1;

  rowsOut.push({
    civilId, stagingId, campaign: c, smsDate,
    matched, status, booked,
    submittedDate, bookedDate, amount,
  });
});

console.log('Per-campaign breakdown (live cross-referenced where matched):');
Object.entries(campaigns).forEach(([name, b]) => {
  console.log(`  ${name}: submitted=${b.submitted} toMaster=${b.submittedToMaster} approved=${b.approved} booked=${b.booked} (SAR ${Math.round(b.bookedAmount).toLocaleString()})`);
});
console.log(`Matched against live Acquisition data: ${matchedCount.toLocaleString()} / ${raw.length.toLocaleString()}`);

// --- Summary sheet (vendor monthly rollup, reproduced as-is) ---
let summaryTrend = [];
if (wb.SheetNames.includes('Summary')) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { defval: '', header: 1 });
  const header = rows[0] || [];
  const idx = k => header.indexOf(k);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    summaryTrend.push({
      month: r[idx('SMS_delivered_month')],
      campaign: r[idx('Campaign_name')],
      duration: r[idx('Data_duration')],
      submissions: r[idx('Total_submissions')],
      approvals: r[idx('Total_final_approvals')],
      bookings: r[idx('Total_bookings')],
    });
  }
  summaryTrend.sort((a, b) => String(a.month).localeCompare(String(b.month)) || String(a.campaign).localeCompare(String(b.campaign)));
  console.log(`Summary sheet: ${summaryTrend.length} rows reproduced`);
}

const dateRange = (() => {
  let min = null, max = null;
  raw.forEach(r => {
    const d = excelSerialToYMD(r.SMS_Delivered_Date);
    if (!d) return;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  });
  return { min, max };
})();

const SMS_DATA = {
  meta: {
    sourceFile: fileName,
    generatedAt: new Date().toISOString(),
    totalRows: raw.length,
    deliveredMin: dateRange.min,
    deliveredMax: dateRange.max,
    matchedInAcquisition: matchedCount,
    hasLiveCrossReference: !!stagingMap,
  },
  overall,
  campaigns,
  summaryTrend,
  rows: rowsOut,
};

// --- Render page ---
const html = buildHtml(SMS_DATA);
// Write via temp-file + rename, not an in-place writeFileSync -- this
// OneDrive-synced folder has repeatedly (confirmed across multiple scripts,
// e.g. build_simah_datechunks.js) intermittently failed an in-place
// truncate with UNKNOWN/EPERM. A fresh temp file is a plain create, never
// a truncate of a synced file, so renaming over the target sidesteps it.
const tmpHtml = `${HTML_FILE}.tmp`;
fs.writeFileSync(tmpHtml, html, 'utf-8');
for (let attempt = 1; ; attempt++) {
  try { fs.renameSync(tmpHtml, HTML_FILE); break; }
  catch (e) {
    if (attempt >= 5) throw e;
    console.warn(`  rename attempt ${attempt} failed (${e.code}), retrying…`);
    const until = Date.now() + attempt * 500;
    while (Date.now() < until) { /* busy-wait: this script has no async loop */ }
  }
}
console.log(`✅ SMS_Analyzer.html written — ${Object.keys(campaigns).length} campaigns, ${raw.length.toLocaleString()} rows.`);
archiveProcessedFile(filePath);

function buildHtml(data) {
  const dataJson = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tasheel · SMS Analyzer</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#eef1f7;--panel:#fff;--panel2:#f7f8fb;--line:rgba(30,45,75,.10);--line2:rgba(30,45,75,.17);
 --ink:#141c2b;--ink2:#3a475e;--muted:#5b6b83;--faint:#8493a8;
 --cyan:#0e9e90;--cyan-d:#0b7d72;--gold:#bd7d12;--gold-d:#9a6410;--violet:#6f5be0;--red:#c0392b;--green:#1c7d50;}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:radial-gradient(1200px 700px at 82% -12%,rgba(14,158,144,.10),transparent 60%),radial-gradient(1000px 600px at -5% 5%,rgba(189,125,18,.09),transparent 55%),var(--bg);
 color:var(--ink);font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2,h3,.disp{font-family:'Space Grotesk',sans-serif}
a{color:var(--cyan-d)}
header{padding:20px 26px;display:flex;align-items:center;gap:13px;justify-content:space-between;flex-wrap:wrap}
.hleft{display:flex;align-items:center;gap:13px}
.logo{width:38px;height:38px;border-radius:10px;position:relative;background:conic-gradient(from 210deg,var(--cyan),var(--gold),var(--cyan))}
.logo::after{content:"";position:absolute;inset:5px;border-radius:6px;background:#fff}
.logo::before{content:"↗";position:absolute;inset:0;display:grid;place-items:center;z-index:2;font-family:'Space Grotesk';font-weight:700;color:var(--cyan);font-size:18px}
.brand .t{font-family:'Space Grotesk';font-weight:700;font-size:17px}
.brand .s{font-size:10.5px;color:var(--muted);letter-spacing:.13em;text-transform:uppercase;margin-top:1px}
.home-link{font-size:12.5px;color:var(--muted);text-decoration:none;display:flex;align-items:center;gap:5px;font-weight:600}
.home-link:hover{color:var(--ink)}
main{max-width:1180px;margin:0 auto;padding:6px 26px 60px}
.hint{font-size:11.5px;color:var(--faint);margin:2px 0 20px}
.section{margin-bottom:34px}
.sec-h{display:flex;align-items:baseline;gap:10px;margin-bottom:14px}
.sec-h h2{font-size:16px;margin:0}
.sec-h .n{font-size:10px;color:var(--faint);font-family:'JetBrains Mono'}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 2px 4px rgba(20,30,50,.03)}
.card .lab{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin-bottom:6px}
.card .big{font-size:24px;font-weight:700;font-family:'Space Grotesk'}
.card .sub{font-size:11px;color:var(--faint);margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--panel);border-radius:12px;overflow:hidden;border:1px solid var(--line)}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line)}
th{background:var(--panel2);font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700}
tr:last-child td{border-bottom:none}
td.num,th.num{text-align:right;font-family:'JetBrains Mono'}
.campname{font-weight:700;font-family:'Space Grotesk'}
.rate-good{color:var(--green);font-weight:700}
.rate-bad{color:var(--red);font-weight:700}
.bar-wrap{background:var(--panel2);border-radius:6px;height:6px;overflow:hidden;margin-top:6px}
.bar{height:100%;background:linear-gradient(90deg,var(--cyan),var(--cyan-d));border-radius:6px}
.foot{text-align:center;color:var(--faint);font-size:11px;font-family:'JetBrains Mono';padding:22px}
.tablewrap{overflow-x:auto}
.camp-block{margin-bottom:22px}
.camp-block:last-child{margin-bottom:0}
.camp-block h3{font-size:13px;margin:0 0 10px;font-family:'Space Grotesk';display:flex;align-items:center;gap:8px}
.camp-block h3 .n{font-size:10px;color:var(--faint);font-weight:400;font-family:'JetBrains Mono'}
.filters{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:18px}
.filter-row{display:flex;flex-wrap:wrap;gap:14px;align-items:end}
.filter-item{display:flex;flex-direction:column;gap:5px}
.filter-item label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700}
.filter-item select,.filter-item input{padding:7px 10px;border:1px solid var(--line2);border-radius:8px;background:var(--panel2);color:var(--ink);font-family:'Inter',sans-serif;font-size:12.5px}
.filter-item input[type="date"]{font-family:'JetBrains Mono'}
.filter-reset{padding:7px 14px;border:1px solid var(--line2);border-radius:8px;background:var(--panel2);color:var(--muted);font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif}
.filter-reset:hover{color:var(--ink);border-color:var(--line)}
.search-box{display:flex;flex-direction:column;gap:5px;flex:1;min-width:220px}
.results-row{display:flex;gap:14px;margin:16px 0}
.results-row .card{flex:1}
.match-badge{display:inline-block;font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:5px;letter-spacing:.03em}
.match-badge.live{background:rgba(28,125,80,.12);color:var(--green)}
.match-badge.stale{background:rgba(189,125,18,.12);color:var(--gold-d)}
.row-limit-note{font-size:11px;color:var(--faint);margin-top:8px}
</style></head>
<body>
<header>
  <div class="hleft">
    <div class="logo"></div>
    <div class="brand"><div class="t">SMS Analyzer</div><div class="s">Tasheel Finance · Campaign Performance</div></div>
  </div>
  <a class="home-link" href="index.html">← Home</a>
</header>
<main>
<div class="hint" id="source-hint"></div>

<div class="section">
  <div class="sec-h"><h2>Overall</h2><span class="n">this export · by campaign</span></div>
  <div id="overall-kpis"></div>
</div>

<div class="section">
  <div class="sec-h"><h2>Campaign performance</h2><span class="n">by CampaignName · this export</span></div>
  <div class="tablewrap"><table id="campaign-table"></table></div>
</div>

<div class="section" id="trend-section">
  <div class="sec-h"><h2>Historical trend</h2><span class="n">vendor monthly rollup · reproduced as-is, own figures</span></div>
  <div class="hint">Note: this table's "Bookings" figure is the campaign vendor's own monthly count and does not match the "Booked" count above — bookings mature over weeks after an SMS send, and this rollup reflects more elapsed maturation time than the fresh Raw Data export above has had. Both are shown side by side rather than forced to reconcile.</div>
  <div class="tablewrap"><table id="trend-table"></table></div>
</div>

<div class="section">
  <div class="sec-h"><h2>Lookup &amp; filter</h2><span class="n">Submitted → Booked, sliced by campaign / SMS date / submitted date / booked date</span></div>
  <div class="hint" id="crossref-hint"></div>
  <div class="filters">
    <div class="filter-row">
      <div class="search-box">
        <label for="f-search">Civil ID lookup</label>
        <input type="text" id="f-search" placeholder="Type a full or partial Civil ID…">
      </div>
      <div class="filter-item">
        <label for="f-campaign">Campaign</label>
        <select id="f-campaign"><option value="">All campaigns</option></select>
      </div>
      <div class="filter-item">
        <label for="f-smsdate">SMS sent date</label>
        <select id="f-smsdate"><option value="">All dates</option></select>
      </div>
      <div class="filter-item"><label for="f-sub-from">Submitted from</label><input type="date" id="f-sub-from"></div>
      <div class="filter-item"><label for="f-sub-to">Submitted to</label><input type="date" id="f-sub-to"></div>
      <div class="filter-item"><label for="f-book-from">Booked from</label><input type="date" id="f-book-from"></div>
      <div class="filter-item"><label for="f-book-to">Booked to</label><input type="date" id="f-book-to"></div>
      <button class="filter-reset" id="f-reset">Reset filters</button>
    </div>
  </div>
  <div class="results-row" id="filter-kpis"></div>
  <div class="hint">Note: "Submitted" here counts a Staging ID as submitted the moment it's found in the live Acquisition dataset (which only contains applications that reached master) — this can be higher than the "Submitted to Master" figure in the Overview section above, which relies only on this export's own snapshot flag and can be stale for applications that reached master after the SMS file was pulled.</div>
  <div class="tablewrap"><table id="filter-table"></table></div>
  <div class="row-limit-note" id="filter-row-note"></div>
</div>

</main>
<div class="foot">Built for <a href="https://www.linkedin.com/in/emadayyash" target="_blank">Emad Ayyash</a> · Tasheel Finance</div>
<script>
const SMS_DATA = ${dataJson};

function fmt(n){ return (n==null||isNaN(n))?'—':Math.round(n).toLocaleString(); }
function money(n){ return (n==null||isNaN(n))?'—':'SAR '+Math.round(n).toLocaleString(); }
function pct(n){ return (n==null||isNaN(n))?'—':n.toFixed(1)+'%'; }
function prettyMonth(m){
  const s=String(m); if(s.length!==6) return s;
  const y=s.slice(0,4), mo=parseInt(s.slice(4,6),10);
  const names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return names[mo-1]+' '+y;
}

function render(){
  const d = SMS_DATA;
  document.getElementById('source-hint').textContent =
    \`Source: \${d.meta.sourceFile} · \${fmt(d.meta.totalRows)} applications · SMS delivered \${d.meta.deliveredMin} → \${d.meta.deliveredMax}\`;

  // Overall KPIs
  function kpiBlock(b, total){
    const rate = b.submitted ? (b.booked/b.submitted*100) : 0;
    const toMasterRate = b.submitted ? (b.submittedToMaster/b.submitted*100) : 0;
    const kpis = [
      ['Applications Created', fmt(b.submitted), 'from SMS click-through'],
      ['Submitted to Master', fmt(b.submittedToMaster), pct(toMasterRate)+' of created'],
      ['Final Approved', fmt(b.approved), 'FinalApprovalFlag = Y'],
      ['Booked', fmt(b.booked), pct(rate)+' of created'],
      ['Booked Value', money(b.bookedAmount), 'total ItemValue'],
      ['Cancelled', fmt(b.cancelled), ''],
    ];
    return \`<div class="kpis">\${kpis.map(([lab,big,sub])=>
      \`<div class="card"><div class="lab">\${lab}</div><div class="big">\${big}</div><div class="sub">\${sub}</div></div>\`
    ).join('')}</div>\`;
  }
  const campNamesForKpi = Object.keys(d.campaigns).sort((a,b)=>d.campaigns[b].submitted-d.campaigns[a].submitted);
  let overallHtml = \`<div class="camp-block"><h3>All Campaigns <span class="n">combined</span></h3>\${kpiBlock(d.overall)}</div>\`;
  overallHtml += campNamesForKpi.map(name =>
    \`<div class="camp-block"><h3>\${name}</h3>\${kpiBlock(d.campaigns[name])}</div>\`
  ).join('');
  document.getElementById('overall-kpis').innerHTML = overallHtml;

  // Campaign table
  const campNames = Object.keys(d.campaigns).sort((a,b)=>d.campaigns[b].submitted-d.campaigns[a].submitted);
  let maxSub = Math.max(...campNames.map(c=>d.campaigns[c].submitted), 1);
  let th = '<tr><th>Campaign</th><th class="num">Submitted</th><th class="num">To Master</th><th class="num">Approved</th><th class="num">Booked</th><th class="num">Booking Rate</th><th class="num">Booked Value</th><th>Volume</th></tr>';
  let rows = campNames.map(name=>{
    const b = d.campaigns[name];
    const r = b.submitted ? (b.booked/b.submitted*100) : 0;
    const rateCls = r>=10?'rate-good':(r<3?'rate-bad':'');
    const barPct = (b.submitted/maxSub*100).toFixed(1);
    return \`<tr>
      <td class="campname">\${name}</td>
      <td class="num">\${fmt(b.submitted)}</td>
      <td class="num">\${fmt(b.submittedToMaster)}</td>
      <td class="num">\${fmt(b.approved)}</td>
      <td class="num">\${fmt(b.booked)}</td>
      <td class="num \${rateCls}">\${pct(r)}</td>
      <td class="num">\${money(b.bookedAmount)}</td>
      <td><div class="bar-wrap"><div class="bar" style="width:\${barPct}%"></div></div></td>
    </tr>\`;
  }).join('');
  document.getElementById('campaign-table').innerHTML = th + rows;

  // Historical trend table (vendor Summary sheet, as-is)
  if (d.summaryTrend && d.summaryTrend.length) {
    let th2 = '<tr><th>Month</th><th>Campaign</th><th>Duration</th><th class="num">Submissions</th><th class="num">Final Approvals</th><th class="num">Bookings</th></tr>';
    let rows2 = d.summaryTrend.map(r=>
      \`<tr><td>\${prettyMonth(r.month)}</td><td class="campname">\${r.campaign}</td><td>\${r.duration}</td><td class="num">\${fmt(r.submissions)}</td><td class="num">\${fmt(r.approvals)}</td><td class="num">\${fmt(r.bookings)}</td></tr>\`
    ).join('');
    document.getElementById('trend-table').innerHTML = th2 + rows2;
  } else {
    document.getElementById('trend-section').style.display = 'none';
  }

  initLookup(d);
}

// --- Lookup & filter: Civil ID search + Campaign/SMS date/Submitted date/
// Booked date filters over the per-application row data. "Submitted" here
// means the row reached the master Acquisition system at all (has a
// submittedDate); "Booked" uses the live cross-referenced status where a
// StagingID match exists, falling back to this export's own snapshot
// status otherwise -- each row carries a "matched" flag so the table can
// show which one it's using. ---
function initLookup(d){
  const rows = d.rows || [];
  document.getElementById('crossref-hint').textContent = d.meta.hasLiveCrossReference
    ? \`\${fmt(d.meta.matchedInAcquisition)} of \${fmt(d.meta.totalRows)} applications matched against the live Acquisition dataset by Staging ID -- those use the current status/date; unmatched rows (never reached master, or ID not found) fall back to this export's own snapshot fields.\`
    : \`Acquisition_for_Loans_all_merged.csv wasn't found at build time -- every row below uses only this export's own snapshot fields (no live cross-reference). Phone number lookup isn't available -- the source file has no phone column, only Civil ID.\`;

  const campSel = document.getElementById('f-campaign');
  [...new Set(rows.map(r=>r.campaign))].sort().forEach(c=>{
    const o=document.createElement('option'); o.value=c; o.textContent=c; campSel.appendChild(o);
  });
  const smsSel = document.getElementById('f-smsdate');
  [...new Set(rows.map(r=>r.smsDate).filter(Boolean))].sort().forEach(dt=>{
    const o=document.createElement('option'); o.value=dt; o.textContent=dt; smsSel.appendChild(o);
  });

  const els = {
    search: document.getElementById('f-search'),
    campaign: document.getElementById('f-campaign'),
    smsdate: document.getElementById('f-smsdate'),
    subFrom: document.getElementById('f-sub-from'),
    subTo: document.getElementById('f-sub-to'),
    bookFrom: document.getElementById('f-book-from'),
    bookTo: document.getElementById('f-book-to'),
  };
  const ROW_CAP = 300;

  function apply(){
    const q = els.search.value.trim();
    const camp = els.campaign.value;
    const sms = els.smsdate.value;
    const subFrom = els.subFrom.value, subTo = els.subTo.value;
    const bookFrom = els.bookFrom.value, bookTo = els.bookTo.value;

    const filtered = rows.filter(r=>{
      if (q && !(r.civilId && r.civilId.includes(q))) return false;
      if (camp && r.campaign !== camp) return false;
      if (sms && r.smsDate !== sms) return false;
      if (subFrom && (!r.submittedDate || r.submittedDate < subFrom)) return false;
      if (subTo && (!r.submittedDate || r.submittedDate > subTo)) return false;
      if (bookFrom && (!r.bookedDate || r.bookedDate < bookFrom)) return false;
      if (bookTo && (!r.bookedDate || r.bookedDate > bookTo)) return false;
      return true;
    });

    const submittedCount = filtered.filter(r=>r.submittedDate).length;
    const bookedCount = filtered.filter(r=>r.booked).length;
    const bookedAmount = filtered.filter(r=>r.booked).reduce((s,r)=>s+(r.amount||0),0);
    const rate = submittedCount ? (bookedCount/submittedCount*100) : 0;
    document.getElementById('filter-kpis').innerHTML = [
      ['Matching applications', fmt(filtered.length)],
      ['Submitted', fmt(submittedCount)],
      ['Booked', fmt(bookedCount)+' ('+pct(rate)+')'],
      ['Booked value', money(bookedAmount)],
    ].map(([lab,big])=>\`<div class="card"><div class="lab">\${lab}</div><div class="big">\${big}</div></div>\`).join('');

    const th = '<tr><th>Civil ID</th><th>Staging ID</th><th>Campaign</th><th>SMS Date</th><th>Submitted</th><th>Booked</th><th>Status</th></tr>';
    const bodyRows = filtered.slice(0, ROW_CAP).map(r=>\`<tr>
      <td>\${r.civilId||'—'}</td>
      <td>\${r.stagingId||'—'}</td>
      <td class="campname">\${r.campaign}</td>
      <td>\${r.smsDate||'—'}</td>
      <td>\${r.submittedDate||'—'}</td>
      <td>\${r.bookedDate||(r.booked?'yes':'—')}</td>
      <td>\${r.status||'—'} <span class="match-badge \${r.matched?'live':'stale'}">\${r.matched?'LIVE':'SNAPSHOT'}</span></td>
    </tr>\`).join('');
    document.getElementById('filter-table').innerHTML = filtered.length ? (th + bodyRows) : '<tr><td style="text-align:center;color:var(--faint)">No matching applications</td></tr>';
    document.getElementById('filter-row-note').textContent = filtered.length > ROW_CAP
      ? \`Showing first \${ROW_CAP} of \${fmt(filtered.length)} matching rows -- narrow the filters to see more specific results.\`
      : '';
  }

  Object.values(els).forEach(el => el.addEventListener('input', apply));
  document.getElementById('f-reset').addEventListener('click', ()=>{
    Object.values(els).forEach(el => el.value = '');
    apply();
  });
  apply();
}

render();
</script>
</body></html>
`;
}

module.exports = { buildHtml };
