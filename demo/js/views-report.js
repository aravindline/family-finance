// Report a problem (app 0.15.1, Aravind approved 15 Nov 2026). Collects what is needed to find a fault: the screens
// just used, app and tracker versions, sync state and recent error messages. Never any amounts, names of holdings,
// notes or the tracker link. The person sees exactly what is shared before sending it.
import { ctx, state } from './ctx.js';
import { h, toast, card } from './ui.js';

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

export function details(appVersion) {
  const s = ctx.snap() || {}; const st = ctx.V.get('sync', 'state') || {}; const ua = navigator.userAgent;
  const dev = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Other';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  return [
    ['App version', appVersion],
    ['Tracker version', s.schema ? 'v' + s.schema : 'not synced yet'],
    ['Screens just used', trail.join(' › ') || state.view],
    ['Device', dev + ' · ' + br + (matchMedia('(display-mode: standalone)').matches ? ' · installed' : ' · in the browser')],
    ['Last sync', st.lastSync ? st.lastSync.slice(0, 16).replace('T', ' ') + ' UTC' : 'never'],
    ['Last sync problem', st.lastError || 'none'],
    ['Tracker update problem', st.upgradeError || 'none'],
    ['Recalculation', st.recalcError ? 'failed: ' + st.recalcError : st.recalcMs ? 'ok, ' + Math.round(st.recalcMs / 100) / 10 + ' s' : 'not run yet'],
    ['Waiting to sync', String(ctx.V.all('outbox').length)],
    ['Needs your choice', String(ctx.V.all('conflict').length)],
    ['Recent error messages', errors.join(' | ') || 'none'],
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
    card('What is shared', null, h('div', { class: 'kv', id: 'repdetails' }, rows.flatMap(([k, v]) => [h('span', {}, k), h('span', {}, v)])))] };
}
