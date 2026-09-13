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

fs.writeFileSync(SNB_HTML, shell, 'utf-8');
console.log('Shell written.');

// --- Step 2: fill it with SNB-only data via the shared engine ---
console.log(`Reading ${path.basename(filePath)}…`);
const allRows = readCsv(filePath);
console.log(`Parsed ${allRows.length.toLocaleString()} total rows`);

const snbRows = allRows.filter(r => (r['Region_for_Sales'] || '').trim().toUpperCase() === 'SNB');
console.log(`SNB rows: ${snbRows.length.toLocaleString()}`);
if (!snbRows.length) {
  console.error('No SNB rows found -- check Region_for_Sales values.');
  process.exit(1);
}

buildDashboardArtifact(snbRows, SNB_HTML, 'SNB (Region_for_Sales)');
console.log('✅ SNB_Overview.html rebuilt as a full clone of the main dashboard, scoped to SNB.');
