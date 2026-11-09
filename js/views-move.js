// Move to a new tracker version: copy everything you entered from the current tracker into a newer one from Claude,
// check it, save it into the NEW file, then point this phone at it. The old file keeps all its data; the app only
// adds one line to its App Meta sheet saying where it moved, so the other phone knows to switch too.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, toast, card, empty } from './ui.js';
import { GraphFile } from './graph.js';
import * as Auth from './auth.js';
import { CONFIG } from './config.js';
import { Workbook } from './xlsx.js';
import { moveData, looksBlank, markMoved, markMovedFrom, schemaVersion } from './migrate.js';

const MV = { target: null, report: null, busy: false, step: '', done: null };
const T = f => new GraphFile({ base: CONFIG.graphBase, getToken: () => Auth.getToken(true), driveId: f.driveId, itemId: f.itemId });

async function pick(link) {
  const f = await GraphFile.fromShareLink({ base: CONFIG.graphBase, getToken: () => Auth.getToken(true), link });
  const cur = ctx.V.get('sync', 'file');
  if (cur && cur.itemId === f.itemId) throw new Error('That is the tracker you already use. Paste the link of the NEW file from Claude.');
  return f;
}

async function run(apply) {
  const cur = ctx.V.get('sync', 'file'); if (!cur) return toast('Connect your current tracker first (Settings › Sync)', 'bad');
  if (ctx.V.all('outbox').length) return toast('Sync first: ' + ctx.V.all('outbox').length + ' change(s) are still waiting', 'bad');
  if (state.syncing) return toast('A sync is running. Try again in a moment.', 'bad');
  MV.busy = true; state.syncing = true; MV.step = 'Downloading both files…'; ctx.render();
  try {
    const oldT = T(cur), newT = T(MV.target);
    const [o, n] = [await oldT.download(), await newT.download()];
    const oldWb = await Workbook.open(o.bytes), newWb = await Workbook.open(n.bytes);
    const blankNew = looksBlank(newWb);
    if (blankNew.daily || blankNew.income) throw new Error('The new file already has ' + blankNew.daily + ' expenses and ' + blankNew.income + ' income entries. Use the blank file from Claude, not a copy of your tracker.');
    const vo = schemaVersion(oldWb), vn = schemaVersion(newWb);
    if (vo && vn && vn <= vo) throw new Error('The new file is version ' + vn + ' and yours is ' + vo + '. Pick the newer file from Claude.');
    MV.step = 'Copying your entries…'; ctx.render();
    const rep = moveData(oldWb, newWb);
    MV.report = { ...rep, oldName: cur.name, newName: MV.target.name, copied: rep.copied.length, copiedList: undefined };
    if (!apply) return;
    if (rep.wrong.length) throw new Error(rep.wrong.length + ' values did not read back the same. Nothing was saved.');
    const at = new Date().toISOString(), by = ctx.who() || '';
    markMovedFrom(newWb, { from: cur.name, by, at, version: vo });
    MV.step = 'Saving into ' + MV.target.name + '…'; ctx.render();
    await newT.upload(await newWb.save(), n.etag);
    markMoved(oldWb, { to: MV.target.name, by, at, version: vn });
    MV.step = 'Marking the old file as moved…'; ctx.render();
    try { await oldT.upload(await oldWb.save(), o.etag); } catch (e) { toast('Copied, but the old file could not be marked as moved (' + e.message + '). Switch the other phone yourself.', 'bad'); }
    const prevSnap = ctx.snap();
    await ctx.saveSettings({ moveCheck: { from: cur.name, to: MV.target.name, at, nw: prevSnap && prevSnap.netWorth ? prevSnap.netWorth.family : null, copied: rep.copied.length } });
    await ctx.V.put('sync', 'file', MV.target); await ctx.V.put('sync', 'state', { lastSync: null, lastError: null, etag: null });
    MV.done = { name: MV.target.name, at }; MV.target = null; MV.report = null;
    toast('Moved. This phone now uses ' + MV.done.name, 'good');
  } catch (e) { toast(e.message || String(e), 'bad'); }
  finally { MV.busy = false; state.syncing = false; MV.step = ''; ctx.render(); if (MV.done) ctx.doSync(true); }
}

