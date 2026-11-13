// Update the tracker in one tap (app 0.14.0, Aravind 11 Nov 2026): no download, upload or link to paste. The app takes
// the blank next version it ships with, carries every entry of your tracker into it, checks each one, and saves it over
// the same file in OneDrive. OneDrive keeps the previous version in its Version history, and this phone keeps a copy
// so the update can be undone from here.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, toast, card, empty, sheet } from './ui.js';
import { GraphFile } from './graph.js';
import * as Auth from './auth.js';
import { CONFIG } from './config.js';
import { Workbook } from './xlsx.js';
import { upgradeBytes } from './upgrade.js';
import { PreconditionFailed } from './sync.js';

export const TEMPLATE = { version: 30, path: 'tracker/template-v30.xlsx' };
const UP = { busy: false, step: '', done: null, err: null };
const T = f => new GraphFile({ base: CONFIG.graphBase, getToken: () => Auth.getToken(true), driveId: f.driveId, itemId: f.itemId });
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const other = () => (ctx.who() === 'Madhu' ? 'Aravind' : 'Madhu');

async function run() {
  const cur = ctx.V.get('sync', 'file'); if (!cur) return toast('Connect the tracker first (Settings › Sync)', 'bad');
  if (state.syncing) return toast('A sync is running. Try again in a moment.', 'bad');
  UP.busy = true; UP.err = null; UP.step = 'Syncing your changes first…'; ctx.render();
  try {
    await ctx.doSync(true);
    if (ctx.V.all('outbox').length) throw new Error(ctx.V.all('outbox').length + ' change(s) could not sync yet. Nothing was changed. Try again when they have synced.');
    state.syncing = true;
    UP.step = 'Reading your tracker…'; ctx.render();
    const file = T(cur); const o = await file.download();
    UP.step = 'Getting the new version…'; ctx.render();
    const tr = await fetch(TEMPLATE.path, { cache: 'no-store' }); if (!tr.ok) throw new Error('Could not get the new tracker version (' + tr.status + '). Check the internet connection.');
    const tpl = new Uint8Array(await tr.arrayBuffer());
    UP.step = 'Carrying every entry across and checking each one…'; ctx.render();
    const at = new Date().toISOString();
    const r = await upgradeBytes(Workbook, o.bytes, tpl, { by: ctx.who() || '', at });
    await ctx.V.put('backup', 'tracker', { name: cur.name, version: r.from, at, bytes: b64(o.bytes) });
    UP.step = 'Saving v' + r.to + ' over ' + cur.name + '…'; ctx.render();
    try { await file.upload(r.bytes, o.etag); }
    catch (e) { if (e instanceof PreconditionFailed) throw new Error('The tracker changed in OneDrive while updating (perhaps ' + other() + '\'s phone synced). Nothing was changed. Tap Update again.'); throw e; }
    const prevSnap = ctx.snap();
    await ctx.saveSettings({ moveCheck: { from: 'v' + r.from, to: 'v' + r.to, at, nw: prevSnap && prevSnap.netWorth ? prevSnap.netWorth.family : null, copied: r.copied } });
    await ctx.V.put('sync', 'state', { lastSync: null, lastError: null, etag: null });
    UP.done = { from: r.from, to: r.to, copied: r.copied, checked: r.checked, at };
  } catch (e) { UP.err = e.message || String(e); toast(UP.err, 'bad'); }
  finally { UP.busy = false; state.syncing = false; UP.step = ''; ctx.render(); if (UP.done) ctx.doSync(true); }
}

async function undo() {
  const cur = ctx.V.get('sync', 'file'); const bk = ctx.V.get('backup', 'tracker'); if (!cur || !bk) return;
  UP.busy = true; UP.step = 'Putting v' + bk.version + ' back…'; state.syncing = true; ctx.render();
  try {
    const m = await T(cur).meta(); await T(cur).upload(unb64(bk.bytes), m.eTag);
    await ctx.V.put('sync', 'state', { lastSync: null, lastError: null, etag: null }); await ctx.V.remove('backup', 'tracker');
    UP.done = null; toast('Your tracker is back to v' + bk.version + ' as it was before the update.', 'good');
  } catch (e) { toast(e.message || String(e), 'bad'); }
  finally { UP.busy = false; state.syncing = false; UP.step = ''; ctx.render(); ctx.doSync(true); }
}

