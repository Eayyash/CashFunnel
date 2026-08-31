/**
 * "CocoNut v2" tab data builder: for every Tasheel customer with a
 * COMPLETED booked contract (Altitudestatus === 'Completed [C]' in
 * Acquisition_for_Loans_all_merged.csv), lists every ACTIVE competitor
 * loan reported to SIMAH whose product type is a genuine personal-finance
 * product (Personal Loan / Top-Up Loan / Consumer Durables Loan / Social
 * Loan / Microfinance) -- deliberately excluding Buy Now Pay Later, Mobile
 * Phone, Credit Card, Mortgage, Car Lease, etc. even though those also
 * appear as SIMAH-reported credit instruments -- so it's an apples-to-
 * apples "what we give our customers vs. what they're also carrying
 * elsewhere" comparison, not a general credit-exposure dump (that's what
 * the original CocoNut tab is for).
 *
 * "Attached sheet" UCFS details (app status, item value, approved tenure,
 * profit amount, sales completed date) all live directly in
 * Acquisition_for_Loans_all_merged.csv -- confirmed by inspection, no
 * separate file needed:
 *   Altitudestatus, ItemValue, TENURE, PROFIT_AMOUNT, SalesCompletedDate
 *
 * Row grain: one row per (customer, competitor loan) -- if a customer has
 * loans with 2+ different lenders they ALL appear as separate rows, never
 * combined into one column/cell.
 *
 * IMPORTANT -- this version no longer cross-references OverView.xlsx (the
 * source behind Holistic_View.html / the original CocoNut tab). The first
 * build did (bridging via StagingID, same as build_coconut_matches.js),
 * but OverView.xlsx turned out to be a STALE snapshot (snapDate 2026-07-31,
 * file last modified Aug 9) while Acquisition_for_Loans_all_merged.csv and
 * the SIMAH archive are both current through the latest daily merge -- so
 * requiring StagingID membership in that stale portfolio was silently
 * dropping every customer who completed a loan in August. Altitudestatus
 * === 'Completed [C]' in the (always-current) Acquisition CSV is already
 * the authoritative "genuinely booked" signal used elsewhere in this same
 * codebase (see the BOOKED set in backfill_simah_rawrecords.js), so it's
 * used alone here now -- no OverView.xlsx dependency, no staleness risk,
 * and it also makes this script much faster (no more streaming the 273MB/
 * 422K-row xlsx).
 *
 * Usage: node --max-old-space-size=8192 scripts/build_coconut_v2.js
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'SIMAH_Intelligence.html');
const ARCHIVE_DIR = path.join('C:', 'Users', 'Emad.Ayyash', 'OneDrive - tasheelfinance', 'Documents', 'EIA Work', 'AI-Work', 'SIMAH Qarar JSON');
const ACQ_CSV = path.join(ROOT, 'Acquisition_for_Loans_all_merged.csv');

function parseCsvLine(line) {
  const r = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
    else { if (c === '"') inQ = true; else if (c === ',') { r.push(cur); cur = ''; } else cur += c; }
  }
  r.push(cur);
  return r;
}

// civilId -> [{stagingId, itemValue, tenure, profitAmount, salesCompletedDate, product}]
// Altitudestatus === 'Completed [C]' ("app status completed") is the ONLY
// gate now -- no OverView.xlsx portfolio membership required (see header
// comment: that file is a stale snapshot and was silently dropping recent
// completions).
function buildCompletedAcqByCivil() {
  console.log('Reading', ACQ_CSV, 'for completed UCFS loan details (ItemValue/Tenure/ProfitAmount/SalesCompletedDate)…');
  const lines = fs.readFileSync(ACQ_CSV, 'utf-8').split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const idx = name => headers.indexOf(name);
  const iStaging = idx('StagingID'), iCivil = idx('CivilID'), iAlt = idx('Altitudestatus'),
    iItem = idx('ItemValue'), iTenure = idx('TENURE'), iProfit = idx('PROFIT_AMOUNT'),
    iSales = idx('SalesCompletedDate'), iProd = idx('Product_type'), iSubmitted = idx('submitted');
  const map = new Map(); // civilId -> array of completed-loan records
  let completedCount = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const vals = parseCsvLine(lines[i]);
    const sid = vals[iStaging], civ = (vals[iCivil] || '').trim(), alt = vals[iAlt];
    if (!sid || !civ) continue;
    if (alt !== 'Completed [C]') continue;
    completedCount++;
    let arr = map.get(civ);
    if (!arr) { arr = []; map.set(civ, arr); }
    arr.push({
      stagingId: sid,
      itemValue: Math.round(Number(vals[iItem])) || null,
      tenure: Number(vals[iTenure]) || null,
      profitAmount: Math.round(Number(vals[iProfit])) || null,
      salesCompletedDate: vals[iSales] || '',
      product: vals[iProd] || '',
      submitted: vals[iSubmitted] || ''
    });
  }
  console.log(`  ${map.size.toLocaleString()} unique civilIds have >=1 completed loan (${completedCount.toLocaleString()} completed rows total)`);
  return map;
}

// Personal-finance product types only -- deliberately excludes Buy Now Pay
// Later (the single largest SIMAH product type by volume), Mobile Phone,
// Credit Card, Mortgage, Car Lease, etc.
const ALLOWED_PRODUCT_TYPES = new Set([
  'Personal Loan', 'Top-Up Loan', 'Consumer Durables Loan', 'Social Loan', 'Microfinance'
]);
const COMPETITOR_CATEGORY = {
  'Tamara Finance Company': 'BNPL', 'AL RAJHI BANK': 'Bank', 'Tabby Finance Company': 'BNPL',
  'Emkan Company for Financing': 'NBFI', 'Saudi National Bank': 'Bank', 'STC Bank': 'Bank',
  'TAMAM Finance': 'NBFI', 'QUARA FINANCE': 'NBFI', 'ARAB NATIONAL BANK': 'Bank',
  'ABDUL LATIF JAMEEL': 'NBFI', 'Saudi Awwal Bank': 'Bank', 'IJARAH FINANCE': 'NBFI',
  'SAUDI FRANSI FINANCING AND LEASING COMPANY': 'NBFI', 'AMLAK': 'NBFI', 'RIYADH BANK': 'Bank',
  'SOCIAL DEVELOPMENT BANK': 'Bank', 'EMIRATES BANK': 'Bank', 'REAL ESTATE DEVELOPMENT FUND': 'Bank',
  'ALINMA BANK': 'Bank',
  'MADFU Ltd': 'BNPL',
  'BANK ALJAZIRA': 'Bank', 'BANK AL BILAD': 'Bank', 'BANQUE SAUDI FRANSI': 'Bank',
  'GULF INTERNATIONAL BANK': 'Bank', 'THE SAUDI INVESTMENT BANK': 'Bank',
  'D360 Bank': 'Bank', 'FIRST ABU DHABI BANK': 'Bank',
  'AGRICULTURAL DEVELOPMENT FUND': 'Bank', 'ANB INVEST': 'Bank', 'NCB CAPITAL': 'Bank',
  'ALBilad investment Company': 'Bank',
  'NAYIFAT FINANCE COMPANY': 'NBFI', 'AL YUSR INSTALLMENT CO': 'NBFI', 'Tamweel Aloula': 'NBFI',
  'NATIONAL FINANCE COMPANY': 'NBFI', 'TAAJEER FINANCE': 'NBFI', 'RAYA FINANCING': 'NBFI',
  'SAUDI FINANCE COMPANY': 'NBFI', 'Sanad Finance Company': 'NBFI', 'NATIONAL FINANCE HOUSE': 'NBFI',
  'AL JABR FINANCING CORPORATION': 'NBFI', 'OSOUL MODERN FINANCE CO LTD': 'NBFI',
  'DERAYAH FINANCIAL COMPANY': 'NBFI', 'SHL Finance Company': 'NBFI',
  'MASAR ALNUMOU FINANCE COMPANY': 'NBFI', 'BIDAYA FINANCE COMPANY': 'NBFI',
  'Modern Integrated Solutions Financing Company': 'NBFI', 'Tokilat Finance Company': 'NBFI',
  'LOAN FOR FINANCE': 'NBFI', 'Eitmed Finance Company': 'NBFI', 'Tamwily International Company': 'NBFI',
  'TAAJEER COMPANY': 'NBFI', 'TAAJEER GULF CO': 'NBFI', 'DAR AL TAMLEEK': 'NBFI',
  'DAR ALETIMAN ALSAUDI INSTALLMENT': 'NBFI', 'MORABAHA MARENA': 'NBFI',
  'MATAJR INSTALLMENT COMPANY': 'NBFI', 'NAMA United Financing': 'NBFI', 'TAMKEEN INSTALLMENT CO': 'NBFI',
  'Alan Khaleejia Microfinancing Company': 'NBFI', 'SEWLAH FOR TRADING AND INSTALLMENT': 'NBFI',
  'SULFAH': 'NBFI', 'Seulah al awla': 'NBFI', 'MONEYMOON': 'NBFI', 'GO Money': 'NBFI',
  'MOHOUR EL TEMKIN': 'NBFI', 'EL ALOW FINNACIAL CO RIZE': 'NBFI', 'Fuel Finance': 'NBFI',
  'Alpha Arabia Finance': 'NBFI'
};
function competitorCategory(name) { return COMPETITOR_CATEGORY[(name || '').trim()] || 'Other'; }
function findReport(obj, depth) {
  depth = depth || 0;
  if (!obj || typeof obj !== 'object' || depth > 10) return null;
  if (Array.isArray(obj)) { for (const item of obj) { const r = findReport(item, depth + 1); if (r) return r; } return null; }
  if (obj.providedDemographicsInfo || obj.availableDemographicsInfo) return obj;
  for (const k of Object.keys(obj)) { const v = obj[k]; if (v && typeof v === 'object') { const r = findReport(v, depth + 1); if (r) return r; } }
  return null;
}
function asArray(x) { if (x == null) return []; return Array.isArray(x) ? x : [x]; }
function parseDMY(s) { const p = (s || '').split('/'); return p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]) : null; }

async function main() {
  console.log('=== CocoNut v2: Completed UCFS loans x SIMAH active personal-finance competitor loans ===');
  const acqByCivil = buildCompletedAcqByCivil();

  const files = fs.readdirSync(ARCHIVE_DIR).filter(f => /\.csv$/i.test(f)).sort();
  console.log(`${files.length} archived SIMAH files to scan for matches`);

  const rows = []; // {civilId(masked), stagingId, tasheelProduct, itemValue, approvedTenure, profitAmount, salesCompletedDate, institution, category, competitorProductType, amount, installment, tenure, rate, issuedDate}
  let totalScanned = 0, matchedCustomers = 0;
  for (const fn of files) {
    const fp = path.join(ARCHIVE_DIR, fn);
    console.log(`Reading ${fn}…`);
    const rl = readline.createInterface({ input: fs.createReadStream(fp, { encoding: 'utf-8' }), crlfDelay: Infinity });
    let headers = null, idxJson = -1, n = 0;
    for await (const line of rl) {
      if (!headers) { headers = parseCsvLine(line); idxJson = headers.indexOf('JSON_Response'); continue; }
      try {
        const vals = parseCsvLine(line);
        const jsonStr = vals[idxJson];
        if (!jsonStr) continue;
        const rep = findReport(JSON.parse(jsonStr));
        if (!rep) continue;
        const civilId = rep.providedDemographicsInfo?.demIDNumber || rep.availableDemographicsInfo?.demIDNumber || null;
        if (!civilId) continue;
        totalScanned++;
        const acqLoans = acqByCivil.get(civilId);
        if (!acqLoans || !acqLoans.length) continue; // no completed portfolio StagingID for this customer

        // Most recent completed StagingID (by SalesCompletedDate) represents
        // "the" UCFS loan we compare against for this customer.
        const latestAcq = acqLoans.slice().sort((a, b) => (b.salesCompletedDate || '').localeCompare(a.salesCompletedDate || ''))[0];

        const cis = asArray(rep.creditInstrumentDetails);
        const perInst = {}; // institution -> latest matching instrument
        cis.forEach(ci => {
          if (ci.ciStatus?.creditInstrumentStatusCode !== 'A') return; // active only
          const prodType = (ci.ciProductTypeDesc?.textEn || '').trim();
          if (!ALLOWED_PRODUCT_TYPES.has(prodType)) return; // personal-finance product types only
          const cred = ci.ciCreditor?.memberNameEN || 'Unknown';
          if (cred.trim() === 'United Company for Financial Services') return; // UCFS is Tasheel itself, not a competitor
          const amount = Number(ci.ciLimit) || 0;
          const installment = Number(ci.ciInstallmentAmount) || 0;
          const tenureMonths = Number(ci.ciTenure) || 0;
          let annualRatePct = null;
          if (amount > 0 && tenureMonths > 0 && installment > 0) {
            const flatRate = ((installment * tenureMonths / amount) - 1) * (12 / tenureMonths);
            if (isFinite(flatRate)) annualRatePct = Math.round(flatRate * 100 * 10) / 10;
          }
          const issuedDate = ci.ciIssuedDate || '';
          const d = parseDMY(issuedDate);
          const key = cred + '|' + prodType; // don't merge different product types from the same lender
          const existing = perInst[key];
          if (!existing || (d && (!existing.date || d > existing.date))) {
            perInst[key] = {
              institution: cred, category: competitorCategory(cred), competitorProductType: prodType,
              amount: Math.round(amount), installment: Math.round(installment) || null, tenure: tenureMonths || null,
              rate: annualRatePct, issuedDate, date: d
            };
          }
        });
        const instKeys = Object.keys(perInst);
        if (!instKeys.length) continue;
        matchedCustomers++;
        instKeys.forEach(key => {
          const l = perInst[key];
          rows.push({
            civilId: civilId.slice(0, 4) + '****' + civilId.slice(-2),
            stagingId: latestAcq.stagingId,
            tasheelProduct: latestAcq.product,
            itemValue: latestAcq.itemValue,
            approvedTenure: latestAcq.tenure,
            profitAmount: latestAcq.profitAmount,
            salesCompletedDate: latestAcq.salesCompletedDate,
            submitted: latestAcq.submitted,
            institution: l.institution, category: l.category, competitorProductType: l.competitorProductType,
            amount: l.amount, installment: l.installment, tenure: l.tenure, rate: l.rate, issuedDate: l.issuedDate
          });
        });
        n++;
      } catch (e) { /* skip malformed row */ }
    }
    console.log(`  ${n} portfolio matches found in this file`);
  }
  console.log(`Total: ${totalScanned.toLocaleString()} SIMAH records scanned, ${matchedCustomers.toLocaleString()} completed-UCFS customers have >=1 active personal-finance competitor loan, ${rows.length.toLocaleString()} (customer, institution, product type) rows`);

  // By-competitor summary using AVERAGES (not medians), per user instruction.
  const byInst = {}; // institution -> {category, count, itemValueSum/N, profitAmountSum/N, amountSum, installmentSum, rateSum/N}
  rows.forEach(r => {
    const k = r.institution;
    if (!byInst[k]) byInst[k] = { institution: k, category: r.category, count: 0, itemValueSum: 0, itemValueN: 0, profitAmountSum: 0, profitAmountN: 0, amountSum: 0, installmentSum: 0, installmentN: 0, rateSum: 0, rateN: 0 };
    const b = byInst[k];
    b.count++;
    if (r.itemValue != null) { b.itemValueSum += r.itemValue; b.itemValueN++; }
    if (r.profitAmount != null) { b.profitAmountSum += r.profitAmount; b.profitAmountN++; }
    b.amountSum += r.amount;
    if (r.installment != null) { b.installmentSum += r.installment; b.installmentN++; }
    if (r.rate != null) { b.rateSum += r.rate; b.rateN++; }
  });
  const competitorAverages = Object.values(byInst).map(b => ({
    institution: b.institution, category: b.category, count: b.count,
    avgTasheelItemValue: b.itemValueN ? Math.round(b.itemValueSum / b.itemValueN) : null,
    avgTasheelProfitAmount: b.profitAmountN ? Math.round(b.profitAmountSum / b.profitAmountN) : null,
    avgCompetitorAmount: Math.round(b.amountSum / b.count),
    avgCompetitorInstallment: b.installmentN ? Math.round(b.installmentSum / b.installmentN) : null,
    avgCompetitorRate: b.rateN ? Math.round(b.rateSum / b.rateN * 10) / 10 : null
  })).sort((a, b) => b.count - a.count);

  console.log('By institution (avg competitor amount / avg rate):');
  competitorAverages.forEach(c => console.log(`  ${c.institution.padEnd(48)} n=${c.count} avgAmt=SAR ${c.avgCompetitorAmount} avgRate=${c.avgCompetitorRate}%`));

  const blob = `const COCONUT_V2_DATA = ${JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString().slice(0, 10),
      completedCustomers: acqByCivil.size,
      matchedCustomers, archiveFiles: files.length,
      allowedProductTypes: [...ALLOWED_PRODUCT_TYPES]
    },
    rows, competitorAverages
  })};\n`;
  const startTag = 'const COCONUT_V2_DATA = ';
  const html = fs.readFileSync(HTML, 'utf-8');
  const s2 = html.indexOf(startTag);
  let newHtml;
  if (s2 !== -1) {
    const endMatch = /\};\r?\n/.exec(html.slice(s2));
    const e2 = s2 + endMatch.index + 1;
    newHtml = html.slice(0, s2) + blob + html.slice(e2);
    console.log('(replaced existing COCONUT_V2_DATA)');
  } else {
    const anchor = 'const SIMAH_ORIG';
    const ai = html.indexOf(anchor);
    if (ai === -1) { console.error('Could not find insertion anchor (const SIMAH_ORIG)'); process.exit(1); }
    newHtml = html.slice(0, ai) + blob + html.slice(ai);
    console.log('(inserted new COCONUT_V2_DATA)');
  }
  fs.writeFileSync(HTML, newHtml, 'utf-8');
  console.log('✅ Done.');
}
main();
