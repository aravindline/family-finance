// Handover packs (tracker v25+): what the other person would need if one of you is not around.
// Each person edits their own pack; the other sees it view-only. Every 3 months the app asks the owner to check it.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, seg, card, empty } from './ui.js';
import { FORMS } from './forms.js';
import { isoToSerial, serialToISO } from './xlsx.js';

const PEOPLE = ['Aravind', 'Madhu'];
const tagOf = p => (p === 'Madhu' ? 'M' : 'A');
const blank = v => v === null || v === undefined || v === '';
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const DAYS = 91;

function pend(sheet) { const m = new Map(); for (const op of ctx.V.all('outbox').filter(o => o.kind === 'setCells' && o.sheet === sheet)) for (const c of op.cells) m.set(c.ref, c.value); return m; }
const formsOf = p => FORMS.filter(f => f.owner === p);
const dataOf = id => { const s = ctx.snap(); return s && s.forms ? s.forms[id] : null; };

// latest review date (ISO) for a person's pack, counting reviews not yet synced
export function lastReview(p) {
  const f = FORMS.find(x => x.id === 'ho' + tagOf(p) + 'review'); const d = f && dataOf(f.id); if (!d) return null;
  const pm = pend(f.sheet); let best = null;
  for (const r of d.rows) { const v = pm.has('A' + r.r) ? pm.get('A' + r.r) : (r.cells.A || {}).v; if (typeof v === 'number' && v > 0 && (best === null || v > best)) best = v; }
  return best === null ? null : serialToISO(best);
}
export function hasHandover() { const s = ctx.snap(); return !!(s && s.forms && s.forms.hoAaccounts); }
const daysSince = iso => (iso ? Math.floor((Date.parse(todayISO()) - Date.parse(iso)) / 864e5) : Infinity);

async function looksRight(p, note) {
  const f = FORMS.find(x => x.id === 'ho' + tagOf(p) + 'review'); const d = f && dataOf(f.id);
  if (!d) return toast('Sync first: your tracker has no handover sheets yet', 'bad');
  const pm = pend(f.sheet); const row = d.rows.find(r => ['A', 'B', 'C'].every(c => blank(pm.has(c + r.r) ? pm.get(c + r.r) : (r.cells[c] || {}).v)) && (r.cells.A || {}).in);
  if (!row) return toast('The review log is full. Ask Claude for more rows.', 'bad');
  await ctx.queue({ kind: 'setCells', sheet: f.sheet, title: 'Handover · ' + p + ' reviewed', cells: [
    { ref: 'A' + row.r, base: (row.cells.A || {}).v ?? null, value: isoToSerial(todayISO()), label: 'Date reviewed' },
    { ref: 'B' + row.r, base: (row.cells.B || {}).v ?? null, value: p, label: 'Reviewed by' },
    { ref: 'C' + row.r, base: (row.cells.C || {}).v ?? null, value: note || 'Checked, no changes', label: 'What changed' }] });
  toast('Thanks. Next check in 3 months.', 'good'); ctx.render();
}

// Home To do item: shown to the signed-in person when their own pack has not been checked for 3 months
export function handoverItem() {
  const me = ctx.who(); if (!me || !hasHandover()) return null;
  const last = lastReview(me); if (daysSince(last) < DAYS) return null;
  const snooze = (ctx.settings().handoverSnooze || ''); if (snooze && snooze > todayISO()) return null;
  const other = me === 'Aravind' ? 'Madhu' : 'Aravind';
  return { id: 'honudge', icon: 'shield', t: 'Is your handover pack still right?', sub: last ? 'Last checked ' + F.date(last) + '. What ' + other + ' needs if you are not around.' : 'Not checked yet. It tells ' + other + ' what to do if you are not around.',
    btns: [h('button', { class: 'btn small', id: 'holater', onclick: async () => { const d = new Date(); d.setDate(d.getDate() + 7); await ctx.saveSettings({ handoverSnooze: d.toISOString().slice(0, 10) }); ctx.render(); } }, 'Later'),
      h('button', { class: 'btn small', id: 'hoopen', onclick: () => { state.hoPerson = me; ctx.go('handover'); } }, 'Update'),
      h('button', { class: 'btn primary small', id: 'hookay', onclick: () => looksRight(me) }, 'Looks right')] };
}
export function handoverNudge() {
  const me = ctx.who(); if (!me || !hasHandover()) return null;
  const last = lastReview(me); if (daysSince(last) < DAYS) return null;
  const snooze = (ctx.settings().handoverSnooze || '');
  if (snooze && snooze > todayISO()) return null;
  return h('section', { class: 'card', id: 'honudge' },
    h('div', { class: 'card-h' }, h('h2', {}, 'Is your handover pack still right?')),
    h('p', { class: 'hint' }, last ? 'Last checked ' + F.date(last) + '. Accounts, contacts, digital access and instructions for ' + (me === 'Aravind' ? 'Madhu' : 'Aravind') + '.' : 'Not checked yet. It tells ' + (me === 'Aravind' ? 'Madhu' : 'Aravind') + ' what to do if you are not around.'),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', id: 'hookay', onclick: () => looksRight(me) }, 'Looks right'),
      h('button', { class: 'btn', id: 'hoopen', onclick: () => { state.hoPerson = me; ctx.go('handover'); } }, 'Update'),
      h('button', { class: 'btn ghost', id: 'holater', onclick: async () => { const d = new Date(); d.setDate(d.getDate() + 7); await ctx.saveSettings({ handoverSnooze: d.toISOString().slice(0, 10) }); ctx.render(); } }, 'Later')));
}

