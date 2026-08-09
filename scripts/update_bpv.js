/**
 * update_bpv.js – Rebuild const BPV in Business_Performance_View.html
 * from the full merged dataset in Acquisition_Command_Dashboard.html,
 * funnel data from Funnel_Analysis.html, and SIMAH data from SIMAH_Intelligence.html.
 *
 * Usage:  node --max-old-space-size=4096 scripts/update_bpv.js
 */
const fs = require('fs');
const path = require('path');
const pako = require('pako');

const ROOT = path.resolve(__dirname, '..');
const ACQ_HTML  = path.join(ROOT, 'Acquisition_Command_Dashboard.html');
const FUN_HTML  = path.join(ROOT, 'Funnel_Analysis.html');
const SIM_HTML  = path.join(ROOT, 'SIMAH_Intelligence.html');
const BPV_HTML  = path.join(ROOT, 'Business_Performance_View.html');

// ── helpers ──────────────────────────────────────────────────────────
function extractJSON(html, varName) {
  const re = new RegExp('const ' + varName + ' = (\\{.*?\\});', 's');
  const m = html.match(re);
  if (!m) throw new Error(varName + ' not found');
  return JSON.parse(m[1]);
}

function wkOf(d) {                             // ISO week Monday start
  const dt = new Date(d + 'T00:00:00');
  const day = (dt.getDay() + 6) % 7;          // Mon=0
  dt.setDate(dt.getDate() - day);
  return dt.toISOString().slice(0, 10);
}

function monOf(d) { return d.slice(0, 7); }    // "YYYY-MM"

// ── 1. Read Acquisition dashboard ────────────────────────────────────
console.log('Reading Acquisition_Command_Dashboard.html …');
const acqHtml = fs.readFileSync(ACQ_HTML, 'utf8');
const DD = extractJSON(acqHtml, 'DAILY_DEFAULT');
console.log('  DAILY_DEFAULT: %d dates, %d total rows', DD.dates.length, DD.meta.total);

// ── 2. Aggregate weekly / monthly from DAILY_DEFAULT.days ────────────
console.log('Aggregating weekly + monthly …');

const weeklyMap = {};   // wk → {sub,init,book,val,tsum,tn}
const monthlyMap = {};  // mon → {sub,init,final,book,val,tsum,tn, emp:{}, nat:{}, inc:{}}

for (const date of Object.keys(DD.days)) {
  const day = DD.days[date];
  const k = day.k;
  const wk = wkOf(date);
  const mon = monOf(date);

  // ── weekly ──
  if (!weeklyMap[wk]) weeklyMap[wk] = { sub: 0, init: 0, book: 0, val: 0, tsum: 0, tn: 0 };
  const w = weeklyMap[wk];
  w.sub  += k.sub;
  w.init += k.init;
  w.book += k.book;
  w.val  += k.val;
  w.tsum += k.tsum;
  w.tn   += k.tn;

  // ── monthly ──
  if (!monthlyMap[mon]) monthlyMap[mon] = {
    sub: 0, init: 0, final: 0, book: 0, val: 0, tsum: 0, tn: 0,
    emp: {}, nat: {}, inc: {}
  };
  const m = monthlyMap[mon];
  m.sub   += k.sub;
  m.init  += k.init;
  m.final += k.final;
  m.book  += k.book;
  m.val   += k.val;
  m.tsum  += k.tsum;
  m.tn    += k.tn;

  // breakdowns
  for (const dim of ['employer', 'nationality', 'income']) {
    const target = dim === 'employer' ? 'emp' : dim === 'nationality' ? 'nat' : 'inc';
    const dd = day.d[dim];
    if (!dd) continue;
    for (const metric of ['sub', 'init', 'book']) {
      if (!dd[metric]) continue;
      for (const [cat, cnt] of Object.entries(dd[metric])) {
        if (!m[target][cat]) m[target][cat] = { sub: 0, init: 0, book: 0, bval: 0 };
        m[target][cat][metric] += cnt;
      }
    }
  }
}

