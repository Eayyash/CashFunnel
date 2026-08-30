/**
 * For each competitor company in SIMAH_Intelligence.html's Competitors List
 * (Banks + NBFI), find the customers who booked with UCFS AND had a loan at
 * that company, then pull UCFS's OWN booked terms for those exact same
 * customers straight from the Acquisition system (ItemValue = ticket size,
 * PROFIT_RATE = the real profit rate on their UCFS contract) — a genuine
 * apples-to-apples comparison, not the SIMAH self-reported proxy used for
 * the Buy-Out Conversions benchmark bubble.
 *
 * Join key: rawRecords already carries stagingId (computed at merge time
 * from the full, unmasked CivilID — the masked civilId shown in the UI
 * can't be joined back, but stagingId can).
 *
 * Usage: node scripts/build_ucfs_company_compare.js
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'SIMAH_Intelligence.html');
const MERGED_CSV = path.join(ROOT, 'Acquisition_for_Loans_all_merged.csv');

console.log('=== UCFS vs. each company (Banks + NBFI) builder ===');

console.log('Reading SIMAH_Intelligence.html…');
const html = fs.readFileSync(HTML, 'utf-8');
const marker = 'const SIMAH_DATA = ';
const si = html.indexOf(marker);
const endTag = ';\nlet D = SIMAH_DATA;';
const se = html.indexOf(endTag, si);
if (si < 0 || se < 0) { console.error('Could not locate SIMAH_DATA blob'); process.exit(1); }
const D = JSON.parse(html.slice(si + marker.length, se));
console.log(`  ${D.rawRecords.length.toLocaleString()} rawRecords`);

// Most-recent SIMAH pull per customer, booked with UCFS, has a competitor
// loan on file — identical population to renderCompetitorsList().
const seenCiv = new Set();
const recs = (D.rawRecords || []).filter(r => {
  if (r.booked !== 'Y') return false;
  if (!(r.competitorLoans || []).length) return false;
  const key = r.civilId || ('_' + Math.random());
  if (seenCiv.has(key)) return false;
  seenCiv.add(key);
  return true;
});
console.log(`  ${recs.length.toLocaleString()} booked-with-UCFS customers with a competitor loan on file`);

function parseDMY(s) {
  const p = (s || '').split('/');
  return p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]) : null;
}

// Per company: {category, count, rateSum, rateN, amountSum, amountN, stagingIds:Set}
const byInst = {};
recs.forEach(r => {
  if (!r.stagingId) return; // can't join back to Acquisition without it
  const perCustInst = {};
  (r.competitorLoans || []).forEach(l => {
    if (l.category !== 'Bank' && l.category !== 'NBFI') return;
    const d = parseDMY(l.issuedDate);
    const existing = perCustInst[l.institution];
    if (!existing || (d && (!existing.date || d > existing.date))) {
      perCustInst[l.institution] = {
        category: l.category,
        rate: (l.annualRatePct != null && l.annualRatePct >= 0) ? l.annualRatePct : null,
        amount: (l.amount > 0) ? l.amount : null,
        date: d
      };
    }
  });
  Object.entries(perCustInst).forEach(([inst, p]) => {
    if (!byInst[inst]) byInst[inst] = { institution: inst, category: p.category, count: 0, rateSum: 0, rateN: 0, amountSum: 0, amountN: 0, stagingIds: new Set() };
    const b = byInst[inst];
    b.count++;
    if (p.rate != null) { b.rateSum += p.rate; b.rateN++; }
    if (p.amount != null) { b.amountSum += p.amount; b.amountN++; }
    b.stagingIds.add(r.stagingId);
  });
});
const companies = Object.values(byInst);
console.log(`  ${companies.length} companies (Bank+NBFI) with booked-with-UCFS customers`);

// Map every needed StagingID -> list of company institutions it belongs to.
const stagingToCompanies = new Map();
companies.forEach(c => {
  c.stagingIds.forEach(sid => {
    if (!stagingToCompanies.has(sid)) stagingToCompanies.set(sid, []);
    stagingToCompanies.get(sid).push(c.institution);
  });
});
console.log(`  ${stagingToCompanies.size} unique StagingIDs to look up in Acquisition`);

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

const BOOKED = new Set(['Completed [C]', 'Pending Final Approval']);

async function main() {
  console.log('Streaming Acquisition_for_Loans_all_merged.csv…');
  const rl = readline.createInterface({ input: fs.createReadStream(MERGED_CSV, { encoding: 'utf-8' }), crlfDelay: Infinity });
  let headers = null, idxStaging = -1, idxStatus = -1, idxItemValue = -1, idxProfitRate = -1;
  const ucfsByInst = {}; // institution -> {valSum, valN, rateSum, rateN}
  let n = 0, matched = 0;
  for await (const line of rl) {
    if (!headers) {
      headers = parseCsvLine(line);
      idxStaging = headers.indexOf('StagingID');
      idxStatus = headers.indexOf('Altitudestatus');
      idxItemValue = headers.indexOf('ItemValue');
      idxProfitRate = headers.indexOf('PROFIT_RATE');
      continue;
    }
    n++;
    const sid = line.slice(0, line.indexOf(',')); // StagingID is column 1 — cheap pre-check before full parse
    if (!stagingToCompanies.has(sid)) continue;
    const vals = parseCsvLine(line);
    const status = vals[idxStatus] || '';
    if (!BOOKED.has(status)) continue;
    const val = parseFloat(vals[idxItemValue]);
    // PROFIT_RATE is stored as a decimal fraction (0.1441 = 14.41%), not a
    // raw percentage — confirmed against real booked rows.
    const rate = parseFloat(vals[idxProfitRate]) * 100;
    const insts = stagingToCompanies.get(sid) || [];
    insts.forEach(inst => {
      if (!ucfsByInst[inst]) ucfsByInst[inst] = { valSum: 0, valN: 0, rateSum: 0, rateN: 0 };
      const u = ucfsByInst[inst];
      if (!isNaN(val) && val > 0) { u.valSum += val; u.valN++; }
      if (!isNaN(rate)) { u.rateSum += rate; u.rateN++; }
    });
    matched++;
  }
  console.log(`  ${n.toLocaleString()} rows scanned, ${matched.toLocaleString()} matched rows contributed`);

  const result = companies.map(c => {
    const u = ucfsByInst[c.institution] || { valSum: 0, valN: 0, rateSum: 0, rateN: 0 };
    return {
      institution: c.institution,
      category: c.category,
      count: c.count,
      companyAvgTicket: c.amountN ? Math.round(c.amountSum / c.amountN) : null,
      companyAvgRate: c.rateN ? Math.round(c.rateSum / c.rateN * 10) / 10 : null,
      ucfsAvgTicket: u.valN ? Math.round(u.valSum / u.valN) : null,
      ucfsAvgRate: u.rateN ? Math.round(u.rateSum / u.rateN * 10) / 10 : null,
      ucfsN: u.valN
    };
  }).filter(c => c.ucfsN > 0).sort((a, b) => b.count - a.count);

  console.log('Results:');
  result.forEach(r => console.log(`  ${r.institution} (${r.category}): ${r.count} cust, company avg ticket SAR ${r.companyAvgTicket}/rate ${r.companyAvgRate}% vs UCFS avg ticket SAR ${r.ucfsAvgTicket}/rate ${r.ucfsAvgRate}%`));

  const blob = `const UCFS_VS_COMPANY = ${JSON.stringify({ meta: { generatedAt: new Date().toISOString().slice(0, 10) }, companies: result })};\n`;
  const startTag = 'const UCFS_VS_COMPANY = ';
  const html2 = fs.readFileSync(HTML, 'utf-8');
  const s2 = html2.indexOf(startTag);
  let newHtml;
  if (s2 !== -1) {
    const endMatch = /\};\r?\n/.exec(html2.slice(s2));
    const e2 = s2 + endMatch.index + 1;
    newHtml = html2.slice(0, s2) + blob + html2.slice(e2);
    console.log('(replaced existing UCFS_VS_COMPANY)');
  } else {
    const anchor = 'const SIMAH_ORIG';
    const ai = html2.indexOf(anchor);
    if (ai === -1) { console.error('Could not find insertion anchor (const SIMAH_ORIG)'); process.exit(1); }
    newHtml = html2.slice(0, ai) + blob + html2.slice(ai);
    console.log('(inserted new UCFS_VS_COMPANY)');
  }
  fs.writeFileSync(HTML, newHtml, 'utf-8');
  console.log('✅ Done.');
}
main();
