#!/usr/bin/env node
/**
 * Build Simah2_Call.html, a standalone single-page dashboard answering:
 * for customers who applied more than once, what changes between the 1st
 * and 2nd application that actually reached SIMAH (SMH_Score populated)?
 *
 * Replaces the earlier "tab 10" version that lived inside
 * Acquisition_Command_Dashboard.html -- moved out to its own page per
 * explicit request (2026-10-01) so it gets its own scorecard tile on
 * index.html, matching the convention every other dashboard here follows
 * (one topic, one self-contained HTML file).
 *
 * 2026-10-01 rewrite: embeds raw per-pair/per-call records (S.pairsRaw,
 * S.callsRaw from buildSimah2Analysis() in update_acquisition_dashboard.js)
 * instead of server-side-only aggregates, so the page can carry a real
 * top-of-page date-range filter -- every KPI/table/chart below recomputes
 * client-side from the filtered raw records, not fixed at build time.
 *
 * Reads the already-computed `simah2` block out of
 * Acquisition_Command_Dashboard.html's embedded DAILY_DEFAULT rather than
 * re-deriving anything from the raw CSV -- same "read a sibling
 * dashboard's output as input" pattern update_bpv.js already uses.
 *
 * Usage: node scripts/build_simah2_call.js
 * (run AFTER update_acquisition_dashboard.js, which is what actually
 * computes the simah2 block)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_HTML = path.join(ROOT, 'Acquisition_Command_Dashboard.html');
const OUT_HTML = path.join(ROOT, 'Simah2_Call.html');

if (!fs.existsSync(SRC_HTML)) {
  console.error('ERROR: Acquisition_Command_Dashboard.html not found -- run update_acquisition_dashboard.js first.');
  process.exit(1);
}

console.log('Reading simah2 block from Acquisition_Command_Dashboard.html…');
const srcHtml = fs.readFileSync(SRC_HTML, 'utf-8');
const m = srcHtml.match(/^const DAILY_DEFAULT = (.*);$/m);
if (!m) {
  console.error('ERROR: could not find DAILY_DEFAULT in Acquisition_Command_Dashboard.html.');
  process.exit(1);
}
const DD = JSON.parse(m[1]);
const S = DD.simah2;
if (!S || !S.pairsRaw) {
  console.error('ERROR: no simah2.pairsRaw block found -- rebuild Acquisition_Command_Dashboard.html with the latest update_acquisition_dashboard.js first.');
  process.exit(1);
}
console.log(`  ${S.pairsRaw.length.toLocaleString()} pairs, ${S.distinctCivilIdsWithSimah.toLocaleString()} distinct SIMAH-pulled customers, ${S.callsRaw.length.toLocaleString()} total SIMAH calls`);

const DATA = {
  meta: { generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19), sourceDate: DD.meta.max },
  distinctCivilIdsWithSimah: S.distinctCivilIdsWithSimah,
  callsRaw: S.callsRaw,
  pairsRaw: S.pairsRaw,
};

const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tasheel · 2nd SIMAH Call</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#eef1f7;--panel:#fff;--panel2:#f7f8fb;--line:rgba(30,45,75,.10);--line2:rgba(30,45,75,.17);
 --ink:#141c2b;--ink2:#3a475e;--muted:#5b6b83;--faint:#8493a8;
 --cyan:#0e9e90;--cyan-d:#0b7d72;--gold:#bd7d12;--gold-d:#9a6410;--violet:#6f5be0;--red:#c0392b;--green:#1c7d50;--blue:#2f92e6;}
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
.sec-h{display:flex;align-items:baseline;gap:10px;margin-bottom:14px;flex-wrap:wrap;justify-content:space-between}
.sec-h h2{font-size:16px;margin:0}
.sec-h .n{font-size:10px;color:var(--faint);font-family:'JetBrains Mono'}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 2px 4px rgba(20,30,50,.03)}
.card .lab{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin-bottom:6px}
.card .big{font-size:24px;font-weight:700;font-family:'Space Grotesk'}
.card .sub{font-size:11px;color:var(--faint);margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--panel);border-radius:12px;overflow:hidden;border:1px solid var(--line)}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line)}
th{background:var(--panel2);font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700}
tr:last-child td{border-bottom:none}
td.num,th.num{text-align:right;font-family:'JetBrains Mono'}
td.same{font-weight:700;color:var(--ink)}
.foot{text-align:center;color:var(--faint);font-size:11px;font-family:'JetBrains Mono';padding:22px}
.tablewrap{overflow-x:auto;max-height:520px;overflow-y:auto}
.tablewrap table{border-radius:0}
.tablewrap thead th{position:sticky;top:0;z-index:1}
.caveat{background:rgba(189,125,18,.08);border:1px solid rgba(189,125,18,.28);border-radius:12px;padding:12px 16px;font-size:12px;color:var(--ink2);margin-bottom:16px;line-height:1.55}
.caveat b{color:var(--gold-d)}
.bars{display:flex;flex-direction:column;gap:8px}
.bar-row{display:grid;grid-template-columns:70px 1fr 60px;align-items:center;gap:10px;font-size:12px}
.bar-row .lab{color:var(--ink2);font-weight:600;font-family:'JetBrains Mono'}
.bar-track{background:var(--panel2);border-radius:6px;height:18px;overflow:hidden}
.bar-fill{height:100%;border-radius:6px}
.bar-val{text-align:right;font-family:'JetBrains Mono';color:var(--ink2)}
.up{color:var(--green)}.down{color:var(--red)}
.filters{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:22px}
.filter-row{display:flex;flex-wrap:wrap;gap:14px;align-items:end}
.filter-item{display:flex;flex-direction:column;gap:5px}
.filter-item label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700}
.filter-item select,.filter-item input{padding:7px 10px;border:1px solid var(--line2);border-radius:8px;background:var(--panel2);color:var(--ink);font-family:'Inter',sans-serif;font-size:12.5px}
.presets{display:flex;gap:6px}
.presets button{appearance:none;border:1px solid var(--line2);background:var(--panel2);color:var(--ink2);font-size:11.5px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer;font-family:'Inter',sans-serif}
.presets button.on{background:var(--cyan);color:#fff;border-color:var(--cyan)}
.btn-reset,.btn-dl{padding:7px 14px;border:1px solid var(--line2);border-radius:8px;background:var(--panel2);color:var(--muted);font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif}
.btn-reset:hover,.btn-dl:hover{color:var(--ink);border-color:var(--line)}
.btn-dl{background:var(--cyan);color:#fff;border-color:var(--cyan)}
.btn-dl:hover{color:#fff;opacity:.9}
@media (max-width:640px){.kpis{grid-template-columns:repeat(2,1fr)}.bar-row{grid-template-columns:55px 1fr 45px}}
</style></head>
<body>
<header>
  <div class="hleft">
    <div class="logo"></div>
    <div class="brand"><div class="t">2nd SIMAH Call</div><div class="s">Tasheel Finance · Acquisition</div></div>
  </div>
  <a class="home-link" href="index.html">← Home</a>
</header>
<main>
<div class="hint" id="source-hint"></div>

<div class="filters">
  <div class="filter-row">
    <div class="filter-item"><label>From</label><input type="date" id="f-from"></div>
    <div class="filter-item"><label>To</label><input type="date" id="f-to"></div>
    <div class="filter-item"><label>Range</label><div class="presets" id="presets">
      <button data-r="all" class="on">All</button>
      <button data-r="30d">Last 30 days</button>
      <button data-r="90d">Last 90 days</button>
      <button data-r="mtd">This month</button>
    </div></div>
    <button class="btn-reset" id="f-reset">Reset</button>
  </div>
  <div class="hint" style="margin:10px 0 0" id="filter-hint"></div>
</div>

<div class="section">
  <div class="sec-h"><h2>Summary</h2><span class="n">customers who applied twice, both reaching SIMAH -- filtered by the 2nd call's date</span></div>
  <div class="kpis" id="kpis"></div>
  <div class="caveat" style="margin-top:14px"><p><b>What this is:</b> for every customer whose 1st AND 2nd application both reached SIMAH (SMH_Score populated), this compares application #1 against application #2 — risk grade, DBR band, SIMAH score, and (where available) the actual offer terms. Later re-applications (3rd, 4th, …) are not included — this is specifically about the <i>second</i> call.</p></div>
</div>

<div class="section">
  <div class="sec-h"><h2>Number of SIMAH calls by month</h2><span class="n">every application with SMH_Score populated, by its own submitted month</span></div>
  <div class="bars" id="call-volume-bars"></div>
</div>

<div class="section">
  <div class="sec-h"><h2>2nd-call pairs by month</h2><span class="n">by the 2nd application's submitted date</span></div>
  <div class="bars" id="pairs-bars"></div>
</div>

<div class="section">
  <div class="sec-h"><h2>Risk grade: 1st call → 2nd call</h2><span class="n" id="riskgrade-n"></span></div>
  <div class="tablewrap"><table id="riskgrade-table"></table></div>
</div>

<div class="section">
  <div class="sec-h"><h2>DBR band: 1st call → 2nd call</h2><span class="n" id="dbrband-n"></span></div>
  <div class="tablewrap"><table id="dbrband-table"></table></div>
</div>

<div class="section">
  <div class="sec-h"><h2>Offer terms: 1st call → 2nd call</h2><span class="n">only where both applications reached a real financing offer</span></div>
  <div class="tablewrap"><table id="offer-table"></table></div>
</div>

<div class="section">
  <div class="sec-h"><h2>Applications offered a different amount</h2><span style="display:flex;align-items:center;gap:10px"><span class="n" id="diff-count"></span><button class="btn-dl" id="diff-export">⬇ Export to Excel (CSV)</button></span></div>
  <div class="caveat"><p><b>Sample size:</b> this list is every application where the financing amount on the 2nd call differs from the 1st — small by construction, since the offer fields are only populated once an application reaches a real financing offer (confirmed: a small fraction of all pairs). Treat this as a worklist of specific cases, not a population-level trend; the risk-grade/DBR/SIMAH-score sections above cover the full pair population and are the more solid aggregate result. CREDIT_LIMIT was checked and excluded — it's a Cards-only column in this shared schema, always blank for loan applications.</p></div>
  <div class="tablewrap"><table id="diff-table"></table></div>
</div>

</main>
<div class="foot">Built for <a href="https://www.linkedin.com/in/emadayyash" target="_blank">Emad Ayyash</a> · Tasheel Finance</div>
<script>
const SIMAH2_DATA = ${JSON.stringify(DATA)};
function fmt(n){ return (n==null||isNaN(n))?'—':Math.round(n).toLocaleString(); }
function pct(n){ return (n==null||isNaN(n))?'—':n.toFixed(1)+'%'; }
function money(n){ return (n==null||isNaN(n))?'—':'SAR '+Math.round(n).toLocaleString(); }
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// pairsRaw row shape: [civilId, stagingId1, stagingId2, date1, date2,
//   riskGrade1, riskGrade2, dbrBand1, dbrBand2, smh1, smh2, amt1, amt2,
//   rate1, rate2, tenure1, tenure2, finBand1, finBand2]
const P = { civ:0, sid1:1, sid2:2, d1:3, d2:4, g1:5, g2:6, b1:7, b2:8, s1:9, s2:10, amt1:11, amt2:12, rate1:13, rate2:14, ten1:15, ten2:16, fb1:17, fb2:18 };

let FROM = null, TO = null;
function addDays(ymd,n){ const d=new Date(ymd+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }

function minMaxDate(){
  let mn=null, mx=null;
  SIMAH2_DATA.callsRaw.forEach(d=>{ if(!mn||d<mn)mn=d; if(!mx||d>mx)mx=d; });
  return [mn, mx];
}
const [DATA_MIN, DATA_MAX] = minMaxDate();

function filteredPairs(){
  return SIMAH2_DATA.pairsRaw.filter(p => (!FROM || p[P.d2] >= FROM) && (!TO || p[P.d2] <= TO));
}
function filteredCalls(){
  return SIMAH2_DATA.callsRaw.filter(d => (!FROM || d >= FROM) && (!TO || d <= TO));
}

function renderKpis(pairs){
  const n = pairs.length;
  let gChanged=0, bChanged=0, sUp=0, sDown=0, sSame=0, sN=0, sSum=0, offerN=0;
  pairs.forEach(p=>{
    if(p[P.g1]!==p[P.g2]) gChanged++;
    if(p[P.b1]!==p[P.b2]) bChanged++;
    if(p[P.s1]!=null && p[P.s2]!=null){ sN++; sSum += (p[P.s2]-p[P.s1]); if(p[P.s2]>p[P.s1])sUp++; else if(p[P.s2]<p[P.s1])sDown++; else sSame++; }
    if(p[P.amt1]!=null && p[P.amt2]!=null) offerN++;
  });
  const diffCount = pairs.filter(p=>p[P.amt1]!=null && p[P.amt2]!=null && p[P.amt1]!==p[P.amt2]).length;
  const items = [
    ['Pairs (2nd call reached)', fmt(n), fmt(SIMAH2_DATA.distinctCivilIdsWithSimah)+' distinct SIMAH-pulled customers (all time)'],
    ['Risk grade changed', n?pct(100*gChanged/n):'—', fmt(gChanged)+' of '+fmt(n)+' pairs'],
    ['DBR band changed', n?pct(100*bChanged/n):'—', fmt(bChanged)+' of '+fmt(n)+' pairs'],
    ['SIMAH score, avg change', (sN?((sSum/sN>=0?'+':'')+(sSum/sN).toFixed(1)):'—'), fmt(sDown)+' down · '+fmt(sUp)+' up · '+fmt(sSame)+' same'],
    ['Offered a different amount', fmt(diffCount), n?pct(100*offerN/n)+' of pairs reached a real offer both times':'—'],
  ];
  document.getElementById('kpis').innerHTML = items.map(([lab,big,sub])=>
    '<div class="card"><div class="lab">'+esc(lab)+'</div><div class="big">'+big+'</div><div class="sub">'+esc(sub)+'</div></div>').join('');
}

function renderBars(containerId, rows){
  const max = Math.max(1, ...rows.map(r=>r[1]));
  document.getElementById(containerId).innerHTML = rows.map(([month,val])=>{
    const w = Math.max(2, Math.round(100*val/max));
    return '<div class="bar-row"><div class="lab">'+esc(month)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+w+'%;background:var(--cyan)"></div></div><div class="bar-val">'+fmt(val)+'</div></div>';
  }).join('') || '<p class="hint">No data in this range.</p>';
}
function monthlyCounts(dates){
  const m = {};
  dates.forEach(d=>{ const k=d.slice(0,7); m[k]=(m[k]||0)+1; });
  return Object.keys(m).sort().map(k=>[k,m[k]]);
}

function transitionTable(pairs, idx1, idx2, grades){
  const t = {};
  pairs.forEach(p=>{ const from=p[idx1], to=p[idx2]; const f=t[from]||(t[from]={}); f[to]=(f[to]||0)+1; });
  let h = '<thead><tr><th>1st call \\\\ 2nd call</th>' + grades.map(g=>'<th class="num">'+esc(g)+'</th>').join('') + '<th class="num">Total</th></tr></thead><tbody>';
  grades.forEach(from=>{
    const row = t[from] || {};
    let rowTot = 0; grades.forEach(g=>rowTot += (row[g]||0));
    h += '<tr><td>'+esc(from)+'</td>' + grades.map(to=>{
      const v = row[to]||0, same = to===from;
      return '<td class="num'+(same?' same':'')+'">'+(v?fmt(v):'—')+'</td>';
    }).join('') + '<td class="num" style="font-weight:600">'+fmt(rowTot)+'</td></tr>';
  });
  h += '</tbody>';
  return h;
}

function offerStat(pairs, aIdx, bIdx){
  let n=0, up=0, down=0, same=0, sum=0;
  pairs.forEach(p=>{
    const a=p[aIdx], b=p[bIdx];
    if(a==null || b==null) return;
    n++; if(b>a)up++; else if(b<a)down++; else same++; sum += (b-a);
  });
  return {n,up,down,same,sumDelta:sum};
}
function renderOfferTable(pairs){
  const fields = [
    ['Financing amount', offerStat(pairs, P.amt1, P.amt2), 'money'],
    ['Profit rate', offerStat(pairs, P.rate1, P.rate2), 'pct'],
    ['Tenure', offerStat(pairs, P.ten1, P.ten2), 'mo'],
  ];
  let h = '<thead><tr><th>Field</th><th class="num">n</th><th class="num">Up</th><th class="num">Down</th><th class="num">Same</th><th class="num">Avg change</th></tr></thead><tbody>';
  fields.forEach(([lab,o,kind])=>{
    if(!o.n){ h += '<tr><td>'+esc(lab)+'</td><td class="num">0</td><td class="num" colspan="4">no matching pairs</td></tr>'; return; }
    const avgD = o.sumDelta/o.n;
    const fmtD = kind==='money'?money(avgD):kind==='pct'?(avgD.toFixed(2)+' pp'):(avgD.toFixed(1)+' mo');
    h += '<tr><td>'+esc(lab)+'</td><td class="num">'+fmt(o.n)+'</td><td class="num">'+fmt(o.up)+'</td><td class="num">'+fmt(o.down)+'</td><td class="num">'+fmt(o.same)+'</td><td class="num" style="font-weight:600">'+(avgD>=0?'+':'')+fmtD+'</td></tr>';
  });
  let fbN=0, fbChanged=0, fbSame=0;
  pairs.forEach(p=>{ if(p[P.fb1]!=null && p[P.fb2]!=null){ fbN++; if(p[P.fb1]!==p[P.fb2])fbChanged++; else fbSame++; } });
  h += '<tr><td>FinBand (category)</td><td class="num">'+fmt(fbN)+'</td><td class="num" colspan="3">'+fmt(fbChanged)+' changed · '+fmt(fbSame)+' same</td><td class="num" style="font-weight:600">'+(fbN?pct(100*fbChanged/fbN):'—')+' changed</td></tr>';
  h += '</tbody>';
  document.getElementById('offer-table').innerHTML = h;
}

function diffApps(pairs){
  return pairs
    .filter(p => p[P.amt1]!=null && p[P.amt2]!=null && p[P.amt1]!==p[P.amt2])
    .map(p => ({ civilId:p[P.civ], sid1:p[P.sid1], sid2:p[P.sid2], date1:p[P.d1], date2:p[P.d2], amount1:p[P.amt1], amount2:p[P.amt2], delta:p[P.amt2]-p[P.amt1] }))
    .sort((a,b) => b.delta - a.delta || a.date2.localeCompare(b.date2));
}
let CURRENT_DIFF = [];
function renderDiffTable(pairs){
  const apps = diffApps(pairs);
  CURRENT_DIFF = apps;
  document.getElementById('diff-count').textContent = fmt(apps.length) + ' applications';
  let h = '<thead><tr><th>Civil ID</th><th>1st Staging ID</th><th>2nd Staging ID</th><th>1st date</th><th>2nd date</th><th class="num">1st amount</th><th class="num">2nd amount</th><th class="num">Change</th></tr></thead><tbody>';
  apps.forEach(a=>{
    const cls = a.delta>=0 ? 'up' : 'down';
    h += '<tr><td>'+esc(a.civilId)+'</td><td>'+esc(a.sid1)+'</td><td>'+esc(a.sid2)+'</td><td>'+esc(a.date1)+'</td><td>'+esc(a.date2)+'</td><td class="num">'+money(a.amount1)+'</td><td class="num">'+money(a.amount2)+'</td><td class="num '+cls+'">'+(a.delta>=0?'+':'')+money(a.delta)+'</td></tr>';
  });
  h += '</tbody>';
  document.getElementById('diff-table').innerHTML = h;
}

function exportDiffCsv(){
  const header = ['Civil ID','1st Staging ID','2nd Staging ID','1st date','2nd date','1st amount (SAR)','2nd amount (SAR)','Change (SAR)'];
  const esc2 = v => { const s = String(v==null?'':v); return /[",\\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const lines = [header.join(',')];
  CURRENT_DIFF.forEach(a => lines.push([a.civilId,a.sid1,a.sid2,a.date1,a.date2,a.amount1,a.amount2,a.delta].map(esc2).join(',')));
  const blob = new Blob([lines.join('\\n')], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'simah2_different_offer_amount' + (FROM||TO ? ('_'+(FROM||DATA_MIN)+'_to_'+(TO||DATA_MAX)) : '') + '.csv';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
document.getElementById('diff-export').addEventListener('click', exportDiffCsv);

function renderAll(){
  const pairs = filteredPairs(), calls = filteredCalls();
  document.getElementById('filter-hint').textContent = 'Showing ' + (FROM||DATA_MIN) + ' → ' + (TO||DATA_MAX) + ' · ' + fmt(pairs.length) + ' pairs, ' + fmt(calls.length) + ' SIMAH calls in range';
  renderKpis(pairs);
  renderBars('call-volume-bars', monthlyCounts(calls));
  renderBars('pairs-bars', monthlyCounts(pairs.map(p=>p[P.d2])));
  const riskGrades = ['L','M','H','Unknown'];
  document.getElementById('riskgrade-n').textContent = 'SC_RiskGrade transition, ' + fmt(pairs.length) + ' pairs in range';
  document.getElementById('riskgrade-table').innerHTML = transitionTable(pairs, P.g1, P.g2, riskGrades);
  const dbrBands = ['<=20%','>20-<=30%','>30-<=40%','>40-<=45%','>45-<=50%','>50-<=55%','>55-<=60%','>60-<=65%','>65%','Unknown'];
  document.getElementById('dbrband-n').textContent = 'CurrentDBRBand transition, ' + fmt(pairs.length) + ' pairs in range';
  document.getElementById('dbrband-table').innerHTML = transitionTable(pairs, P.b1, P.b2, dbrBands);
  renderOfferTable(pairs);
  renderDiffTable(pairs);
}

function applyPreset(r){
  if(r==='all'){FROM=null;TO=null;}
  else if(r==='30d'){FROM=addDays(DATA_MAX,-29);TO=DATA_MAX;}
  else if(r==='90d'){FROM=addDays(DATA_MAX,-89);TO=DATA_MAX;}
  else if(r==='mtd'){FROM=DATA_MAX.slice(0,8)+'01';TO=DATA_MAX;}
  document.getElementById('f-from').value=FROM||DATA_MIN;
  document.getElementById('f-to').value=TO||DATA_MAX;
  document.querySelectorAll('#presets button').forEach(b=>b.classList.toggle('on',b.dataset.r===r));
  renderAll();
}
document.querySelectorAll('#presets button').forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.r)));
document.getElementById('f-from').addEventListener('change',()=>{FROM=document.getElementById('f-from').value||null;document.querySelectorAll('#presets button').forEach(x=>x.classList.remove('on'));renderAll();});
document.getElementById('f-to').addEventListener('change',()=>{TO=document.getElementById('f-to').value||null;document.querySelectorAll('#presets button').forEach(x=>x.classList.remove('on'));renderAll();});
document.getElementById('f-reset').addEventListener('click',()=>applyPreset('all'));

document.getElementById('source-hint').textContent = 'Source data through ' + SIMAH2_DATA.meta.sourceDate + ' · generated ' + SIMAH2_DATA.meta.generatedAt;
document.getElementById('f-from').min = DATA_MIN; document.getElementById('f-from').max = DATA_MAX;
document.getElementById('f-to').min = DATA_MIN; document.getElementById('f-to').max = DATA_MAX;
applyPreset('all');
</script>
</body></html>
`;

fs.writeFileSync(OUT_HTML, html, 'utf-8');
console.log(`✅ Simah2_Call.html written — ${S.pairsRaw.length.toLocaleString()} pairs, ${S.callsRaw.length.toLocaleString()} total SIMAH calls (all embedded for client-side date filtering).`);
