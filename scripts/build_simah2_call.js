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
 * Reads the already-computed `simah2` block out of
 * Acquisition_Command_Dashboard.html's embedded DAILY_DEFAULT (built by
 * buildSimah2Analysis() in update_acquisition_dashboard.js) rather than
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
if (!S || !S.pairCount) {
  console.error('ERROR: no simah2 block found -- rebuild Acquisition_Command_Dashboard.html with the latest update_acquisition_dashboard.js first.');
  process.exit(1);
}
console.log(`  ${S.pairCount.toLocaleString()} pairs, ${S.distinctCivilIdsWithSimah.toLocaleString()} distinct SIMAH-pulled customers, ${S.differentOfferApps.length.toLocaleString()} apps with a different offer amount`);

const DATA = {
  meta: { generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19), sourceDate: DD.meta.max },
  simah2: S,
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
.sec-h{display:flex;align-items:baseline;gap:10px;margin-bottom:14px;flex-wrap:wrap}
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

<div class="section">
  <div class="sec-h"><h2>Summary</h2><span class="n">customers who applied twice, both reaching SIMAH</span></div>
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
  <div class="sec-h"><h2>Applications offered a different amount</h2><span class="n" id="diff-count"></span></div>
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

const S = SIMAH2_DATA.simah2;
document.getElementById('source-hint').textContent = 'Source data through ' + SIMAH2_DATA.meta.sourceDate + ' · generated ' + SIMAH2_DATA.meta.generatedAt;

function renderKpis(){
  const offerPct = S.pairCount ? (100*S.offer.FIN_AMOUNT.n/S.pairCount) : 0;
  const items = [
    ['Pairs (2nd call reached)', fmt(S.pairCount), fmt(S.distinctCivilIdsWithSimah)+' distinct SIMAH-pulled customers'],
    ['Risk grade changed', pct(100*S.riskGrade.changed/S.pairCount), fmt(S.riskGrade.changed)+' of '+fmt(S.pairCount)+' pairs'],
    ['DBR band changed', pct(100*S.dbrBand.changed/S.pairCount), fmt(S.dbrBand.changed)+' of '+fmt(S.pairCount)+' pairs'],
    ['SIMAH score, avg change', (S.smhScore.n?((S.smhScore.sumDelta/S.smhScore.n>=0?'+':'')+(S.smhScore.sumDelta/S.smhScore.n).toFixed(1)):'—'), fmt(S.smhScore.down)+' down · '+fmt(S.smhScore.up)+' up · '+fmt(S.smhScore.same)+' same'],
    ['Offered a different amount', fmt(S.differentOfferApps.length), pct(offerPct)+' of pairs reached a real offer both times'],
  ];
  document.getElementById('kpis').innerHTML = items.map(([lab,big,sub])=>
    '<div class="card"><div class="lab">'+esc(lab)+'</div><div class="big">'+big+'</div><div class="sub">'+esc(sub)+'</div></div>').join('');
}

function renderBars(containerId, rows, valueKey, color, label){
  const max = Math.max(1, ...rows.map(r=>r[valueKey]));
  document.getElementById(containerId).innerHTML = rows.map(r=>{
    const w = Math.max(2, Math.round(100*r[valueKey]/max));
    return '<div class="bar-row"><div class="lab">'+esc(r.month)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+w+'%;background:'+color+'"></div></div><div class="bar-val">'+fmt(r[valueKey])+'</div></div>';
  }).join('') || '<p class="hint">No data.</p>';
}

function transitionTable(t, grades){
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

function renderOfferTable(){
  const rows = [
    ['Financing amount', S.offer.FIN_AMOUNT, 'money'],
    ['Profit rate', S.offer.PROFIT_RATE, 'pct'],
    ['Tenure', S.offer.TENURE, 'mo'],
  ];
  let h = '<thead><tr><th>Field</th><th class="num">n</th><th class="num">Up</th><th class="num">Down</th><th class="num">Same</th><th class="num">Avg change</th></tr></thead><tbody>';
  rows.forEach(([lab,o,kind])=>{
    if(!o || !o.n){ h += '<tr><td>'+esc(lab)+'</td><td class="num">0</td><td class="num" colspan="4">no matching pairs</td></tr>'; return; }
    const avgD = o.sumDelta/o.n;
    const fmtD = kind==='money'?money(avgD):kind==='pct'?(avgD.toFixed(2)+' pp'):(avgD.toFixed(1)+' mo');
    h += '<tr><td>'+esc(lab)+'</td><td class="num">'+fmt(o.n)+'</td><td class="num">'+fmt(o.up)+'</td><td class="num">'+fmt(o.down)+'</td><td class="num">'+fmt(o.same)+'</td><td class="num" style="font-weight:600">'+(avgD>=0?'+':'')+fmtD+'</td></tr>';
  });
  const fb = S.finBand;
  h += '<tr><td>FinBand (category)</td><td class="num">'+fmt(fb.n)+'</td><td class="num" colspan="3">'+fmt(fb.changed)+' changed · '+fmt(fb.same)+' same</td><td class="num" style="font-weight:600">'+(fb.n?pct(100*fb.changed/fb.n):'—')+' changed</td></tr>';
  h += '</tbody>';
  document.getElementById('offer-table').innerHTML = h;
}

function renderDiffTable(){
  const apps = S.differentOfferApps;
  document.getElementById('diff-count').textContent = fmt(apps.length) + ' applications';
  let h = '<thead><tr><th>Civil ID</th><th>1st Staging ID</th><th>2nd Staging ID</th><th>1st date</th><th>2nd date</th><th class="num">1st amount</th><th class="num">2nd amount</th><th class="num">Change</th></tr></thead><tbody>';
  apps.forEach(a=>{
    const cls = a.delta>=0 ? 'up' : 'down';
    h += '<tr><td>'+esc(a.civilId)+'</td><td>'+esc(a.stagingId1)+'</td><td>'+esc(a.stagingId2)+'</td><td>'+esc(a.date1)+'</td><td>'+esc(a.date2)+'</td><td class="num">'+money(a.amount1)+'</td><td class="num">'+money(a.amount2)+'</td><td class="num '+cls+'">'+(a.delta>=0?'+':'')+money(a.delta)+'</td></tr>';
  });
  h += '</tbody>';
  document.getElementById('diff-table').innerHTML = h;
}

renderKpis();
renderBars('call-volume-bars', S.monthlyCallVolumeTrend, 'calls', 'var(--cyan)');
renderBars('pairs-bars', S.monthlyTrend, 'pairs', 'var(--violet)');
const riskGrades = ['L','M','H','Unknown'];
document.getElementById('riskgrade-n').textContent = 'SC_RiskGrade transition, all ' + fmt(S.pairCount) + ' pairs';
document.getElementById('riskgrade-table').innerHTML = transitionTable(S.riskGrade.transitions, riskGrades);
const dbrBands = Object.keys(S.dbrBand.transitions).sort();
document.getElementById('dbrband-n').textContent = 'CurrentDBRBand transition, all ' + fmt(S.pairCount) + ' pairs';
document.getElementById('dbrband-table').innerHTML = transitionTable(S.dbrBand.transitions, dbrBands);
renderOfferTable();
renderDiffTable();
</script>
</body></html>
`;

fs.writeFileSync(OUT_HTML, html, 'utf-8');
console.log(`✅ Simah2_Call.html written — ${S.pairCount.toLocaleString()} pairs, ${S.differentOfferApps.length.toLocaleString()} apps with a different offer amount.`);
