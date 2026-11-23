// Report a problem (app 0.15.1, Aravind approved 15 Nov 2026). Collects what is needed to find a fault: the screens
// just used, app and tracker versions, sync state and recent error messages. Never any amounts, names of holdings,
// notes or the tracker link. The person sees exactly what is shared before sending it.
import { ctx, state } from './ctx.js';
import { h, toast, card } from './ui.js';
import * as F from './fmt.js';
import { fireMissing } from './views-v14.js';

// a few recent screens and error messages, kept in memory only (gone when the app closes)
const trail = [], errors = [];
export function noteView(v) { if (trail[trail.length - 1] !== v) { trail.push(v); if (trail.length > 8) trail.shift(); } }
export function noteError(m) { const s = String(m || '').replace(/₹\s?[\d,.]+\s?(L|Cr|k)?/g, '₹…').replace(/\b\d{4,}\b/g, '…').slice(0, 200); errors.push(new Date().toISOString().slice(11, 19) + ' ' + s); if (errors.length > 8) errors.shift(); }
window.__ffNoteError = noteError;
window.addEventListener('error', e => noteError(e.message));
window.addEventListener('unhandledrejection', e => noteError(e.reason && e.reason.message || e.reason));

// the address is kept scrambled in the code and shown only when the person sends a report
const ADDR = [109, 111, 99, 46, 107, 111, 111, 108, 116, 117, 111, 64, 110, 105, 102, 109, 97, 102, 100, 110, 105, 118, 97, 114, 97];
const addr = () => String.fromCharCode(...ADDR.slice().reverse());
export const feedbackAddress = addr; // 0.16.0: also used by Send feedback (Help)

// screen names as the person knows them (the trail keeps the app's own route names)
const NAMES = { home: 'Home', spend: 'Money', income: 'Income', wealth: 'Wealth', more: 'More', settings: 'Settings', report: 'Report a problem',
  addexpense: 'Add expense', addincome: 'Add income', monthly: 'Month-end update', fire: 'FIRE details', plan: 'FIRE & goals', form: 'A list in More',
  formedit: 'Editing a setting or item', tracker: 'A topic in More', kite: 'Kite holdings', intlpaste: 'INDmoney prices', cas: 'CAS statement',
  signin: 'Sign in & tracker', reports: 'Reports', recurring: 'Recurring', activity: 'Family activity', events: 'Events', lent: 'Money lent',
  checks: 'Checks', protection: 'Protection', documents: 'Documents', year: 'Year in review', move: 'Tracker version', privacy: 'Privacy',
  conflicts: 'Needs your choice', backup: 'Backup', restore: 'Restore', changelock: 'Change lock', handover: 'Handover', suggest: 'Suggestions', deposits: 'FD / RD', epf: 'EPF', gratuity: 'Gratuity' };
const nameOf = v => NAMES[v] || (String(v || '').charAt(0).toUpperCase() + String(v || '').slice(1));
const none = (x, ok = 'None') => x ? String(x) : ok;

export function details(appVersion) {
  const s = ctx.snap() || {}; const st = ctx.V.get('sync', 'state') || {}; const ua = navigator.userAgent;
  const dev = /Android/i.test(ua) ? 'Android phone' : /iPhone|iPad/i.test(ua) ? 'iPhone / iPad' : /Windows/i.test(ua) ? 'Windows laptop' : /Mac/i.test(ua) ? 'Mac' : 'Other device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'another browser';
  const secs = st.recalcMs ? Math.max(1, Math.round(st.recalcMs / 1000)) : 0;
  const miss = ctx.snap() ? fireMissing(s) : [];
  const fire = !ctx.snap() ? 'Not synced yet' : s.firePlan && s.firePlan.needed > 0 ? 'Worked out' : miss.length ? 'Needs ' + miss.map(r => r.label).join(', ') : 'Works out to nothing';
  const waiting = ctx.V.all('outbox').length, choice = ctx.V.all('conflict').length;
  return [
    ['App version', String(appVersion).split(' ')[0]],
    ['Tracker version', s.schema ? 'v' + s.schema : 'Not synced yet'],
    ['Screens just used', (trail.length ? trail : [state.view]).map(nameOf).join(' › ')],
    ['Device', dev + ', ' + br + (matchMedia('(display-mode: standalone)').matches ? ' (installed app)' : '')],
    ['Last sync', st.lastSync ? F.dateTime(st.lastSync) : 'Never'],
    ['Sync problems', none(st.lastError)],
    ['Tracker update problems', none(st.upgradeError)],
    ['Figures worked out', st.recalcError ? 'No: ' + st.recalcError : secs ? 'Yes, in ' + secs + ' second' + (secs === 1 ? '' : 's') : 'Not yet'],
    ['FIRE plan', fire],
    ['Changes waiting to sync', waiting ? String(waiting) : 'None'],
    ['Changes needing your choice', choice ? String(choice) : 'None'],
    ['Recent error messages', errors.join(' | ') || 'None'],
  ];
}

export function viewReport(appVersion) {
  const W = state.report || (state.report = { text: '' });
  const rows = details(appVersion);
  const ta = h('textarea', { class: 'field', id: 'reptext', rows: 4, maxlength: 1000, placeholder: 'What went wrong? What did you expect to see?', 'aria-label': 'What went wrong', oninput: e => { W.text = e.target.value; } }, W.text);
  const body = () => 'Problem: ' + (W.text.trim() || '(not described)') + '\n\n' + rows.map(([k, v]) => k + ': ' + v).join('\n');
  // Send is a mail link whose address is filled in only when tapped with a description written
  const send = e => {
    if (!W.text.trim()) { e.preventDefault(); toast('Write a line about what went wrong first', 'bad'); ta.focus(); return; }
    const a = addr(); sendBtn.href = 'mailto:' + a + '?subject=' + encodeURIComponent('Family Finance: problem report') + '&body=' + encodeURIComponent(body());
    sent.hidden = false; sent.querySelector('#repaddr').textContent = a;
  };
  const sendBtn = h('a', { class: 'btn primary', id: 'repsend', href: '#', role: 'button', onclick: send }, 'Send by email');
  const copy = async () => { try { await navigator.clipboard.writeText(body()); toast('Copied. Paste it wherever you report problems.', 'good'); } catch (e) { toast('Could not copy on this device', 'bad'); } };
  const sent = h('p', { class: 'hint', id: 'repsent', hidden: true }, 'Your email app should open with the report. If it does not, send it to ', h('span', { id: 'repaddr' }), '.');
  return { title: 'Report a problem', back: 'settings', body: [
    card(null, null, h('p', { class: 'hint', style: { marginTop: 0 } }, 'Tell what happened. The details below are added so the fault can be found. They hold no amounts, no names of holdings, no notes and no tracker link.'), ta,
      h('div', { class: 'btns', style: { marginTop: '10px' } }, sendBtn, h('button', { class: 'btn', id: 'repcopy', onclick: copy }, 'Copy')), sent),
    card('What is shared', null, h('dl', { class: 'replist', id: 'repdetails' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])))] };
}
