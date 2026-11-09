// Sync engine: outbox -> tracker file in OneDrive. The tracker is the source of truth.
// Rules: write only input cells and the app's own tables; never delete rows; never overwrite
// a record someone else changed since we last saw it (that becomes a conflict for the user).
import { Workbook, serialToISO, isoToSerial } from './xlsx.js';
import { uuid } from './crypto.js';
import { extractSnapshot } from './extract.js';
import { readArea, toRows, isTidy, readTidy, toTidy, TIDY } from './kite.js';
import { movedTo } from './migrate.js';

const DAILY = 'tblDaily', LOG = 'tblSyncLog', META = 'tblAppMeta';
export class PreconditionFailed extends Error {}

const nowStamp = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
const FIELDS = { date: 'Date', amount: 'Amount', category: 'Category', sub: 'Sub-category', mode: 'Payment mode', notes: 'Notes', by: 'Logged by', status: 'Status', event: 'Event', enteredBy: 'Entered by' };

export function rowToEntry(r) {
  return { id: r['Entry ID'], date: typeof r.Date === 'number' ? serialToISO(r.Date) : r.Date, amount: Number(r.Amount) || 0, category: r.Category || '', sub: r['Sub-category'] || '',
    mode: r['Payment mode'] || '', notes: r.Notes || '', event: r.Event || '', by: r['Logged by'] || '', enteredBy: r['Entered by'] || '', status: r.Status || 'Active', createdAt: r['Created at'] || '', updatedAt: r['Updated at'] || '', version: Number(r.Version) || 1, row: r._row };
}
function entryCell(field, v) { return field === 'date' ? isoToSerial(v) : field === 'amount' ? Number(v) : v; }

