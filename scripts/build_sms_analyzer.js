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
 * Usage: node scripts/build_sms_analyzer.js "<path to SMS_Campaign_*.xlsx>"
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const HTML_FILE = path.join(ROOT, 'SMS_Analyzer.html');
const BOOKED_SET = new Set(['Completed [C]', 'Pending Final Approval']);

const filePath = process.argv[2];
if (!filePath || !fs.existsSync(filePath)) {
  console.error('Usage: node scripts/build_sms_analyzer.js "<path to SMS_Campaign_*.xlsx>"');
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

// --- Per-campaign breakdown ---
const campaigns = {};
const overall = { submitted: 0, submittedToMaster: 0, approved: 0, booked: 0, bookedAmount: 0, cancelled: 0, declined: 0 };
raw.forEach(r => {
  const c = String(r.CampaignName || 'Unknown').trim() || 'Unknown';
  if (!campaigns[c]) campaigns[c] = { submitted: 0, submittedToMaster: 0, approved: 0, booked: 0, bookedAmount: 0, cancelled: 0, declined: 0, byDate: {}, statusBreakdown: {} };
  const b = campaigns[c];
  const status = String(r.Status_In_Master || '').trim();
  const amount = parseFloat(r.Amount) || 0;

  b.submitted++; overall.submitted++;
  if (r.SubmittedToMaster) { b.submittedToMaster++; overall.submittedToMaster++; }
  if (r.FinalApprovalFlag === 'Y') { b.approved++; overall.approved++; }
  if (BOOKED_SET.has(status)) { b.booked++; b.bookedAmount += amount; overall.booked++; overall.bookedAmount += amount; }
  if (status === 'Cancelled [X]') { b.cancelled++; overall.cancelled++; }
  if (status === 'Declined [D]') { b.declined++; overall.declined++; }

  const dd = excelSerialToYMD(r.SMS_Delivered_Date);
  if (dd) b.byDate[dd] = (b.byDate[dd] || 0) + 1;
  const stKey = status || '(not submitted to master)';
  b.statusBreakdown[stKey] = (b.statusBreakdown[stKey] || 0) + 1;
});

console.log('Per-campaign breakdown:');
Object.entries(campaigns).forEach(([name, b]) => {
  console.log(`  ${name}: submitted=${b.submitted} toMaster=${b.submittedToMaster} approved=${b.approved} booked=${b.booked} (SAR ${Math.round(b.bookedAmount).toLocaleString()})`);
});

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
  },
  overall,
  campaigns,
  summaryTrend,
};

// --- Render page ---
const html = buildHtml(SMS_DATA);
fs.writeFileSync(HTML_FILE, html, 'utf-8');
console.log(`✅ SMS_Analyzer.html written — ${Object.keys(campaigns).length} campaigns, ${raw.length.toLocaleString()} rows.`);

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
#login-gate{position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:20px}
#login-gate .box{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:32px 30px;max-width:380px;width:100%;box-shadow:0 10px 40px -12px rgba(20,30,50,.25);text-align:center}
#login-gate .logo{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,var(--gold),var(--gold-d));margin:0 auto 14px}
#login-gate h1{font-size:17px;margin:0 0 4px;color:var(--ink)}
#login-gate p{font-size:12.5px;color:var(--muted);margin:0 0 20px}
#login-gate input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--line2);border-radius:9px;background:var(--panel2);color:var(--ink);font-family:'Space Grotesk',sans-serif;font-size:13.5px;margin-bottom:10px}
#login-gate input:focus{outline:none;border-color:var(--cyan)}
#login-gate button{width:100%;padding:10px 12px;border:none;border-radius:9px;background:linear-gradient(var(--gold),var(--gold-d));color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:'Space Grotesk',sans-serif}
#login-gate .err{color:#c0392b;font-size:12px;margin-top:10px;display:none}
#login-gate.hidden{display:none}
body.gate-locked>*:not(#login-gate){display:none!important}
</style></head>
<body class="gate-locked">
<div id="login-gate">
  <div class="box">
    <div class="logo"></div>
    <h1>SMS Analyzer</h1>
    <p>Enter your Tasheel Finance email to view this dashboard.</p>
    <input type="email" id="gate-email" placeholder="Enter your email" autocomplete="email">
    <button id="gate-btn">Continue</button>
    <div class="err" id="gate-err">That email isn't on the access list. Contact Emad Ayyash for access.</div>
  </div>
</div>
<script>
(function(){
  var ALLOWED=['emad.ayyash@tasheelfinance.com','muhammad.akram@tasheelfinance.com','omar.hassan@tasheelfinance.com','mostafa.ashour@tasheelfinance.com','abdallah.elmasry@tasheelfinance.com','partha.dev@tasheelfinance.com','imad_ayyash@hotmail.com','ali.jaber@tasheelfinance.com','ali.abdelmuhsin@tasheelfinance.com'];
  var LSKEY='tasheel_sms_gate_email';
  function unlock(){document.body.classList.remove('gate-locked');document.getElementById('login-gate').classList.add('hidden');}
  function tryEmail(raw){
    var e=(raw||'').trim().toLowerCase();
    if(ALLOWED.indexOf(e)!==-1){try{localStorage.setItem(LSKEY,e);}catch(err){}unlock();return true;}
    return false;
  }
  var saved=null;
  try{saved=localStorage.getItem(LSKEY);}catch(err){}
  if(saved && tryEmail(saved)){/* unlocked */}
  document.getElementById('gate-btn').addEventListener('click',function(){
    var val=document.getElementById('gate-email').value;
    if(!tryEmail(val)){document.getElementById('gate-err').style.display='block';}
  });
  document.getElementById('gate-email').addEventListener('keydown',function(e){
    if(e.key==='Enter')document.getElementById('gate-btn').click();
  });
})();
</script>
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
  <div class="sec-h"><h2>Overall</h2><span class="n">this export</span></div>
  <div class="kpis" id="overall-kpis"></div>
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
  const o = d.overall;
  const rate = o.submitted ? (o.booked/o.submitted*100) : 0;
  const toMasterRate = o.submitted ? (o.submittedToMaster/o.submitted*100) : 0;
  const kpis = [
    ['Applications Created', fmt(o.submitted), 'from SMS click-through'],
    ['Submitted to Master', fmt(o.submittedToMaster), pct(toMasterRate)+' of created'],
    ['Final Approved', fmt(o.approved), 'FinalApprovalFlag = Y'],
    ['Booked', fmt(o.booked), pct(rate)+' of created'],
    ['Booked Value', money(o.bookedAmount), 'total ItemValue'],
    ['Cancelled', fmt(o.cancelled), ''],
  ];
  document.getElementById('overall-kpis').innerHTML = kpis.map(([lab,big,sub])=>
    \`<div class="card"><div class="lab">\${lab}</div><div class="big">\${big}</div><div class="sub">\${sub}</div></div>\`
  ).join('');

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
}
render();
</script>
</body></html>
`;
}

module.exports = { buildHtml };
