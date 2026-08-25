/**
 * One-off backfill: rebuild ONLY the `rawRecords` cache (and derived
 * submittedMin/submittedMax) in SIMAH_Intelligence.html from the raw
 * SIMAH_Qarar_JSON_*.csv files still available on disk, joined against the
 * latest cumulative Acquisition_for_Loans CSV.
 *
 * Why: buildAggregates()/mergeAggregates() in update_simah_from_qarar_csv.js
 * cap rawRecords at 5000 and always keep the FIRST 5000 ever added (oldest
 * batches), so every batch merged after the cache filled up (long ago)
 * silently vanished from the rawRecords cache — even though the numeric
 * aggregates (score distributions, totals, etc.) correctly reflect all
 * merged batches. This script does NOT touch any aggregate field — only
 * rawRecords + meta.submittedMin/submittedMax are replaced.
 *
 * Usage: node scripts/backfill_simah_rawrecords.js <file1.csv> [file2.csv ...]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML_OUT = path.join(ROOT, 'SIMAH_Intelligence.html');
const RAW_CAP = 10000;

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/backfill_simah_rawrecords.js <SIMAH_Qarar_JSON_*.csv> [...]');
  process.exit(1);
}

// --- CSV parsing (identical to update_simah_from_qarar_csv.js) ---
function parseCsvLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { result.push(cur); cur = ''; }
      else cur += c;
    }
  }
  result.push(cur);
  return result;
}
function readCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = vals[j] ?? '';
    rows.push(obj);
  }
  return rows;
}
function findReport(obj, depth) {
  depth = depth || 0;
  if (!obj || typeof obj !== 'object' || depth > 10) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) { const r = findReport(item, depth + 1); if (r) return r; }
    return null;
  }
  if (obj.providedDemographicsInfo || obj.availableDemographicsInfo) return obj;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') { const r = findReport(v, depth + 1); if (r) return r; }
  }
  return null;
}
function asArray(x) { if (x == null) return []; return Array.isArray(x) ? x : [x]; }
function parseDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}
function extractFeatures(rep) {
  const f = {};
  const demId = rep.providedDemographicsInfo?.demIDNumber || rep.availableDemographicsInfo?.demIDNumber || null;
  f.civilId = demId;
  const avail = rep.availableDemographicsInfo || {};
  f.gender = rep.providedDemographicsInfo?.demGender || avail.demGender || 'Unknown';
  f.nationality = avail.demNationality?.couNameEN || rep.providedDemographicsInfo?.demNationality?.couNameEN || 'Unknown';
  f.city = avail.demCustomerCity || '';
  f.simahIncome = parseFloat(avail.demTotalMonthlyIncome) || 0;
  f.maritalStatus = avail.demMaritalStatus?.statusNameEN || 'Unknown';
  f.name = rep.providedDemographicsInfo?.demCustomerName || avail.demCustomerName || '';
  const sc = asArray(rep.score)[0];
  f.score = sc ? sc.score : null;
  f.scoreCard = sc?.scoreCard?.scoreCardDescEn || '';
  f.scoreReasons = (sc?.reasonCodes || []).map(r => r.scoreReasonCodeName);
  f.scoreReasonTexts = (sc?.reasonCodes || []).map(r => r.scoreReasonCodeDescEn);
  const si = rep.summaryInfo || {};
  f.activeCreditInstruments = si.summActiveCreditInstruments || 0;
  f.totalLimits = si.summTotalLimits || 0;
  f.totalLiabilities = si.summTotalLiablilites || 0;
  f.utilization = f.totalLimits > 0 ? Math.round((f.totalLiabilities / f.totalLimits) * 100) : 0;
  f.totalDefaults = si.summTotalDefaults || 0;
  f.activeDefaults = si.summDefaults || 0;
  f.currentDelinquent = si.summCurrentDelinquentBalance || 0;
  f.totalEnquiries = si.summPreviousEnquires || 0;
  f.enquiriesThisMonth = si.summPreviousEnquiresThisMonth || 0;
  const reportDate = parseDate(rep.reportDate);
  const enqs = asArray(rep.prevEnquiries);
  let enq30 = 0, enq90 = 0, enq180 = 0;
  const competitors = {};
  enqs.forEach(e => {
    const ed = parseDate(e.prevEnqDate);
    if (reportDate && ed) {
      const diffDays = (reportDate - ed) / 864e5;
      if (diffDays <= 30) enq30++;
      if (diffDays <= 90) enq90++;
      if (diffDays <= 180) enq180++;
    }
    const member = e.prevEnqEnquirer?.memberNameEN || 'Unknown';
    competitors[member] = (competitors[member] || 0) + 1;
  });
  f.enq30 = enq30; f.enq90 = enq90; f.enq180 = enq180;
  f.competitors = competitors;
  const cis = asArray(rep.creditInstrumentDetails);
  let bnplCount = 0, bnplBal = 0, totalInstallments = 0, activeLoans = 0, totalOutstanding = 0, totalPastDue = 0;
  cis.forEach(ci => {
    const isActive = ci.ciStatus?.creditInstrumentStatusCode === 'O';
    const prod = ci.ciProductTypeDesc?.textEn || 'Unknown';
    if (isActive) activeLoans++;
    if (prod === 'Buy Now Pay Later' && isActive) { bnplCount++; bnplBal += ci.ciOutstandingBalance || 0; }
    if (isActive) {
      totalOutstanding += ci.ciOutstandingBalance || 0;
      totalPastDue += ci.ciPastDue || 0;
      totalInstallments += ci.ciInstallmentAmount || 0;
    }
  });
  f.bnplCount = bnplCount; f.bnplBalance = Math.round(bnplBal); f.activeLoans = activeLoans;
  f.totalOutstanding = Math.round(totalOutstanding); f.totalPastDue = Math.round(totalPastDue);
  f.totalInstallments = Math.round(totalInstallments);
  f.estimatedDBR = f.simahIncome > 0 ? Math.round((f.totalInstallments / f.simahIncome) * 100) : null;
  const pDefs = asArray(rep.personalDefaults || rep.primaryDefaults);
  f.defaultCount = pDefs.length;
  f.defaultsSettled = pDefs.filter(d => d.pDefaultStatuses?.defaultStatusCode === 'FS').length;
  f.defaultsActive = pDefs.filter(d => d.pDefaultStatuses?.defaultStatusCode !== 'FS').length;
  const emps = asArray(rep.employers);
  const currentEmp = emps.find(e => e.empStatusType?.employerStatusTypeCode?.trim() === 'C');
  f.employerName = currentEmp?.empEmployerNameDescEn || '';
  f.enquiryDetails = enqs.slice(0, 50).map(e => [
    e.prevEnqEnquirer?.memberShortNameEN || '',
    e.prevEnqProductTypeDesc?.textEn || '',
    e.prevEnqType?.textEn || '',
    e.prevEnqDate ? e.prevEnqDate.slice(-4) : '',
    e.prevEnqDate || ''
  ]);
  return f;
}
function findLatestAcqFile() {
  return fs.readdirSync(ROOT).filter(f => /^Acquisition_for_Loans_\d{4}-\d{2}-\d{2}\.csv$/i.test(f)).sort().pop();
}

// --- Main ---
console.log('=== SIMAH rawRecords backfill ===');

const acqFile = findLatestAcqFile();
console.log(`Reading ${acqFile}…`);
const acqRows = readCsv(path.join(ROOT, acqFile));
const acqMap = {};
acqRows.forEach(r => { if (r.CivilID) acqMap[r.CivilID] = r; });
console.log(`  ${acqRows.length.toLocaleString()} acquisition rows, ${Object.keys(acqMap).length.toLocaleString()} unique CivilIDs`);

const BOOKED = new Set(['Completed [C]', 'Pending Final Approval']);
const freshRecords = [];

files.forEach(fp => {
  console.log(`Reading ${path.basename(fp)}…`);
  const csvRows = readCsv(fp);
  let n = 0, errs = 0;
  csvRows.forEach(row => {
    try {
      const wrapper = JSON.parse(row.JSON_Response);
      const rep = findReport(wrapper);
      if (!rep) { errs++; return; }
      const f = extractFeatures(rep);
      if (!f.civilId) { errs++; return; }
      const acq = acqMap[f.civilId];
      const matched = !!acq;
      const isApproved = acq?.Approvalflag === 'Y';
      const isBooked = matched && BOOKED.has(acq?.Altitudestatus);
      const isStp = matched && acq?.STP === 'Y';
      const topComp = Object.entries(f.competitors).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, cnt]) => ({ name, cnt }));
      freshRecords.push({
        civilId: f.civilId ? f.civilId.slice(0, 4) + '****' + f.civilId.slice(-2) : 'N/A',
        name: f.name, score: f.score, scoreCard: f.scoreCard,
        scoreReasons: f.scoreReasons, scoreReasonTexts: f.scoreReasonTexts,
        enq90: f.enq90, enq30: f.enq30, enq180: f.enq180,
        totalEnquiries: f.totalEnquiries, enquiriesThisMonth: f.enquiriesThisMonth,
        activeLoans: f.activeLoans, activeCreditInstruments: f.activeCreditInstruments,
        bnpl: f.bnplCount, bnplBalance: f.bnplBalance,
        totalLimits: f.totalLimits, totalLiabilities: f.totalLiabilities, utilization: f.utilization,
        totalOutstanding: f.totalOutstanding, totalPastDue: f.totalPastDue, totalInstallments: f.totalInstallments,
        estDBR: f.estimatedDBR,
        defaults: f.defaultCount, defaultsSettled: f.defaultsSettled, defaultsActive: f.defaultsActive,
        totalDefaultAmt: f.totalDefaults, currentDelinquent: f.currentDelinquent,
        simahIncome: f.simahIncome, employerName: f.employerName, nationality: f.nationality,
        gender: f.gender, maritalStatus: f.maritalStatus, city: f.city,
        topCompetitors: topComp, eq: f.enquiryDetails || [],
        outcome: matched ? (acq.Altitudestatus || 'Matched') : 'No match',
        stp: isStp ? 'Y' : 'N', approved: isApproved ? 'Y' : 'N', booked: isBooked ? 'Y' : 'N',
        stagingId: acq?.StagingID || '',
        declineReason: acq?.SimplifiedDeclinedReason || '', deDecision: acq?.DE_Decision || '',
        lightDE: acq?.Light_DE_Decision || '',
        store: acq?.StoreNameOnline || acq?.StoreName || '', region: acq?.Region || '',
        product: acq?.Product_type || '', source: acq?.SubmitSource || '',
        submitted: acq?.submitted || '',
        riskRating: acq?.RiskRating || '', scRiskGrade: acq?.SC_RiskGrade || '',
        declaredIncome: parseFloat(acq?.Income) || 0, incomeBand: acq?.DeclaredIncomeBand || '',
        ageBand: acq?.AgeBand || '', revisedDBR: acq?.Revised_DBR || '',
        smhDBR: acq?.SIMAH_DBR || '', smhInstallments: acq?.SIMAH_Installments || '',
        smhScore: acq?.SIMAH_Score || '', smhBand: acq?.SIMAH_Band || '',
        gosiCalled: acq?.Is_GOSI_Called || '', mofCalled: acq?.Is_MOF_Called || '',
        employerType: acq?.FinalEmployerType || ''
      });
      n++;
    } catch (e) { errs++; }
  });
  console.log(`  ${n} extracted, ${errs} errors`);
});

console.log(`Total fresh records built: ${freshRecords.length}`);

// Prioritize records with a real submitted date (most recent first); unmatched
// (no submitted date) fill any remaining capacity at the end.
const dated = freshRecords.filter(r => r.submitted).sort((a, b) => b.submitted.localeCompare(a.submitted));
const undated = freshRecords.filter(r => !r.submitted);
const finalRecords = [...dated, ...undated].slice(0, RAW_CAP);

const dates = finalRecords.map(r => r.submitted).filter(Boolean).sort();
const submittedMin = dates[0] || null;
const submittedMax = dates[dates.length - 1] || null;
console.log(`Final rawRecords: ${finalRecords.length} (capped at ${RAW_CAP})`);
console.log(`submittedMin: ${submittedMin}, submittedMax: ${submittedMax}`);

// --- Splice into SIMAH_Intelligence.html (only rawRecords + meta.submittedMin/Max) ---
console.log('Reading SIMAH_Intelligence.html…');
const html = fs.readFileSync(HTML_OUT, 'utf-8');
const startTag = 'const SIMAH_DATA = ';
const startIdx = html.indexOf(startTag) + startTag.length;
const endTag = ';\nlet D = SIMAH_DATA;';
const endIdx = html.indexOf(endTag, startIdx);
if (startIdx < 0 || endIdx < 0) { console.error('Could not locate SIMAH_DATA blob'); process.exit(1); }
const data = JSON.parse(html.slice(startIdx, endIdx));

console.log(`Old rawRecords: ${data.rawRecords.length}`);
data.rawRecords = finalRecords;
data.meta.submittedMin = submittedMin;
data.meta.submittedMax = submittedMax;

const newBlob = JSON.stringify(data);
const newHtml = html.slice(0, startIdx) + newBlob + html.slice(endIdx);
fs.writeFileSync(HTML_OUT, newHtml, 'utf-8');
console.log('✅ Done — rawRecords + submittedMin/Max backfilled. All other aggregates untouched.');