// Apply the outbox to a downloaded workbook. Returns {applied, conflicts, logRows}.
export function applyOutbox(wb, ops, who, device) {
  const batch = uuid().slice(0, 8), stamp = nowStamp();
  const byId = new Map(wb.tableRows(DAILY).filter(r => r['Entry ID']).map(r => [r['Entry ID'], r]));
  const applied = [], conflicts = [], log = [];
  for (const op of ops) {
    if (op.kind === 'addExpense') {
      if (byId.has(op.entry.id)) { applied.push(op.opId); continue; } // already there (earlier attempt)
      const e = op.entry;
      const row = wb.appendTableRow(DAILY, { Date: isoToSerial(e.date), Amount: Number(e.amount), Category: e.category, 'Sub-category': e.sub || null, 'Payment mode': e.mode || null, Notes: e.notes || null, ...(wb.table(DAILY).cols.includes('Event') ? { Event: e.event || null } : {}), ...(wb.table(DAILY).cols.includes('Entered by') ? { 'Entered by': e.enteredBy || e.by } : {}), 'Logged by': e.by, Status: 'Active', 'Entry ID': e.id, 'Created at': e.createdAt, 'Updated at': stamp, Version: 1 });
      log.push([stamp, who, device, 'Daily Expenses', 'Row ' + row + ' (' + e.id.slice(0, 8) + ')', 'New entry', '', e.date + ' · ₹' + e.amount + ' · ' + e.category + (e.sub ? ' › ' + e.sub : ''), batch]);
      byId.set(e.id, { _row: row }); applied.push(op.opId);
    } else if (op.kind === 'editExpense' || op.kind === 'deleteExpense') {
      const r = byId.get(op.id);
      if (!r) { conflicts.push({ op, reason: 'missing', remote: null }); continue; }
      const remote = rowToEntry(r);
      const owner = remote.enteredBy || remote.by; // whoever typed the entry may change it (one of you can enter for the other)
      if (owner && op.by && owner !== op.by) { conflicts.push({ op, reason: 'not-owner', remote }); continue; }
      // changed elsewhere since we last saw it? (version bump by the app, or any value edited directly in Excel)
      const same = (a, b) => String(a ?? '') === String(b ?? '');
      const editedElsewhere = remote.version !== op.baseVersion || (op.base && Object.keys(op.base).some(k => !same(remote[k], op.base[k])));
      if (editedElsewhere) { conflicts.push({ op, reason: 'changed', remote }); continue; }
      const changes = op.kind === 'deleteExpense' ? { status: 'Deleted' } : op.changes;
      if ('event' in changes && !wb.table(DAILY).cols.includes('Event')) { conflicts.push({ op, reason: 'needs-v21', remote }); continue; }
      for (const [f, v] of Object.entries(changes)) {
        const old = remote[f];
        wb.setTableCell(DAILY, r._row, FIELDS[f], entryCell(f, v));
        log.push([stamp, who, device, 'Daily Expenses', 'Row ' + r._row + ' (' + op.id.slice(0, 8) + ')', FIELDS[f], old === undefined || old === null ? '' : String(old), String(v), batch]);
      }
      wb.setTableCell(DAILY, r._row, 'Updated at', stamp);
      wb.setTableCell(DAILY, r._row, 'Version', remote.version + 1);
      applied.push(op.opId);
    } else if (op.kind === 'addRow') {
      // a new record in one of the app's own tables (events, money lent, repayments, budgets, chart notes)
      if (!wb.tables[op.table]) { conflicts.push({ op, reason: 'needs-v21', remote: null }); continue; }
      if (op.idCol && wb.tableRows(op.table).some(r => String(r[op.idCol] ?? '') === String(op.values[op.idCol]))) { applied.push(op.opId); continue; }
      const vals = Object.assign({}, op.values); const t = wb.table(op.table);
      for (const k of Object.keys(vals)) if (!t.cols.includes(k)) delete vals[k];
      const row = wb.appendTableRow(op.table, vals);
      log.push([stamp, who, device, t.sheet, 'Row ' + row + (op.idCol ? ' (' + String(op.values[op.idCol]).slice(0, 8) + ')' : ''), 'New ' + (op.what || 'row'), '', op.summary || '', batch]);
      applied.push(op.opId);
    } else if (op.kind === 'setRow') {
      // change fields of one record found by its ID; a field changed elsewhere since this device saw it is a conflict
      if (!wb.tables[op.table]) { conflicts.push({ op, reason: 'needs-v21', remote: null }); continue; }
      const r = wb.tableRows(op.table).find(x => String(x[op.idCol] ?? '') === String(op.id));
      if (!r) { conflicts.push({ op, reason: 'missing', remote: null }); continue; }
      const same = (a, b) => (a === null || a === undefined || a === '' ? b === null || b === undefined || b === '' : typeof a === 'number' || typeof b === 'number' ? Math.abs(Number(a) - Number(b)) < 1e-9 : String(a) === String(b ?? ''));
      if (op.base && Object.entries(op.base).some(([k, v]) => !same(r[k], v))) { conflicts.push({ op, reason: 'changed', remote: r }); continue; }
      const t = wb.table(op.table);
      for (const [k, v] of Object.entries(op.changes)) {
        if (!t.cols.includes(k)) continue;
        wb.setTableCell(op.table, r._row, k, v === '' ? null : v);
        log.push([stamp, who, device, t.sheet, 'Row ' + r._row + ' (' + String(op.id).slice(0, 8) + ')', k, r[k] === null || r[k] === undefined ? '' : String(r[k]), v === null || v === undefined ? '' : String(v), batch]);
      }
      applied.push(op.opId);
    } else if (op.kind === 'setCells') {
      // Input cells only, all or nothing. A cell that now differs from what this device last saw is a conflict.
      const same = (a, b) => { if (a === null || a === undefined || a === '') return b === null || b === undefined || b === ''; if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a) - Number(b)) < 1e-9; return String(a) === String(b ?? ''); };
      const bad = [];
      for (const c of op.cells) {
        if (wb.isFormula(op.sheet, c.ref)) { bad.push({ ...c, reason: 'formula' }); continue; }
        const cur = wb.get(op.sheet, c.ref);
        if (!same(cur, c.base) && !same(cur, c.value)) bad.push({ ...c, remote: cur });
      }
      if (bad.length) { conflicts.push({ op, reason: bad.some(b => b.reason === 'formula') ? 'formula' : 'changed', cells: bad, remote: null }); continue; }
      for (const c of op.cells) {
        const old = wb.get(op.sheet, c.ref); if (same(old, c.value)) continue;
        wb.set(op.sheet, c.ref, c.value === '' ? null : c.value);
        log.push([stamp, who, device, op.sheet, c.ref, c.label || c.ref, old === null || old === undefined ? '' : String(old), c.value === null || c.value === undefined ? '' : String(c.value), batch]);
      }
      applied.push(op.opId);
    } else if (op.kind === 'fillColumn') {
      // a pasted list, one line per cell, into a column the tracker reads (rest of the range cleared)
      if (!wb.hasSheet(op.sheet)) { conflicts.push({ op, reason: 'missing', remote: null }); continue; }
      const fx = wb.formulaRefs(op.sheet); let hasF = false; for (let r = op.from; r <= op.to; r++) if (fx.has(op.col + r)) hasF = true;
      if (hasF || op.lines.length > op.to - op.from + 1) { conflicts.push({ op, reason: 'formula', remote: null }); continue; }
      let before = 0;
      for (let r = op.from; r <= op.to; r++) {
        const old = wb.get(op.sheet, op.col + r); if (old !== null && old !== '') before++;
        const line = op.lines[r - op.from]; const n = line !== undefined && /^-?[\d,]*\.?\d+$/.test(String(line)) ? Number(String(line).replace(/,/g, '')) : line;
        if ((line === undefined || line === '') && (old === null || old === '')) continue;
        wb.set(op.sheet, op.col + r, line === undefined ? null : n);
      }
      if (op.date) { const od = wb.get(op.sheet, op.date.ref); if (!wb.isFormula(op.sheet, op.date.ref)) wb.set(op.sheet, op.date.ref, op.date.value); log.push([stamp, who, device, op.sheet, op.date.ref, 'Date', od === null ? '' : String(od), String(op.date.value), batch]); }
      log.push([stamp, who, device, op.sheet, op.col + op.from + ':' + op.col + op.to, op.title || 'Pasted list', before + ' lines', op.lines.length + ' lines', batch]);
      applied.push(op.opId);
    } else if (op.kind === 'kitePaste') {
      // Kite holdings: rewrite the paste area; accounts not in this paste keep their rows
      const sh = 'Paste Holdings'; if (!wb.hasSheet(sh)) { conflicts.push({ op, reason: 'missing', remote: null }); continue; }
      const g = wb.grid(sh);
      const codes = []; for (let r = 6; r <= 11; r++) { const v = g.get(r) && g.get(r).get(1); if (v) codes.push(String(v)); }
      if (isTidy(g.get(12) && g.get(12).get(1))) { // tracker v25+: one row per stock per account
        const S = TIDY.start, E = S + TIDY.rows - 1, NC = TIDY.cols.length;
        const fx = wb.formulaRefs(sh); let hasF = false; for (let r = S; r <= E && !hasF; r++) for (const c of TIDY.cols) if (fx.has(c + r)) { hasF = true; break; }
        if (hasF) { conflicts.push({ op, reason: 'formula', remote: null }); continue; }
        const old = []; for (let r = S; r <= E; r++) { const m = g.get(r); old.push([1, 2, 3, 4, 5].map(c => (m && m.has(c) ? m.get(c) : null))); }
        const acc = readTidy(old, codes); const before = old.filter(x => x[0] && x[1]).length;
        for (const c of op.replace || []) acc[c] = [];
        for (const [c, list] of Object.entries(op.accounts || {})) acc[c] = list;
        const rows = toTidy(acc, codes);
        if (rows.length > TIDY.rows) { conflicts.push({ op, reason: 'full', remote: rows.length + ' rows; the tracker has room for ' + TIDY.rows }); continue; }
        for (let r = S; r <= E; r++) { const row = rows[r - S]; const m = g.get(r); for (let k = 0; k < NC; k++) { const v = row ? row[k] : null; if (v === null && !(m && m.has(k + 1) && m.get(k + 1) !== null)) continue; wb.set(sh, TIDY.cols[k] + r, v); } }
        if (op.asOf) { const oldD = wb.get(sh, 'B3'); wb.set(sh, 'B3', op.asOf); log.push([stamp, who, device, sh, 'B3', 'Prices as of', oldD === null ? '' : String(oldD), String(op.asOf), batch]); }
        log.push([stamp, who, device, sh, 'A' + S + ':E' + (S + Math.max(rows.length, before) - 1), 'Kite holdings (' + Object.keys(op.accounts || {}).join(', ') + ')', before + ' rows', rows.length + ' rows', batch]);
        applied.push(op.opId); continue;
      }
      const COLS = 'ABCDEFG'; const start = op.start || 13;
      let last = start - 1; for (const [r, m] of g) if (r >= start && [...m.keys()].some(c => c <= 7)) last = Math.max(last, r);
      const old = []; for (let r = start; r <= last; r++) { const m = g.get(r); old.push([1, 2, 3, 4, 5, 6, 7].map(c => (m && m.has(c) ? m.get(c) : null))); }
      const fx = wb.formulaRefs(sh); let hasF = false; for (let r = start; r <= last; r++) for (const c of COLS) if (fx.has(c + r)) hasF = true;
      if (hasF) { conflicts.push({ op, reason: 'formula', remote: null }); continue; }
      const acc = readArea(old, codes); const before = Object.values(acc).reduce((t, l) => t + l.length, 0);
      for (const c of op.replace || []) acc[c] = [];
      for (const [c, list] of Object.entries(op.accounts || {})) acc[c] = list;
      const rows = toRows(acc);
      const end = Math.max(last, start + rows.length - 1);
      for (let r = start; r <= end; r++) { const row = rows[r - start]; for (let k = 0; k < 7; k++) { const v = row ? row[k] : null; const ref = COLS[k] + r; if (v === null && !(g.get(r) && g.get(r).has(k + 1))) continue; wb.set(sh, ref, v); } }
      if (op.asOf) { const oldD = wb.get(sh, 'B3'); wb.set(sh, 'B3', op.asOf); log.push([stamp, who, device, sh, 'B3', 'Prices as of', oldD === null ? '' : String(oldD), String(op.asOf), batch]); }
      const after = Object.values(acc).reduce((t, l) => t + l.filter(x => x.qty > 0).length, 0);
      log.push([stamp, who, device, sh, 'A' + start + ':G' + end, 'Kite holdings (' + Object.keys(op.accounts || {}).join(', ') + ')', before + ' holdings', after + ' holdings', batch]);
      applied.push(op.opId);
    }
  }
  for (const l of log) wb.appendTableRow(LOG, { When: l[0], Who: l[1], Device: l[2], Sheet: l[3], 'Cell or record': l[4], Field: l[5], 'Old value': l[6], 'New value': l[7], 'Batch ID': l[8] });
  if (log.length) { // remember when the app last wrote, to know when Excel has recalculated since
    const m = wb.tableRows(META).find(x => x.Key === 'lastAppWrite');
    if (m) { wb.setTableCell(META, m._row, 'Updated at', new Date().toISOString()); wb.setTableCell(META, m._row, 'Updated by', who); wb.setTableCell(META, m._row, 'Version', (Number(m.Version) || 0) + 1); }
    else wb.appendTableRow(META, { Key: 'lastAppWrite', Version: 1, 'Updated at': new Date().toISOString(), 'Updated by': who });
  }
  return { applied, conflicts, logCount: log.length };
}