// Format weekly array
const weekly = Object.keys(weeklyMap).sort().map(wk => {
  const w = weeklyMap[wk];
  return {
    wk,
    sub: w.sub,
    init: w.init,
    book: w.book,
    val: w.val,
    avg: w.tn ? Math.round(w.tsum / w.tn) : 0,
    avgLoan: w.book ? Math.round(w.val / w.book) : 0
  };
});

// Format monthly array
const monthly = Object.keys(monthlyMap).sort().map(mon => {
  const m = monthlyMap[mon];
  return {
    mon,
    sub: m.sub,
    init: m.init,
    final: m.final,
    book: m.book,
    val: m.val,
    avgLoan: m.book ? Math.round(m.val / m.book) : 0,
    avgTen: m.tn ? Math.round(m.tsum / m.tn) : 0,
    emp: m.emp,
    nat: m.nat,
    inc: m.inc
  };
});

console.log('  Weekly buckets: %d, Monthly buckets: %d', weekly.length, monthly.length);
monthly.forEach(m => console.log('    %s  sub=%d  book=%d', m.mon, m.sub, m.book));

// ── 3. Decode RAWSTORE for cross-segments ────────────────────────────
console.log('Decoding RAWSTORE for cross-segments …');
const RS_RAW = extractJSON(acqHtml, 'RAWSTORE');

const bin = Buffer.from(RS_RAW.b64, 'base64');
const buf = pako.inflate(bin);
const TMAP = { b: Int8Array, h: Int16Array, d: Float64Array };
const BSZ  = { b: 1, h: 2, d: 8 };
const RS = {};
for (const name in RS_RAW.header) {
  const H = RS_RAW.header[name];
  const sl = buf.slice(H.off, H.off + H.len * BSZ[H.t]);
  RS[name] = new TMAP[H.t](sl.buffer.slice(sl.byteOffset, sl.byteOffset + sl.byteLength));
}
const N = RS_RAW.n;
const DTS = RS_RAW.dates;
const VOCAB = RS_RAW.vocab;

console.log('  RAWSTORE: %d rows decoded', N);

// Build cross-segments: employer × nationality × income
// Bucketed by month (sub counted in its submission month, book/val counted in
// its booking month — same split DAILY_DEFAULT already uses) so the BPV
// Overview tab's Top/Low Performing Segments table can be filtered by date
// range instead of being frozen to one all-time tally.
const segMap = {};        // key → {sub, book, valSum}                (all-time, back-compat)
const monthSegMap = {};   // mon → key → {emp, nat, inc, sub, book, valSum}
const empArr   = RS.employer;
const natArr   = RS.nationality;
const incArr   = RS.income;
const sdayArr  = RS.sday;
const bvalArr  = RS.bval;
const bdayArr  = RS.bday;

function segBucket(map, mon, key, emp, nat, inc) {
  if (!map[mon]) map[mon] = {};
  const sm = map[mon];
  if (!sm[key]) sm[key] = { emp, nat, inc, sub: 0, book: 0, valSum: 0 };
  return sm[key];
}

let bptr = 0;
for (let i = 0; i < N; i++) {
  const si = sdayArr[i];
  const bi = bdayArr[i];                     // Int16: 65535 → -1 = not booked
  const booked = bi >= 0;

  const emp = VOCAB.employer[empArr[i]] || 'Unknown';
  const nat = VOCAB.nationality[natArr[i]] || 'Unknown';
  const inc = VOCAB.income[incArr[i]] || 'Unknown';
  const key = emp + '|' + nat + '|' + inc;

  if (!segMap[key]) segMap[key] = { emp, nat, inc, sub: 0, book: 0, valSum: 0 };
  segMap[key].sub++;

  if (si >= 0) {
    const subMon = DTS[si].slice(0, 7);
    segBucket(monthSegMap, subMon, key, emp, nat, inc).sub++;
  }

  if (booked) {
    segMap[key].book++;
    segMap[key].valSum += bvalArr[bptr];
    if (bi >= 0) {
      const bookMon = DTS[bi].slice(0, 7);
      const mb = segBucket(monthSegMap, bookMon, key, emp, nat, inc);
      mb.book++;
      mb.valSum += bvalArr[bptr];
    }
    bptr++;
  }
}

