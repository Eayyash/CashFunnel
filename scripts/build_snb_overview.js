#!/usr/bin/env node
/**
 * Build SNB_Overview.html -- a FULL CLONE of Acquisition_Command_Dashboard.html
 * (all 7 tabs: Summary, Performance, Credit & Risk, Sales & Geography, Notes
 * & Quality, Demographic, Approved Criteria), scoped to the SNB sales channel
 * (Region_for_Sales === 'SNB', column CJ) which is excluded from the main
 * dashboard per explicit request 2026-09-13.
 *
 * Scope decision (2026-09-13): an initial lighter "core KPI scorecard"
 * version was built and shipped first, then the user asked for the full
 * 7-tab clone instead -- see git history. Rather than hand-write a second,
 * parallel copy of Acquisition_Command_Dashboard.html's ~2,000 lines of
 * chart/tab/drill-down JS (a huge duplication-of-logic risk), this reuses
 * the EXACT SAME engine: buildDashboardArtifact() was extracted out of
 * update_acquisition_dashboard.js into a reusable, exported function (see
 * that file) that aggregates a rows array into DAILY_DEFAULT + RAWSTORE and
 * injects both into any target HTML file carrying those two markers.
 *
 * This script:
 *  1. Reads the current Acquisition_Command_Dashboard.html and strips its
 *     embedded DAILY_DEFAULT/RAWSTORE data back to empty placeholders,
 *     re-labels the visible branding (title/header text) from "Acquisition
 *     Command" to "SNB Overview", and writes that as SNB_Overview.html's
 *     shell -- done fresh on every run, so SNB_Overview.html always tracks
 *     whatever tabs/charts/features the main dashboard currently has.
 *  2. Calls the SAME buildDashboardArtifact() used for the main dashboard,
 *     fed only the SNB rows, to fill that shell with real data.
 *
 * Usage: node scripts/build_snb_overview.js [path-to-merged-csv]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAIN_HTML = path.join(ROOT, 'Acquisition_Command_Dashboard.html');
const SNB_HTML = path.join(ROOT, 'SNB_Overview.html');
const DEFAULT_CSV = path.join(ROOT, 'Acquisition_for_Loans_all_merged.csv');
const filePath = process.argv[2] || DEFAULT_CSV;

const { buildDashboardArtifact, readCsv } = require('./update_acquisition_dashboard.js');

// --- Read the merged CSV once, upfront -- used both for the SNB filter
// below (Step 2) and the Civil ID reconciliation table (Step 1b), so this
// only reads the 850K+ row file once per run instead of twice. ---
console.log(`Reading ${path.basename(filePath)}…`);
const allRows = readCsv(filePath);
console.log(`Parsed ${allRows.length.toLocaleString()} total rows`);

// --- Step 1: rebuild SNB_Overview.html's shell from the CURRENT main dashboard ---
console.log('Rebuilding SNB_Overview.html shell from Acquisition_Command_Dashboard.html…');
let shell = fs.readFileSync(MAIN_HTML, 'utf-8');

// Reset the two data blobs to empty placeholders -- buildDashboardArtifact()
// finds these exact markers and replaces the whole line, so what's here
// between builds doesn't matter as long as the marker text matches.
shell = shell.replace(
  /const DAILY_DEFAULT = \{[\s\S]*?\};(\r?\n)/,
  'const DAILY_DEFAULT = {meta:{min:null,max:null,total:0,name:"",pendingFinalApproval:0},dates:[],days:{}};$1'
);
shell = shell.replace(
  /const RAWSTORE = \{[\s\S]*?\};(\r?\n)/,
  'const RAWSTORE = {n:0,dates:[],vocab:{},header:{},b64:""};$1'
);

// Re-label visible branding (title tag, main heading, header sub-brand) --
// everything else (tabs, charts, filters, drill-downs) stays byte-identical
// to the main dashboard, which is the whole point of cloning it this way.
shell = shell.replace('<title>Tasheel · Acquisition Command</title>', '<title>Tasheel · SNB Overview</title>');
shell = shell.replace('<h1>Acquisition Command</h1>', '<h1>SNB Overview</h1>');
shell = shell.replace(
  '<div class="t">Acquisition Command</div><div class="s">Tasheel Finance · Tawarruq Cash</div>',
  '<div class="t">SNB Overview</div><div class="s">Tasheel Finance · Region_for_Sales = SNB</div>'
);

// --- SNB-only "Customer Info" tab (added 2026-09-16, per explicit request) ---
// Injected into the cloned shell every run, AFTER the clone-from-main-
// dashboard step above -- this tab exists ONLY on SNB_Overview.html, never
// on Acquisition_Command_Dashboard.html, and survives every future rebuild
// because it's applied fresh each time rather than hand-edited into the
// output file directly (which the clone step would just overwrite).
// Two sections: booked applications (keyed on Altitudestatus ===
// 'Completed [C]', respects the main FROM/TO range filter like the rest of
// the dashboard) and Pending Final Approval (Altitudestatus === 'Pending
// Final Approval', a live snapshot not affected by the range filter, same
// convention as the Pending Final Approval KPI card). Reuses RS/VOCAB
// (the RAWSTORE engine) already loaded for every other tab -- no new data
// pipeline, no raw CivilID (RAWSTORE deliberately never ships that to the
// client, per established convention) -- Staging ID stands in as the
// per-application identifier.
shell = shell.replace(
  '<button class="tab" data-tab="appr"><span class="n">07</span>Approved Criteria</button>',
  '<button class="tab" data-tab="appr"><span class="n">07</span>Approved Criteria</button>\n  <button class="tab" data-tab="custinfo"><span class="n">08</span>Customer Info</button>'
);
shell = shell.replace(
  '<div class="foot" id="foot"></div>',
  `<section class="panel-tab" id="custinfo">
  <div class="sec-h"><span class="k">08</span><h2>Customer Info</h2><span class="hint">booked applications use the range filter above · Pending Final Approval is a live snapshot, not affected by the range filter</span></div>

  <div class="sec-h" style="margin-top:8px"><span class="k">BOOKED</span><h2>Booked Applications — Customer Info</h2><span class="hint" id="ci-booked-hint"></span></div>
  <div class="grid k7" id="ci-booked-kpis" style="margin-bottom:12px"></div>
  <div id="ci-booked-table" style="overflow-x:auto"></div>

  <div class="sec-h" style="margin-top:26px"><span class="k">PENDING</span><h2>Pending Final Approval — Customer Info</h2><span class="hint">not affected by the range filter above</span></div>
  <div class="grid k7" id="ci-pfa-kpis" style="margin-bottom:12px"></div>
  <div id="ci-pfa-table" style="overflow-x:auto"></div>
</section>
<div class="foot" id="foot"></div>`
);
shell = shell.replace(
  `if(!rendered[id]){rendered[id]=true;if(['credit','geo','demo'].includes(id))renderChartTab(id);if(id==='notes')renderNotes();if(id==='appr')renderApproved();}`,
  `if(!rendered[id]){rendered[id]=true;if(['credit','geo','demo'].includes(id))renderChartTab(id);if(id==='notes')renderNotes();if(id==='appr')renderApproved();if(id==='custinfo')renderCustomerInfo();}`
);
shell = shell.replace(
  'if(rendered.appr)renderApproved();updateChips();}',
  'if(rendered.appr)renderApproved();if(rendered.custinfo)renderCustomerInfo();updateChips();}'
);

// customerInfoRows() needs direct access to RS/VOCAB/N/DTS/getStagingId,
// which live inside the "interactive engine" IIFE (a separate closure from
// the tab-rendering code above -- confirmed live 2026-09-16: injecting a
// function that touched RS from outside that IIFE threw "RS is not
// defined"). So the row-computation function goes INSIDE that IIFE
// (anchored right after STAGING_ID_LEN, where getStagingId is also
// defined) and is exposed through the existing window.__engine bridge,
// same mechanism every other cross-closure call in this file already uses.
shell = shell.replace(
  'const STAGING_ID_LEN=8;',
  `const STAGING_ID_LEN=8;
  // Customer Info tab (SNB only) -- kind is 'booked' (Altitudestatus ===
  // 'Completed [C]', booked date within [fromA,toA]) or 'pfa' (Altitudestatus
  // === 'Pending Final Approval', live snapshot, fromA/toA ignored).
  function customerInfoRows(kind, fromA, toA){
    const sd=RS.sday,bd=RS.bday,flags=RS.flags,bval=RS.bval,stArr=RS.status;
    const VSt=VOCAB.status;
    const out=[]; let bptr=0;
    for(let i=0;i<N;i++){
      const isBooked=(flags[i]>>2)&1;
      if(!isBooked)continue;
      const v=bval[bptr]; const bi=bd[i]; const bDate=bi>=0?DTS[bi]:null;
      const st=VSt[stArr[i]];
      bptr++;
      let match=false;
      if(kind==='booked' && st==='Completed [C]' && bDate && bDate>=fromA && bDate<=toA) match=true;
      if(kind==='pfa' && st==='Pending Final Approval') match=true;
      if(!match)continue;
      out.push({
        stagingId:getStagingId(i), submitted:DTS[sd[i]], booked:bDate, amount:v, status:st,
        employer:VOCAB.employer[RS.employer[i]], nationality:VOCAB.nationality[RS.nationality[i]],
        age:VOCAB.age[RS.age[i]], gender:VOCAB.gender[RS.gender[i]], marital:VOCAB.marital[RS.marital[i]],
        income:VOCAB.income[RS.income[i]], city:VOCAB.city[RS.city[i]], region:VOCAB.region[RS.region[i]],
        store:VOCAB.store[RS.store[i]], product:VOCAB.product[RS.product[i]],
        scoreband:VOCAB.scoreband[RS.scoreband[i]], dbr:VOCAB.dbr[RS.dbr[i]], simah:VOCAB.simah[RS.simah[i]]
      });
    }
    return out;
  }`
);
shell = shell.replace(
  'topCompanies,approvedNotBooked,approvedNotBookedDetail};',
  'topCompanies,approvedNotBooked,approvedNotBookedDetail,customerInfoRows};'
);

// Rendering lives in the SAME (non-IIFE) top-level scope as RANGE/money/
// fmt/prettyD/rendered/the tab-click wiring, so those are all directly
// available here -- only the RS-touching row computation had to cross the
// window.__engine bridge above. esc() lives in yet a THIRD, separate IIFE
// (not reachable from here either), so this defines its own tiny escaper
// rather than reach for that one.
shell = shell.replace(
  '/* ============ tabs ============ */',
  `/* ============ Customer Info (SNB only) ============ */
const CI_CAP=500;
function ciEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function ciTable(rows,showBooked){
  if(!rows.length) return '<p class="cap">No applications found.</p>';
  let h='<table class="dt"><thead><tr><th>Staging ID</th><th>Submitted</th>'+(showBooked?'<th>Booked</th>':'')+'<th>Status</th><th class="num">Amount</th><th>Employer</th><th>Nationality</th><th>Age</th><th>Gender</th><th>Marital</th><th>Income</th><th>City</th><th>Region</th><th>Store</th><th>Product</th><th>Score</th><th>DBR</th><th>SIMAH</th></tr></thead><tbody>';
  rows.slice(0,CI_CAP).forEach(r=>{
    h+='<tr><td>'+ciEsc(r.stagingId||'—')+'</td><td>'+prettyD(r.submitted)+'</td>'+(showBooked?'<td>'+(r.booked?prettyD(r.booked):'—')+'</td>':'')+
      '<td>'+ciEsc(r.status)+'</td><td class="num">'+money(r.amount)+'</td><td>'+ciEsc(r.employer)+'</td><td>'+ciEsc(r.nationality)+'</td><td>'+ciEsc(r.age)+'</td><td>'+ciEsc(r.gender)+'</td><td>'+ciEsc(r.marital)+'</td><td>'+ciEsc(r.income)+'</td><td>'+ciEsc(r.city)+'</td><td>'+ciEsc(r.region)+'</td><td>'+ciEsc(r.store)+'</td><td>'+ciEsc(r.product)+'</td><td>'+ciEsc(r.scoreband)+'</td><td>'+ciEsc(r.dbr)+'</td><td>'+ciEsc(r.simah)+'</td></tr>';
  });
  return h+'</tbody></table>';
}
function ciKpis(count,total,label1,label2){
  return [['Applications',fmt(count),label1],['Total value',money(total),label2]]
    .map(x=>'<div class="card kpi"><div class="lab">'+x[0]+'</div><div class="big" style="font-size:21px">'+x[1]+'</div><div class="cap" style="color:var(--faint);font-size:10px">'+x[2]+'</div></div>').join('');
}
function renderCustomerInfo(){
  if(!window.__engine||!window.__engine.customerInfoRows)return;
  const bookedRows=window.__engine.customerInfoRows('booked',RANGE.from,RANGE.to);
  const pfaRows=window.__engine.customerInfoRows('pfa',null,null);

  document.getElementById('ci-booked-hint').textContent=prettyD(RANGE.from)+'–'+prettyD(RANGE.to)+(bookedRows.length>CI_CAP?' · showing first '+fmt(CI_CAP)+' of '+fmt(bookedRows.length):'');
  const bookedTotal=bookedRows.reduce((s,r)=>s+(r.amount||0),0);
  document.getElementById('ci-booked-kpis').innerHTML=ciKpis(bookedRows.length,bookedTotal,'in selected range','SAR');
  document.getElementById('ci-booked-table').innerHTML=ciTable(bookedRows,true);

  const pfaTotal=pfaRows.reduce((s,r)=>s+(r.amount||0),0);
  document.getElementById('ci-pfa-kpis').innerHTML=ciKpis(pfaRows.length,pfaTotal,'live snapshot','SAR');
  document.getElementById('ci-pfa-table').innerHTML=ciTable(pfaRows,false);
}

/* ============ tabs ============ */`
);

