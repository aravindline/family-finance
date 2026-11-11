// Move everything you entered from your current tracker into a newer (blank) tracker version from Claude.
// Pure functions on two Workbook objects, so they can be tested without OneDrive.
//  1. History tables the app appends to (Daily Expenses, Income Entries, Events, Money Lent, Budget History, Invested History, Chart
//     Notes, Sync Log, App Meta): every typed value is copied row by row, matched by COLUMN NAME, so a column that
//     moved still lands in the right place. The new table grows if it is shorter.
//  2. Every other input cell (yellow, no formula) is copied to the same sheet and cell. If its row has a label
//     (for example a setting's name) and the new file has that label on another row, the value follows the label.
//     The new file's own labels, formulas and Change Log are kept.
//  3. Known layout changes between versions are converted (v24 Kite 3-line paste -> v25 tidy rows).
//  Anything that has no place in the new file is listed, never dropped silently. The old file is not changed.
import { col2n, n2col, splitRef } from './xlsx.js';
import { isTidy, readArea, toTidy, TIDY } from './kite.js';

const blank = v => v === null || v === undefined || v === '';
const HISTORY = new Set(['tblDaily', 'tblIncome', 'tblEvents', 'tblLent', 'tblRepaid', 'tblBudget', 'tblChartNotes', 'tblSyncLog', 'tblAppMeta', 'tblInvestedHist', 'tblEPF', 'tblGoalLinks', 'tblDeposits', 'tblMonthClose']);
const META = 'tblAppMeta';
// Input cells a version removed on purpose (approved by Aravind). A value typed there is listed as "not carried over",
// so the move can still go ahead. Key = the version that removed them.
const DROPPED = {
  26: { 'Expenses': /^T(2[7-9]|[3-9]\d|1[0-4]\d)$/, 'Other Holdings': /^A7$/, 'Loans': /^R[4-6]$/, 'Estate & Contacts': /^[A-E](1[1-9]|20)$/, 'Goals': /^C7$/ },
  29: { 'Other Assets': /^[J-O](1[4-9]|2[01])$/ }, // the FD / RD details block: its rows become FD / RD register entries
};
// v29: labels say "Aravind's retirement" instead of a fixed age; a setting whose label was reworded still finds its row
const RELABEL = [[/\bFIRE at 40\b/g, 'FIRE at retirement'], [/\bAfter 40\b/g, 'After retirement'], [/\bafter 40\b/g, 'after retirement'], [/\bafter-40\b/g, 'after-retirement'],
  [/\bBefore 40\b/g, 'Before retirement'], [/\bbefore 40\b/g, 'before retirement'], [/\bat 40\b/g, 'at retirement'], [/^Gratuity cap \(₹\)$/, 'Gratuity tax-free limit (₹)']];
export const relabel = s => RELABEL.reduce((t, [a, b]) => t.replace(a, b), s);
// Input cells a version moved to a new place (old ref -> new ref)
const MOVED = { 26: { 'Other Holdings': { A8: 'K5', B8: 'K6' } } };
function movedBy(from, to, sheet, ref) {
  for (const [v, m] of Object.entries(MOVED)) if ((from || 0) < Number(v) && (to || 0) >= Number(v) && m[sheet] && m[sheet][ref]) return m[sheet][ref];
  return null;
}
function droppedBy(from, to, sheet, ref) {
  for (const [v, m] of Object.entries(DROPPED)) if ((from || 0) < Number(v) && (to || 0) >= Number(v) && m[sheet] && m[sheet].test(ref)) return Number(v);
  return null;
}
export function schemaVersion(wb) { try { const v = wb.get('Settings', 'C4'); return typeof v === 'number' ? v : Number(v) || null; } catch (e) { return null; } }
export function movedTo(wb) { try { return wb.tables[META] ? wb.tableRows(META).find(r => r.Key === 'movedTo') || null : null; } catch (e) { return null; } }

function tableBoxes(wb, only) {
  const by = {};
  for (const name of Object.keys(wb.tables)) { if (only && !only.has(name)) continue; try { const t = wb.table(name); (by[t.sheet] = by[t.sheet] || []).push([t.c1, t.r1, t.c2, t.r2]); } catch (e) { /* skip */ } }
  return by;
}
const inBox = (boxes, ref) => { const [c, r] = splitRef(ref); const n = col2n(c); return (boxes || []).some(([c1, r1, c2, r2]) => n >= c1 && n <= c2 && r >= r1 && r <= r2); };