// Filter to segments with at least 50 submissions and sort by sub desc
const segments = Object.values(segMap)
  .filter(s => s.sub >= 50)
  .sort((a, b) => b.sub - a.sub)
  .map(s => ({
    emp: s.emp,
    nat: s.nat,
    inc: s.inc,
    sub: s.sub,
    book: s.book,
    avg: s.book ? Math.round(s.valSum / s.book) : 0
  }));

console.log('  Cross-segments (≥50 subs): %d', segments.length);

// Format monthly segments (no per-month threshold — client aggregates across
// the filtered range and applies its own display threshold, same as it
// already does with book>10 on the all-time table)
const monthlySegments = Object.keys(monthSegMap).sort().map(mon => ({
  mon,
  segs: Object.values(monthSegMap[mon]).map(s => ({
    emp: s.emp,
    nat: s.nat,
    inc: s.inc,
    sub: s.sub,
    book: s.book,
    valSum: Math.round(s.valSum)
  }))
}));
console.log('  Monthly cross-segments: %d months, %d total combos', monthlySegments.length,
  monthlySegments.reduce((a, m) => a + m.segs.length, 0));

// ── 4. Read Funnel data ──────────────────────────────────────────────
console.log('Reading Funnel_Analysis.html …');
const funHtml = fs.readFileSync(FUN_HTML, 'utf8');
const FD = extractJSON(funHtml, 'FUNNEL_DEFAULT');

// Aggregate total funnel across all dates, per journey
// Only include the 3 main journeys: New Customer, Existing Customer, BO (Tawarruq)
const JOURNEYS = ['New Customer', 'Existing Customer', 'BO (Tawarruq)'];
const funnelTotal = {};
const monthlyFunnelMap = {};  // mon → { journey → { step → count } }

for (const date of Object.keys(FD.days)) {
  const mon = monOf(date);
  const dayData = FD.days[date];

  for (const journey of JOURNEYS) {
    if (!dayData[journey]) continue;

    if (!funnelTotal[journey]) funnelTotal[journey] = {};
    if (!monthlyFunnelMap[mon]) monthlyFunnelMap[mon] = {};
    if (!monthlyFunnelMap[mon][journey]) monthlyFunnelMap[mon][journey] = {};

    for (const [step, cnt] of Object.entries(dayData[journey])) {
      funnelTotal[journey][step] = (funnelTotal[journey][step] || 0) + cnt;
      monthlyFunnelMap[mon][journey][step] = (monthlyFunnelMap[mon][journey][step] || 0) + cnt;
    }
  }
}

const monthlyFunnel = Object.keys(monthlyFunnelMap).sort().map(mon => {
  const entry = { mon };
  for (const j of JOURNEYS) {
    if (monthlyFunnelMap[mon][j]) entry[j] = monthlyFunnelMap[mon][j];
  }
  return entry;
});

console.log('  Funnel months: %d', monthlyFunnel.length);

// ── 5. Read SIMAH data ───────────────────────────────────────────────
console.log('Reading SIMAH_Intelligence.html …');
const simHtml = fs.readFileSync(SIM_HTML, 'utf8');
const SIMAH = extractJSON(simHtml, 'SIMAH_DATA');
console.log('  SIMAH total: %d, matched: %d', SIMAH.meta.total, SIMAH.meta.matched);

// ── 5b. Build AI-tab data: all dimensions + day-of-week + momentum ───
console.log('Building AI-tab data …');

// 5b-i. Aggregate all dimensions from DAILY_DEFAULT.days
const AI_DIMS = ['employer','nationality','income','risk','simah','age','region','city',
                 'natdetail','source','product','gender','marital','scoreband','dbr','store'];
