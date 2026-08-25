const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML_FILE = path.join(ROOT, 'Acquisition_Command_Dashboard.html');

// --- Find the latest Acquisition_for_Loans file ---
function findLatestFile() {
  const files = fs.readdirSync(ROOT)
    .filter(f => /^Acquisition_for_Loans_\d{4}-\d{2}-\d{2}\.(csv|xlsx)$/i.test(f))
    .sort();
  if (!files.length) throw new Error('No Acquisition_for_Loans files found in ' + ROOT);
  return files[files.length - 1];
}

// --- CSV parser ---
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

// --- Aggregation (mirrors buildDaily in the dashboard HTML) ---
const CONFIG = { bookCol: 'SalesCompletedDate' };
const BOOKED_SET = new Set(['Completed [C]', 'Pending Final Approval']);
const DIMCOL = {
  employer: 'FinalEmployerType', nationality: 'Nationality_Flag',
  income: 'DeclaredIncomeBand', risk: 'RiskRating', simah: 'SC_RiskGrade',
  age: 'AgeBand', gender: 'Gender', marital: 'MaritalStatus',
  product: 'Product_type', source: 'SubmitSource', scoreband: 'AppScoreBand',
  dbr: 'CurrentDBRBand'
};
const LONGCOL = { store: 'StoreName', city: 'CITY', natdetail: 'NATIONALITY' };

function gv(r, k) {
  const v = r[k];
  return (v == null || v === '') ? 'Unknown' : String(v).trim() || 'Unknown';
}

