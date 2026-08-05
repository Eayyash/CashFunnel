/**
 * Update SIMAH_Intelligence.html from a combined_output.txt file
 * (one JSON SIMAH report per line).
 *
 * Usage: node scripts/update_simah_from_combined.js <path-to-combined_output.txt>
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const HTML_OUT = path.join(ROOT, 'SIMAH_Intelligence.html');
const COMBINED_FILE = process.argv[2];

if (!COMBINED_FILE || !fs.existsSync(COMBINED_FILE)) {
  console.error('Usage: node scripts/update_simah_from_combined.js <combined_output.txt>');
  process.exit(1);
}

// --- Reuse all utility functions from process_simah.js ---
// (inline to avoid module gymnastics)

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

function parseDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

function extractFeatures(rep) {
  const f = {};
  const demId = rep.providedDemographicsInfo?.demIDNumber ||
                rep.availableDemographicsInfo?.demIDNumber || null;
  f.civilId = demId;

  const avail = rep.availableDemographicsInfo || {};
  f.gender = rep.providedDemographicsInfo?.demGender || avail.demGender || 'Unknown';
  f.nationality = avail.demNationality?.couNameEN ||
                  rep.providedDemographicsInfo?.demNationality?.couNameEN || 'Unknown';
  f.city = avail.demCustomerCity || '';
  f.simahIncome = parseFloat(avail.demTotalMonthlyIncome) || 0;
  f.maritalStatus = avail.demMaritalStatus?.statusNameEN || 'Unknown';

  const name = rep.providedDemographicsInfo?.demCustomerName ||
               avail.demCustomerName || '';
  f.name = name;

  const sc = rep.score && rep.score[0];
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
  const enqs = rep.prevEnquiries || [];
  let enq30 = 0, enq60 = 0, enq90 = 0, enq180 = 0;
  const competitors = {};
  const enqProducts = {};
  const enqByYear = {};
  const enqByMonth = {};
  const enqByMember = {};
  const enqByProduct = {};
  const enqByType = {};
  enqs.forEach(e => {
    const ed = parseDate(e.prevEnqDate);
    if (reportDate && ed) {
      const diffDays = (reportDate - ed) / 864e5;
      if (diffDays <= 30) enq30++;
      if (diffDays <= 60) enq60++;
      if (diffDays <= 90) enq90++;
      if (diffDays <= 180) enq180++;
    }
    const member = e.prevEnqEnquirer?.memberNameEN || 'Unknown';
    competitors[member] = (competitors[member] || 0) + 1;
    const prod = e.prevEnqProductTypeDesc?.textEn || 'Unknown';
    enqProducts[prod] = (enqProducts[prod] || 0) + 1;
    // For extended aggregation
    const eType = e.prevEnqType?.textEn || 'Unknown';
    const yr = e.prevEnqDate ? e.prevEnqDate.slice(-4) : 'Unknown';
    enqByYear[yr] = (enqByYear[yr] || 0) + 1;
    if (ed) {
      const moKey = ed.getFullYear() + '-' + String(ed.getMonth()+1).padStart(2,'0');
      enqByMonth[moKey] = (enqByMonth[moKey] || 0) + 1;
    }
    enqByMember[member] = (enqByMember[member] || 0) + 1;
    enqByProduct[prod] = (enqByProduct[prod] || 0) + 1;
    enqByType[eType] = (enqByType[eType] || 0) + 1;
  });
  f.enq30 = enq30; f.enq60 = enq60; f.enq90 = enq90; f.enq180 = enq180;
  f.competitors = competitors;
  f.enqProducts = enqProducts;
  f.enqByYear = enqByYear;
  f.enqByMonth = enqByMonth;
  f.enqByMember = enqByMember;
  f.enqByProduct = enqByProduct;
  f.enqByType = enqByType;

  const cis = rep.creditInstrumentDetails || [];
  let bnplCount = 0, bnplBal = 0, totalInstallments = 0, activeLoans = 0;
  let totalOutstanding = 0, totalPastDue = 0;
  const productTypes = {};
  const creditors = {};
  cis.forEach(ci => {
    const isActive = ci.ciStatus?.creditInstrumentStatusCode === 'O';
    const prod = ci.ciProductTypeDesc?.textEn || 'Unknown';
    if (isActive) {
      activeLoans++;
      productTypes[prod] = (productTypes[prod] || 0) + 1;
      const cred = ci.ciCreditor?.memberNameEN || 'Unknown';
      creditors[cred] = (creditors[cred] || 0) + 1;
    }
    if (prod === 'Buy Now Pay Later') {
      if (isActive) { bnplCount++; bnplBal += ci.ciOutstandingBalance || 0; }
    }
    if (isActive) {
      totalOutstanding += ci.ciOutstandingBalance || 0;
      totalPastDue += ci.ciPastDue || 0;
      totalInstallments += ci.ciInstallmentAmount || 0;
    }
  });
  f.bnplCount = bnplCount;
  f.bnplBalance = Math.round(bnplBal);
  f.activeLoans = activeLoans;
  f.totalOutstanding = Math.round(totalOutstanding);
  f.totalPastDue = Math.round(totalPastDue);
  f.totalInstallments = Math.round(totalInstallments);
  f.activeProductTypes = productTypes;
  f.activeCreditors = creditors;

  f.estimatedDBR = f.simahIncome > 0
    ? Math.round((f.totalInstallments / f.simahIncome) * 100) : null;

  const pDefs = rep.personalDefaults || rep.primaryDefaults || [];
  f.defaultCount = pDefs.length;
  f.defaultsSettled = pDefs.filter(d =>
    d.pDefaultStatuses?.defaultStatusCode === 'FS').length;
  f.defaultsActive = pDefs.filter(d =>
    d.pDefaultStatuses?.defaultStatusCode !== 'FS').length;

  const emps = rep.employers || [];
  const currentEmp = emps.find(e =>
    e.empStatusType?.employerStatusTypeCode?.trim() === 'C');
  f.employerName = currentEmp?.empEmployerNameDescEn || '';
  f.employerIncome = currentEmp?.empIncome || 0;

  // Enquiry details for raw record
  f.enquiryDetails = enqs.slice(0, 50).map(e => [
    e.prevEnqEnquirer?.memberShortNameEN || '',
    e.prevEnqProductTypeDesc?.textEn || '',
    e.prevEnqType?.textEn || '',
    e.prevEnqDate ? e.prevEnqDate.slice(-4) : '',
    e.prevEnqDate || ''
  ]);

  return f;
}

function scoreBand(s) {
  if (s == null) return 'No Score';
  if (s < 400) return '300-399';
  if (s < 500) return '400-499';
  if (s < 550) return '500-549';
  if (s < 600) return '550-599';
  if (s < 650) return '600-649';
  if (s < 700) return '650-699';
  if (s < 750) return '700-749';
  return '750-850';
}
function enqBand(n) {
  if (n === 0) return '0';
  if (n <= 2) return '1-2';
  if (n <= 5) return '3-5';
  if (n <= 10) return '6-10';
  return '11+';
}
function utilizBand(u) {
  if (u <= 20) return '0-20%';
  if (u <= 40) return '21-40%';
  if (u <= 60) return '41-60%';
  if (u <= 80) return '61-80%';
  return '81-100%+';
}
function dbrBand(d) {
  if (d == null) return 'Unknown';
  if (d <= 20) return '0-20%';
  if (d <= 30) return '21-30%';
  if (d <= 40) return '31-40%';
  if (d <= 50) return '41-50%';
  return '50%+';
}
function shoppingBand(n) {
  if (n <= 2) return '0-2';
  if (n <= 5) return '3-5';
  if (n <= 10) return '6-10';
  return '11+';
}

// --- Build aggregates (extended version matching current SIMAH_Intelligence.html) ---
function buildAggregates(features, acqMap) {
  const agg = {
    meta: { total: features.length, matched: 0, unmatched: 0, reportDate: new Date().toISOString().slice(0, 10) },
    scoreDistribution: {},
    enqIntensity: {},
    competitorRank: {},
    competitorByOutcome: {},
    productEnquiries: {},
    utilizationBands: {},
    dbrBands: {},
    scoreReasonFreq: {},
    incomeMatch: { match: 0, mismatch: 0, noData: 0 },
    declineByScore: {},
    rawRecords: [],
    scoreReasonDescs: {},
    enquirerNames: {},
    productNames: {},
    typeNames: {},
    allYears: new Set(),
    enquirerStats: {},
    shoppingBands: {},
    institutionLoanStats: {},
    ucfsAvgFinAmount: 0,
    enqByMember: {},
    enqByProduct: {},
    enqByType: {},
    enqByMonth: {},
    totalEnquiries: 0
  };

  const BOOKED = new Set(['Completed [C]', 'Pending Final Approval']);
  let ucfsSum = 0, ucfsN = 0;

  features.forEach(f => {
    const acq = acqMap[f.civilId];
    const matched = !!acq;
    if (matched) agg.meta.matched++;
    else agg.meta.unmatched++;

    const isApproved = acq?.Approvalflag === 'Y';
    const isBooked = acq ? BOOKED.has(acq.Altitudestatus) : false;
    const isStp = acq ? (acq.STP === '1' || acq.STP === 1) : false;

    // Score distribution
    const sb = scoreBand(f.score);
    const sd = agg.scoreDistribution[sb] || (agg.scoreDistribution[sb] = { sub: 0, approved: 0, booked: 0, stp: 0 });
    sd.sub++; if (isApproved) sd.approved++; if (isBooked) sd.booked++; if (isStp) sd.stp++;

    // Enquiry intensity
    const eb = enqBand(f.enq90);
    const ei = agg.enqIntensity[eb] || (agg.enqIntensity[eb] = { sub: 0, approved: 0, booked: 0, stp: 0 });
    ei.sub++; if (isApproved) ei.approved++; if (isBooked) ei.booked++; if (isStp) ei.stp++;

    // Competitors
    for (const [comp, cnt] of Object.entries(f.competitors)) {
      agg.competitorRank[comp] = (agg.competitorRank[comp] || 0) + cnt;
      const co = agg.competitorByOutcome[comp] || (agg.competitorByOutcome[comp] = { sub: 0, approved: 0, booked: 0 });
      co.sub++; if (isApproved) co.approved++; if (isBooked) co.booked++;
    }

    // Product enquiries
    for (const [prod, cnt] of Object.entries(f.enqProducts)) {
      agg.productEnquiries[prod] = (agg.productEnquiries[prod] || 0) + cnt;
    }

    // Utilization bands with acq matching
    const ub = utilizBand(f.utilization);
    if (!agg.utilizationBands[ub]) agg.utilizationBands[ub] = { sub: 0, approved: 0, booked: 0, stp: 0, acqMatched: 0, acqRows: 0, acqApproved: 0 };
    const ui = agg.utilizationBands[ub];
    ui.sub++; if (isApproved) ui.approved++; if (isBooked) ui.booked++; if (isStp) ui.stp++;
    if (matched) { ui.acqMatched++; ui.acqRows++; if (isApproved) ui.acqApproved++; }

    // DBR
    const db = dbrBand(f.estimatedDBR);
    const di = agg.dbrBands[db] || (agg.dbrBands[db] = { sub: 0, approved: 0, booked: 0, stp: 0 });
    di.sub++; if (isApproved) di.approved++; if (isBooked) di.booked++; if (isStp) di.stp++;

    // Score reasons
    f.scoreReasons.forEach((r, i) => {
      agg.scoreReasonFreq[r] = (agg.scoreReasonFreq[r] || 0) + 1;
      if (!agg.scoreReasonDescs[r] && f.scoreReasonTexts[i])
        agg.scoreReasonDescs[r] = f.scoreReasonTexts[i];
    });

    // Income match
    if (acq && f.simahIncome > 0) {
      const declared = parseFloat(acq.Income) || 0;
      if (declared > 0) {
        const ratio = declared / f.simahIncome;
        if (ratio >= 0.8 && ratio <= 1.2) agg.incomeMatch.match++;
        else agg.incomeMatch.mismatch++;
      } else agg.incomeMatch.noData++;
    } else agg.incomeMatch.noData++;

    // Decline by score
    if (acq && !isApproved && acq.SimplifiedDeclinedReason) {
      const dbs = agg.declineByScore[sb] || (agg.declineByScore[sb] = {});
      dbs[acq.SimplifiedDeclinedReason] = (dbs[acq.SimplifiedDeclinedReason] || 0) + 1;
    }

    // Shopping bands
    const shopB = shoppingBand(f.enq90);
    if (!agg.shoppingBands[shopB]) agg.shoppingBands[shopB] = { sub: 0, approved: 0, booked: 0 };
    agg.shoppingBands[shopB].sub++;
    if (isApproved) agg.shoppingBands[shopB].approved++;
    if (isBooked) agg.shoppingBands[shopB].booked++;

    // Enquiry aggregations
    for (const [k, v] of Object.entries(f.enqByMember || {})) agg.enqByMember[k] = (agg.enqByMember[k] || 0) + v;
    for (const [k, v] of Object.entries(f.enqByProduct || {})) agg.enqByProduct[k] = (agg.enqByProduct[k] || 0) + v;
    for (const [k, v] of Object.entries(f.enqByType || {})) agg.enqByType[k] = (agg.enqByType[k] || 0) + v;
    for (const [k, v] of Object.entries(f.enqByMonth || {})) agg.enqByMonth[k] = (agg.enqByMonth[k] || 0) + v;
    for (const [k, v] of Object.entries(f.enqByYear || {})) agg.allYears.add(k);
    agg.totalEnquiries += f.totalEnquiries;

    // Institution loan stats
    for (const [inst, cnt] of Object.entries(f.activeCreditors || {})) {
      if (!agg.institutionLoanStats[inst]) agg.institutionLoanStats[inst] = { loans: 0, customers: 0 };
      agg.institutionLoanStats[inst].loans += cnt;
      agg.institutionLoanStats[inst].customers++;
    }

    // UCFS avg fin amount
    if (matched && acq.FIN_AMOUNT) {
      ucfsSum += parseFloat(acq.FIN_AMOUNT) || 0;
      ucfsN++;
    }

    // Raw record
    if (agg.rawRecords.length < 5000) {
      const topComp = Object.entries(f.competitors).sort((a,b)=>b[1]-a[1]).slice(0,7)
        .map(([name,cnt])=>({name,cnt}));
      agg.rawRecords.push({
        civilId: f.civilId ? f.civilId.slice(0, 4) + '****' + f.civilId.slice(-2) : 'N/A',
        name: f.name,
        score: f.score,
        scoreCard: f.scoreCard,
        scoreReasons: f.scoreReasons,
        scoreReasonTexts: f.scoreReasonTexts,
        enq90: f.enq90, enq30: f.enq30, enq180: f.enq180,
        totalEnquiries: f.totalEnquiries,
        enquiriesThisMonth: f.enquiriesThisMonth,
        activeLoans: f.activeLoans,
        activeCreditInstruments: f.activeCreditInstruments,
        bnpl: f.bnplCount, bnplBalance: f.bnplBalance,
        totalLimits: f.totalLimits, totalLiabilities: f.totalLiabilities,
        utilization: f.utilization,
        totalOutstanding: f.totalOutstanding, totalPastDue: f.totalPastDue,
        totalInstallments: f.totalInstallments,
        estDBR: f.estimatedDBR,
        defaults: f.defaultCount, defaultsSettled: f.defaultsSettled, defaultsActive: f.defaultsActive,
        totalDefaultAmt: f.totalDefaults,
        currentDelinquent: f.currentDelinquent,
        simahIncome: f.simahIncome,
        employerName: f.employerName,
        nationality: f.nationality,
        gender: f.gender,
        maritalStatus: f.maritalStatus,
        city: f.city,
        topCompetitors: topComp,
        eq: f.enquiryDetails || [],
        outcome: matched ? (acq.Altitudestatus || 'Matched') : 'No match',
        stp: isStp ? 'Y' : 'N',
        approved: isApproved ? 'Y' : 'N',
        booked: isBooked ? 'Y' : 'N',
        declineReason: acq?.SimplifiedDeclinedReason || '',
        deDecision: acq?.DE_Decision || '',
        lightDE: acq?.Light_DE_Decision || '',
        store: acq?.StoreNameOnline || acq?.StoreName || '',
        region: acq?.Region || '',
        product: acq?.Product_type || '',
        source: acq?.SubmitSource || '',
        submitted: acq?.submitted || '',
        riskRating: acq?.RiskRating || '',
        scRiskGrade: acq?.SC_RiskGrade || '',
        declaredIncome: parseFloat(acq?.Income) || 0,
        incomeBand: acq?.DeclaredIncomeBand || '',
        ageBand: acq?.AgeBand || '',
        revisedDBR: acq?.Revised_DBR || '',
        smhDBR: acq?.SMH_CurrentDBR || '',
        smhInstallments: acq?.SMH_MonthlyInstalments || '',
        smhScore: acq?.SMH_Score || '',
        smhBand: acq?.SMHBand || '',
        gosiCalled: acq?.Is_GOSI_Called || '',
        mofCalled: acq?.Is_MOF_Called || '',
        employerType: acq?.FinalEmployerType || ''
      });
    }
  });

  agg.allYears = [...agg.allYears].sort();
  agg.ucfsAvgFinAmount = ucfsN ? Math.round(ucfsSum / ucfsN) : 0;

  // Enquirer/product/type name maps
  features.forEach(f => {
    f.enquiryDetails?.forEach(eq => {
      if (eq[0]) agg.enquirerNames[eq[0]] = eq[0];
      if (eq[1]) agg.productNames[eq[1]] = eq[1];
      if (eq[2]) agg.typeNames[eq[2]] = eq[2];
    });
  });

  return agg;
}

// --- Find latest acquisition CSV ---
function findLatestAcqFile() {
  return fs.readdirSync(ROOT)
    .filter(f => /^Acquisition_for_Loans_\d{4}-\d{2}-\d{2}\.csv$/i.test(f))
    .sort().pop();
}

// ═══════════════════════ MAIN ═══════════════════════
console.log('=== SIMAH Intelligence Updater (combined file) ===');
console.log(`Input: ${COMBINED_FILE}`);

// Read combined file — one JSON report per line
const lines = fs.readFileSync(COMBINED_FILE, 'utf-8').split(/\r?\n/).filter(l => l.trim());
console.log(`Found ${lines.length} lines`);

const features = [];
let parseErrors = 0;
lines.forEach((line, i) => {
  try {
    const rep = JSON.parse(line);
    const f = extractFeatures(rep);
    if (f.civilId) features.push(f);
    else parseErrors++;
  } catch (e) {
    parseErrors++;
    if (parseErrors <= 5) console.warn(`  Line ${i+1} parse error: ${e.message.slice(0,80)}`);
  }
});
console.log(`Extracted features from ${features.length} reports (${parseErrors} errors)`);

// Read acquisition CSV
const acqFile = findLatestAcqFile();
let acqMap = {};
if (acqFile) {
  console.log(`Reading ${acqFile}…`);
  const rows = readCsv(path.join(ROOT, acqFile));
  console.log(`  ${rows.length.toLocaleString()} acquisition rows`);
  rows.forEach(r => { if (r.CivilID) acqMap[r.CivilID] = r; });
  console.log(`  ${Object.keys(acqMap).length.toLocaleString()} unique CivilIDs`);
} else {
  console.warn('No Acquisition CSV found — running SIMAH-only analysis');
}

// Build aggregates
console.log('Aggregating…');
const agg = buildAggregates(features, acqMap);
agg.meta.simahFiles = features.length;
agg.meta.parseErrors = parseErrors;
agg.meta.acqFile = acqFile || 'none';

// Inject into HTML
console.log('Updating SIMAH_Intelligence.html…');
const htmlTemplate = fs.readFileSync(HTML_OUT, 'utf-8');
const dataLine = `const SIMAH_DATA = ${JSON.stringify(agg)};`;
const marker = 'const SIMAH_DATA = {';
const startIdx = htmlTemplate.indexOf(marker);
if (startIdx === -1) {
  console.error('ERROR: Could not find SIMAH_DATA marker in HTML template');
  process.exit(1);
}
// Find the end of the SIMAH_DATA assignment (match balanced braces then semicolon)
let depth = 0, endIdx = startIdx + marker.length - 1;
for (let i = endIdx; i < htmlTemplate.length; i++) {
  if (htmlTemplate[i] === '{') depth++;
  else if (htmlTemplate[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
}
// Include the trailing semicolon
if (htmlTemplate[endIdx] === ';') endIdx++;

const updated = htmlTemplate.slice(0, startIdx) + dataLine + htmlTemplate.slice(endIdx);
fs.writeFileSync(HTML_OUT, updated, 'utf-8');

console.log(`\nDone — ${features.length} SIMAH reports processed, ${agg.meta.matched} matched to acquisitions.`);
console.log(`Score distribution: ${JSON.stringify(agg.scoreDistribution)}`);