const dimTotals = {};  // dim → { cat → {sub,init,book} }
const dimMonthly = {}; // dim → { cat → { mon → {sub,book} } }
const dowMap = {};     // 0–6 → {sub,init,book,val}

for (const date of Object.keys(DD.days)) {
  const day = DD.days[date];
  const k = day.k;
  const dt = new Date(date + 'T00:00:00');
  const dow = dt.getDay(); // 0=Sun
  if (!dowMap[dow]) dowMap[dow] = { sub: 0, init: 0, book: 0, val: 0 };
  dowMap[dow].sub  += k.sub;
  dowMap[dow].init += k.init;
  dowMap[dow].book += k.book;
  dowMap[dow].val  += k.val;

  const mon = monOf(date);
  for (const dim of AI_DIMS) {
    const dd = day.d[dim];
    if (!dd) continue;
    if (!dimTotals[dim]) dimTotals[dim] = {};
    if (!dimMonthly[dim]) dimMonthly[dim] = {};
    for (const metric of ['sub', 'init', 'book']) {
      if (!dd[metric]) continue;
      for (const [cat, cnt] of Object.entries(dd[metric])) {
        if (!dimTotals[dim][cat]) dimTotals[dim][cat] = { sub: 0, init: 0, book: 0 };
        dimTotals[dim][cat][metric] += cnt;
        if (!dimMonthly[dim][cat]) dimMonthly[dim][cat] = {};
        if (!dimMonthly[dim][cat][mon]) dimMonthly[dim][cat][mon] = { sub: 0, book: 0 };
        dimMonthly[dim][cat][mon][metric === 'init' ? 'sub' : metric] += (metric === 'init' ? 0 : cnt);
        // track sub and book per month
        if (metric === 'sub') dimMonthly[dim][cat][mon].sub += 0; // already counted
        if (metric === 'book') dimMonthly[dim][cat][mon].book += 0; // already counted
      }
    }
  }
}

// Fix dimMonthly – simpler rebuild
const dimMonthly2 = {};
for (const date of Object.keys(DD.days)) {
  const day = DD.days[date];
  const mon = monOf(date);
  for (const dim of AI_DIMS) {
    const dd = day.d[dim];
    if (!dd) continue;
    if (!dimMonthly2[dim]) dimMonthly2[dim] = {};
    if (dd.sub) {
      for (const [cat, cnt] of Object.entries(dd.sub)) {
        if (!dimMonthly2[dim][cat]) dimMonthly2[dim][cat] = {};
        if (!dimMonthly2[dim][cat][mon]) dimMonthly2[dim][cat][mon] = { sub: 0, book: 0 };
        dimMonthly2[dim][cat][mon].sub += cnt;
      }
    }
    if (dd.book) {
      for (const [cat, cnt] of Object.entries(dd.book)) {
        if (!dimMonthly2[dim][cat]) dimMonthly2[dim][cat] = {};
        if (!dimMonthly2[dim][cat][mon]) dimMonthly2[dim][cat][mon] = { sub: 0, book: 0 };
        dimMonthly2[dim][cat][mon].book += cnt;
      }
    }
  }
}

// 5b-ii. Day of week array (Sun=0 … Sat=6)
const dowArr = [0,1,2,3,4,5,6].map(d => ({
  day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d],
  sub: (dowMap[d]||{}).sub||0,
  init: (dowMap[d]||{}).init||0,
  book: (dowMap[d]||{}).book||0,
  val: (dowMap[d]||{}).val||0
}));

// 5b-iii. Compact dimMonthly: only keep top categories per dim (by sub)
// to avoid bloating the HTML
const dimMomentum = {};
for (const dim of AI_DIMS) {
  if (!dimTotals[dim]) continue;
  const cats = Object.entries(dimTotals[dim])
    .filter(([c]) => c !== 'Unknown' && c !== 'U')
    .sort((a, b) => b[1].sub - a[1].sub)
    .slice(0, dim === 'city' || dim === 'store' || dim === 'natdetail' ? 15 : 10);
  dimMomentum[dim] = {};
  for (const [cat] of cats) {
    const months = dimMonthly2[dim]?.[cat] || {};
    dimMomentum[dim][cat] = Object.keys(months).sort().map(mon => ({
      mon, sub: months[mon].sub, book: months[mon].book
    }));
  }
}