function growTable(wb, name, lastRow) {
  const t = wb.table(name); if (lastRow <= t.r2) return;
  const ref = n2col(t.c1) + t.r1 + ':' + n2col(t.c2) + lastRow;
  t.el.setAttribute('ref', ref); const af = t.el.getElementsByTagNameNS(t.el.namespaceURI, 'autoFilter')[0]; if (af) af.setAttribute('ref', ref);
  wb.dirty.add(t.path);
  for (let r = t.r2 + 1; r <= lastRow; r++) for (let c = t.c1; c <= t.c2; c++) { const st = wb.style(t.sheet, n2col(c) + t.r2); const ref1 = n2col(c) + r; if (!wb.isFormula(t.sheet, ref1)) wb.set(t.sheet, ref1, null, st); }
}

// returns { copied: [{sheet, ref, value}], missing: [{sheet, where, value, why}], perSheet: {sheet: {n, sum}}, notes: [] }
export function moveData(oldWb, newWb) {
  const copied = [], missing = [], notes = [], dropped = [];
  const vFrom = schemaVersion(oldWb), vTo = schemaVersion(newWb);
  const put = (sheet, ref, value) => { newWb.set(sheet, ref, value); copied.push({ sheet, ref, value }); };
  // ---- 1. tables
  for (const name of Object.keys(oldWb.tables)) {
    if (!HISTORY.has(name)) continue;
    const ot = oldWb.table(name);
    const rows = []; // old typed values per data row
    for (let r = ot.r1 + 1; r <= ot.r2; r++) {
      const o = {}; let any = false;
      ot.cols.forEach((h, i) => { const ref = n2col(ot.c1 + i) + r; if (oldWb.isFormula(ot.sheet, ref)) return; const v = oldWb.get(ot.sheet, ref); if (!blank(v)) { o[h] = v; any = true; } });
      rows.push(any ? o : null);
    }
    if (name === META) for (let i = 0; i < rows.length; i++) if (rows[i] && rows[i].Key === 'movedTo') rows[i] = null;
    while (rows.length && !rows[rows.length - 1]) rows.pop();
    if (!rows.length) continue;
    if (!newWb.tables[name]) { rows.forEach((o, i) => o && missing.push({ sheet: ot.sheet, where: name + ' row ' + (i + 1), value: JSON.stringify(o).slice(0, 120), why: 'table not in the new tracker' })); continue; }
    growTable(newWb, name, newWb.table(name).r1 + rows.length);
    const nt = newWb.table(name);
    rows.forEach((o, i) => {
      if (!o) return; const r = nt.r1 + 1 + i;
      for (const [h, v] of Object.entries(o)) {
        const ci = nt.cols.indexOf(h);
        if (ci < 0) { missing.push({ sheet: ot.sheet, where: name + ' · ' + h + ' (row ' + (i + 1) + ')', value: v, why: 'column not in the new tracker' }); continue; }
        const ref = n2col(nt.c1 + ci) + r;
        if (newWb.isFormula(nt.sheet, ref)) { missing.push({ sheet: nt.sheet, where: name + ' · ' + h + ' (row ' + (i + 1) + ')', value: v, why: 'a formula in the new tracker' }); continue; }
        put(nt.sheet, ref, v);
      }
    });
  }
  // ---- 2. Kite holdings layout change
  const oldTidy = oldWb.hasSheet('Paste Holdings') && isTidy(oldWb.get('Paste Holdings', 'A12'));
  const newTidy = newWb.hasSheet('Paste Holdings') && isTidy(newWb.get('Paste Holdings', 'A12'));
  const skipPaste = new Set();
  if (oldWb.hasSheet('Paste Holdings') && !oldTidy && newTidy) {
    const g = oldWb.grid('Paste Holdings'); const codes = []; for (let r = 6; r <= 11; r++) { const v = g.get(r) && g.get(r).get(1); if (v) codes.push(String(v)); }
    let last = 12; for (const [r, m] of g) if (r >= 13 && [...m.keys()].some(c => c <= 7)) last = Math.max(last, r);
    const area = []; for (let r = 13; r <= last; r++) { const m = g.get(r); area.push([1, 2, 3, 4, 5, 6, 7].map(c => (m && m.has(c) ? m.get(c) : null))); }
    const rows = toTidy(readArea(area, codes), codes);
    if (rows.length > TIDY.rows) missing.push({ sheet: 'Paste Holdings', where: 'Kite holdings', value: rows.length + ' rows', why: 'more than the ' + TIDY.rows + ' rows in the new tracker' });
    for (let r = TIDY.start; r < TIDY.start + TIDY.rows; r++) { const row = rows[r - TIDY.start]; for (let k = 0; k < 5; k++) { const ref = TIDY.cols[k] + r; skipPaste.add(ref); const v = row ? row[k] : null; if (!blank(v)) put('Paste Holdings', ref, v); else if (!blank(newWb.get('Paste Holdings', ref))) newWb.set('Paste Holdings', ref, null); } }
    notes.push('Kite holdings converted to one row per stock per account: ' + rows.length + ' rows.');
  }
  // ---- 2b. v28: EPF is set on the EPF sheet. Typed EPF figures become EPF entries, so nothing is lost:
  //  the last EPF balance per person -> an "Opening balance" for the month of the move;
  //  each past month's EPF figure -> a one-month entry (person "Family"), so past months show the same as before.
  const skipCell = new Set();
  if ((vFrom || 0) < 28 && (vTo || 0) >= 28 && newWb.tables.tblEPF) {
    const today = new Date(); const ser = (y, m) => Math.round((Date.UTC(y, m - 1, 1) - Date.UTC(1899, 11, 30)) / 86400000);
    const monthSer = v => { if (typeof v === 'number') { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return ser(d.getUTCFullYear(), d.getUTCMonth() + 1); } const m = /^(\d{4})-(\d{2})/.exec(String(v || '')); return m ? ser(+m[1], +m[2]) : null; };
    let n = 0; const add = (person, kind, amount, from, to, note, sheet, ref) => {
      n++; const row = newWb.appendTableRow('tblEPF', { 'Entry ID': 'EPF-MOVED-' + n, Person: person, Kind: kind, 'Amount (₹)': amount, 'From month': from, 'To month': to, Notes: note, 'Entered by': 'Move to v28', 'Entered at': today.toISOString().slice(0, 16).replace('T', ' '), Status: 'Active' });
      copied.push({ sheet: 'EPF', ref: 'D' + row, value: amount }); skipCell.add(sheet + '|' + ref);
    };
    if (oldWb.hasSheet('Other Assets')) {
      const g = oldWb.grid('Other Assets');
      for (const [r, m] of g) { const a = m.get(1); if (typeof a !== 'string' || !/^EPF/i.test(a.trim()) || r < 7) continue;
        [['D', 'Aravind'], ['E', 'Madhu']].forEach(([c, p]) => { const ref = c + r; if (oldWb.isFormula('Other Assets', ref)) return; const v = oldWb.get('Other Assets', ref); if (typeof v === 'number' && v) add(p, 'Opening balance', v, ser(today.getFullYear(), today.getMonth() + 1), null, 'EPF balance carried from v' + vFrom, 'Other Assets', ref); });
        break; }
    }
    const T = 'Income & Investment Tracker';
    if (oldWb.hasSheet(T)) {
      const g = oldWb.grid(T); let hr = null, hc = null;
      for (const [r, m] of g) { for (const [c, v] of m) if (typeof v === 'string' && /^EPF \/ VPF/.test(v.trim())) { hr = r; hc = c; break; } if (hr) break; }
      if (hr) for (const [r, m] of g) { if (r <= hr) continue; const ref = n2col(hc) + r; if (oldWb.isFormula(T, ref)) continue; const v = m.get(hc); if (typeof v !== 'number' || !v) continue;
        const ms = monthSer(m.get(1)); if (ms === null) continue; add('Family', 'Monthly contribution', v, ms, ms, 'Month-end EPF figure carried from v' + vFrom, T, ref); }
    }
    if (n) notes.push('EPF: ' + n + ' typed figure' + (n > 1 ? 's' : '') + ' carried to the new EPF sheet (balance as an opening balance this month, past months as they were).');
  }
  // ---- 2c. v29: FD / RD rows on Other Assets become entries in the FD / RD register (Deposits), with rate and dates from
  //  the old details block; Settings "joined" and gratuity accrual move to the Gratuity sheet (Aravind's column).
  if ((vFrom || 0) < 29 && (vTo || 0) >= 29 && newWb.tables.tblDeposits) {
    const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    if (oldWb.hasSheet('Other Assets')) {
      const g = oldWb.grid('Other Assets'); const cellv = (r, c) => { const m = g.get(r); return m ? m.get(col2n(c)) ?? null : null; };
      const details = {}; for (let r = 14; r <= 21; r++) { const k = cellv(r, 'J'); if (typeof k === 'string' && k.trim()) details[k.trim()] = r; }
      let n = 0;
      for (let r = 15; r <= 19; r++) {
        // the row's Type decides; a row with no Type is placed by its name (the blank tracker's names are "Fixed deposit 1" and so on)
        const type = String(cellv(r, 'C') || cellv(r, 'A') || '').trim();
        const kind = /recurring|\bRD\b/i.test(type) ? 'RD' : /corporate/i.test(type) ? 'Corporate FD' : /fixed|\bFD\b/i.test(type) ? 'FD' : null;
        for (const c of 'ABCDEG') skipCell.add('Other Assets|' + c + r);
        if (!kind) continue;
        const name = String(cellv(r, 'A') || type).trim(); const dr = details[name];
        const rate = dr ? cellv(dr, 'K') : null, start = dr ? cellv(dr, 'L') : null, mat = dr ? cellv(dr, 'M') : null;
        for (const [c, who] of [['D', 'Aravind'], ['E', 'Madhu']]) {
          if (oldWb.isFormula('Other Assets', c + r)) continue; const v = cellv(r, c); if (typeof v !== 'number' || !v) continue;
          n++; const rd = kind === 'RD';
          const row = newWb.appendTableRow('tblDeposits', { 'Deposit ID': 'DEP-MOVED-' + n, Name: name, Bank: cellv(r, 'B') || '', Whose: who, Kind: kind, 'Amount (₹)': rd ? null : v,
            'Rate %': typeof rate === 'number' ? rate : null, Start: typeof start === 'number' ? start : null, Maturity: typeof mat === 'number' ? mat : null, Status: 'Active',
            Notes: rd ? 'RD balance ₹' + Math.round(v).toLocaleString('en-IN') + ' carried from v' + vFrom + ': add the monthly instalment, start and maturity' : 'Carried from v' + vFrom,
            'Entered by': 'Move to v29', 'Entered at': at });
          if (rd) notes.push('Your recurring deposit "' + name + '" (₹' + Math.round(v).toLocaleString('en-IN') + ', ' + who + ') is in the FD / RD list: open Cash & fixed income › FD / RD and add its monthly instalment, start and maturity so its value counts again.');
          else copied.push({ sheet: 'Deposits', ref: 'F' + row, value: v });
        }
        if (dr) for (const c of 'JKLMNO') skipCell.add('Other Assets|' + c + dr);
      }
      if (n) notes.push('FD / RD: ' + n + ' deposit' + (n > 1 ? 's' : '') + ' moved from Other Assets to the new FD / RD list.');
    }
    if (oldWb.hasSheet('Settings') && newWb.hasSheet('Gratuity')) {
      const join = oldWb.get('Settings', 'C58'), accr = oldWb.get('Settings', 'C59');
      const lab = r => String(oldWb.get('Settings', 'B' + r) || '');
      if (/joined/i.test(lab(58)) && typeof join === 'number' && join) { put('Gratuity', 'C7', join); skipCell.add('Settings|C58'); }
      if (/gratuity accrual/i.test(lab(59)) && typeof accr === 'number' && accr) { put('Gratuity', 'C8', Math.round(accr / (15 / 26 / 12))); skipCell.add('Settings|C59'); notes.push('Gratuity: joining date and basic + DA (worked out from the monthly accrual) moved to the new Gratuity sheet for Aravind. Add the company and check the figure.'); }
    }
  }
  // ---- 3. every other input cell
  const ob = tableBoxes(oldWb, HISTORY);
  for (const sheet of Object.keys(oldWb.sheetPath)) {
    let refs; try { refs = oldWb.inputRefs(sheet); } catch (e) { continue; }
    const nin = newWb.hasSheet(sheet) ? newWb.inputRefs(sheet) : null;
    const og = oldWb.grid(sheet), ng = nin ? newWb.grid(sheet) : null;
    // a row's label: the first typed, non-input, non-formula text in columns A to D (e.g. a setting's name)
    const labelOf = (wb, g, inp, r) => { for (let c = sheet === 'Settings' ? 2 : 1; c <= 4; c++) { const ref = n2col(c) + r; const v = g.get(r) && g.get(r).get(c); if (typeof v === 'string' && v.trim() && !inp.has(ref) && !wb.isFormula(sheet, ref)) return [c, v.trim()]; } return null; };
    const newRowOf = new Map();
    const target = (ref) => {
      const [c, r] = splitRef(ref); const lab = labelOf(oldWb, og, refs, r); if (!lab) return ref;
      const here = labelOf(newWb, ng, nin, r); if (here && here[0] === lab[0] && here[1] === lab[1]) return ref;
      const key = lab[0] + '|' + lab[1];
      if (!newRowOf.has(key)) {
        const find = want => { for (const [rr, m] of ng) { const v = m.get(lab[0]); if (typeof v === 'string' && v.trim() === want && !nin.has(n2col(lab[0]) + rr)) return rr; } return null; };
        newRowOf.set(key, find(lab[1]) ?? (relabel(lab[1]) !== lab[1] ? find(relabel(lab[1])) : null));
      }
      const rr = newRowOf.get(key); return rr ? c + rr : null;
    };
    for (const ref of refs) {
      if (inBox(ob[sheet], ref)) continue; // handled with its table
      if (sheet === 'Paste Holdings' && (skipPaste.has(ref) || (!oldTidy && splitRef(ref)[1] >= 13))) continue;
      if (sheet === 'Paste Holdings' && newTidy && splitRef(ref)[1] >= 6 && splitRef(ref)[1] <= 11 && /^APP/i.test(String(oldWb.get(sheet, 'A' + splitRef(ref)[1]) || ''))) continue; // combined app slots are not used from v25
      if (skipCell.has(sheet + '|' + ref)) continue; // converted above (EPF sheet, FD / RD register, Gratuity)
      const v = oldWb.get(sheet, ref); if (blank(v)) continue;
      const mv = movedBy(vFrom, vTo, sheet, ref); if (mv && nin && nin.has(mv)) { put(sheet, mv, v); continue; }
      if (sheet === 'Other Holdings' && ref === 'A7' && String(v).trim().toUpperCase() === 'USD' && (vTo || 0) >= 26 && (vFrom || 0) < 26) continue; // USD is built in from v26
      const dv = droppedBy(vFrom, vTo, sheet, ref); if (dv) { dropped.push({ sheet, where: ref, value: v, why: 'removed in v' + dv }); continue; }
      if (!nin) { missing.push({ sheet, where: ref, value: v, why: 'sheet not in the new tracker' }); continue; }
      const to = target(ref);
      if (!to) { missing.push({ sheet, where: ref, value: v, why: 'its row label is not in the new tracker' }); continue; }
      if (newWb.isFormula(sheet, to)) { missing.push({ sheet, where: to, value: v, why: 'a formula in the new tracker' }); continue; }
      if (!nin.has(to)) { missing.push({ sheet, where: to, value: v, why: 'not an input cell in the new tracker' }); continue; }
      put(sheet, to, v);
    }
  }
  // ---- check: read every copied cell back from the new file
  const wrong = copied.filter(c => { const v = newWb.get(c.sheet, c.ref); return typeof c.value === 'number' ? Math.abs(Number(v) - c.value) > 1e-9 : String(v ?? '') !== String(c.value ?? ''); });
  const perSheet = {};
  for (const c of copied) { const p = perSheet[c.sheet] = perSheet[c.sheet] || { n: 0, sum: 0, newSum: 0 }; p.n++; if (typeof c.value === 'number') p.sum += c.value; const nv = newWb.get(c.sheet, c.ref); if (typeof nv === 'number') p.newSum += nv; }
  return { copied, missing, wrong, perSheet, notes, dropped, from: vFrom, to: vTo };
}

// a fresh tracker from Claude has no daily expenses or income typed in it yet
export function looksBlank(wb) {
  const n = name => { try { return wb.tables[name] ? wb.tableRows(name).filter(r => Object.entries(r).some(([k, v]) => k !== '_row' && !blank(v))).length : 0; } catch (e) { return 0; } };
  return { daily: n('tblDaily'), income: n('tblIncome') };
}

export function markMoved(oldWb, { to, by, at, version }) {
  oldWb.appendTableRow(META, { Key: 'movedTo', Version: version || '', 'Updated at': at, 'Updated by': by + (to ? ' · ' + to : '') });
}
export function markMovedFrom(newWb, { from, by, at, version }) {
  if (!newWb.tables[META]) return;
  newWb.appendTableRow(META, { Key: 'movedFrom', Version: version || '', 'Updated at': at, 'Updated by': by + (from ? ' · ' + from : '') });
}