export function lastAppWrite(wb) { try { const m = wb.tableRows(META).find(x => x.Key === 'lastAppWrite'); return m ? m['Updated at'] : null; } catch (e) { return null; } }

// One full sync round. transport: { download() -> {bytes, etag}, upload(bytes, etag) -> {etag} | throws PreconditionFailed,
// meta() -> {eTag} (optional) }. With nothing to send and an unchanged file, nothing is downloaded (saves mobile data).
export async function syncOnce({ transport, ops, who, device, maxTries = 3, lastEtag = null }) {
  if (!ops.length && lastEtag && transport.meta) {
    const m = await transport.meta();
    if (m && m.eTag === lastEtag) return { applied: [], conflicts: [], logCount: 0, unchanged: true, etag: lastEtag, attempts: 0 };
  }
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const { bytes, etag } = await transport.download();
    const wb = await Workbook.open(bytes);
    if (!wb.hasSheet('Daily Expenses') || !wb.tables[DAILY]) throw new Error('This file is not tracker v20 or later (Daily Expenses sheet missing).');
    const mv = movedTo(wb);
    if (mv) { const e = new Error('This tracker was moved to a newer tracker' + (mv['Updated by'] && String(mv['Updated by']).includes(' · ') ? ' (' + String(mv['Updated by']).split(' · ').slice(1).join(' · ') + ')' : '') + ' on ' + String(mv['Updated at'] || '').slice(0, 10) + '. Switch this phone: More › App › Settings › Advanced › New tracker version.'); e.moved = true; throw e; }
    const res = ops.length ? applyOutbox(wb, ops, who, device) : { applied: [], conflicts: [], logCount: 0 };
    let finalWb = wb, newEtag = etag;
    if (res.logCount) {
      const out = await wb.save();
      try { newEtag = (await transport.upload(out, etag)).etag; }
      catch (e) { if (e instanceof PreconditionFailed && attempt < maxTries) continue; throw e; } // someone saved meanwhile: start again on the new file
      finalWb = await Workbook.open(out);
    }
    const entries = finalWb.tableRows(DAILY).filter(r => r['Entry ID'] || r.Date).map(rowToEntry);
    const snap = extractSnapshot(finalWb);
    const appWrite = lastAppWrite(finalWb);
    snap.provisional = !!(appWrite && snap.fileModified && new Date(appWrite) > new Date(snap.fileModified));
    return { ...res, entries, snapshot: snap, attempts: attempt, etag: newEtag };
  }
}

// A second, small workbook (the suggestion box): append rows only, retry if someone saved meanwhile.
export async function syncExtraFile({ transport, ops, who, maxTries = 3 }) {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const { bytes, etag } = await transport.download();
    const wb = await Workbook.open(bytes);
    const applied = [];
    for (const op of ops) {
      if (!wb.tables[op.table]) throw new Error('That file has no ' + op.table + ' table. Is it the Suggestion Box file?');
      if (op.idCol && wb.tableRows(op.table).some(r => String(r[op.idCol] ?? '') === String(op.values[op.idCol]))) { applied.push(op.opId); continue; }
      wb.appendTableRow(op.table, op.values); applied.push(op.opId);
    }
    let rows = wb.tables.tblSuggestions ? wb.tableRows('tblSuggestions').filter(r => r.Suggestion) : [];
    if (applied.length) {
      const out = await wb.save();
      try { await transport.upload(out, etag); } catch (e) { if (e instanceof PreconditionFailed && attempt < maxTries) continue; throw e; }
    }
    return { applied, rows };
  }
}