console.log('  Dimensions: %d, DOW entries: %d', Object.keys(dimTotals).length, dowArr.length);

// ── 5c. Build daily array from DAILY_DEFAULT.days ───────────────────
// Each entry: { date, sub, init, book, val, dims: { dim → { cat → {sub,init,book} } } }
console.log('Building daily array …');
const daily = Object.keys(DD.days).sort().map(date => {
  const day = DD.days[date];
  const k = day.k;
  const dims = {};
  for (const dim of AI_DIMS) {
    const dd = day.d[dim];
    if (!dd) continue;
    dims[dim] = {};
    // Collect all categories that have sub, init, or book
    const allCats = new Set();
    if (dd.sub) Object.keys(dd.sub).forEach(c => allCats.add(c));
    if (dd.init) Object.keys(dd.init).forEach(c => allCats.add(c));
    if (dd.book) Object.keys(dd.book).forEach(c => allCats.add(c));
    for (const cat of allCats) {
      dims[dim][cat] = {
        sub:  (dd.sub  && dd.sub[cat])  || 0,
        init: (dd.init && dd.init[cat]) || 0,
        book: (dd.book && dd.book[cat]) || 0
      };
    }
  }
  return { date, sub: k.sub, init: k.init, book: k.book, val: k.val, dims };
});
console.log('  Daily entries: %d', daily.length);

// ── 6. Build KPI ─────────────────────────────────────────────────────
const totalSub  = monthly.reduce((s, m) => s + m.sub, 0);
const totalBook = monthly.reduce((s, m) => s + m.book, 0);
const totalVal  = monthly.reduce((s, m) => s + m.val, 0);

const kpi = {
  totalSub,
  totalBook,
  totalVal,
  overallBookRate: totalSub ? (100 * totalBook / totalSub).toFixed(1) : '0.0',
  avgLoan: totalBook ? Math.round(totalVal / totalBook) : 0,
  snapDate: new Date().toISOString().slice(0, 10),
  dataRange: DD.meta.min + ' → ' + DD.meta.max,
  csvName: DD.meta.name
};

console.log('  KPI: totalSub=%d  totalBook=%d  avgLoan=%d  bookRate=%s%%',
  kpi.totalSub, kpi.totalBook, kpi.avgLoan, kpi.overallBookRate);

// ── 7. Assemble BPV ─────────────────────────────────────────────────
const BPV = {
  daily,
  weekly,
  monthly,
  segments,
  monthlySegments,
  funnel: funnelTotal,
  monthlyFunnel,
  simah: SIMAH,
  kpi,
  // AI tab data
  dims: dimTotals,
  dow: dowArr,
  momentum: dimMomentum
};

// ── 8. Inject into Business_Performance_View.html ────────────────────
console.log('Injecting into Business_Performance_View.html …');
let bpvHtml = fs.readFileSync(BPV_HTML, 'utf8');

const bpvRe = /const BPV =\{.*?\};/s;
if (!bpvRe.test(bpvHtml)) throw new Error('const BPV = {...}; not found in Business_Performance_View.html');

const newBpv = 'const BPV =' + JSON.stringify(BPV) + ';';
bpvHtml = bpvHtml.replace(bpvRe, newBpv);
fs.writeFileSync(BPV_HTML, bpvHtml, 'utf8');

console.log('✅ Done – BPV updated in Business_Performance_View.html');
console.log('   Data range: %s', kpi.dataRange);
console.log('   Total submissions: %s', kpi.totalSub.toLocaleString());
console.log('   Total bookings: %s', kpi.totalBook.toLocaleString());
