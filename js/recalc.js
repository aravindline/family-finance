// In-app recalculation of the whole tracker (app 0.15.1, Aravind 15 Nov 2026: "all settings should be updated
// immediately"). The tracker's own formulas are read from the file, turned into a form the formula engine understands
// (table references, Excel-only forms), worked out in calc-worker.js, and the results are written back into the file
// as the values Excel would save. So the app shows fresh figures at once and the file stays current without Excel.
import { col2n, n2col } from './xlsx.js';

const ERR = /^#(N\/A|VALUE!|REF!|DIV\/0!|NUM!|NAME\?|NULL!)$/;

// ---------------------------------------------------------------- formula text -> engine text
function tableMap(wb) {
  const m = new Map();
  for (const name of Object.keys(wb.tables)) { const t = wb.table(name); m.set(name.toLowerCase(), t); }
  return m;
}
const unesc = s => s.replace(/'(.)/g, '$1');
const qs = s => "'" + s.replace(/'/g, "''") + "'";
function colRange(t, cols, part, row) {
  const i1 = t.cols.findIndex(h => h.toLowerCase() === cols[0].toLowerCase()); const i2 = t.cols.findIndex(h => h.toLowerCase() === cols[cols.length - 1].toLowerCase());
  if (i1 < 0 || i2 < 0) return null;
  const c1 = n2col(t.c1 + Math.min(i1, i2)), c2 = n2col(t.c1 + Math.max(i1, i2));
  let r1 = t.r1 + 1, r2 = Math.max(t.r2, t.r1 + 1);
  if (part === 'all') r1 = t.r1; else if (part === 'headers') r2 = r1 = t.r1; else if (part === 'this') r1 = r2 = row;
  const sh = qs(t.sheet) + '!';
  return r1 === r2 && c1 === c2 ? sh + '$' + c1 + '$' + r1 : sh + '$' + c1 + '$' + r1 + ':$' + c2 + '$' + r2;
}
// tblX[Col], tblX[[Col]], tblX[[#This Row],[Col]], tblX[@Col], tblX[[#Data],[Col]], tblX[[#All],[A]:[B]], tblX[#Data], tblX[]
function structured(f, tables, row) {
  let out = '', i = 0, bad = false;
  while (i < f.length) {
    if (f[i] === '"') { let j = i + 1; while (j < f.length && !(f[j] === '"' && f[j + 1] !== '"')) j += f[j] === '"' ? 2 : 1; out += f.slice(i, j + 1); i = j + 1; continue; }
    const m = /^([A-Za-z_\\][\w.\\]*)\[/.exec(f.slice(i));
    const prev = i ? f[i - 1] : '';
    if (m && !/[\w.'!]/.test(prev) && tables.has(m[1].toLowerCase())) {
      const t = tables.get(m[1].toLowerCase()); let d = 0, j = i + m[1].length;
      for (; j < f.length; j++) { if (f[j] === "'") { j++; continue; } if (f[j] === '[') d++; else if (f[j] === ']' && --d === 0) break; }
      const spec = f.slice(i + m[1].length + 1, j); const items = []; let part = 'data';
      const re = /\[((?:'.|[^\]])*)\]/g; let x; const inner = spec.startsWith('[') || spec.startsWith('@') ? spec : '[' + spec + ']';
      let s2 = inner; if (s2.startsWith('@')) { part = 'this'; s2 = s2.slice(1); if (s2 && !s2.startsWith('[')) s2 = '[' + s2 + ']'; }
      while ((x = re.exec(s2))) { const it = unesc(x[1]); if (/^#this row$/i.test(it)) part = 'this'; else if (/^#data$/i.test(it)) part = 'data'; else if (/^#all$/i.test(it)) part = 'all'; else if (/^#headers$/i.test(it)) part = 'headers'; else if (/^#totals$/i.test(it)) { bad = true; } else if (it) items.push(it); }
      const cols = items.length ? items : [t.cols[0], t.cols[t.cols.length - 1]];
      const r = colRange(t, cols, part, row); if (!r) bad = true;
      out += r || '#REF!'; i = j + 1; continue;
    }
    out += f[i]; i++;
  }
  return { f: out, bad };
}
// ranges: 'Sheet'!$A$1:$B$9, Sheet!A1:B9, A1:B9
const RNG = /^(?:('(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/;
function parseRange(a, here) { const m = RNG.exec(a.trim()); if (!m) return null; const sheet = m[1] ? (m[1][0] === "'" ? m[1].slice(1, -1).replace(/''/g, "'") : m[1]) : here;
  const c1 = col2n(m[2]), r1 = Number(m[3]), c2 = m[4] ? col2n(m[4]) : c1, r2 = m[5] ? Number(m[5]) : r1;
  return { sheet, c1: Math.min(c1, c2), c2: Math.max(c1, c2), r1: Math.min(r1, r2), r2: Math.max(r1, r2), n: (Math.abs(c2 - c1) + 1) * (Math.abs(r2 - r1) + 1) }; }
const refOf = (g, c, r) => qs(g.sheet) + '!$' + n2col(c) + '$' + r;
function args(s) { const out = []; let d = 0, q = false, sq = false, cur = ''; for (const ch of s) { if (ch === '"' && !sq) q = !q; else if (ch === "'" && !q) sq = !sq; if (!q && !sq && (ch === '(' || ch === '{')) d++; if (!q && !sq && (ch === ')' || ch === '}')) d--; if (ch === ',' && d === 0 && !q && !sq) { out.push(cur); cur = ''; continue; } cur += ch; } out.push(cur); return out; }
// finds NAME( ... ) calls (not inside text) and lets fn rewrite them; fn returns null to keep the call as it is
function eachCall(f, name, fn) {
  let out = '', i = 0;
  while (i < f.length) {
    if (f[i] === '"') { let j = i + 1; while (j < f.length && !(f[j] === '"' && f[j + 1] !== '"')) j += f[j] === '"' ? 2 : 1; out += f.slice(i, j + 1); i = j + 1; continue; }
    if (f[i] === "'") { let j = i + 1; while (j < f.length && !(f[j] === "'" && f[j + 1] !== "'")) j += f[j] === "'" ? 2 : 1; out += f.slice(i, j + 1); i = j + 1; continue; }
    const m = new RegExp('^' + name + '\\(').exec(f.slice(i)); const prev = i ? f[i - 1] : '';
    if (m && !/[\w.]/.test(prev)) {
      let d = 0, j = i + name.length, q = false, sq = false; for (; j < f.length; j++) { const ch = f[j]; if (ch === '"' && !sq) q = !q; else if (ch === "'" && !q) sq = !sq; if (q || sq) continue; if (ch === '(') d++; else if (ch === ')' && --d === 0) break; }
      const inner = eachCall(f.slice(i + name.length + 1, j), name, fn); const r = fn(args(inner).map(x => x.trim()));
      out += r === null ? name + '(' + inner + ')' : r; i = j + 1; continue;
    }
    out += f[i]; i++;
  }
  return out;
}
// Excel's SUBTOTAL(1xx, ...) skips hidden rows (rows a slicer or filter hides are saved hidden). The engine does not
// know about hidden rows, so the app gives it a 0/1 "visible" column per sheet (sheet __vis) and multiplies by it.
function visOf(g, ctx) { const v = ctx.vis.get(g.sheet); if (!v) return null; return qs('__vis') + '!$' + n2col(v.col) + '$' + g.r1 + ':$' + n2col(v.col) + '$' + g.r2; }
function subtotals(f, ctx) {
  // SUBTOTAL(103|109, OFFSET(X, ROW(R)-ROW(X), 0)): one cell at a time over R
  f = f.replace(/SUBTOTAL\((10[39]),OFFSET\(([^,()]+),ROW\(([^()]+)\)-ROW\(\2\),0\)\)/g, (all, code, x, rng) => {
    const g = parseRange(rng, ctx.sheet); const vis = g && g.c1 === g.c2 ? visOf(g, ctx) : null; const mul = vis ? '*' + vis : '';
    return code === '103' ? '(NOT(ISBLANK(' + rng + '))*1' + mul + ')' : '(IF(ISNUMBER(' + rng + '),' + rng + ',0)' + mul + ')'; });
  if (!f.includes('SUBTOTAL(')) return f;
  return eachCall(f, 'SUBTOTAL', a => {
    if (a.length !== 2 || !/^(10[39])$/.test(a[0])) return null; const g = parseRange(a[1], ctx.sheet); if (!g) return null;
    const vis = g.c1 === g.c2 ? visOf(g, ctx) : null; if (!vis) return null; // no hidden rows on that sheet: the engine's own SUBTOTAL is right
    return a[0] === '103' ? 'SUMPRODUCT(NOT(ISBLANK(' + a[1] + '))*' + vis + ')' : 'SUMPRODUCT(IF(ISNUMBER(' + a[1] + '),' + a[1] + ',0)*' + vis + ')';
  });
}
// COUNTIF(S)(range, criteria) where a criteria is a RANGE of many cells: Excel returns one count per criteria cell.
// Small range: add up equality tests cell by cell. Small criteria list: pick the count for each criteria cell.
function arrayCountifs(f, ctx) {
  for (const fn of ['COUNTIFS', 'COUNTIF']) if (f.includes(fn + '(')) f = eachCall(f, fn, a => {
    const pairs = []; for (let k = 0; k + 1 < a.length; k += 2) pairs.push([a[k], a[k + 1]]);
    const multi = pairs.map(([, c]) => { const g = parseRange(c, ctx.sheet); return g && g.n > 1 ? g : null; });
    if (!multi.some(Boolean)) return null;
    if (pairs.some(([, c], k) => !multi[k] && /^"[<>=]|[*?~]/.test(c))) return null; // operators or wildcards: left as it is
    if (pairs.length === 1) { const g = parseRange(pairs[0][0], ctx.sheet); if (g && g.n <= 64) { const t = []; for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) t.push('(' + pairs[0][1] + '=' + refOf(g, c, r) + ')'); return '(' + t.join('+') + ')'; } }
    const lead = multi.find(Boolean); if (lead.n > 64 || multi.some(g => g && g.n !== lead.n)) return null;
    const vertical = lead.c1 === lead.c2; let expr = '0';
    for (let k = lead.n - 1; k >= 0; k--) {
      const parts = pairs.map(([rng, c], i) => { const g = multi[i]; if (!g) return rng + ',' + c; const r = vertical ? g.r1 + k : g.r1, cc = vertical ? g.c1 : g.c1 + k; return rng + ',' + refOf(g, cc, r); });
      const pos = vertical ? 'ROW(' + pairs[multi.indexOf(lead)][1] + ')=' + (lead.r1 + k) : 'COLUMN(' + pairs[multi.indexOf(lead)][1] + ')=' + (lead.c1 + k);
      expr = 'IF(' + pos + ',' + fn + '(' + parts.join(',') + '),' + expr + ')';
    }
    return expr;
  });
  return f;
}
// Excel treats a criteria that points at an empty cell as 0; the engine refuses it. Single-cell criteria are wrapped.
const CRIT = { COUNTIF: [1], SUMIF: [1], AVERAGEIF: [1], COUNTIFS: 'odd', SUMIFS: 'even', AVERAGEIFS: 'even', MAXIFS: 'even', MINIFS: 'even' };
function blankCriteria(f, ctx) {
  for (const [fn, pos] of Object.entries(CRIT)) if (f.includes(fn + '(')) f = eachCall(f, fn, a => {
    let changed = false; const out = a.map((x, i) => { const isC = pos === 'odd' ? i % 2 === 1 : pos === 'even' ? i >= 2 && i % 2 === 0 : pos.includes(i);
      if (!isC) return x; const g = parseRange(x, ctx.sheet); if (!g || g.n !== 1) return x; changed = true; return 'IF(ISBLANK(' + x + '),0,' + x + ')'; });
    return changed ? fn + '(' + out.join(',') + ')' : null; });
  return f;
}
// ROW(A12:A131) is a list of row numbers in Excel; the engine gives only the first. A helper sheet of row numbers stands in.
function rowArrays(f, ctx) {
  if (!f.includes('ROW(')) return f;
  return eachCall(f, 'ROW', a => { if (a.length !== 1) return null; const g = parseRange(a[0], ctx.sheet); if (!g || g.r1 === g.r2) return null;
    if (ctx.rowsMax && g.r2 > ctx.rowsMax.n) ctx.rowsMax.n = g.r2; return qs('__rows') + '!$A$' + g.r1 + ':$A$' + g.r2; });
}
export function toEngine(text, ctx) {
  let f = text.replace(/_xlfn\._xlws\.|_xlfn\.|_xlws\./g, '');
  const s = structured(f, ctx.tables, ctx.row); f = s.f;
  f = subtotals(f, ctx); f = arrayCountifs(f, ctx); f = blankCriteria(f, ctx); f = rowArrays(f, ctx);
  return { f, bad: s.bad };
}

// ---------------------------------------------------------------- collect, run, write back
export function collect(wb) {
  const tables = tableMap(wb); const sheets = {}, formulas = {}, keep = [];
  // rows Excel treats as hidden: hidden rows in the file, and table rows a filter (slicer) leaves out
  const vis = new Map(); const filt = new Map();
  for (const tn of Object.keys(wb.tables)) { const fs = wb.tableFilter(tn).filter(x => !x.unsupported && x.values); if (!fs.length) continue; const t = wb.table(tn); const l = filt.get(t.sheet) || []; l.push({ t, fs }); filt.set(t.sheet, l); }
  for (const name of wb.sheetNames()) { const h = wb.hiddenRows(name); if (h.size || filt.has(name)) vis.set(name, { col: vis.size + 1, h, f: filt.get(name) || [] }); }
  const rowsMax = { n: 0 };
  for (const name of wb.sheetNames()) {
    const cells = [], fx = [];
    for (const [r, c, v, k] of wb.cellsForCalc(name)) {
      if (k === 'keep') { keep.push([name, r, c]); if (v !== null && v !== '') cells.push([r, c, typeof v === 'string' ? "'" + v : v]); continue; }
      if (typeof v === 'string' && v[0] === '=') {
        const t = toEngine(v.slice(1), { tables, row: r, sheet: name, vis, rowsMax });
        if (t.bad) { keep.push([name, r, c]); const cv = wb.get(name, n2col(c) + r); if (cv !== null && cv !== '') cells.push([r, c, typeof cv === 'string' ? "'" + cv : cv]); continue; }
        cells.push([r, c, '=' + t.f]); fx.push([r, c]); continue;
      }
      cells.push([r, c, typeof v === 'string' ? (ERR.test(v) ? v : "'" + v) : v]);
    }
    sheets[name] = cells; formulas[name] = fx;
  }
  if (vis.size) { const vc = []; for (const [name, v] of vis) { let max = 0; for (const [r] of sheets[name]) if (r > max) max = r; max = Math.max(max, ...v.h) + 50;
    for (let r = 1; r <= max; r++) {
      if (v.h.has(r)) { vc.push([r, v.col, 0]); continue; }
      const conds = []; for (const { t, fs } of v.f) if (r > t.r1 && r <= t.r2) for (const x of fs) { const ref = qs(name) + '!$' + n2col(t.c1 + x.col) + '$' + r;
        const any = x.values.map(val => '(' + ref + '&"")="' + String(val).replace(/"/g, '""') + '"'); if (x.blank) any.push('(' + ref + '&"")=""'); conds.push(any.length ? 'OR(' + any.join(',') + ')' : 'FALSE()'); }
      vc.push([r, v.col, conds.length ? '=IF(AND(' + conds.join(',') + '),1,0)' : 1]);
    } } sheets.__vis = vc; }
  if (rowsMax.n) { const rc = []; for (let r = 1; r <= rowsMax.n; r++) rc.push([r, 1, r]); sheets.__rows = rc; }
  return { sheets, formulas, keep };
}

let worker = null, seq = 0; const waiting = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./calc-worker.js', import.meta.url));
  worker.onmessage = e => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); e.data.ok ? w.res(e.data) : w.rej(new Error(e.data.error)); };
  worker.onerror = e => { for (const w of waiting.values()) w.rej(new Error(e.message || 'Recalculation failed')); waiting.clear(); worker = null; };
  return worker;
}
const call = msg => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); getWorker().postMessage({ ...msg, id }); });

// Recalculates every formula in wb and writes the results in. Returns { changed, ms, cells }.
export async function recalcWorkbook(wb) {
  const { sheets, formulas } = collect(wb);
  const r = await call({ type: 'build', sheets, formulas });
  let changed = 0, cells = 0;
  for (const [name, refs] of Object.entries(formulas)) {
    const vals = r.values[name]; refs.forEach(([row, c], k) => { cells++; let v = vals[k]; if (typeof v === 'number' && !isFinite(v)) v = '#NUM!'; if (wb.setCached(name, n2col(c) + row, v === undefined ? null : v)) changed++; });
  }
  return { changed, ms: r.ms, cells };
}
export const _test = { toEngine, collect, call, reset: () => { if (worker) worker.terminate(); worker = null; } };
