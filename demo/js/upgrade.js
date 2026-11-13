// One-tap tracker update in place (app 0.14.0, Aravind 11 Nov 2026). The app carries your entries into the next blank
// tracker version it ships with, checks every one, and saves the result over your own tracker file in OneDrive.
// Pure functions on Workbook objects, so they can be tested without OneDrive.
import { moveData, schemaVersion, markUpgraded } from './migrate.js';

// formula cells keep the result Excel last worked out in YOUR file when the formula is exactly the same in both
// versions, so the app shows real figures straight away; Excel recalculates everything when the file is next opened.
function formulaKeys(doc) {
  const ns = doc.documentElement.namespaceURI; const master = new Map(); const out = new Map();
  for (const f of doc.getElementsByTagNameNS(ns, 'f')) if (f.getAttribute('t') === 'shared' && f.getAttribute('ref')) master.set(f.getAttribute('si'), f.parentNode.getAttribute('r') + '=' + f.textContent);
  for (const f of doc.getElementsByTagNameNS(ns, 'f')) {
    const c = f.parentNode; const r = c.getAttribute('r'); if (!r) continue;
    const t = f.getAttribute('t') || '';
    if (t === 'shared') { const m = master.get(f.getAttribute('si')); if (m) out.set(r, ['shared', m, c]); }
    else if (t === '' || t === 'normal') out.set(r, ['n', f.textContent, c]);
  }
  return out;
}
export function carryCache(oldWb, newWb) {
  let carried = 0, total = 0;
  for (const sheet of Object.keys(newWb.sheetPath)) {
    if (!oldWb.hasSheet(sheet)) continue;
    const nd = newWb._sheet(sheet), od = oldWb._sheet(sheet);
    const nk = formulaKeys(nd.doc), ok = formulaKeys(od.doc); const ns = nd.doc.documentElement.namespaceURI; let changed = false;
    for (const [ref, [kind, key, cell]] of nk) {
      total++; const o = ok.get(ref); if (!o || o[0] !== kind || o[1] !== key) continue;
      const ov = o[2].getElementsByTagNameNS(o[2].namespaceURI, 'v')[0]; if (!ov) continue;
      for (const v of [...cell.getElementsByTagNameNS(ns, 'v')]) cell.removeChild(v);
      const t = o[2].getAttribute('t'); let text = ov.textContent; let type = t;
      if (t === 's') { text = oldWb.shared[Number(text)] ?? ''; type = 'str'; } // shared strings are not shared between files
      if (type) cell.setAttribute('t', type); else cell.removeAttribute('t');
      const v = nd.doc.createElementNS(ns, 'v'); v.textContent = text; cell.appendChild(v); carried++; changed = true;
    }
    if (changed) newWb.dirty.add(nd.p);
  }
  newWb._grids = null; // cached values changed: read the grids again
  return { carried, total };
}

// your own notes beside each setting (Settings, column F) stay with their setting
export function carryNotes(oldWb, newWb) {
  if (!oldWb.hasSheet('Settings') || !newWb.hasSheet('Settings')) return 0;
  const og = oldWb.grid('Settings'), ng = newWb.grid('Settings'); const rowOf = new Map(); let n = 0;
  for (const [r, m] of ng) { const b = m.get(2); if (typeof b === 'string' && b.trim()) rowOf.set(b.trim(), r); }
  for (const [r, m] of og) {
    const b = m.get(2), f = m.get(6); if (typeof b !== 'string' || typeof f !== 'string' || !f.trim() || oldWb.isFormula('Settings', 'F' + r)) continue;
    const nr = rowOf.get(b.trim()); if (!nr || newWb.isFormula('Settings', 'F' + nr)) continue;
    const cur = ng.get(nr) && ng.get(nr).get(6); if (cur !== undefined && cur !== null && cur !== '') continue;
    newWb.set('Settings', 'F' + nr, f); n++;
  }
  return n;
}

// every input cell of your file, read back from the updated file (after saving and opening it again): same value, or listed
export function checkInputs(oldWb, upWb, rep) {
  const moved = new Map(rep.copied.map(c => [c.sheet + '|' + c.ref, c.value]));
  const bad = []; let n = 0;
  for (const c of rep.copied) {
    n++; const v = upWb.get(c.sheet, c.ref);
    const same = typeof c.value === 'number' ? typeof v === 'number' && Math.abs(v - c.value) < 1e-9 : String(v ?? '') === String(c.value ?? '');
    if (!same) bad.push({ sheet: c.sheet, ref: c.ref, was: c.value, now: v });
  }
  return { checked: n, bad, moved: moved.size };
}

// the whole update, on bytes: returns the updated file and a report; throws when anything does not add up
export async function upgradeBytes(Workbook, oldBytes, templateBytes, { by, at }) {
  const oldWb = await Workbook.open(oldBytes), newWb = await Workbook.open(templateBytes);
  const vo = schemaVersion(oldWb), vn = schemaVersion(newWb);
  if (!vo || vo < 29) throw new Error('This update works from tracker v29. Your tracker is ' + (vo ? 'v' + vo : 'an older version') + '.');
  if (vn <= vo) throw new Error('Your tracker is already v' + vo + '.');
  const rep = moveData(oldWb, newWb);
  if (rep.missing.length) { const e = new Error(rep.missing.length + ' entr' + (rep.missing.length === 1 ? 'y has' : 'ies have') + ' no place in v' + vn + '. Nothing was changed.'); e.report = rep; throw e; }
  if (rep.wrong.length) throw new Error(rep.wrong.length + ' values did not read back the same. Nothing was changed.');
  const notes = carryNotes(oldWb, newWb);
  const cache = carryCache(oldWb, newWb);
  markUpgraded(newWb, { from: vo, to: vn, by, at });
  const out = await newWb.save();
  const upWb = await Workbook.open(out); const chk = checkInputs(oldWb, upWb, rep);
  if (chk.bad.length) { const e = new Error(chk.bad.length + ' entries did not read back the same from the updated file. Nothing was changed.'); e.check = chk; throw e; }
  if (schemaVersion(upWb) !== vn) throw new Error('The updated file does not say v' + vn + '. Nothing was changed.');
  return { bytes: out, from: vo, to: vn, copied: rep.copied.length, perSheet: rep.perSheet, cache, notes, checked: chk.checked };
}
