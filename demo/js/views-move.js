// Tracker updates happen by themselves (app 0.15.0, Aravind 15 Nov 2026: "Automatic update"). When the app ships a
// newer blank tracker version, the next sync carries every entry of your tracker into it, checks each one, and saves it
// over the same file in OneDrive before writing anything new. OneDrive keeps the previous version in its Version
// history, and the phone that did the update keeps a copy so it can be undone from here. An app older than the tracker
// never writes to it (sync.js maxSchema).
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, toast, card, empty, sheet } from './ui.js';
import { GraphFile } from './graph.js';
import * as Auth from './auth.js';
import { CONFIG } from './config.js';
import { Workbook } from './xlsx.js';
import { upgradeBytes } from './upgrade.js';

export const TEMPLATE = { version: 31, path: 'tracker/template-v31.xlsx' };
const UP = { busy: false, step: '' };
const T = f => new GraphFile({ base: CONFIG.graphBase, getToken: () => Auth.getToken(true), driveId: f.driveId, itemId: f.itemId });
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// handed to syncOnce: fetches the blank new version the app ships with only when an update is due
export function upgrader(by) {
  return async bytes => {
    const tr = await fetch(TEMPLATE.path, { cache: 'no-store' }); if (!tr.ok) throw new Error('Could not get the new tracker version (' + tr.status + ').');
    const tpl = new Uint8Array(await tr.arrayBuffer());
    return upgradeBytes(Workbook, bytes, tpl, { by, at: new Date().toISOString() });
  };
}
// after a sync that updated the tracker: keep the old file on this phone for undo, and a before/after net worth check
export async function afterUpgrade(up, prevSnap) {
  const cur = ctx.V.get('sync', 'file'); const at = new Date().toISOString();
  await ctx.V.put('backup', 'tracker', { name: cur ? cur.name : '', version: up.from, at, bytes: b64(up.oldBytes) });
  await ctx.saveSettings({ moveCheck: { from: 'v' + up.from, to: 'v' + up.to, at, nw: prevSnap && prevSnap.netWorth ? prevSnap.netWorth.family : null, copied: up.copied } });
}

async function undo() {
  const cur = ctx.V.get('sync', 'file'); const bk = ctx.V.get('backup', 'tracker'); if (!cur || !bk) return;
  UP.busy = true; UP.step = 'Putting v' + bk.version + ' back…'; state.syncing = true; ctx.render();
  try {
    const m = await T(cur).meta(); await T(cur).upload(unb64(bk.bytes), m.eTag);
    await ctx.V.put('sync', 'state', { lastSync: null, lastError: null, etag: null }); await ctx.V.remove('backup', 'tracker');
    await ctx.saveSettings({ moveCheck: null, holdUpgrade: true });
    toast('Your tracker is back to v' + bk.version + ' as it was before the update.', 'good');
  } catch (e) { toast(e.message || String(e), 'bad'); }
  finally { UP.busy = false; state.syncing = false; UP.step = ''; ctx.render(); ctx.doSync(true); }
}

export function viewMove() {
  const cur = ctx.V.get('sync', 'file'); const s = ctx.snap(); const v = s && s.schema; const bk = ctx.V.get('backup', 'tracker');
  const st = ctx.settings(); const chk = st.moveCheck; const err = (ctx.V.get('sync', 'state') || {}).upgradeError;
  const body = [h('h2', { class: 'formhead' }, 'Tracker version'),
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, 'When the app brings a new tracker version, the next sync updates your tracker by itself: every entry is carried across and checked, in the same OneDrive file.')];
  if (!cur || !s) { body.push(card(null, null, empty('Connect the tracker and sync first (Settings › Sync).'))); return { title: 'Tracker version', back: 'settings', body }; }
  body.push(card('Your tracker', null, h('div', { class: 'kv', id: 'upver' }, h('span', {}, 'File'), h('span', {}, cur.name), h('span', {}, 'Version'), h('span', {}, v ? 'v' + v : '–'), h('span', {}, 'This app brings'), h('span', {}, 'v' + TEMPLATE.version))));
  if (UP.busy) body.push(card(null, null, h('p', { id: 'upstep' }, UP.step || 'Working…'), h('p', { class: 'hint' }, 'Keep the app open until this finishes.')));
  else if (v && v < TEMPLATE.version) {
    body.push(card(st.holdUpgrade ? 'Update paused' : 'Update due', null,
      h('p', { class: 'hint', id: 'updue' }, st.holdUpgrade ? 'You put the earlier version back, so the update waits until you start it.' : err ? 'The last try did not finish: ' + err : 'It runs at the next sync.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', id: 'upgo', onclick: async () => { await ctx.saveSettings({ holdUpgrade: false }); ctx.doSync(true); } }, st.holdUpgrade ? 'Update now' : 'Sync now'))));
  } else body.push(card(null, null, h('p', { id: 'uptodate' }, 'Your tracker is up to date.')));
  if (chk && !UP.busy) {
    const after = s.netWorth ? s.netWorth.family : null; const hasNw = chk.nw !== null && chk.nw !== undefined;
    body.push(card('Check after the update', null, h('div', { class: 'kv', id: 'mvcheck' }, h('span', {}, 'Updated'), h('span', {}, chk.from + ' to ' + chk.to + ' · ' + F.date(chk.at.slice(0, 10))), h('span', {}, 'Entries checked'), h('span', { class: 'num' }, String(chk.copied || 0)),
      hasNw ? [h('span', {}, 'Net worth before'), h('span', { class: 'num' }, F.inr(chk.nw)), h('span', {}, 'Net worth now'), h('span', { class: 'num' }, after === null || after === undefined ? '–' : F.inr(after))] : null),
      !hasNw ? h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Every entry was read back from the updated file and matches.') : h('p', { class: 'hint', style: { marginTop: '8px' } }, s.provisional ? 'Open the tracker once in Excel for the web, then sync to compare.' : after !== null && Math.abs(after - chk.nw) < 1 ? 'They match.' : 'They differ by ' + F.inr(Math.abs((after || 0) - chk.nw)) + '. New prices or entries since the update can explain it.')));
  }
  if (bk && !UP.busy) body.push(card('Undo', null, h('p', { class: 'hint' }, 'Puts back the v' + bk.version + ' file as it was just before the update on ' + F.date(bk.at.slice(0, 10)) + '. Entries synced since then are not in it.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn', id: 'upundo', onclick: () => {
      const close = sheet('Put v' + bk.version + ' back?', h('p', {}, 'Entries synced after the update would be lost. Use this only if the update went wrong.'),
        h('div', { class: 'btns' }, h('button', { class: 'btn danger', id: 'upundoyes', onclick: () => { close(); undo(); } }, 'Put it back'), h('button', { class: 'btn', onclick: () => close() }, 'Keep v' + TEMPLATE.version)));
    } }, 'Undo the update'), h('button', { class: 'btn ghost', id: 'upforget', onclick: async () => { await ctx.V.remove('backup', 'tracker'); toast('Copy removed from this phone'); ctx.render(); } }, 'All good: remove the copy'))));
  return { title: 'Tracker version', back: 'settings', body };
}