function toYMD(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function buildDaily(rows, name) {
  const cnt = { store: {}, city: {}, natdetail: {} };
  rows.forEach(r => {
    for (const k in LONGCOL) {
      const v = gv(r, LONGCOL[k]);
      cnt[k][v] = (cnt[k][v] || 0) + 1;
    }
  });
  const top = {};
  for (const k in cnt) {
    top[k] = new Set(
      Object.entries(cnt[k]).sort((a, b) => b[1] - a[1]).slice(0, 20).map(x => x[0])
    );
  }

  const ALLD = [...Object.keys(DIMCOL), ...Object.keys(LONGCOL)];
  const days = {};
  const bucket = d => days[d] || (days[d] = {
    k: { sub: 0, init: 0, final: 0, book: 0, val: 0, tsum: 0, tn: 0, clim_sum: 0, clim_n: 0, utilsum: 0, utiln: 0 },
    d: {}, mg: { sub: {}, book: {} }, dec: {}
  });
  const inc = (m, k) => { if (k != null) m[k] = (m[k] || 0) + 1; };

  rows.forEach(r => {
    const sd = toYMD(r['submitted']);
    const booked = BOOKED_SET.has(String(r['Altitudestatus']));
    const initA = r['Approvalflag'] === 'Y';
    const fin = r['FinalApprovalFlag'] === 'Y';
    const reg = (r['is_panda'] == 1 || r['is_panda'] === '1') ? 'Panda' : gv(r, 'Region');
    const dval = {};
    for (const k in DIMCOL) dval[k] = gv(r, DIMCOL[k]);
    dval.region = reg;
    for (const k in LONGCOL) {
      const v = gv(r, LONGCOL[k]);
      dval[k] = top[k].has(v) ? v : 'Other';
    }
    const emp = dval.employer;
    const gosi = r['Is_GOSI_Called'], mof = r['Is_MOF_Called'];

    if (sd) {
      const b = bucket(sd);
      b.k.sub++;
      if (initA) b.k.init++;
      if (fin) b.k.final++;
      for (const dm of ALLD) {
        const dd = b.d[dm] || (b.d[dm] = { sub: {}, init: {}, book: {}, bval: {} });
        inc(dd.sub, dval[dm]);
        if (initA) inc(dd.init, dval[dm]);
      }
      const rr = b.d.region || (b.d.region = { sub: {}, init: {}, book: {}, bval: {} });
      inc(rr.sub, reg);
      if (initA) inc(rr.init, reg);
      const mgs = b.mg.sub[emp] || (b.mg.sub[emp] = [0, 0, 0, 0]);
      if (gosi === 'Y') mgs[0]++; else if (gosi === 'N') mgs[1]++;
      if (mof === 'Y') mgs[2]++; else if (mof === 'N') mgs[3]++;
      const dr = r['SimplifiedDeclinedReason'];
      if (dr != null && dr !== '' && String(dr) !== 'nan') inc(b.dec, String(dr));
    }

    if (booked) {
      const bd = toYMD(r[CONFIG.bookCol]);
      if (bd) {
        const b = bucket(bd);
        b.k.book++;
        const iv = Number(r['ItemValue']);
        if (!isNaN(iv)) b.k.val += iv;
        const tn = Number(r['TENURE']);
        if (!isNaN(tn)) { b.k.tsum += tn; b.k.tn++; }
        const cl = Number(r['CREDIT_LIMIT']);
        if (!isNaN(cl)) { b.k.clim_sum += cl; b.k.clim_n++; }
        const mp = Number(r['Max_Principal']);
        if (!isNaN(iv) && mp > 0) { b.k.utilsum += iv / mp; b.k.utiln++; }
        for (const dm of ALLD) {
          const dd = b.d[dm] || (b.d[dm] = { sub: {}, init: {}, book: {}, bval: {} });
          inc(dd.book, dval[dm]);
        }
        const rr = b.d.region || (b.d.region = { sub: {}, init: {}, book: {}, bval: {} });
        inc(rr.book, reg);
        if (!isNaN(iv)) rr.bval[reg] = (rr.bval[reg] || 0) + iv;
        const mgb = b.mg.book[emp] || (b.mg.book[emp] = [0, 0, 0, 0]);
        if (gosi === 'Y') mgb[0]++; else if (gosi === 'N') mgb[1]++;
        if (mof === 'Y') mgb[2]++; else if (mof === 'N') mgb[3]++;
      }
    }
  });

  const dates = Object.keys(days).sort();
  for (const d in days) {
    days[d].k.val = Math.round(days[d].k.val);
    for (const dm in days[d].d) {
      const bv = days[d].d[dm].bval;
      for (const kk in bv) bv[kk] = Math.round(bv[kk]);
    }
  }
  return { meta: { min: dates[0], max: dates[dates.length - 1], total: rows.length, name }, dates, days };
}

// --- Main ---
const targetFile = process.argv[2] || findLatestFile();
const filePath = path.isAbsolute(targetFile) ? targetFile : path.join(ROOT, targetFile);

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const ext = path.extname(filePath).toLowerCase();
if (ext !== '.csv') {
  console.error(`Only CSV files are supported by this script. Got: ${ext}`);
  console.error('Convert the xlsx to CSV first, or use the dashboard upload button.');
  process.exit(1);
}

const fileName = path.basename(filePath);
console.log(`Reading ${fileName}…`);
const rows = readCsv(filePath);
console.log(`Parsed ${rows.length.toLocaleString()} rows`);

console.log('Aggregating…');
const result = buildDaily(rows, fileName);
console.log(`Date range: ${result.meta.min} → ${result.meta.max} (${result.dates.length} days)`);

const newLine = `const DAILY_DEFAULT = ${JSON.stringify(result)};`;

console.log('Updating Acquisition_Command_Dashboard.html…');
let html = fs.readFileSync(HTML_FILE, 'utf-8');
const marker = 'const DAILY_DEFAULT = {';
const startIdx = html.indexOf(marker);
if (startIdx === -1) {
  console.error('ERROR: Could not find DAILY_DEFAULT in HTML — file format may have changed.');
  process.exit(1);
}
const lineStart = html.lastIndexOf('\n', startIdx) + 1;
const lineEnd = html.indexOf('\n', startIdx);
let updatedHtml = html.slice(0, lineStart) + newLine + html.slice(lineEnd);
console.log(`DAILY_DEFAULT updated.`);

// --- Build RAWSTORE (columnar binary for the trend engine) ---
console.log('Building RAWSTORE…');
const zlib = require('zlib');

const DIMCOL_MAP = {
  employer: 'FinalEmployerType', nationality: 'Nationality_Flag',
  income: 'DeclaredIncomeBand', risk: 'RiskRating', simah: 'SC_RiskGrade',
  age: 'AgeBand', gender: 'Gender', marital: 'MaritalStatus',
  product: 'Product_type', source: 'SubmitSource', scoreband: 'AppScoreBand',
  dbr: 'CurrentDBRBand'
};
const LONGCOL_MAP = { store: 'StoreName', city: 'CITY', natdetail: 'NATIONALITY' };
const EXTRA_DIMS = { de_decision: 'DE_Decision', referreasons: 'referreasons', gosi: 'Is_GOSI_Called', mof: 'Is_MOF_Called', dec: 'SimplifiedDeclinedReason' };

// Smart Finance: the column holds reason-text when flagged, blank otherwise.
function smartVal(r) { return String(r['SmartFinance'] || '').trim() !== '' ? 'Smart Finance' : 'Normal'; }
// Income split at exactly 15,000 SAR (raw Income, not the pre-bucketed DeclaredIncomeBand
// which tops out at an open-ended "14000+" and can't cut cleanly at 15K).
function incBand15Val(r) {
  const inc = parseFloat(r['Income']);
  if (isNaN(inc)) return 'Unknown';
  return inc >= 15000 ? '15K+' : '<15K';
}

// Count values for LONGCOL to pick top 20
const longCnt = {};
for (const k in LONGCOL_MAP) longCnt[k] = {};
rows.forEach(r => {
  for (const k in LONGCOL_MAP) {
    const v = gv(r, LONGCOL_MAP[k]);
    longCnt[k][v] = (longCnt[k][v] || 0) + 1;
  }
});
const longTop = {};
for (const k in longCnt) {
  longTop[k] = new Set(
    Object.entries(longCnt[k]).sort((a, b) => b[1] - a[1]).slice(0, 20).map(x => x[0])
  );
}

// Build vocab and collect all dates
const allDims = { ...DIMCOL_MAP, ...LONGCOL_MAP, ...EXTRA_DIMS };
// region is special (derived from Region + is_panda); smart/incband15 are also derived
const vocabSets = { region: new Set(), smart: new Set(), incband15: new Set() };
for (const k in allDims) vocabSets[k] = new Set();
const dateSet = new Set();

rows.forEach(r => {
  const sd = toYMD(r['submitted']);
  if (sd) dateSet.add(sd);
  const booked = BOOKED_SET.has(String(r['Altitudestatus']));
  if (booked) { const bd = toYMD(r[CONFIG.bookCol]); if (bd) dateSet.add(bd); }
  // region
  const reg = (r['is_panda'] == 1 || r['is_panda'] === '1') ? 'Panda' : gv(r, 'Region');
  vocabSets.region.add(reg);
  vocabSets.smart.add(smartVal(r));
  vocabSets.incband15.add(incBand15Val(r));
  // standard dims
  for (const k in DIMCOL_MAP) vocabSets[k].add(gv(r, DIMCOL_MAP[k]));
  // long dims (top 20 + Other)
  for (const k in LONGCOL_MAP) {
    const v = gv(r, LONGCOL_MAP[k]);
    vocabSets[k].add(longTop[k].has(v) ? v : 'Other');
  }
  // extra dims
  for (const k in EXTRA_DIMS) {
    const v = gv(r, EXTRA_DIMS[k]);
    vocabSets[k].add(v);
  }
});

const dates = [...dateSet].sort();
const dateIdx = {};
dates.forEach((d, i) => dateIdx[d] = i);

const vocab = {};
for (const k in vocabSets) {
  vocab[k] = [...vocabSets[k]];
}
const vocabIdx = {};
for (const k in vocab) {
  vocabIdx[k] = {};
  vocab[k].forEach((v, i) => vocabIdx[k][v] = i);
}

// Build columnar arrays
const N = rows.length;
const flags = new Uint8Array(N);
const sday = new Uint16Array(N);
const bday = new Uint16Array(N);
const dimCols = {};
for (const k in vocabSets) dimCols[k] = new Uint8Array(N);
const bookedRows = [];
// Compact per-row customer id: maps each non-blank CivilID to a small integer so
// duplicate-application analysis can group rows by customer without shipping raw
// civil IDs to the client. Rows with no CivilID get the sentinel 0xFFFFFFFF.
const NO_CIV = 0xFFFFFFFF;
const civIdMap = new Map();
const civIdx = new Uint32Array(N);

rows.forEach((r, i) => {
  const init = r['Approvalflag'] === 'Y';
  const fin = r['FinalApprovalFlag'] === 'Y';
  const booked = BOOKED_SET.has(String(r['Altitudestatus']));
  const declined = String(r['Altitudestatus']) === 'Declined [D]';
  flags[i] = (init ? 1 : 0) | (fin ? 2 : 0) | (booked ? 4 : 0) | (declined ? 8 : 0);

  const cid = String(r['CivilID'] || '').trim();
  if (cid) {
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

  // region
  const reg = (r['is_panda'] == 1 || r['is_panda'] === '1') ? 'Panda' : gv(r, 'Region');
  dimCols.region[i] = vocabIdx.region[reg] || 0;
  dimCols.smart[i] = vocabIdx.smart[smartVal(r)] || 0;
  dimCols.incband15[i] = vocabIdx.incband15[incBand15Val(r)] || 0;

  // standard dims
  for (const k in DIMCOL_MAP) {
    dimCols[k][i] = vocabIdx[k][gv(r, DIMCOL_MAP[k])] || 0;
  }
  // long dims
  for (const k in LONGCOL_MAP) {
    const v = gv(r, LONGCOL_MAP[k]);
    dimCols[k][i] = vocabIdx[k][longTop[k].has(v) ? v : 'Other'] || 0;
  }
  // extra dims
  for (const k in EXTRA_DIMS) {
    dimCols[k][i] = vocabIdx[k][gv(r, EXTRA_DIMS[k])] || 0;
  }
});

// Build booked-only float64 arrays
const bval = new Float64Array(bookedRows.length);
const bten = new Float64Array(bookedRows.length);
const blim = new Float64Array(bookedRows.length);
// Utilization = ItemValue / Max_Principal, booked rows only (both columns are only
// ever populated once a contract books). NaN when Max_Principal isn't usable.
const butil = new Float64Array(bookedRows.length);
bookedRows.forEach((ri, j) => {
  const r = rows[ri];
  bval[j] = parseFloat(r['ItemValue']) || 0;
  bten[j] = parseFloat(r['TENURE']) || 0;
  blim[j] = parseFloat(r['CREDIT_LIMIT']) || 0;
  const mp = parseFloat(r['Max_Principal']);
  butil[j] = (mp > 0) ? (bval[j] / mp) : NaN;
});

// Assemble binary buffer
const BSZ = { b: 1, h: 2, d: 8, i: 4 };
const header = {};
let offset = 0;
function addCol(name, arr, type) {
  header[name] = { off: offset, len: arr.length, t: type };
  offset += arr.length * BSZ[type];
}
addCol('flags', flags, 'b');
addCol('sday', sday, 'h');
addCol('bday', bday, 'h');
const dimOrder = ['region', 'employer', 'nationality', 'income', 'risk', 'simah', 'age', 'gender', 'marital', 'product', 'source', 'scoreband', 'dbr', 'store', 'city', 'natdetail', 'de_decision', 'referreasons', 'gosi', 'mof', 'dec', 'smart', 'incband15'];
dimOrder.forEach(k => addCol(k, dimCols[k], 'b'));
addCol('civIdx', civIdx, 'i');
addCol('bval', bval, 'd');
addCol('bten', bten, 'd');
addCol('blim', blim, 'd');
addCol('butil', butil, 'd');

const totalBytes = offset;
const buf = Buffer.alloc(totalBytes);
let pos = 0;
function writeBuf(arr) {
  Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(buf, pos);
  pos += arr.byteLength;
}
writeBuf(flags);
writeBuf(sday);
writeBuf(bday);
dimOrder.forEach(k => writeBuf(dimCols[k]));
writeBuf(civIdx);
writeBuf(bval);
writeBuf(bten);
writeBuf(blim);
writeBuf(butil);

const compressed = zlib.deflateSync(buf, { level: 9 });
const b64 = compressed.toString('base64');

const rawStore = { n: N, dates, vocab, header, b64 };
const rawLine = `const RAWSTORE = ${JSON.stringify(rawStore)};`;

const rawMarker = 'const RAWSTORE = {';
const ri = updatedHtml.indexOf(rawMarker);
if (ri !== -1) {
  const rls = updatedHtml.lastIndexOf('\n', ri) + 1;
  const rle = updatedHtml.indexOf('\n', ri);
  updatedHtml = updatedHtml.slice(0, rls) + rawLine + updatedHtml.slice(rle);
  console.log(`RAWSTORE updated — ${N.toLocaleString()} rows, ${dates.length} dates, ${b64.length.toLocaleString()} chars b64.`);
} else {
  console.warn('WARN: RAWSTORE marker not found — skipping columnar update.');
}

fs.writeFileSync(HTML_FILE, updatedHtml, 'utf-8');
console.log(`Done — dashboard updated with ${rows.length.toLocaleString()} rows (${result.meta.min} → ${result.meta.max}).`);

// --- Application Cost scorecard ---
const COST_HTML = path.join(ROOT, 'Application_Cost.html');
if (fs.existsSync(COST_HTML)) {
  console.log('Computing application cost data…');
  const costDays = {};
  const MOF_SECTORS = new Set(['Government Entity', 'Military with Grades']);
  const GOSI_SECTORS = new Set(['Private Company', 'Pension']);
  const costBucket = d => costDays[d] || (costDays[d] = {
    bl: 0, bn69: 0, bn35: 0, bv: 0,  // booked local: count, nafith69, nafith35, totalVal
    be: 0, be69: 0, be35: 0, bev: 0,  // booked expat
    bgl: 0, bge: 0, bml: 0, bme: 0,  // booked GOSI/MOF split by local/expat
    nl: 0, ne: 0, ng: 0, nm: 0        // not-booked local, expat, GOSI, MOF
  });
  let costTotal = 0;
  rows.forEach(r => {
    const cid = String(r.CivilID || '').trim();
    if (!cid) return;
    const isLocal = cid.startsWith('1');
    const booked = BOOKED_SET.has(String(r.Altitudestatus || ''));
    const amount = parseFloat(r.ItemValue) || 0;
    const emp = String(r.FinalEmployerType || '').trim();
    const isGosi = GOSI_SECTORS.has(emp);
    const isMof = MOF_SECTORS.has(emp);
    if (booked) {
      const bd = toYMD(r[CONFIG.bookCol]);
      if (!bd) return;
      costTotal++;
      const b = costBucket(bd);
      if (isLocal) { b.bl++; b.bv += Math.round(amount); if (amount >= 50000) b.bn69++; else b.bn35++; }
      else { b.be++; b.bev += Math.round(amount); if (amount >= 50000) b.be69++; else b.be35++; }
      if (isGosi) { if (isLocal) b.bgl++; else b.bge++; }
      if (isMof) { if (isLocal) b.bml++; else b.bme++; }
    } else {
      const sd = toYMD(r['submitted']);
      if (!sd) return;
      costTotal++;
      const b = costBucket(sd);
      if (isLocal) b.nl++; else b.ne++;
      if (isGosi) b.ng++; if (isMof) b.nm++;
    }
  });

  // Per-status counts for the Application Statuses tab (total + per-day)
  const statusMap = {};
  const statusByDay = {};  // { date: { status: {l,e,gl,ge,ml,me,ln69,ln35,en69,en35} } }
  const emptySD = () => ({ l:0, e:0, gl:0, ge:0, ml:0, me:0, ln69:0, ln35:0, en69:0, en35:0 });
  rows.forEach(r => {
    const cid = String(r.CivilID || '').trim();
    if (!cid) return;
    const status = String(r.Altitudestatus || '').trim();
    if (!status) return;
    const isLocal = cid.startsWith('1');
    const emp = String(r.FinalEmployerType || '').trim();
    const isGosi = GOSI_SECTORS.has(emp);
    const isMof = MOF_SECTORS.has(emp);
    const amount = parseFloat(r.ItemValue) || 0;
    const booked = BOOKED_SET.has(status);
    const d = booked ? toYMD(r[CONFIG.bookCol]) : toYMD(r['submitted']);
    const s = statusMap[status] || (statusMap[status] = { n: 0, l: 0, e: 0, gl: 0, ge: 0, ml: 0, me: 0, n69: 0, n35: 0, ln69: 0, ln35: 0, en69: 0, en35: 0 });
    s.n++;
    if (isLocal) { s.l++; if (isGosi) s.gl++; if (isMof) s.ml++; if (amount >= 50000) { s.n69++; s.ln69++; } else { s.n35++; s.ln35++; } }
    else { s.e++; if (isGosi) s.ge++; if (isMof) s.me++; if (amount >= 50000) { s.n69++; s.en69++; } else { s.n35++; s.en35++; } }
    if (d) {
      const dayMap = statusByDay[d] || (statusByDay[d] = {});
      const sd = dayMap[status] || (dayMap[status] = emptySD());
      if (isLocal) { sd.l++; if (isGosi) sd.gl++; if (isMof) sd.ml++; if (amount >= 50000) sd.ln69++; else sd.ln35++; }
      else { sd.e++; if (isGosi) sd.ge++; if (isMof) sd.me++; if (amount >= 50000) sd.en69++; else sd.en35++; }
    }
  });

  const costDates = Object.keys(costDays).sort();
  const costData = { days: costDays, dates: costDates, statuses: statusMap, statusByDay, meta: { min: costDates[0], max: costDates[costDates.length - 1], total: costTotal, fileName } };

  const costLine = `const COST_DATA = ${JSON.stringify(costData)};`;
  let costHtml = fs.readFileSync(COST_HTML, 'utf-8');
  const costMarker = 'const COST_DATA = {';
  const ci = costHtml.indexOf(costMarker);
  if (ci !== -1) {
    const cls = costHtml.lastIndexOf('\n', ci) + 1;
    const cle = costHtml.indexOf('\n', ci);
    costHtml = costHtml.slice(0, cls) + costLine + costHtml.slice(cle);
    fs.writeFileSync(COST_HTML, costHtml, 'utf-8');
    console.log(`Application_Cost.html updated — ${costTotal.toLocaleString()} applications costed.`);
  } else {
    console.warn('WARN: COST_DATA marker not found in Application_Cost.html — skipping cost update.');
  }
}