// --- Step 1c: Civil ID reconciliation list (added 2026-09-16, per explicit
// request) -- a fixed, hand-provided list of Civil IDs, checked against
// whether each currently has an SNB application in Pending Final Approval.
// For the ones that don't ("missing" -- confirmed via clarifying question
// this means "not currently Pending Final Approval", not "not found in
// Acquisition data at all"), show their Staging ID and current status so
// it's clear what's actually happening with that application instead of
// just an absence. Recomputed fresh from live data every run (so this
// evolves as these specific applications move through the pipeline) --
// edit CIVIL_ID_RECONCILE_LIST below to change the set, or delete this
// block entirely to remove the feature.
const CIVIL_ID_RECONCILE_LIST = [
  '1028721742','1086461272','1121040180','1105548224','2300158579','1071945230',
  '2218898399','1063625816','2498747290','2563385133','1015706979','1102306659',
  '1067749141','1091031706','2545447340','1015021981','1029633151','1076051307',
  '2537808178','1102405857','1017219625','1070558232','1001619228','2355395829',
];
function buildReconcileTable() {
  const byCivilId = new Map();
  allRows.forEach(r => {
    const cid = String(r['CivilID'] || '').trim();
    if (!cid) return;
    if (!byCivilId.has(cid)) byCivilId.set(cid, []);
    byCivilId.get(cid).push(r);
  });

  const missing = [];
  CIVIL_ID_RECONCILE_LIST.forEach(cid => {
    const apps = byCivilId.get(cid) || [];
    const isSnbPfa = apps.some(r =>
      (r['Region_for_Sales'] || '').trim().toUpperCase() === 'SNB' &&
      String(r['Altitudestatus'] || '').trim() === 'Pending Final Approval'
    );
    if (isSnbPfa) return; // present -- not "missing", skip
    if (!apps.length) {
      missing.push({ civilId: cid, stagingId: null, status: 'Not found in Acquisition data', region: null, submitted: null });
      return;
    }
    // Multiple applications for one CivilID: prefer the most recently
    // submitted one as the most relevant for "why isn't this PFA".
    const best = apps.slice().sort((a, b) => String(a['submitted'] || '').localeCompare(String(b['submitted'] || ''))).pop();
    missing.push({
      civilId: cid,
      stagingId: best['StagingID'] || null,
      status: String(best['Altitudestatus'] || '').trim() || '(blank)',
      region: (best['Region_for_Sales'] || '').trim() || null,
      submitted: best['submitted'] || null,
      otherApps: apps.length - 1,
    });
  });

  console.log(`Civil ID reconciliation: ${missing.length} of ${CIVIL_ID_RECONCILE_LIST.length} not currently SNB Pending Final Approval`);

  const rowsHtml = missing.map(m => `<tr>
    <td>${m.civilId}</td>
    <td>${m.stagingId || '—'}</td>
    <td>${m.status}</td>
    <td>${m.region || '—'}</td>
    <td>${m.submitted || '—'}</td>
    <td>${m.otherApps ? m.otherApps + ' other application(s)' : ''}</td>
  </tr>`).join('');
  return `
  <div class="sec-h" style="margin-top:26px"><span class="k">RECONCILE</span><h2>Provided Civil IDs — not currently SNB Pending Final Approval</h2><span class="hint">${missing.length} of ${CIVIL_ID_RECONCILE_LIST.length} provided Civil IDs · Staging ID + current status shown for context · recomputed fresh from live data on every rebuild</span></div>
  <table class="dt"><thead><tr><th>Civil ID</th><th>Staging ID</th><th>Current Status</th><th>Sales Region</th><th>Submitted</th><th>Note</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
}
const reconcileHtml = buildReconcileTable();
shell = shell.replace(
  '<div id="ci-pfa-table" style="overflow-x:auto"></div>\n</section>',
  `<div id="ci-pfa-table" style="overflow-x:auto"></div>
${reconcileHtml}
</section>`
);

fs.writeFileSync(SNB_HTML, shell, 'utf-8');
console.log('Shell written.');

// --- Step 2: fill it with SNB-only data via the shared engine ---
const snbRows = allRows.filter(r => (r['Region_for_Sales'] || '').trim().toUpperCase() === 'SNB');
console.log(`SNB rows: ${snbRows.length.toLocaleString()}`);
if (!snbRows.length) {
  console.error('No SNB rows found -- check Region_for_Sales values.');
  process.exit(1);
}

buildDashboardArtifact(snbRows, SNB_HTML, 'SNB (Region_for_Sales)');
console.log('✅ SNB_Overview.html rebuilt as a full clone of the main dashboard, scoped to SNB.');