export function viewMove() {
  const cur = ctx.V.get('sync', 'file'); const s = ctx.snap(); const v = s && s.schema; const bk = ctx.V.get('backup', 'tracker');
  const chk = ctx.settings().moveCheck;
  const body = [h('h2', { class: 'formhead' }, 'Update the tracker'),
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, 'One tap: the app carries every entry into the new tracker version, checks each one, and saves it over your tracker in OneDrive. Same file, same link; nothing to download or upload.')];
  if (!cur || !s) { body.push(card(null, null, empty('Connect the tracker and sync first (Settings › Sync).'))); return { title: 'Update', back: 'settings', body }; }
  const upToDate = v >= TEMPLATE.version;
  body.push(card('Your tracker', null, h('div', { class: 'kv', id: 'upver' }, h('span', {}, 'File'), h('span', {}, cur.name), h('span', {}, 'Version'), h('span', {}, v ? 'v' + v : '–'), h('span', {}, 'This app brings'), h('span', {}, 'v' + TEMPLATE.version))));
  if (UP.busy) body.push(card(null, null, h('p', { id: 'upstep' }, UP.step || 'Working…'), h('p', { class: 'hint' }, 'Keep the app open until this finishes.')));
  else if (UP.done) {
    body.push(card('Updated to v' + UP.done.to, null, h('p', { id: 'updone' }, UP.done.copied + ' entries carried across; each one was read back and matches.'),
      h('ol', { class: 'hint', style: { margin: '6px 0 0 18px' } }, h('li', {}, 'Open the tracker once in Excel for the web, so it recalculates every figure.'), h('li', {}, 'On ' + other() + '\'s phone just sync. It uses the same file, so there is nothing else to do there.'))));
  } else if (upToDate) body.push(card(null, null, h('p', { id: 'uptodate' }, 'Your tracker is up to date.')));
  else {
    body.push(card('Before you tap Update', null, h('ul', { class: 'hint', style: { margin: '0 0 8px 18px' } },
      h('li', {}, 'On ' + other() + '\'s phone: open the app and sync, so no change is left waiting there.'),
      h('li', {}, 'Close the tracker in Excel everywhere.'),
      h('li', {}, 'Only what you typed (the yellow cells and the lists the app fills) is carried across. Anything changed by hand elsewhere in Excel is replaced by the new version.')),
      UP.err ? h('p', { class: 'hint', id: 'uperr', style: { color: 'var(--critical)' } }, UP.err) : null,
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', id: 'upgo', onclick: () => {
        const close = sheet('Update to v' + TEMPLATE.version + '?', h('p', {}, 'Your tracker becomes v' + TEMPLATE.version + ' with all your entries, in the same OneDrive file. If anything does not match, nothing is changed.'),
          h('p', { class: 'hint' }, 'OneDrive keeps the old version in its Version history, and this phone keeps a copy so you can undo from here.'),
          h('div', { class: 'btns' }, h('button', { class: 'btn primary', id: 'upyes', onclick: () => { close(); run(); } }, 'Update'), h('button', { class: 'btn', onclick: () => close() }, 'Not now')));
      } }, 'Update to v' + TEMPLATE.version))));
  }
  if (chk && !UP.busy && s && chk.nw !== null && chk.nw !== undefined) {
    const after = s.netWorth ? s.netWorth.family : null;
    body.push(card('Check after the update', null, h('div', { class: 'kv', id: 'mvcheck' }, h('span', {}, 'Updated'), h('span', {}, chk.from + ' to ' + chk.to + ' · ' + F.date(chk.at.slice(0, 10))), h('span', {}, 'Net worth before'), h('span', { class: 'num' }, F.inr(chk.nw)),
      h('span', {}, 'Net worth now'), h('span', { class: 'num' }, after === null || after === undefined ? '–' : F.inr(after))),
      h('p', { class: 'hint', style: { marginTop: '8px' } }, s.provisional ? 'Open the tracker once in Excel for the web, then sync to compare.' : after !== null && Math.abs(after - chk.nw) < 1 ? 'They match.' : 'They differ by ' + F.inr(Math.abs((after || 0) - chk.nw)) + '. New prices or entries since the update can explain it; otherwise ask Claude.')));
  }
  if (bk && !UP.busy) body.push(card('Undo', null, h('p', { class: 'hint' }, 'Puts back the v' + bk.version + ' file as it was just before the update on ' + F.date(bk.at.slice(0, 10)) + '. Entries synced since then are not in it.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn', id: 'upundo', onclick: () => {
      const close = sheet('Put v' + bk.version + ' back?', h('p', {}, 'Entries synced after the update would be lost. Use this only if the update went wrong.'),
        h('div', { class: 'btns' }, h('button', { class: 'btn danger', id: 'upundoyes', onclick: () => { close(); undo(); } }, 'Put it back'), h('button', { class: 'btn', onclick: () => close() }, 'Keep v' + TEMPLATE.version)));
    } }, 'Undo the update'), h('button', { class: 'btn ghost', id: 'upforget', onclick: async () => { await ctx.V.remove('backup', 'tracker'); toast('Copy removed from this phone'); ctx.render(); } }, 'All good: remove the copy'))));
  return { title: 'Update', back: 'settings', body };
}
