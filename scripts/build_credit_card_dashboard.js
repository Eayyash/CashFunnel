#!/usr/bin/env node
/**
 * Build Credit_Card_Dashboard.html's DAILY_DEFAULT + RAWSTORE + journey
 * trends from a raw Acquisition-schema CSV export (e.g. YTD_Credit_Cards.csv).
 *
 * 2026-09-29 rewrite: added full row-level RAWSTORE (the same compact
 * columnar binary blob Acquisition_Command_Dashboard.html embeds), so
 * Credit Card can carry the SAME client-side "interactive engine" tab
 * (cross-filter bar, Approved-Not-Booked drill-down, correlation charts,
 * duplicate-customer analysis, unique-applicant stats, and the various
 * per-dimension daily-trend charts) instead of being limited to
 * pre-aggregated per-day buckets only. DAILY_DEFAULT (day-bucket
 * aggregate) is still built and embedded too -- Summary/Approved
 * Criteria/etc. still read it directly, same as before.
 *
 * RAWSTORE encoding is a hand-adapted copy of the RAWSTORE-building
 * section of update_acquisition_dashboard.js (search that file for
 * "Build RAWSTORE") -- NOT a direct call into that module, because that
 * module hardcodes its own CONFIG.bookCol ('SalesCompletedDate') and
 * BOOKED_SET at module scope, used internally by buildDaily/
 * buildJourneyTrends without being parameters. Credit Card's bookCol is
 * different ('StatusLastUpdateMoment_Date', confirmed intentional --
 * see CONFIG below), so those functions could not be reused as-is
 * without risking breaking Acquisition/SNB Overview, which DO import
 * that module. readCsv() IS reused directly (see require below) since
 * it has no such hardcoding.
 *
 * Usage: node --max-old-space-size=8192 scripts/build_credit_card_dashboard.js <path-to-csv>
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { readCsv } = require('./update_acquisition_dashboard.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_HTML = path.join(ROOT, 'Credit_Card_Dashboard.html');
const filePath = process.argv[2];

if (!filePath || !fs.existsSync(filePath)) {
  console.error('ERROR: usage: node scripts/build_credit_card_dashboard.js <path-to-csv>');
  process.exit(1);
}

// ── Exact port of Credit_Card_Dashboard.html's own constants ───────────
// Credit-Card-specific values -- intentionally different from Acquisition's
// (bookCol, filterVal) -- preserved verbatim from the pre-existing script.
const CONFIG = { valueLabel: 'Booked value', thirdKpi: 'climit', bookCol: 'StatusLastUpdateMoment_Date', bookedLabel: 'Booked cards in range', filterCol: 'Product_type', filterVal: 'Cards' };
const BOOKED_SET = new Set(['Completed [C]', 'Pending Final Approval']);
const DIMCOL = { employer: 'FinalEmployerType', nationality: 'Nationality_Flag', income: 'DeclaredIncomeBand', risk: 'RiskRating', simah: 'SC_RiskGrade', age: 'AgeBand', gender: 'Gender', marital: 'MaritalStatus', product: 'Product_type', source: 'SubmitSource', scoreband: 'AppScoreBand', dbr: 'CurrentDBRBand' };
const LONGCOL = { store: 'StoreName', city: 'CITY', natdetail: 'NATIONALITY' };
// Extra RAWSTORE-only dims (not in the day-bucket DIMCOL set), same field
// names as Acquisition's RAWSTORE -- same 88-column source schema.
const EXTRA_DIMS = { de_decision: 'DE_Decision', referreasons: 'referreasons', gosi: 'Is_GOSI_Called', mof: 'Is_MOF_Called', dec: 'SimplifiedDeclinedReason', status: 'Altitudestatus' };

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
// gv: same as Acquisition's, PLUS treats the literal string 'NULL' as
// missing -- this raw CSV export uses literal "NULL" for missing values
// (confirmed 2026-09-29: CurrentDBRBand is 27.5% literal "NULL" strings),
// unlike the xlsx exports the dashboard was originally built against.
function gv(r, k) {
  const v = r[k];
  if (v == null || v === '' || v === 'NULL') return 'Unknown';
  const s = String(v).trim();
  return (s === '' || s === 'NULL') ? 'Unknown' : s;
}
// Smart Finance / income-15K-split dims (RAWSTORE-only, same as Acquisition's).
function smartVal(r) { return String(r['SmartFinance'] || '').trim() !== '' && String(r['SmartFinance']).trim() !== 'NULL' ? 'Smart Finance' : 'Normal'; }
function incBand15Val(r) {
  const inc = parseFloat(r['Income']);
  if (isNaN(inc)) return 'Unknown';
  return inc >= 15000 ? '15K+' : '<15K';
}

// ── Company normalizer (line-for-line port of Acquisition's, generic over
// any `rows` -- same "Company" column, same corruption pattern, same
// source schema). ---
const CORRUPTED_COMPANY_RE = /[�?]/;
const COMPANY_TOPN = 60;
const UNLISTED_ARABIC_LITERAL = 'شركة غير مدرجة';
const JUNK_COMPANY_VALUES = new Set(['تم الرفض بسبب السجل التجاري 0', 'Rejected due to CR number is 0']);
function buildCompanyNormalizer(rows) {
  const rawCounts = new Map();
  rows.forEach(r => {
    const v = (r['Company'] || '').trim();
    if (!v || v === 'NULL') return;
    rawCounts.set(v, (rawCounts.get(v) || 0) + 1);
  });
  let unlistedArabicRaw = null, unlistedArabicCount = 0;
  for (const [v, n] of rawCounts) {
    if (CORRUPTED_COMPANY_RE.test(v) && n > unlistedArabicCount) { unlistedArabicRaw = v; unlistedArabicCount = n; }
  }
  function normalize(raw) {
    const v = (raw || '').trim();
    if (!v || v === 'NULL') return null;
    if (JUNK_COMPANY_VALUES.has(v)) return null;
    if (v === unlistedArabicRaw) return 'Unlisted Company';
    const vNormWs = v.replace(/\s+/g, ' ');
    if (vNormWs === UNLISTED_ARABIC_LITERAL) return 'Unlisted Company';
    if (/^UNLISTED\s*COMPANY$/i.test(vNormWs)) return 'Unlisted Company';
    if (CORRUPTED_COMPANY_RE.test(v)) return null;
    return v;
  }
  const groups = new Map();
  rows.forEach(r => {
    const name = normalize(r['Company']);
    if (name == null) return;
    const key = name.toUpperCase();
    const g = groups.get(key) || { count: 0, casings: new Map() };
    g.count++;
    g.casings.set(name, (g.casings.get(name) || 0) + 1);
    groups.set(key, g);
  });
  const top = [...groups.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, COMPANY_TOPN);
  const displayNameByKey = new Map(top.map(([key, g]) => [key, [...g.casings.entries()].sort((a, b) => b[1] - a[1])[0][0]]));
  function companyOf(raw) {
    const name = normalize(raw);
    if (name == null) return 'Other';
    const disp = displayNameByKey.get(name.toUpperCase());
    return disp || 'Other';
  }
  return { companyOf, topNames: [...displayNameByKey.values()] };
}

console.log(`Reading ${path.basename(filePath)}…`);
let allRows = readCsv(filePath);
console.log(`Parsed ${allRows.length.toLocaleString()} rows`);
// Defensive filter -- confirmed 2026-09-29 the source CSV is already
// 100% Product_type='Cards' (137,334/137,334 rows), but keep the filter
// so this script stays correct if a future export is a mixed-product file.
const rows = CONFIG.filterCol ? allRows.filter(r => String(r[CONFIG.filterCol]) === CONFIG.filterVal) : allRows;
console.log(`Filtered to Product_type=Cards: ${rows.length.toLocaleString()} rows`);

// ── buildDaily(), unchanged from the pre-existing script ───────────────
function buildDaily(rows, name) {
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

// ── buildJourneyTrends(), adapted from update_acquisition_dashboard.js ─
// Same per-day journey metrics (GOSI/MOF/Qarar/SIMAH call coverage, risk
// grade mix, decline reasons, employer mix, income trends, submission
// source mix, STB digital-booking mix) but keyed to THIS file's own
// CONFIG.bookCol/BOOKED_SET (StatusLastUpdateMoment_Date), not
// Acquisition's SalesCompletedDate.
// JOURNEY_CHANGE_DATE: corrected 2026-09-29 -- an earlier version of this
// file assumed the 10-Sep-2026 GOSI/MOF-before-Qarar/SIMAH policy change
// was Tawarruq/loans-specific and left this null. Confirmed against the
// live Cards data that assumption was WRONG: the same shift shows up here
// too (GOSI call rate 44.4%->75.9%, MOF 2.4%->15.8%, SIMAH 74.0%->52.6%,
// all in the same direction as loans, split at the same date), so the
// backend gating change is shared across products, not loans-only. This
// also means the before/after "journey change" analysis cards (company
// status, cost-benefit, employer-benefit, insights) now apply here too --
// ported below, keyed off the same approvedCompanies-*.csv reference file
// Acquisition uses (a bank-wide company list, not loans-specific).
const JOURNEY_CHANGE_DATE = '2026-09-10';
function ymdAdd(ymdStr, n) { const d = new Date(ymdStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function medianOf(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2); }
const CS_LABEL_TO_KEY = { 'Listed Cat A': 'catA', 'Listed Cat B': 'catB', 'Listed Cat C': 'catC', 'Blacklisted': 'blacklisted', 'Rejected': 'rejected', 'Deleted': 'deleted' };
const CS_KEYS = ['catA', 'catB', 'catC', 'blacklisted', 'rejected', 'deleted', 'unlisted', 'unreadable'];
function companyStatusOf(companyRaw, companyStatusMap, normCompany) {
  const raw = String(companyRaw == null ? '' : companyRaw).trim();
  if (!raw || raw === 'NULL' || raw.indexOf('?') >= 0) return 'unreadable';
  const label = companyStatusMap.get(normCompany(raw));
  return label ? CS_LABEL_TO_KEY[label] : 'unlisted';
}
function buildJourneyTrends(rows, dataMax, companyStatusMap, normCompany) {
  const end = ymdAdd(dataMax, -1);
  // Window start: earliest date in the data (Credit Card's history is far
  // shorter than Acquisition's, so there's no fixed '2026-08-14' floor --
  // just use everything available, capped to the last complete day).
  const minDate = rows.reduce((m, r) => { const d = toYMD(r['submitted']); return d && (!m || d < m) ? d : m; }, null);
  const start30 = minDate || end;
  const startInc = minDate || end;
  const flag = v => { const s = String(v == null ? '' : v).trim().toUpperCase(); return s === 'Y' || s === '1' || s === 'TRUE'; };
  const days = {}, inc = {};
  for (let d = start30; d <= end; d = ymdAdd(d, 1)) {
    days[d] = { date: d, wd: new Date(d + 'T00:00:00Z').getUTCDay(), subs: 0, init: 0, fin: 0, bk: 0, amt: 0, saudi: 0, expats: 0,
      emp_private: 0, emp_unlisted: 0, emp_govt: 0, emp_pension: 0, emp_military: 0, gosi_called: 0, mof_called: 0, qarar_called: 0, simah_called: 0,
      dr_dbr: 0, dr_loansize: 0, dr_inactive: 0, dr_minincome: 0, dr_simah: 0, unl_tagged: 0, unl_wrong: 0,
      rg_l: 0, rg_m: 0, rg_h: 0, rg_unknown: 0,
      bk_private: 0, bk_unlisted: 0, bk_govt: 0, bk_pension: 0, bk_military: 0,
      ss_ui: 0, ss_backoffice: 0, ss_android: 0, ss_android_s: 0, ss_ios: 0, ss_other: 0,
      stb_ui: 0, stb_backoffice: 0, stb_android: 0, stb_android_s: 0, stb_ios: 0,
      _si: [], _sa: [], _ei: [], _ea: [] };
    CS_KEYS.forEach(k => { days[d]['cs_' + k] = 0; days[d]['bk_cs_' + k] = 0; });
  }
  for (let d = startInc; d <= end; d = ymdAdd(d, 1)) inc[d] = { date: d, _s: [], _e: [] };
  const EMP = { 'Private Company': 'emp_private', 'Unlisted': 'emp_unlisted', 'Government Entity': 'emp_govt', 'Pension': 'emp_pension', 'Military with Grades': 'emp_military' };
  const BK_EMP = { 'Private Company': 'bk_private', 'Unlisted': 'bk_unlisted', 'Government Entity': 'bk_govt', 'Pension': 'bk_pension', 'Military with Grades': 'bk_military' };
  const DR = { 'DBR': 'dr_dbr', 'Loan Size Rule': 'dr_loansize', 'Inactive Company': 'dr_inactive', 'Minimum Income Rule': 'dr_minincome', 'SIMAH Rules': 'dr_simah' };
  const SS = { 'UI': 'ss_ui', 'backoffice': 'ss_backoffice', 'Android': 'ss_android', 'Android-S': 'ss_android_s', 'IOS-S': 'ss_ios' };
  const pos = v => { const n = parseFloat(v); return n > 0 ? n : null; };
  for (const r of rows) {
    const sd = toYMD(r['submitted']);
    const d = sd && days[sd];
    const saudi = String(r['Nationality_Flag'] || '').trim() === 'Saudi';
    const expat = String(r['Nationality_Flag'] || '').trim() === 'Expats';
    if (d) {
      d.subs++;
      if (r['Approvalflag'] === 'Y') d.init++;
      if (r['FinalApprovalFlag'] === 'Y') d.fin++;
      if (saudi) d.saudi++; else if (expat) d.expats++;
      const ek = EMP[String(r['FinalEmployerType'] || '').trim()]; if (ek) d[ek]++;
      if (companyStatusMap) d['cs_' + companyStatusOf(r['Company'], companyStatusMap, normCompany)]++;
      if (flag(r['Is_GOSI_Called'])) d.gosi_called++;
      if (flag(r['Is_MOF_Called'])) d.mof_called++;
      const hasSmhScore = String(r['SMH_Score'] == null ? '' : r['SMH_Score']).trim() !== '' && String(r['SMH_Score']).trim() !== 'NULL';
      const deDec = String(r['DE_Decision'] || '').trim();
      if (hasSmhScore || deDec === 'X') d.qarar_called++;
      if (hasSmhScore) d.simah_called++;
      const dk = DR[String(r['SimplifiedDeclinedReason'] || '').trim()]; if (dk) d[dk]++;
      d[SS[String(r['SubmitSource'] || '').trim()] || 'ss_other']++;
      if (/unlisted company/i.test(String(r['referreasons'] || ''))) {
        d.unl_tagged++;
        if (String(r['FinalEmployerType'] || '').trim() !== 'Unlisted') d.unl_wrong++;
      }
      const g = String(r['SC_RiskGrade'] || '').trim().toUpperCase();
      if (g === 'L') d.rg_l++; else if (g === 'M') d.rg_m++; else if (g === 'H') d.rg_h++; else d.rg_unknown++;
      const iv = pos(r['Income']), av = pos(r['AltitudeIncome']);
      if (saudi) { if (iv) d._si.push(iv); if (av) d._sa.push(av); }
      else if (expat) { if (iv) d._ei.push(iv); if (av) d._ea.push(av); }
    }
    const ii = sd && inc[sd];
    if (ii) { const av = pos(r['AltitudeIncome']); if (av) { if (saudi) ii._s.push(av); else if (expat) ii._e.push(av); } }
    if (BOOKED_SET.has(String(r['Altitudestatus'] || '').trim())) {
      const bd = days[toYMD(r[CONFIG.bookCol])];
      if (bd) {
        bd.bk++; bd.amt += parseFloat(r['ItemValue']) || 0;
        const bek = BK_EMP[String(r['FinalEmployerType'] || '').trim()]; if (bek) bd[bek]++;
        if (companyStatusMap) bd['bk_cs_' + companyStatusOf(r['Company'], companyStatusMap, normCompany)]++;
        if (String(r['STB_Status'] || '').trim() === 'Booked_Full_STB') {
          const stbKey = SS[String(r['SubmitSource'] || '').trim()];
          if (stbKey) bd['stb_' + stbKey.slice(3)]++;
        }
      }
    }
  }
  const avgUnder = a => { const f = a.filter(x => x <= 500000); return f.length ? Math.round(f.reduce((s, x) => s + x, 0) / f.length) : 0; };
  const trends30 = Object.values(days).map(d => {
    const o = Object.assign({}, d, { amt: Math.round(d.amt), sau_inc: medianOf(d._si), sau_alt: medianOf(d._sa), exp_inc: medianOf(d._ei), exp_alt: medianOf(d._ea) });
    delete o._si; delete o._sa; delete o._ei; delete o._ea; return o;
  });
  const incomeDaily = Object.values(inc).map(d => ({ date: d.date, sau_med: medianOf(d._s), sau_avg: avgUnder(d._s), exp_med: medianOf(d._e), exp_avg: avgUnder(d._e), sau_n: d._s.length, exp_n: d._e.length }));
  return { changeDate: JOURNEY_CHANGE_DATE, windowStart: start30, windowEnd: end, dataMax, trends30, incomeDaily };
}

console.log('Aggregating (DAILY_DEFAULT, filtered to Product_type=Cards)…');
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

// ── Approved-companies reference (same bank-wide list Acquisition uses --
// confirmed 2026-09-29 this applies to Cards too, not loans-specific).
const APPROVED_COMPANIES_CSV = path.join(ROOT, 'approvedCompanies-21-09-2026-16-11.csv');
const STATUS_LABEL = { '4': 'Listed Cat A', '1': 'Listed Cat B', '2': 'Listed Cat C', '3': 'Blacklisted', '0': 'Rejected', '99': 'Deleted' };
const STATUS_PRIORITY = ['Blacklisted', 'Listed Cat A', 'Listed Cat B', 'Listed Cat C', 'Rejected', 'Deleted'];
const normCompany = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '');
let companyStatusMap = null, approvedCompaniesMeta = null;
if (fs.existsSync(APPROVED_COMPANIES_CSV)) {
  const approvedRows = readCsv(APPROVED_COMPANIES_CSV);
  companyStatusMap = new Map();
  approvedRows.forEach(r => {
    const n = normCompany(r['Company']);
    if (!n) return;
    const label = STATUS_LABEL[String(r['Active'] || '').trim()];
    if (!label) return;
    const cur = companyStatusMap.get(n);
    if (!cur || STATUS_PRIORITY.indexOf(label) < STATUS_PRIORITY.indexOf(cur)) companyStatusMap.set(n, label);
  });
  const active = approvedRows.filter(r => String(r['Active'] || '').trim() === '1').length;
  approvedCompaniesMeta = { total: approvedRows.length, active, asOf: '2026-09-21', distinctNames: companyStatusMap.size };
  console.log(`Approved companies: ${approvedRows.length.toLocaleString()} total, ${active.toLocaleString()} Active=1, ${companyStatusMap.size.toLocaleString()} distinct names indexed`);
}

console.log('Building journey trends…');
nd.journey = buildJourneyTrends(rows, nd.meta.max, companyStatusMap, normCompany);
console.log(`Journey trends: ${nd.journey.trends30.length} days (${nd.journey.windowStart} → ${nd.journey.windowEnd}), income series ${nd.journey.incomeDaily.length} days`);
if (approvedCompaniesMeta) nd.journey.approvedCompanies = approvedCompaniesMeta;

// ── Build RAWSTORE (columnar binary for the client-side interactive
// engine) -- adapted from update_acquisition_dashboard.js's "Build
// RAWSTORE" section; same encoding (flags/sday/bday/dim bytes/civIdx/
// stagingId/bval/bten/blim/butil, zlib-deflated, base64), same dimOrder,
// so Credit_Card_Dashboard.html's client-side decoder (a straight copy of
// Acquisition's) works completely unmodified. ---
console.log('Building RAWSTORE…');
const dashboardRows = rows;
const longCnt = {};
for (const k in LONGCOL) longCnt[k] = {};
dashboardRows.forEach(r => {
  for (const k in LONGCOL) {
    const v = gv(r, LONGCOL[k]);
    longCnt[k][v] = (longCnt[k][v] || 0) + 1;
  }
});
const longTop = {};
for (const k in longCnt) {
  longTop[k] = new Set(Object.entries(longCnt[k]).sort((a, b) => b[1] - a[1]).slice(0, 20).map(x => x[0]));
}

const allDims = { ...DIMCOL, ...LONGCOL, ...EXTRA_DIMS };
const { companyOf, topNames: companyTopNames } = buildCompanyNormalizer(dashboardRows);
const vocabSets = { region: new Set(), smart: new Set(), incband15: new Set(), company: new Set(companyTopNames.concat('Other')) };
for (const k in allDims) vocabSets[k] = new Set();
const dateSet = new Set();

dashboardRows.forEach(r => {
  const sd = toYMD(r['submitted']);
  if (sd) dateSet.add(sd);
  const booked = BOOKED_SET.has(String(r['Altitudestatus']));
  if (booked) { const bd = toYMD(r[CONFIG.bookCol]); if (bd) dateSet.add(bd); }
  const reg = (r['is_panda'] == 1 || r['is_panda'] === '1') ? 'Panda' : gv(r, 'Region');
  vocabSets.region.add(reg);
  vocabSets.smart.add(smartVal(r));
  vocabSets.incband15.add(incBand15Val(r));
  for (const k in DIMCOL) vocabSets[k].add(gv(r, DIMCOL[k]));
  for (const k in LONGCOL) {
    const v = gv(r, LONGCOL[k]);
    vocabSets[k].add(longTop[k].has(v) ? v : 'Other');
  }
  for (const k in EXTRA_DIMS) {
    const v = gv(r, EXTRA_DIMS[k]);
    vocabSets[k].add(v);
  }
});

const dates = [...dateSet].sort();
const dateIdx = {};
dates.forEach((d, i) => dateIdx[d] = i);

const vocab = {};
for (const k in vocabSets) vocab[k] = [...vocabSets[k]];
const vocabIdx = {};
for (const k in vocab) { vocabIdx[k] = {}; vocab[k].forEach((v, i) => vocabIdx[k][v] = i); }

const N = dashboardRows.length;
const flags = new Uint8Array(N);
const sday = new Uint16Array(N);
const bday = new Uint16Array(N);
const dimCols = {};
for (const k in vocabSets) dimCols[k] = new Uint8Array(N);
const bookedRows = [];
const NO_CIV = 0xFFFFFFFF;
const civIdMap = new Map();
const civIdx = new Uint32Array(N);
const STAGING_ID_LEN = 8;
const stagingIdBytes = new Uint8Array(N * STAGING_ID_LEN);

dashboardRows.forEach((r, i) => {
  const sid = String(r['StagingID'] || '').slice(0, STAGING_ID_LEN);
  for (let k = 0; k < STAGING_ID_LEN; k++) {
    stagingIdBytes[i * STAGING_ID_LEN + k] = k < sid.length ? sid.charCodeAt(k) : 32;
  }
  const init = r['Approvalflag'] === 'Y';
  const fin = r['FinalApprovalFlag'] === 'Y';
  const booked = BOOKED_SET.has(String(r['Altitudestatus']));
  const declined = String(r['Altitudestatus']) === 'Declined [D]';
  flags[i] = (init ? 1 : 0) | (fin ? 2 : 0) | (booked ? 4 : 0) | (declined ? 8 : 0);

  const cid = String(r['CivilID'] || '').trim();
  if (cid && cid !== 'NULL') {
    let idx = civIdMap.get(cid);
    if (idx === undefined) { idx = civIdMap.size; civIdMap.set(cid, idx); }
    civIdx[i] = idx;
  } else {
    civIdx[i] = NO_CIV;
  }

  const sd = toYMD(r['submitted']);
  sday[i] = sd && dateIdx[sd] !== undefined ? dateIdx[sd] : 65535;

  if (booked) {
    const bd = toYMD(r[CONFIG.bookCol]);
    bday[i] = bd && dateIdx[bd] !== undefined ? dateIdx[bd] : 65535;
    bookedRows.push(i);
  } else {
    bday[i] = 65535;
  }

  const reg = (r['is_panda'] == 1 || r['is_panda'] === '1') ? 'Panda' : gv(r, 'Region');
  dimCols.region[i] = vocabIdx.region[reg] || 0;
  dimCols.smart[i] = vocabIdx.smart[smartVal(r)] || 0;
  dimCols.incband15[i] = vocabIdx.incband15[incBand15Val(r)] || 0;
  { const ci = vocabIdx.company[companyOf(r['Company'])]; dimCols.company[i] = ci !== undefined ? ci : vocabIdx.company['Other']; }

  for (const k in DIMCOL) dimCols[k][i] = vocabIdx[k][gv(r, DIMCOL[k])] || 0;
  for (const k in LONGCOL) {
    const v = gv(r, LONGCOL[k]);
    dimCols[k][i] = vocabIdx[k][longTop[k].has(v) ? v : 'Other'] || 0;
  }
  for (const k in EXTRA_DIMS) dimCols[k][i] = vocabIdx[k][gv(r, EXTRA_DIMS[k])] || 0;
});

const bval = new Float64Array(bookedRows.length);
const bten = new Float64Array(bookedRows.length);
const blim = new Float64Array(bookedRows.length);
const butil = new Float64Array(bookedRows.length);
bookedRows.forEach((ri, j) => {
  const r = dashboardRows[ri];
  bval[j] = parseFloat(r['ItemValue']) || 0;
  bten[j] = parseFloat(r['TENURE']) || 0;
  blim[j] = parseFloat(r['CREDIT_LIMIT']) || 0;
  const mp = parseFloat(r['Max_Principal']);
  butil[j] = (mp > 0) ? (bval[j] / mp) : NaN;
});

const BSZ = { b: 1, h: 2, d: 8, i: 4 };
const header = {};
let offset = 0;
function addCol(name, arr, type) { header[name] = { off: offset, len: arr.length, t: type }; offset += arr.length * BSZ[type]; }
addCol('flags', flags, 'b');
addCol('sday', sday, 'h');
addCol('bday', bday, 'h');
// Same dimOrder as Acquisition's RAWSTORE (order only matters for byte
// layout consistency with the header map; the client reads by name).
const dimOrder = ['region', 'employer', 'nationality', 'income', 'risk', 'simah', 'age', 'gender', 'marital', 'product', 'source', 'scoreband', 'dbr', 'store', 'city', 'natdetail', 'de_decision', 'referreasons', 'gosi', 'mof', 'dec', 'smart', 'incband15', 'company', 'status'];
dimOrder.forEach(k => addCol(k, dimCols[k], 'b'));
addCol('civIdx', civIdx, 'i');
addCol('stagingId', stagingIdBytes, 'b');
addCol('bval', bval, 'd');
addCol('bten', bten, 'd');
addCol('blim', blim, 'd');
addCol('butil', butil, 'd');

const totalBytes = offset;
const buf = Buffer.alloc(totalBytes);
let pos = 0;
function writeBuf(arr) { Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(buf, pos); pos += arr.byteLength; }
writeBuf(flags); writeBuf(sday); writeBuf(bday);
dimOrder.forEach(k => writeBuf(dimCols[k]));
writeBuf(civIdx); writeBuf(stagingIdBytes);
writeBuf(bval); writeBuf(bten); writeBuf(blim); writeBuf(butil);

const compressed = zlib.deflateSync(buf, { level: 9 });
const b64 = compressed.toString('base64');
const rawStore = { n: N, dates, vocab, header, b64 };
console.log(`RAWSTORE built — ${N.toLocaleString()} rows, ${dates.length} dates, ${b64.length.toLocaleString()} chars b64.`);

console.log('Injecting into Credit_Card_Dashboard.html…');
let html = fs.readFileSync(OUT_HTML, 'utf-8');

const newDailyLine = 'const DAILY_DEFAULT = ' + JSON.stringify(nd) + ';';
const dailyRe = /^const DAILY_DEFAULT = .*;$/m;
if (!dailyRe.test(html)) {
  console.error('ERROR: could not find the existing DAILY_DEFAULT line to replace -- aborting without writing.');
  process.exit(1);
}
html = html.replace(dailyRe, () => newDailyLine);

const newRawLine = 'const RAWSTORE = ' + JSON.stringify(rawStore) + ';';
const rawRe = /^const RAWSTORE = .*;$/m;
if (rawRe.test(html)) {
  html = html.replace(rawRe, () => newRawLine);
} else {
  // First-time insertion: place immediately after the DAILY_DEFAULT line
  // (mirrors Acquisition_Command_Dashboard.html's layout -- DAILY_DEFAULT
  // then RAWSTORE, each its own script block).
  const marker = newDailyLine;
  const idx = html.indexOf(marker);
  if (idx === -1) { console.error('ERROR: could not locate the just-written DAILY_DEFAULT line to anchor RAWSTORE insertion.'); process.exit(1); }
  const insertAt = idx + marker.length;
  html = html.slice(0, insertAt) + '\n</script>\n<script>\n' + newRawLine + '\n' + html.slice(insertAt);
}

fs.writeFileSync(OUT_HTML, html, 'utf-8');
console.log(`✅ Credit_Card_Dashboard.html updated — ${nd.meta.total.toLocaleString()} rows, ${nd.meta.min} → ${nd.meta.max}, ${nd.dates.length} dates. RAWSTORE: ${N.toLocaleString()} rows.`);
