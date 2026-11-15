// App 0.15.0 (Aravind, 13-15 Nov 2026): month-end "what I'll do better" notes. One note per person per month, written in
// the last step of the month-end update; every past note on one page (More › Expenses › Month notes) to review later.
// Notes live in the tracker's Month Notes sheet (tblMonthNotes, tracker v31).
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, toast, card, empty } from './ui.js';
import { uuid } from './crypto.js';
import { isoToSerial } from './xlsx.js';

const T = 'tblMonthNotes';
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
// synced notes with this phone's notes still waiting to sync laid over them
export function allNotes(s) {
  const map = new Map(((s && s.monthNotes) || []).map(n => [n.id, { ...n }]));
  for (const op of ctx.V.all('outbox').filter(o => o.table === T).sort((a, b) => a.seq - b.seq)) {
    if (op.kind === 'addRow') { const v = op.values; map.set(v['Note ID'], { id: v['Note ID'], month: v._ym, person: v.Person, note: v.Note, at: v['Entered at'], pending: true }); }
    else if (op.kind === 'setRow' && map.has(op.id)) { const n = map.get(op.id); if (op.changes.Status === 'Deleted') map.delete(op.id); else Object.assign(n, { note: op.changes.Note ?? n.note, pending: true }); }
  }
  return [...map.values()];
}
export const myNote = (s, ym, who) => allNotes(s).find(n => n.month === ym && n.person === who) || null;

export async function saveNote(s, ym, who, text) {
  const t = String(text || '').trim(); const old = myNote(s, ym, who);
  if (old && old.note === t) return false;
  if (!old) {
    if (!t) return false;
    await ctx.queue({ kind: 'addRow', table: T, idCol: 'Note ID', what: 'month note', summary: who + ' · ' + ym,
      values: { 'Note ID': uuid(), Month: isoToSerial(ym + '-01'), Person: who, Note: t, 'Entered by': ctx.who(), 'Entered at': stamp(), Status: 'Active', _ym: ym } });
  } else if (old.pending && !(s.monthNotes || []).some(n => n.id === old.id)) { // not synced yet: change the waiting row itself
    const op = ctx.V.all('outbox').find(o => o.kind === 'addRow' && o.table === T && o.values['Note ID'] === old.id);
    if (!t) await ctx.V.remove('outbox', op.opId); else { op.values.Note = t; await ctx.V.put('outbox', op.opId, op); }
  } else {
    await ctx.queue({ kind: 'setRow', table: T, idCol: 'Note ID', id: old.id, changes: t ? { Note: t, 'Entered at': stamp() } : { Status: 'Deleted' }, base: { Note: old.note } });
  }
  return true;
}

// the field in the month-end update's last step
export function noteField(s, ym, W) {
  const who = ctx.who(); if (!who) return null;
  if (!(s && s.v31)) return h('p', { class: 'hint', id: 'notewait' }, 'Month notes arrive with the tracker update at the next sync.');
  const cur = myNote(s, ym, who);
  if (W.note === undefined) W.note = cur ? cur.note : '';
  return h('div', { id: 'monthnote', style: { marginTop: '14px' } },
    h('div', { class: 'row-between' }, h('div', { class: 'label-sm', style: { margin: 0 } }, 'What I\'ll do better next month'), h('button', { class: 'linkbtn', id: 'notespast', onclick: () => { state.fromWiz = 'notes'; ctx.go('notes'); } }, 'Past notes')),
    h('textarea', { class: 'field', id: 'notetext', rows: 3, maxlength: 400, placeholder: 'Your own note, ' + who + ' (optional)', 'aria-label': 'What I\'ll do better next month, ' + who, oninput: e => { W.note = e.target.value; } }, W.note));
}

export function viewNotes() {
  const s = ctx.snap() || {}; const list = allNotes(s).sort((a, b) => (b.month || '').localeCompare(a.month || '') || String(a.person).localeCompare(String(b.person)));
  const body = [];
  if (!list.length) body.push(card(null, null, empty('No notes yet. Write one in the last step of the month-end update.')));
  const months = [...new Set(list.map(n => n.month))];
  for (const m of months) body.push(card(F.monthLabel(m, true), null, h('ul', { class: 'list' }, list.filter(n => n.month === m).map(n =>
    h('li', { class: 'li wrap' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, n.person, n.pending ? h('span', { class: 'faint' }, ' · waiting to sync') : null), h('div', { class: 'sub notebody' }, n.note)))))));
  return { title: 'Month notes', back: state.fromWiz === 'notes' ? 'monthly' : 'tracker', body: [h('div', { id: 'notespage' }, ...body)] };
}

// S6 (friends using the app): what happens to your data, in plain words
const PRIV = [
  ['Where your data is', 'In two places only: on this phone, locked with your PIN, and in your own tracker file in your own OneDrive. There is no server of ours and nobody else holds a copy.'],
  ['Who can see it', 'You, and anyone you yourself share the OneDrive tracker file with. The app is the same for everyone, but each family has its own file.'],
  ['What the app talks to', 'Only Microsoft: to sign you in and to read and save your tracker file. No analytics, no ads, no trackers.'],
  ['PIN and passwords', 'Your PIN is never stored or sent. Your Microsoft password goes only to Microsoft\'s own page. A CAS statement password is typed each time and used only on this phone.'],
  ['Voice entry', 'Only when you tap the mic: Chrome turns your words into text through Google\'s speech service. If you prefer, type instead; nothing else uses it.'],
  ['Pastes and statements', 'Kite and INDmoney pastes and CAS statements are read on this phone. Only the figures you save reach your tracker file.'],
  ['Problem reports', 'Only when you tap Send in Report a problem: your email app opens with the report, and you send it yourself. It holds no amounts, notes or tracker link.'],
  ['Leaving', 'Settings › Reset this device removes everything from this phone. Your tracker file stays in your OneDrive until you delete it.'],
  ['The code', 'The app\'s code is public, so anyone can check what it does.']];
export function viewPrivacy() {
  return { title: 'Privacy', back: 'settings', body: [h('section', { class: 'card', id: 'privacy' }, h('div', { class: 'card-h' }, h('h2', {}, 'Your data stays yours')),
    h('ul', { class: 'list' }, PRIV.map(([t, d]) => h('li', { class: 'li wrap' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, t), h('div', { class: 'sub' }, d))))))] };
}
