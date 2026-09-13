#!/usr/bin/env node
/**
 * Build SNB_Overview.html -- a focused core-KPI scorecard for the SNB sales
 * channel (Region_for_Sales === 'SNB', column CJ), which is excluded from
 * Acquisition_Command_Dashboard.html per explicit request 2026-09-13 (see
 * the `dashboardRows` filter in update_acquisition_dashboard.js).
 *
 * Scope (confirmed with the user): NOT a full clone of the main dashboard's
 * 7 tabs -- just the main KPI grid, the daily booking count chart+table,
 * and the Approved-Not-Booked-by-Employer-Type breakdown, applying the
 * exact same definitions/logic as Acquisition_Command_Dashboard.html.
 * SNB is a small channel (~1,076 rows total), so this embeds plain JSON
 * (day-level aggregates), not the RAWSTORE binary columnar format the main
 * dashboard needs for 800K+ rows -- there's no size pressure here.
 *
 * Usage: node scripts/build_snb_overview.js [path-to-merged-csv]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CSV = path.join(ROOT, 'Acquisition_for_Loans_all_merged.csv');
const HTML_OUT = path.join(ROOT, 'SNB_Overview.html');
const filePath = process.argv[2] || DEFAULT_CSV;

const BOOKED_SET = new Set(['Completed [C]', 'Pending Final Approval']);
const CONFIG = { bookCol: 'SalesCompletedDate' };
const MOF_SECTORS = new Set(['Government Entity', 'Military with Grades']);
const GOSI_SECTORS = new Set(['Private Company', 'Pension']);

function parseCsvLine(line) {
  const result = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
    else { if (c === '"') inQ = true; else if (c === ',') { result.push(cur); cur = ''; } else cur += c; }
  }
  result.push(cur);
  return result;
}
function gv(r, k) {
  const v = r[k];
  return (v == null || v === '') ? 'Unknown' : String(v).trim() || 'Unknown';
}
function toYMD(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
function isPaidApp(r) {
  if (String(r['Is_GOSI_Called'] || '').trim() === 'Y') return true;
  if (String(r['Is_MOF_Called'] || '').trim() === 'Y') return true;
  if (String(r['SC_RiskGrade'] || '').trim() !== '') return true;
  return false;
}

console.log(`Reading ${path.basename(filePath)}…`);
const text = fs.readFileSync(filePath, 'utf-8');
const lines = text.split(/\r?\n/).filter(l => l.trim());
const headers = parseCsvLine(lines[0]);
const regionIdx = headers.indexOf('Region_for_Sales');
if (regionIdx === -1) { console.error('Could not find Region_for_Sales column'); process.exit(1); }
// Check the SNB flag straight off the parsed field array and only build the
// full row object (88 keyed string properties) for matches -- building one
// for all ~846K rows just to keep 1,076 of them OOM'd this script at an
// 8GB heap (confirmed live). SNB is a tiny fraction of the dataset; this
// keeps peak memory proportional to that, not to the whole CSV.
const rows = [];
let totalParsed = 0;
for (let i = 1; i < lines.length; i++) {
  const vals = parseCsvLine(lines[i]);
  totalParsed++;
  if ((vals[regionIdx] || '').trim().toUpperCase() !== 'SNB') continue;
  const obj = {};
  for (let j = 0; j < headers.length; j++) obj[headers[j]] = vals[j] ?? '';
  rows.push(obj);
}
console.log(`Parsed ${totalParsed.toLocaleString()} total rows`);
console.log(`SNB rows: ${rows.length.toLocaleString()}`);
if (!rows.length) {
  console.error('No SNB rows found -- check Region_for_Sales values.');
  process.exit(1);
}

// --- Daily aggregates (submissions/init/final on submitted date; book/val on booking date) ---
const days = {};
const bucket = d => days[d] || (days[d] = { sub: 0, init: 0, final: 0, book: 0, val: 0 });
let pendingFinalApproval = 0;
rows.forEach(r => {
  const status = String(r['Altitudestatus'] || '');
  if (status === 'Pending Final Approval') pendingFinalApproval++;
  const sd = toYMD(r['submitted']);
  if (sd) {
    const b = bucket(sd);
    b.sub++;
    if (r['Approvalflag'] === 'Y') b.init++;
    if (r['FinalApprovalFlag'] === 'Y') b.final++;
  }
  if (BOOKED_SET.has(status)) {
    const bd = toYMD(r[CONFIG.bookCol]);
    if (bd) {
      const b = bucket(bd);
      b.book++;
      b.val += parseFloat(r['ItemValue']) || 0;
    }
  }
});
const dates = Object.keys(days).sort();

// --- Approved, Not Yet Booked, grouped by FinalEmployerType (same logic as
// Acquisition_Command_Dashboard.html's section 07) ---
const asOf = dates[dates.length - 1];
const asOfMs = new Date(asOf + 'T00:00:00Z').getTime();
const anbStats = {}; // employerType -> {count, sumAge, paid}
let anbTotalCount = 0, anbTotalAge = 0, anbTotalPaid = 0;
rows.forEach(r => {
  const status = String(r['Altitudestatus'] || '');
  if (BOOKED_SET.has(status)) return; // already booked, not part of this bucket
  if (String(r['DE_Decision'] || '').trim() !== 'A') return; // must have cleared the decision engine
  const sd = toYMD(r['submitted']);
  if (!sd) return;
  const age = Math.round((asOfMs - new Date(sd + 'T00:00:00Z').getTime()) / 86400000);
  const paid = isPaidApp(r);
  const name = gv(r, 'FinalEmployerType');
  anbTotalCount++; anbTotalAge += age; if (paid) anbTotalPaid++;
  const s = anbStats[name] || (anbStats[name] = { count: 0, sumAge: 0, paid: 0 });
  s.count++; s.sumAge += age; if (paid) s.paid++;
});
const anbArr = Object.entries(anbStats).map(([name, s]) => ({
  name, count: s.count, avgAge: Math.round(s.sumAge / s.count), paid: s.paid, notPaid: s.count - s.paid
})).sort((a, b) => b.count - a.count);

const meta = {
  min: dates[0], max: dates[dates.length - 1], total: rows.length,
  pendingFinalApproval, asOf
};

const SNB_DATA = {
  meta, dates, days,
  approvedNotBooked: {
    top: anbArr,
    totals: { count: anbTotalCount, avgAge: anbTotalCount ? Math.round(anbTotalAge / anbTotalCount) : 0, paid: anbTotalPaid, notPaid: anbTotalCount - anbTotalPaid },
    employerTypeCount: anbArr.length
  }
};

console.log('Meta:', JSON.stringify(meta));
console.log('Approved-Not-Booked totals:', JSON.stringify(SNB_DATA.approvedNotBooked.totals));

// --- Write / update SNB_Overview.html ---
const dataLine = `const SNB_DATA = ${JSON.stringify(SNB_DATA)};`;

if (fs.existsSync(HTML_OUT)) {
  let html = fs.readFileSync(HTML_OUT, 'utf-8');
  const marker = 'const SNB_DATA = ';
  const idx = html.indexOf(marker);
  if (idx === -1) { console.error('Could not find SNB_DATA marker in existing SNB_Overview.html'); process.exit(1); }
  const lineStart = html.lastIndexOf('\n', idx) + 1;
  const lineEnd = html.indexOf('\n', idx);
  html = html.slice(0, lineStart) + dataLine + html.slice(lineEnd);
  fs.writeFileSync(HTML_OUT, html, 'utf-8');
  console.log('✅ SNB_Overview.html data refreshed.');
} else {
  const template = buildTemplate(dataLine);
  fs.writeFileSync(HTML_OUT, template, 'utf-8');
  console.log('✅ SNB_Overview.html created.');
}

function buildTemplate(dataLine) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tasheel · SNB Overview</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/chartjs-plugin-datalabels/2.2.0/chartjs-plugin-datalabels.min.js"></script>
<style>
:root{--bg:#eef1f7;--panel:#fff;--panel2:#f5f7fb;--line:rgba(30,45,75,.10);--line2:rgba(30,45,75,.17);
 --ink:#141c2b;--ink2:#3a475e;--muted:#5b6b83;--faint:#8493a8;
 --cyan:#0e9e90;--cyan-d:#0b7d72;--gold:#bd7d12;--gold-d:#9a6410;--green:#22b571;--red:#d1493f;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:'Inter',system-ui,sans-serif}
h1,h2,h3{font-family:'Space Grotesk',sans-serif;margin:0}
header{padding:18px 26px;display:flex;align-items:center;gap:12px;background:var(--panel);border-bottom:1px solid var(--line)}
header .t{font-weight:700;font-size:16px}header .s{font-size:11px;color:var(--muted)}
header a{color:var(--cyan-d);text-decoration:none;font-size:12px;margin-left:auto}
main{max-width:1100px;margin:0 auto;padding:22px 20px 60px}
.sec-h{margin:26px 0 12px}.sec-h h2{font-size:16px}.sec-h .hint{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 1px 2px rgba(20,30,50,.04)}
.card .lab{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.card .big{font-family:'Space Grotesk';font-weight:700;font-size:22px;margin-top:4px}
.note-block{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 1px 2px rgba(20,30,50,.04)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:800px){.two{grid-template-columns:1fr}}
.chart-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.chart-card h3{font-size:13.5px;margin-bottom:8px}
.cwrap{height:260px}
table.dt{width:100%;border-collapse:collapse;font-size:12.5px}
table.dt th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--line2)}
table.dt td{padding:7px 8px;border-bottom:1px solid var(--line)}
table.dt td.num{text-align:right;font-variant-numeric:tabular-nums}
.faint{color:var(--faint);font-size:11px}
.foot{text-align:center;color:var(--faint);font-size:11px;font-family:'JetBrains Mono';padding:24px}
.foot a{color:var(--cyan-d);text-decoration:none}
</style></head>
<body>
<header>
 <div><div class="t">SNB Overview</div><div class="s">Acquisition_for_Loans · Region_for_Sales = SNB</div></div>
 <a href="index.html">← Command Center</a>
</header>
<main>
 <div class="sec-h"><h2>Core KPIs</h2><span class="hint" id="kpi-hint"></span></div>
 <div class="grid" id="kpi-grid"></div>

 <div class="sec-h"><h2>Daily Booking Count</h2><span class="hint">current month · today excluded</span></div>
 <div class="two">
   <div class="chart-card"><h3>Daily booking count</h3><div class="cwrap"><canvas id="c-daily-book"></canvas></div></div>
   <div class="chart-card"><h3>Daily booking count table</h3><p class="faint" id="daily-book-cap"></p><div style="max-height:260px;overflow-y:auto" id="daily-book-table"></div></div>
 </div>

 <div class="sec-h"><h2>Approved, Not Yet Booked</h2><span class="hint">cleared the credit decision engine but never converted to a booked loan — grouped by Employer Type (column N, FinalEmployerType), same logic as Acquisition_Command_Dashboard.html</span></div>
 <div class="note-block"><div id="anb-block"></div></div>
</main>
<div class="foot">Built for <a href="https://www.linkedin.com/in/emadayyash" target="_blank">Emad Ayyash</a> · Tasheel Finance</div>
<script>
${dataLine}
const fmt=n=>n==null?'—':n.toLocaleString('en-US');
const money=n=>n==null?'—':'SAR '+Math.round(n).toLocaleString('en-US');
const pct1=n=>n==null||!isFinite(n)?'—':(n*100).toFixed(1)+'%';
const prettyD=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1,d)).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});};
const prettyDLong=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1,d)).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});};
const isKsaWeekend=s=>{const [y,m,d]=s.split('-').map(Number);const dow=new Date(Date.UTC(y,m-1,d)).getUTCDay();return dow===5||dow===6;};

function renderKPI(){
  let sub=0,init=0,final=0,book=0,val=0;
  SNB_DATA.dates.forEach(d=>{const k=SNB_DATA.days[d];sub+=k.sub;init+=k.init;final+=k.final;book+=k.book;val+=k.val;});
  const cards=[
    {lab:'Submissions',big:fmt(sub)},
    {lab:'Initial approved',big:fmt(init),sub:pct1(sub?init/sub:null)+' of submissions'},
    {lab:'Final approved',big:fmt(final),sub:pct1(init?final/init:null)+' of initial'},
    {lab:'Booked & funded',big:fmt(book),sub:pct1(sub?book/sub:null)+' of submissions'},
    {lab:'Loan value',big:money(val)},
    {lab:'Ticket size',big:money(book?val/book:0)},
    {lab:'Pending Final Approval',big:fmt(SNB_DATA.meta.pendingFinalApproval),sub:'Altitudestatus = "Pending Final Approval"'}
  ];
  document.getElementById('kpi-grid').innerHTML=cards.map(c=>
    \`<div class="card"><div class="lab">\${c.lab}</div><div class="big">\${c.big}</div>\${c.sub?'<div class="faint" style="margin-top:4px">'+c.sub+'</div>':''}</div>\`
  ).join('');
  document.getElementById('kpi-hint').textContent=\`\${prettyD(SNB_DATA.meta.min)}–\${prettyD(SNB_DATA.meta.max)} · \${fmt(SNB_DATA.meta.total)} total applications\`;
}

function renderDailyBook(){
  const monthStart=(SNB_DATA.meta.max||SNB_DATA.meta.min||'').slice(0,7)+'-01';
  const labels=[],vals=[];
  SNB_DATA.dates.forEach(d=>{if(d>=monthStart){labels.push(prettyD(d));vals.push(SNB_DATA.days[d].book);}});
  new Chart(document.getElementById('c-daily-book'),{type:'line',
    plugins:[window.ChartDataLabels].filter(Boolean),
    data:{labels,datasets:[{label:'Bookings',data:vals,borderColor:'#22b571',backgroundColor:'rgba(34,181,113,.10)',fill:true,tension:.35,pointRadius:2,pointBackgroundColor:'#22b571',borderWidth:2.2}]},
    options:{maintainAspectRatio:false,plugins:{legend:{display:false},
      datalabels:{align:'top',anchor:'end',offset:4,color:'#22b571',font:{weight:'700',size:9},formatter:v=>v>0?fmt(v):''}},
      scales:{x:{ticks:{maxRotation:0,autoSkip:true,maxTicksLimit:10,font:{size:10}}},y:{title:{display:true,text:'Bookings',font:{size:10}}}}}});
  const today=new Date().toISOString().slice(0,10);
  const rows=[];
  SNB_DATA.dates.forEach(d=>{if(d>=monthStart&&d<today){rows.push([d,SNB_DATA.days[d].book,SNB_DATA.days[d].val||0]);}});
  rows.sort((a,b)=>a[0]<b[0]?1:-1);
  let h='<table class="dt"><thead><tr><th>Report date</th><th class="num">Bookings</th><th class="num">Value (SAR)</th></tr></thead><tbody>';
  rows.forEach(([d,v,val])=>{
    const tag=isKsaWeekend(d)?' <span class="faint">(weekend)</span>':'';
    h+=\`<tr><td>\${prettyDLong(d)}\${tag}</td><td class="num">\${fmt(v)}</td><td class="num">\${fmt(Math.round(val))}</td></tr>\`;
  });
  h+='</tbody></table>';
  document.getElementById('daily-book-table').innerHTML=h;
  document.getElementById('daily-book-cap').textContent=\`since \${prettyDLong(monthStart)} · \${rows.length} rows · today excluded\`;
}

function renderANB(){
  const anb=SNB_DATA.approvedNotBooked;
  if(!anb||!anb.totals.count){document.getElementById('anb-block').innerHTML='<p class="faint">No approved-but-unbooked applications found.</p>';return;}
  let h=\`<div class="grid" style="margin-bottom:12px"><div class="card"><div class="lab">Approved, never booked (all sectors)</div><div class="big">\${fmt(anb.totals.count)}</div></div>\`+
    \`<div class="card"><div class="lab">Already paid (GOSI/MOF/SIMAH)</div><div class="big">\${fmt(anb.totals.paid)}</div></div>\`+
    \`<div class="card"><div class="lab">Avg days stale</div><div class="big">\${fmt(anb.totals.avgAge)}</div></div>\`+
    \`<div class="card"><div class="lab">As of</div><div class="big" style="font-size:16px">\${prettyD(SNB_DATA.meta.asOf)}</div></div></div>\`;
  h+=\`<p class="faint">Grouped by Employer Type (column N) · \${fmt(anb.employerTypeCount)} sector\${anb.employerTypeCount===1?'':'s'}</p>\`;
  const paidLabel=(paid,total)=>paid===0?'No':(paid===total?'Yes':\`Mixed (\${fmt(paid)}/\${fmt(total)})\`);
  h+='<table class="dt"><thead><tr><th>#</th><th>Employer Type</th><th class="num">Approved, not booked</th><th>Paid Application</th></tr></thead><tbody>';
  anb.top.forEach((c,i)=>{
    h+=\`<tr><td class="num">\${i+1}</td><td>\${c.name}</td><td class="num">\${fmt(c.count)}</td><td>\${paidLabel(c.paid,c.count)}</td></tr>\`;
  });
  h+=\`<tr style="font-weight:700"><td></td><td>Total (all sectors)</td><td class="num">\${fmt(anb.totals.count)}</td><td>\${paidLabel(anb.totals.paid,anb.totals.count)}</td></tr>\`;
  h+='</tbody></table>';
  document.getElementById('anb-block').innerHTML=h;
}

renderKPI(); renderDailyBook(); renderANB();
</script>
</body></html>
`;
}