export function viewHandover() {
  const me = ctx.who() || 'Aravind';
  if (!state.hoPerson) state.hoPerson = me;
  const p = state.hoPerson; const mine = p === me;
  if (!hasHandover()) return { title: 'Handover', back: 'more', body: [card(null, null, empty('Your tracker has no handover sheets yet. They come with tracker v25: sync after you switch to it.'))] };
  const items = formsOf(p).filter(f => !f.hidden).map(f => {
    const d = dataOf(f.id); const pm = pend(f.sheet);
    const n = d ? d.rows.filter(r => f.fields.some(x => !blank(pm.has(x.c + r.r) ? pm.get(x.c + r.r) : (r.cells[x.c] || {}).v))).length : 0;
    return h('li', { class: 'li tap', id: 'ho-' + f.id, onclick: () => { state.formId = f.id; ctx.go('form'); } },
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, f.title), h('div', { class: 'sub' }, (n ? n + (f.noAdd ? ' of ' + (d ? d.rows.length : 0) + ' steps written' : ' added') : 'Nothing yet') + ' · ' + f.sub)), icon('right', 16));
  });
  const last = lastReview(p);
  const logF = FORMS.find(x => x.id === 'ho' + tagOf(p) + 'review'); const logD = dataOf(logF.id); const lpm = pend(logF.sheet);
  const log = logD ? logD.rows.map(r => ({ d: lpm.has('A' + r.r) ? lpm.get('A' + r.r) : (r.cells.A || {}).v, c: lpm.has('C' + r.r) ? lpm.get('C' + r.r) : (r.cells.C || {}).v })).filter(x => typeof x.d === 'number' && x.d > 0).sort((a, b) => b.d - a.d).slice(0, 5) : [];
  return { title: 'Handover', back: 'more', body: [
    h('div', { class: 'toolbar' }, seg(PEOPLE, p, v => { state.hoPerson = v; ctx.render(); }, 'Whose pack')),
    h('p', { class: 'hint', style: { margin: '0 4px 12px' }, id: 'homode' }, mine ? 'Your pack: what ' + (p === 'Aravind' ? 'Madhu' : 'Aravind') + ' would need if you are not around. Never passwords, PINs or full numbers (last 4 digits only).' : 'View only: ' + p + ' edits this pack.'),
    card(p + "'s handover pack", null, h('ul', { class: 'list', id: 'holist' }, items)),
    card('Reviews', null,
      h('p', { class: 'hint', id: 'holast' }, last ? 'Last checked ' + F.date(last) + (daysSince(last) >= DAYS ? '. Due again now.' : '. Next check after ' + F.date(new Date(Date.parse(last) + DAYS * 864e5).toISOString().slice(0, 10)) + '.') : 'Not checked yet.'),
      log.length ? h('ul', { class: 'list' }, log.map(x => h('li', { class: 'li' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, F.date(serialToISO(x.d))), h('div', { class: 'sub' }, String(x.c || '')))))) : null,
      mine ? h('div', { class: 'btns', style: { marginTop: '8px' } }, h('button', { class: 'btn primary', id: 'horeview', onclick: () => looksRight(p) }, 'I checked it: looks right')) : null)] };
}