async function switchOnly(link) {
  try {
    const f = await pick(link); const n = await T(f).download(); const wb = await Workbook.open(n.bytes);
    const moved = wb.tables.tblAppMeta && wb.tableRows('tblAppMeta').some(r => r.Key === 'movedFrom');
    if (!moved) return toast('Your data has not been moved into that file yet. Use "Copy my entries" on the phone that did the move, or here.', 'bad');
    await ctx.V.put('sync', 'file', f); await ctx.V.put('sync', 'state', { lastSync: null, lastError: null, etag: null });
    toast('This phone now uses ' + f.name, 'good'); ctx.render(); ctx.doSync(true);
  } catch (e) { toast(e.message || String(e), 'bad'); }
}

export function viewMove() {
  const cur = ctx.V.get('sync', 'file'); const waiting = ctx.V.all('outbox').length;
  const st = ctx.V.get('sync', 'state') || {}; const movedAway = /moved to a newer tracker/i.test(st.lastError || '');
  const chk = ctx.settings().moveCheck; const s = ctx.snap();
  const body = [h('h2', { class: 'formhead' }, 'Move to a new tracker version'),
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, 'When Claude sends a newer tracker, your entries move into it here. Your current file keeps all its data, so you can always go back to it.')];
  if (chk && s && !MV.target) {
    const after = s.netWorth ? s.netWorth.family : null;
    body.push(card('Last move', null, h('div', { class: 'kv', id: 'mvcheck' }, h('span', {}, 'From'), h('span', {}, chk.from), h('span', {}, 'To'), h('span', {}, chk.to), h('span', {}, 'Entries copied'), h('span', {}, String(chk.copied)),
      h('span', {}, 'Net worth before'), h('span', { class: 'num' }, chk.nw === null ? '–' : F.inr(chk.nw)), h('span', {}, 'Net worth now'), h('span', { class: 'num' }, after === null || after === undefined ? '–' : F.inr(after) + (s.provisional ? ' (open the new file in Excel once to confirm)' : ''))),
      h('p', { class: 'hint', style: { marginTop: '8px' } }, chk.nw !== null && after !== null && after !== undefined && !s.provisional ? (Math.abs(after - chk.nw) < 1 ? 'They match.' : 'They differ by ' + F.inr(Math.abs(after - chk.nw)) + '. Prices or new entries since the move can explain it; otherwise ask Claude.') : 'Open the new file once in Excel for the web so it recalculates, then sync to compare.')));
  }
  if (movedAway) body.push(card('This tracker has moved', null, h('p', {}, st.lastError), h('p', { class: 'hint' }, 'Paste the link of the new file below to switch this phone. Changes waiting on this phone go to the new file.')));
  const link = h('input', { class: 'field', id: 'mvlink', placeholder: 'Link to the NEW tracker file in OneDrive', autocomplete: 'off', 'aria-label': 'New tracker link' });
  const steps = h('ol', { class: 'hint', style: { margin: '0 0 8px 18px' } },
    h('li', {}, 'Put the new tracker from Claude in your OneDrive (keep the old one too).'),
    h('li', {}, 'In OneDrive: the new file › Share › Copy link (can edit). Paste it below.'),
    h('li', {}, 'Close the tracker in Excel everywhere, then check and copy.'));
  body.push(card('1. The new file', null, steps, cur ? h('p', { class: 'hint' }, 'Now using: ' + cur.name) : empty('Connect your current tracker first (Settings › Sync).'), link,
    h('div', { class: 'btns', style: { marginTop: '8px' } },
      h('button', { class: 'btn', id: 'mvpick', disabled: MV.busy || !cur, onclick: async () => { try { MV.target = await pick(link.value); MV.report = null; await run(false); } catch (e) { toast(e.message || String(e), 'bad'); } } }, 'Check the new file'),
      h('button', { class: 'btn ghost', id: 'mvswitch', disabled: MV.busy, onclick: () => switchOnly(link.value) }, 'Just switch (moved on the other phone)'))));
  if (waiting) body.push(card(null, null, h('p', { class: 'hint' }, waiting + ' change(s) are waiting to sync. Sync first, so nothing is left behind.'), h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => ctx.doSync(true) }, 'Sync now'))));
  if (MV.busy) body.push(card(null, null, h('p', { id: 'mvstep' }, MV.step || 'Working…')));
  const r = MV.report;
  if (r && MV.target) {
    const rows = Object.entries(r.perSheet).sort((a, b) => a[0].localeCompare(b[0]));
    body.push(card('2. Check before saving', null,
      h('p', {}, 'From ' + r.oldName + (r.from ? ' (v' + r.from + ')' : '') + ' to ' + r.newName + (r.to ? ' (v' + r.to + ')' : '') + ': ' + r.copied + ' entries will be copied.'),
      r.notes.map(n => h('p', { class: 'hint' }, n)),
      h('div', { class: 'tablewrap' }, h('table', { class: 'tbl', id: 'mvtable' }, h('thead', {}, h('tr', {}, h('th', {}, 'Sheet'), h('th', { class: 'num' }, 'Entries'), h('th', { class: 'num' }, 'Numbers add up to'), h('th', {}, 'Check'))),
        h('tbody', {}, rows.map(([sh, p]) => h('tr', {}, h('td', {}, sh), h('td', { class: 'num' }, String(p.n)), h('td', { class: 'num' }, F.inr(p.sum)), h('td', {}, Math.abs(p.sum - p.newSum) < 0.01 ? 'Same' : 'DIFFERENT')))))),
      r.missing.length ? h('div', { id: 'mvmissing' }, h('p', { style: { color: 'var(--critical)', fontWeight: 600 } }, r.missing.length + ' entr' + (r.missing.length === 1 ? 'y has' : 'ies have') + ' no place in the new file:'),
        h('ul', { class: 'list' }, r.missing.slice(0, 30).map(m => h('li', { class: 'li' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, m.sheet + ' · ' + m.where), h('div', { class: 'sub' }, String(m.value).slice(0, 80) + ' · ' + m.why))))),
        h('p', { class: 'hint' }, 'Do not move yet: send Claude this list (no amounts needed) so the new file gets room for them.')) : h('p', { class: 'hint', id: 'mvallok' }, 'Every entry has a place in the new file, and each one was read back to check it.'),
      (r.dropped || []).length ? h('div', { id: 'mvdropped' }, h('p', { style: { fontWeight: 600, marginTop: '8px' } }, r.dropped.length + ' value' + (r.dropped.length === 1 ? ' is' : 's are') + ' in fields the new tracker no longer has, so ' + (r.dropped.length === 1 ? 'it is' : 'they are') + ' not carried over:'),
        h('ul', { class: 'list' }, r.dropped.slice(0, 40).map(m => h('li', { class: 'li' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, m.sheet + ' · ' + m.where), h('div', { class: 'sub' }, String(m.value).slice(0, 80)))))),
        h('p', { class: 'hint' }, 'Your current file keeps them. Note down anything you still need (for example a contact to add in Handover) before you move.')) : null,
      h('div', { class: 'btns', style: { marginTop: '8px' } },
        h('button', { class: 'btn primary', id: 'mvgo', disabled: MV.busy || !!r.missing.length || !!r.wrong.length, onclick: () => run(true) }, 'Copy my entries and switch'),
        h('button', { class: 'btn', onclick: () => { MV.target = null; MV.report = null; ctx.render(); } }, 'Cancel'))));
  }
  if (MV.done) body.push(card('Done', null, h('p', { id: 'mvdone' }, 'This phone now uses ' + MV.done.name + '. Next: open it once in Excel for the web so it recalculates, then on ' + (ctx.who() === 'Madhu' ? 'Aravind' : 'Madhu') + '\'s phone open More › App › Settings › Advanced › New tracker version and paste the same link and tap "Just switch".')));
  return { title: 'Move', back: 'more', body };
}
