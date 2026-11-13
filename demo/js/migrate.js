// Carry everything you entered from your tracker into the next tracker version, inside the app (used by the one-tap
// update, app 0.14.0). Pure functions on two Workbook objects, so they can be tested without OneDrive.
//  1. History tables the app appends to (Daily Expenses, Income Entries, Events, Money Lent, FD / RD, EPF, Month Close and
//     others): every typed value is copied row by row, matched by COLUMN NAME, so a column that moved still lands in the
//     right place. The new table grows if it is shorter.
//  2. Every other input cell (yellow, no formula) is copied to the same sheet and cell. If its row has a label (for
//     example a setting's name) and the new file has that label on another row, the value follows the label.
//  Anything that has no place in the new file is listed, never dropped silently. Works from tracker v29 onwards.
import { col2n, n2col, splitRef } from './xlsx.js';

const blank = v => v === null || v === undefined || v === '';
const HISTORY = new Set(['tblDaily', 'tblIncome', 'tblEvents', 'tblLent', 'tblRepaid', 'tblBudget', 'tblChartNotes', 'tblSyncLog', 'tblAppMeta', 'tblInvestedHist', 'tblEPF', 'tblGoalLinks', 'tblDeposits', 'tblMonthClose']);
const META = 'tblAppMeta';
export function schemaVersion(wb) { try { const v = wb.get('Settings', 'C4'); return typeof v === 'number' ? v : Number(v) || null; } catch (e) { return null; } }

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
  // ---- 2. every other input cell
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
        newRowOf.set(key, find(lab[1]));
      }
      const rr = newRowOf.get(key); return rr ? c + rr : null;
    };
    for (const ref of refs) {
      if (inBox(ob[sheet], ref)) continue; // handled with its table
      const v = oldWb.get(sheet, ref); if (blank(v)) continue;
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

// one line on the App Meta sheet: which version the tracker was updated from, by whom and when
export function markUpgraded(wb, { from, to, by, at }) {
  if (!wb.tables[META]) return;
  wb.appendTableRow(META, { Key: 'upgraded', Version: to || '', 'Updated at': at, 'Updated by': by + ' · from v' + (from || '?') });
}
