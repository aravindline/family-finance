// In-app recalculation of the tracker (app 0.15.1). Runs off the main thread so the screen never freezes.
// Uses HyperFormula (GPLv3, vendor/hyperformula), loaded from the app itself: no outside calls.
/* global HyperFormula, importScripts */
importScripts('../vendor/hyperformula/hyperformula-3.5.0.full.min.js');

// ---- Excel's TEXT(value, format) for the formats a tracker uses (numbers, %, Indian grouping, dates)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const roundHalfAway = (x, d) => { const p = Math.pow(10, d); const y = Math.abs(x) * p; const r = Math.round(y + 1e-9 * Math.max(1, y)); return Math.sign(x) * r / p; };
function splitSections(fmt) { const out = []; let cur = '', q = false, esc = false, br = false;
  for (const ch of fmt) { if (esc) { cur += ch; esc = false; continue; } if (ch === '\\') { cur += ch; esc = true; continue; } if (ch === '"') q = !q; if (!q && ch === '[') br = true; if (!q && ch === ']') br = false; if (ch === ';' && !q && !br) { out.push(cur); cur = ''; continue; } cur += ch; }
  out.push(cur); return out; }
function isDateFmt(s) { return /(^|[^\\"])(y|d|mmm|h|ss)/i.test(s.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '')); }
function fmtDate(serial, s) {
  const ms = Math.round((serial) * 86400000); const d = new Date(Date.UTC(1899, 11, 30) + ms);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), W = d.getUTCDay();
  let out = '', i = 0; s = s.replace(/\[[^\]]*\]/g, '');
  while (i < s.length) {
    const rest = s.slice(i); let m;
    if (rest[0] === '"') { const j = s.indexOf('"', i + 1); out += s.slice(i + 1, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; continue; }
    if (rest[0] === '\\') { out += rest[1] || ''; i += 2; continue; }
    if ((m = /^yyyy/i.exec(rest))) { out += Y; i += 4; continue; }
    if ((m = /^yy/i.exec(rest))) { out += String(Y).slice(2); i += 2; continue; }
    if ((m = /^mmmm/i.exec(rest))) { out += MONL[M]; i += 4; continue; }
    if ((m = /^mmm/i.exec(rest))) { out += MON[M]; i += 3; continue; }
    if ((m = /^mm/i.exec(rest))) { out += String(M + 1).padStart(2, '0'); i += 2; continue; }
    if ((m = /^m/i.exec(rest))) { out += M + 1; i += 1; continue; }
    if ((m = /^dddd/i.exec(rest))) { out += DAYS[W]; i += 4; continue; }
    if ((m = /^ddd/i.exec(rest))) { out += DAYS[W].slice(0, 3); i += 3; continue; }
    if ((m = /^dd/i.exec(rest))) { out += String(D).padStart(2, '0'); i += 2; continue; }
    if ((m = /^d/i.exec(rest))) { out += D; i += 1; continue; }
    out += rest[0]; i++;
  }
  return out;
}
function fmtNumber(x, s) {
  // literal text, then the digit pattern
  let pct = 0; let lit = ''; let pat = ''; const parts = []; let i = 0;
  while (i < s.length) { const ch = s[i];
    if (ch === '"') { const j = s.indexOf('"', i + 1); parts.push({ t: s.slice(i + 1, j) }); i = j + 1; continue; }
    if (ch === '\\') { parts.push({ t: s[i + 1], esc: true }); i += 2; continue; }
    if (ch === '[') { const j = s.indexOf(']', i); i = j + 1; continue; }
    if ('0#?,.'.includes(ch)) { parts.push({ d: ch }); i++; continue; }
    if (ch === '%') { pct++; parts.push({ t: '%' }); i++; continue; }
    if (ch === '_' ) { parts.push({ t: ' ' }); i += 2; continue; }
    if (ch === '*') { i += 2; continue; }
    parts.push({ t: ch }); i++; }
  x = x * Math.pow(100, pct);
  // digit placeholders: integer part, decimal part; literal commas between integer placeholders (escaped) stay where written
  const ph = parts.filter(p => p.d || p.esc); const firstD = parts.findIndex(p => p.d); let lastD = -1; parts.forEach((p, k) => { if (p.d) lastD = k; });
  if (firstD < 0) return parts.map(p => p.t || '').join('');
  const core = parts.slice(firstD, lastD + 1); const dot = core.findIndex(p => p.d === '.');
  const intP = dot < 0 ? core : core.slice(0, dot), decP = dot < 0 ? [] : core.slice(dot + 1);
  const decN = decP.filter(p => p.d === '0' || p.d === '#' || p.d === '?').length; const decMin = decP.filter(p => p.d === '0').length;
  // trailing commas scale by 1000
  let scale = 0; for (let k = intP.length - 1; k >= 0 && intP[k].d === ','; k--) scale++;
  const intCore = scale ? intP.slice(0, intP.length - scale) : intP;
  x = x / Math.pow(1000, scale);
  const r = roundHalfAway(Math.abs(x), decN); let [ip, dp = ''] = r.toFixed(decN).split('.');
  dp = dp.replace(/0+$/, ''); while (dp.length < decMin) dp += '0';
  const grouping = intCore.some(p => p.d === ',') && !intCore.some(p => p.esc);
  const intSlots = intCore.filter(p => p.d === '0' || p.d === '#' || p.d === '?');
  const minInt = intSlots.filter(p => p.d === '0').length;
  if (ip === '0' && minInt === 0) ip = '';
  while (ip.length < minInt) ip = '0' + ip;
  let intStr;
  if (intCore.some(p => p.esc)) { // literal separators, e.g. ##\,##\,##0 (Indian lakh grouping)
    const slots = []; for (const p of intCore) slots.push(p.d && p.d !== ',' ? 'D' : p.esc ? p.t : '');
    let digits = ip.split(''); let o = '';
    for (let k = slots.length - 1; k >= 0; k--) { const sl = slots[k]; if (sl === 'D') { if (digits.length) o = digits.pop() + o; } else if (sl) { if (digits.length) o = sl + o; } }
    intStr = digits.join('') + o;
  } else intStr = grouping ? ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ip;
  const num = intStr + (dp.length ? '.' + dp : (decMin ? '.' : ''));
  return parts.slice(0, firstD).map(p => p.t || '').join('') + num + parts.slice(lastD + 1).map(p => p.t || '').join('');
}
function excelText(v, fmt) {
  if (typeof v !== 'number') return v === null || v === undefined ? '' : (typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
  const secs = splitSections(String(fmt)); let s, val = v;
  const cond = /^\[([<>=]{1,2})(-?[\d.]+)\]/;
  if (secs.length > 1 && cond.test(secs[0])) {
    const [, op, n] = cond.exec(secs[0]); const k = Number(n); const ok = op === '>=' ? v >= k : op === '>' ? v > k : op === '<=' ? v <= k : op === '<' ? v < k : op === '=' ? v === k : v !== k;
    s = ok ? secs[0] : secs[1];
  } else if (v < 0 && secs.length > 1) { s = secs[1]; val = -v; }
  else if (v === 0 && secs.length > 2) s = secs[2];
  else s = secs[0];
  if (/^general$/i.test(s.trim())) return String(v);
  const neg = val < 0 && !(secs.length > 1 && v < 0); const body = isDateFmt(s) ? fmtDate(val, s) : fmtNumber(Math.abs(val), s);
  return (neg && !isDateFmt(s) && roundHalfAway(Math.abs(val), 10) !== 0 ? '-' : '') + body;
}

const NSX = self.HyperFormula; const HFC = NSX.HyperFormula || NSX; const FP = NSX.FunctionPlugin || HFC.FunctionPlugin;
const CellErr = NSX.CellError || HFC.CellError; const ET = NSX.ErrorType || HFC.ErrorType;
const raw = v => (v !== null && typeof v === 'object' && 'val' in v) ? v.val : (typeof v === 'symbol' ? null : v);
const flat = r => { const d = r && typeof r.rawData === 'function' ? r.rawData() : r && r.data ? r.data : Array.isArray(r) ? r : [[r]]; return d.reduce((a, x) => a.concat(Array.isArray(x) ? x : [x]), []); };
class XlPlugin extends FP {
  text(ast, state) { // Excel TEXT: an empty cell formats as 0
    return this.runFunction(ast.args, state, this.metadata('TEXT'), (val, fmt) => { const n = raw(val); return excelText(n === null ? 0 : n, fmt); });
  }
  lookup(ast, state) { // Excel LOOKUP (vector form): the last value <= the one sought, errors skipped (used as LOOKUP(2,1/(test),result))
    return this.runFunction(ast.args, state, this.metadata('LOOKUP'), (val, lv, rv) => {
      const x = raw(val); const L = flat(lv), Rr = rv === undefined ? L : flat(rv); let hit = -1;
      for (let i = 0; i < L.length; i++) { const v = raw(L[i]); if (v instanceof CellErr || v === null || v === undefined) continue;
        if (typeof x === 'number' ? (typeof v === 'number' && v <= x) : (typeof v === 'string' && String(v).toLowerCase() <= String(x).toLowerCase())) hit = i; }
      if (hit < 0) return new CellErr(ET.NA);
      const out = Rr[Math.min(hit, Rr.length - 1)]; const o = raw(out); return o === null || o === undefined ? 0 : out;
    });
  }
}
XlPlugin.implementedFunctions = {
  TEXT: { method: 'text', parameters: [{ argumentType: 'SCALAR' }, { argumentType: 'STRING' }] },
  LOOKUP: { method: 'lookup', enableArrayArithmeticForArguments: true, parameters: [{ argumentType: 'NOERROR' }, { argumentType: 'RANGE' }, { argumentType: 'RANGE', optionalArg: true }] },
};
for (const fn of ['TEXT', 'LOOKUP']) { try { HFC.unregisterFunction(fn); } catch (e) { /* not there */ } }
HFC.registerFunction('TEXT', XlPlugin, { enGB: { TEXT: 'TEXT' } }); HFC.registerFunction('LOOKUP', XlPlugin, { enGB: { LOOKUP: 'LOOKUP' } });

const CONFIG = { licenseKey: 'gpl-v3', useArrayArithmetic: true, leapYear1900: false, nullDate: { year: 1899, month: 12, day: 30 },
  evaluateNullToZero: true, useColumnIndex: true, smartRounding: true, dateFormats: [], timeFormats: [], currencySymbol: [] };
let hf = null, names = [];
const valueOut = v => (v !== null && typeof v === 'object') ? (v.value !== undefined && typeof v.value === 'string' && v.value[0] === '#' ? v.value : ('val' in v ? v.val : String(v))) : v;

function grid(cells) { let R = 0, C = 0; for (const [r, c] of cells) { if (r > R) R = r; if (c > C) C = c; }
  const g = Array.from({ length: R }, () => new Array(C).fill(null)); for (const [r, c, v] of cells) g[r - 1][c - 1] = v; return g; }

self.onmessage = e => {
  const m = e.data; const t0 = Date.now();
  try {
    if (m.type === 'build') {
      if (hf) { try { hf.destroy(); } catch (_) { /* gone */ } }
      const sheets = {}; for (const [n, cells] of Object.entries(m.sheets)) sheets[n] = grid(cells);
      hf = HFC.buildFromSheets(sheets, CONFIG); names = Object.keys(sheets);
      self.postMessage({ id: m.id, ok: true, values: readAll(m.formulas), ms: Date.now() - t0 });
    } else if (m.type === 'set') {
      if (!hf) throw new Error('not built');
      hf.batch(() => { for (const [sheet, r, c, v] of m.changes) hf.setCellContents({ sheet: hf.getSheetId(sheet), row: r - 1, col: c - 1 }, [[v]]); });
      self.postMessage({ id: m.id, ok: true, values: readAll(m.formulas), ms: Date.now() - t0 });
    } else if (m.type === 'text') { self.postMessage({ id: m.id, ok: true, value: excelText(m.v, m.fmt) }); }
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); }
};
function readAll(formulas) { // formulas: {sheet: [[r, c], ...]} -> {sheet: [v, ...]} in the same order
  const out = {};
  for (const [n, refs] of Object.entries(formulas)) { const sid = hf.getSheetId(n); out[n] = refs.map(([r, c]) => valueOut(hf.getCellValue({ sheet: sid, row: r - 1, col: c - 1 }))); }
  return out;
}
