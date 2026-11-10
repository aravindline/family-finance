import * as V from './vault.js';
import { meta } from './db.js';
import * as F from './fmt.js';
import * as Auth from './auth.js';
import * as Bio from './bio.js';
import { CONFIG } from './config.js';
import { GraphFile } from './graph.js';
import { syncOnce, syncExtraFile } from './sync.js';
import { uuid } from './crypto.js';
import { h, icon, toast, sheet, seg, haptic } from './ui.js';
import { ctx, state } from './ctx.js';
import * as M from './views-main.js';
import * as W from './views-more.js';
import * as U from './views-update.js';
import * as R from './views-insight.js';
import * as X from './views-extra.js';
import * as C2 from './views-c2.js';
import * as I from './views-income.js';
import * as FV from './views-forms.js';
import * as KV from './views-kite.js';
import * as CV from './views-cas.js';
import * as HV from './views-handover.js';
import * as YV from './views-year.js';
import * as TV from './views-topics.js';
import * as V12 from './views-v12.js';
import * as MV from './views-move.js';

export const APP_VERSION = '0.12.0 (goals & EPF)';
const $app = document.getElementById('app');

// ---------- appearance (kept outside the vault so the lock screen matches)
async function applyLook() {
  const t = (await meta.get('theme')) || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  const z = (await meta.get('textSize')) || 'system';
  if (z === 'default') document.documentElement.removeAttribute('data-size'); else document.documentElement.setAttribute('data-size', z);
}

// ---------- settings inside the vault
function settings() { return Object.assign({ autoLockMin: 5, graceSec: 30, deviceUser: '' }, V.get('settings', 'app') || {}); }
async function saveSettings(patch) { await V.put('settings', 'app', Object.assign(settings(), patch)); }
const who = () => settings().deviceUser;
const snap = () => V.get('snapshot', 'latest') || null;

// ---------- locking
// The app locks: after the idle time; when it has been in the background longer than the grace time;
// and always when the page is closed. While in the background the screen is blurred.
let hiddenAt = null;
function lockNow(reason) {
  if (!V.isUnlocked()) return;
  if (state.view !== 'lock' && state.view !== 'forgot') state.resume = state.view; state.hidden = undefined; V.lock(); state.view = 'lock'; document.querySelectorAll('.scrim').forEach(x => x.remove()); render();
  if (reason) toast(reason);
}
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => window.addEventListener(ev, () => { state.lastActive = Date.now(); }, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); document.body.classList.add('privacy'); return; }
  document.body.classList.remove('privacy');
  if (hiddenAt && V.isUnlocked()) {
    const g = settings().graceSec; const away = Date.now() - hiddenAt;
    if (away > g * 1000) lockNow(); else state.lastActive = Date.now();
  }
  hiddenAt = null;
});
window.addEventListener('pagehide', () => lockNow());
setInterval(() => {
  if (!V.isUnlocked() || document.visibilityState === 'hidden') return;
  const mins = settings().autoLockMin;
  if (mins > 0 && Date.now() - state.lastActive > mins * 60000) lockNow('Locked after ' + mins + ' min idle');
}, 5000);
window.addEventListener('online', () => { renderTop(); scheduleSync(1000); }); window.addEventListener('offline', () => renderTop());

// ---------- outbox and entries
function entriesView() {
  const file = V.get('entries', 'all') || [];
  const map = new Map(file.map(e => [e.id, { ...e, pending: false }]));
  for (const op of V.all('outbox').sort((a, b) => a.seq - b.seq)) {
    if (op.kind === 'addExpense') map.set(op.entry.id, { ...op.entry, version: 0, status: 'Active', pending: true });
    else if (op.kind === 'editExpense' && map.has(op.id)) map.set(op.id, { ...map.get(op.id), ...op.changes, pending: true });
    else if (op.kind === 'deleteExpense' && map.has(op.id)) map.set(op.id, { ...map.get(op.id), status: 'Deleted', pending: true });
  }
  return [...map.values()].filter(e => e.status !== 'Deleted').sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
}
async function queue(op) {
  op.opId = op.opId || uuid(); op.seq = Date.now() + Math.random(); op.by = who(); op.at = new Date().toISOString();
  await V.put('outbox', op.opId, op); scheduleSync();
}
function baseOf(e) { const b = {}; for (const k of ['date', 'amount', 'category', 'sub', 'mode', 'notes', 'status', 'event', 'by']) b[k] = e[k] ?? ''; return b; }

// ---------- sync
function deviceName() { return settings().deviceName || (/Android/i.test(navigator.userAgent) ? 'Android phone' : /Windows/i.test(navigator.userAgent) ? 'Windows laptop' : 'Browser'); }
function fileTransport(manual) {
  const f = V.get('sync', 'file'); if (!f) return null;
  return new GraphFile({ base: CONFIG.graphBase, getToken: () => Auth.getToken(!!manual), driveId: f.driveId, itemId: f.itemId });
}
let syncTimer = null;
function scheduleSync(ms = 3000) { clearTimeout(syncTimer); syncTimer = setTimeout(() => doSync(false), ms); }
async function doSync(manual) {
  if (!V.isUnlocked() || state.syncing) return;
  const t = fileTransport(manual === true); // a pull-down ('pull') never leaves the app to sign in
  if (CONFIG.demo) { if (manual) toast('Demo copy: nothing is synced. Your test entries stay on this device only.'); return; }
  try { await Auth.init(); } catch (e) { /* offline or blocked: currentAccount stays empty */ }
  if (!t || !Auth.currentAccount()) { if (manual) toast('Connect the tracker first: Settings › Sync', 'bad'); return; }
  if (!who()) { if (manual) toast('Choose who uses this device in Settings first', 'bad'); return; }
  if (!navigator.onLine) { if (manual) toast('Offline. Your edits are saved here and will sync when you are back online.'); return; }
  state.syncing = true; renderTop();
  try {
    const ops = V.all('outbox').sort((a, b) => a.seq - b.seq);
    const prev = V.get('sync', 'state') || {};
    const res = await syncOnce({ transport: t, ops, who: who(), device: deviceName(), lastEtag: manual ? null : prev.etag });
    for (const id of res.applied) await V.remove('outbox', id);
    for (const c of res.conflicts) { await V.put('conflict', c.op.opId, c); await V.remove('outbox', c.op.opId); }
    if (!res.unchanged) {
      await V.put('entries', 'all', res.entries);
      const sn = res.snapshot; sn.asOf = sn.fileModified; await V.put('snapshot', 'latest', sn);
      try { await C2.recordHistory(sn); } catch (e) { /* history is optional */ }
    }
    try { await syncSuggestions(); } catch (e) { if (manual) toast('Suggestion box: ' + e.message, 'bad'); }
    await V.put('sync', 'state', { lastSync: new Date().toISOString(), lastError: null, etag: res.etag || prev.etag });
    if (manual || res.applied.length) toast(res.applied.length ? 'Synced ' + res.applied.length + ' change' + (res.applied.length > 1 ? 's' : '') + ' to the tracker' : 'Up to date');
    if (res.conflicts.length) toast(res.conflicts.length + ' change needs your choice', 'bad');
  } catch (e) {
    const prevErr = (V.get('sync', 'state') || {}).lastError;
    await V.put('sync', 'state', Object.assign(V.get('sync', 'state') || {}, { lastError: e.message, lastErrorAt: new Date().toISOString() }));
    if (manual || (e.locked && prevErr !== e.message)) toast(e.message, 'bad');
    if (e.locked) scheduleSync(120000); // Excel has the file open: try again quietly in 2 minutes
  } finally {
    state.syncing = false;
    // never redraw a screen the person is typing into (or one with a sheet open): only the sync pill changes
    if (V.isUnlocked()) { if (['addexpense', 'addincome', 'monthly', 'holdings', 'suggest', 'formedit', 'form', 'kite', 'intlpaste', 'cas', 'move'].includes(state.view) || document.querySelector('.scrim')) renderTop(); else render(); }
  }
}
// suggestion box: a separate small file in OneDrive; unsent suggestions are appended at each sync
function suggestTransport() { const f = V.get('sync', 'suggestFile'); return f ? new GraphFile({ base: CONFIG.graphBase, getToken: () => Auth.getToken(false), driveId: f.driveId, itemId: f.itemId }) : null; }
async function syncSuggestions() {
  const t = suggestTransport(); if (!t) return;
  const unsent = V.all('suggest').filter(x => !x.sent); const st = V.get('sync', 'suggestRows') || {};
  if (!unsent.length && st.at && Date.now() - new Date(st.at).getTime() < 6 * 3600000) return;
  const serial = iso => Math.round((Date.parse(iso.slice(0, 10) + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);
  const ops = unsent.map(x => ({ opId: x.id, table: 'tblSuggestions', idCol: 'ID', values: { ID: x.id, Date: serial(x.at), From: x.by, 'Screen or area': x.area, Suggestion: x.text, Priority: x.priority, Status: 'New', 'Updated at': x.at.replace('T', ' ').slice(0, 19) } }));
  const res = await syncExtraFile({ transport: t, ops, who: who() });
  for (const id of res.applied) { const x = V.get('suggest', id); if (x) await V.put('suggest', id, Object.assign({}, x, { sent: true })); }
  await V.put('sync', 'suggestRows', { at: new Date().toISOString(), rows: res.rows.map(r => ({ ID: r.ID, Status: r.Status, Reply: r['Reply / decision'] })) });
}
async function connectSuggest(link) { const f = await GraphFile.fromShareLink({ base: CONFIG.graphBase, getToken: () => Auth.getToken(true), link }); await V.put('sync', 'suggestFile', f); await syncSuggestions(); }
setInterval(() => { if (V.isUnlocked() && navigator.onLine && document.visibilityState === 'visible') doSync(false); }, CONFIG.autoSyncMinutes * 60000);

// ---------- shell: top bar (title, sync status, alerts) and navigation
const TABS = [['home', 'Home', 'home'], ['spend', 'Money', 'spend'], ['add', '', 'plus'], ['wealth', 'Wealth', 'wealth'], ['more', 'More', 'more']];
const TAB_OF = { home: 'home', spend: 'spend', addexpense: 'spend', addincome: 'spend', income: 'spend', reports: 'spend', recurring: 'spend', events: 'spend', activity: 'home', conflicts: 'home',
  wealth: 'wealth', plan: 'wealth', alerts: 'wealth', checks: 'wealth', lent: 'more', protection: 'more', documents: 'more', settings: 'more', more: 'more', changelock: 'more', backup: 'more', restore: 'more',
  monthly: 'more', holdings: 'more', suggest: 'more', tracker: 'more', form: 'more', formedit: 'more', kite: 'more', intlpaste: 'more', cas: 'more', handover: 'more', year: 'more', move: 'more', help: 'more', grouping: 'more', signin: 'more', epf: 'more' };
function syncPill() {
  const st = V.get('sync', 'state') || {}; const pending = V.all('outbox').length; const conflicts = V.all('conflict').length;
  let cls = 'pill', text;
  if (conflicts) { cls += ' bad'; text = conflicts + ' to resolve'; }
  else if (CONFIG.demo) { cls += ' off'; text = 'Demo · no sync'; }
  else if (Auth.needsSignIn()) { cls += ' bad'; text = 'Sign in to sync'; }
  else if (!navigator.onLine) { cls += ' off'; text = 'Offline' + (pending ? ' · ' + pending + ' pending' : ''); }
  else if (state.syncing) { cls += ' busy'; text = 'Syncing…'; }
  else if (pending) { cls += ' pending'; text = pending + ' pending'; }
  else { cls += ' ok'; text = st.lastSync ? 'Synced ' + F.ago(st.lastSync) : 'Not synced'; }
  return h('button', { class: cls, id: 'syncpill', 'aria-label': 'Sync status: ' + text + '. Tap for details.', onclick: () => conflicts ? go('conflicts') : syncSheet() },
    h('span', { class: 'led', 'aria-hidden': 'true' }), h('span', { id: 'pending', 'data-count': pending }, text));
}
function syncSheet() {
  const st = V.get('sync', 'state') || {}; const s = snap(); const pending = V.all('outbox').length;
  sheet('Sync',
    h('div', { class: 'kv' },
      h('span', {}, 'Connection'), h('span', {}, navigator.onLine ? 'Online' : 'Offline'),
      h('span', {}, 'Last synced'), h('span', {}, F.dateTime(st.lastSync)),
      h('span', {}, 'Waiting to sync'), h('span', {}, pending + ' change' + (pending === 1 ? '' : 's')),
      h('span', {}, 'Tracker last saved in Excel'), h('span', {}, s && s.fileModified ? F.dateTime(s.fileModified) : '–')),
    st.lastError ? h('p', { class: 'warn-text', style: { marginTop: '10px' } }, 'Last problem: ' + st.lastError) : null,
    s && s.provisional ? h('p', { class: 'hint', style: { marginTop: '10px' } }, 'Totals are provisional until the tracker is next opened in Excel.') : null,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary wide', id: 'syncnow', disabled: state.syncing || null, onclick: e => { e.target.closest('.scrim').remove(); doSync(true); } }, icon('sync', 18), 'Sync now'));
}
function topbar(title, opts = {}) {
  return h('header', { class: 'topbar', id: 'topbar' },
    opts.back ? h('button', { class: 'iconbtn', 'aria-label': 'Back', onclick: () => go(opts.back) }, icon('back')) : null,
    h('h1', {}, title), syncPill(),
    h('button', { class: 'iconbtn', id: 'searchbtn', 'aria-label': 'Search everything', onclick: () => X.openSearch() }, icon('search')),
    h('button', { class: 'iconbtn', id: 'privbtn', 'aria-label': F.isHidden() ? 'Show amounts' : 'Hide amounts', 'aria-pressed': String(F.isHidden()), onclick: togglePrivacy }, icon(F.isHidden() ? 'eyeoff' : 'eye')));
}
function togglePrivacy() { const on = !F.isHidden(); state.hidden = on; F.setHidden(on); toast(on ? 'Amounts hidden' : 'Amounts shown'); render(); }
function pullToSync() {
  let y0 = null, dy = 0; const ind = h('div', { class: 'ptr', 'aria-hidden': 'true' }, icon('sync', 18)); document.body.append(ind);
  window.addEventListener('touchstart', e => { if (window.scrollY > 0 || !V.isUnlocked() || document.querySelector('.scrim, .story') || state.view === 'lock') { y0 = null; return; } y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
  window.addEventListener('touchmove', e => { if (y0 === null) return; dy = e.touches[0].clientY - y0; if (dy <= 0) { ind.style.transform = ''; return; } const d = Math.min(dy, 110); ind.style.transform = 'translate(-50%, ' + d + 'px) rotate(' + d * 3 + 'deg)'; ind.classList.toggle('ready', dy > 80); }, { passive: true });
  window.addEventListener('touchend', () => { if (y0 === null) return; y0 = null; const go = dy > 80; ind.style.transform = ''; ind.classList.remove('ready'); if (go) { haptic(); doSync('pull'); } });
}
let installEvt = null; window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
function installCard() {
  const url = location.origin + location.pathname;
  const step = (n, txt) => h('li', {}, h('span', { class: 'stepn' }, String(n)), h('span', {}, txt));
  return h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Install on another phone or laptop')),
    h('p', { class: 'hint' }, 'For setting up Madhu, or a new device. The app address is:'), h('p', { class: 'mono wrap-any' }, url),
    installEvt ? h('button', { class: 'btn primary', style: { margin: '8px 0' }, onclick: async () => { installEvt.prompt(); installEvt = null; } }, 'Install on this device') : null,
    h('div', { class: 'label-sm' }, 'Android phone (Chrome)'),
    h('ol', { class: 'steps-list' }, step(1, 'Open the address above in Chrome.'), step(2, 'Tap the ⋮ menu, then "Install app" (or "Add to Home screen").'), step(3, 'Open the app from the home screen and choose a 4-digit PIN.')),
    h('div', { class: 'label-sm' }, 'Laptop (Chrome or Edge)'),
    h('ol', { class: 'steps-list' }, step(1, 'Open the address above.'), step(2, 'Click the install icon at the right end of the address bar (or menu › Apps › Install).'), step(3, 'Open it and choose a PIN or passphrase.')),
    h('div', { class: 'label-sm' }, 'Then, on that device'),
    h('ol', { class: 'steps-list' }, step(1, 'More › App › Sign in & tracker › Who uses this device: pick the person.'), step(2, 'Paste the tracker\'s OneDrive link and sign in with that person\'s own Microsoft account.'), step(3, 'For Madhu: share the tracker with her Microsoft account with "Can edit" first (OneDrive › Share).')));
}
function renderTop() { const p = document.getElementById('syncpill'); if (p && V.isUnlocked()) p.replaceWith(syncPill()); }
function nav() {
  const active = TAB_OF[state.view] || 'home';
  return h('nav', { class: 'nav', 'aria-label': 'Main' }, ...TABS.map(([id, label, ic]) => id === 'add'
    ? h('button', { class: 'fab', 'aria-label': 'Add expense', id: 'fab', onclick: () => { state.editing = null; go('addexpense'); } }, icon('plus', 24))
    : h('button', { class: 'nav-item' + (active === id ? ' active' : ''), 'aria-current': active === id ? 'page' : null, onclick: () => go(id) }, h('span', { class: 'ic' }, icon(ic)), label)));
}
// One-time tips: shown the first time a screen opens, gone for good after "Got it".
const TIPS = {
  home: 'Amounts start hidden. Tap the eye at the top to show them. Pull down from the top to sync. The search icon finds screens, settings and entries.',
  spend: 'Switch between Spending and Income at the top. Swipe one of your entries right to edit it, or left to delete it. Every delete or edit can be undone for a few seconds.',
  addexpense: 'Tap the mic and say it, like "450 lunch UPI yesterday". The form fills in; check it and press Save. The category is also suggested for this time of day once you have logged a few.',
  reports: 'Tap a category to see its entries. The recap button shows last month in a few cards.',
  wealth: 'Figures come from the tracker as Excel last saved it. They update after you open the tracker in Excel.',
  tracker: 'Each topic has its screens and everything you type for it. Saving writes only the yellow cells on the next sync.',
  monthly: 'Pick the month, then go step by step. Nothing reaches the tracker until you press Close the month on the last step, and only input cells are written.',
  recurring: 'Set up fixed amounts like rent once. On the due day, Home asks you to Add or Skip.',
  income: 'Add income from Home or the + button (switch to Income at the top). Money › Income compares month on month or year on year.',
  lent: 'Record money you lend. On the follow-up date it shows on Home so you remember to ask.',
  events: 'Make an event, then pick it when you add a spend. The event total adds up here.',
  settings: 'Fingerprint unlock and the lock timing are under Lock.',
};
function tipFor(view) {
  const txt = TIPS[view]; const seen = settings().tipsSeen || [];
  if (!txt || seen.includes(view)) return null;
  const el = h('div', { class: 'tip-card', role: 'note' }, icon('info', 18), h('span', {}, txt),
    h('button', { class: 'btn small', onclick: async () => { el.remove(); await saveSettings({ tipsSeen: [...(settings().tipsSeen || []), view] }); } }, 'Got it'));
  return el;
}
function shell(view) { // view: { title, back?, body: [nodes] }
  // a screen opened from a More topic page goes back to that page; opened from elsewhere, to where it says
  if (state.fromTopic && state.fromTopic === state.view && view.back) view.back = 'tracker';
  if (state.fromWiz && state.fromWiz === state.view && state.wiz && view.back) view.back = 'monthly';
  $app.className = 'app shell';
  const demo = CONFIG.demo ? h('div', { class: 'demobar', id: 'demobar', role: 'note' }, 'DEMO COPY · made-up data · nothing reaches your tracker') : null;
  $app.replaceChildren(...[topbar(view.title, view), demo].filter(Boolean), h('main', { class: 'page', id: 'main' }, tipFor(state.view), ...view.body), nav());
}
const NO_REOPEN = ['addexpense', 'addincome', 'formedit', 'kite', 'intlpaste', 'cas', 'move', 'changelock', 'backup', 'restore', 'conflicts', 'lock', 'forgot', 'setup'];
// Phone back button: every screen change is a browser history step, so Back returns to the previous screen
// (or closes an open sheet) instead of leaving the app.
function go(view, opts = {}) { const prev = state.view; state.view = view; if (view === 'spend' && !opts.keepMoney) state.moneyTab = 'spending'; if (['home', 'spend', 'wealth', 'more'].includes(view)) state.fromTopic = null; window.scrollTo(0, 0); render();
  try { if (V.isUnlocked() && prev !== view && !['lock', 'setup', 'forgot'].includes(view)) history[opts.replace ? 'replaceState' : 'pushState']({ v: view }, ''); } catch (e) { /* ignore */ }
  if (V.isUnlocked() && TAB_OF[view] && !NO_REOPEN.includes(view)) saveSettings({ lastView: view, lastTab: Object.assign({}, state.tab) }).catch(() => {}); }

// ---------- PIN / passphrase entry
function secretInput(type, onDone, opts = {}) {
  if (type === 'pin') {
    let val = '';
    const dots = h('div', { class: 'dots', 'aria-label': 'PIN digits entered' });
    const draw = () => { dots.replaceChildren(...[0, 1, 2, 3].map(i => h('span', { class: 'dot' + (i < val.length ? ' on' : '') }))); dots.setAttribute('aria-label', val.length + ' of 4 digits entered'); };
    const press = d => { if (opts.disabled && opts.disabled()) return; if (d === '⌫') val = val.slice(0, -1); else if (val.length < 4) val += d; draw(); if (val.length === 4) { const v = val; val = ''; setTimeout(draw, 150); onDone(v); } };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', '⌫'].map(k => k === 'bio'
      ? (opts.bio ? h('button', { class: 'key ghost', 'aria-label': 'Unlock with fingerprint', onclick: opts.bio }, icon('finger', 26)) : h('span'))
      : h('button', { class: 'key' + (k === '⌫' ? ' ghost' : ''), 'aria-label': k === '⌫' ? 'Delete' : k, onclick: () => press(k) }, k === '⌫' ? icon('left', 22) : k));
    const onKey = e => { if (!document.body.contains(dots)) return window.removeEventListener('keydown', onKey); if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); };
    window.addEventListener('keydown', onKey);
    draw();
    return h('div', { class: 'pin' }, dots, h('div', { class: 'keypad' }, keys));
  }
  const inp = h('input', { type: 'password', class: 'field', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Passphrase', placeholder: 'Passphrase' });
  const goNext = () => { const v = inp.value; inp.value = ''; onDone(v); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') goNext(); });
  setTimeout(() => inp.focus(), 50);
  return h('div', { class: 'pass' }, inp, h('button', { class: 'btn primary wide', onclick: goNext }, opts.label || 'Unlock'),
    opts.bio ? h('button', { class: 'btn wide', onclick: opts.bio }, icon('finger'), 'Use fingerprint') : null);
}
function centre(...kids) { $app.className = 'app'; $app.replaceChildren(h('main', { class: 'center' }, ...kids)); }

// ---------- first-time setup, lock, forgot
const TOUR = [
  ['lock', 'Private by design', 'Everything on this phone is encrypted with your PIN. No ads, no trackers, no other servers. Amounts stay hidden until you tap the eye.'],
  ['plus', 'Log a spend in seconds', 'Tap +, type the amount, pick a category, done. Each entry is tagged to whoever logs it, and Madhu and Aravind see each other\'s.'],
  ['sync', 'Your tracker stays the master', 'The app reads and writes your Excel tracker in OneDrive. It works offline and syncs when you are back online.'],
];
async function viewSetup() {
  const seq = renderSeq;
  if (!(await meta.get('tourSeen')) && !state.tourDone && !CONFIG.skipTour) {
    let i = state.tourStep || 0; const [ic, ttl, txt] = TOUR[i];
    const next = async () => { if (i < TOUR.length - 1) { state.tourStep = i + 1; render(); } else { state.tourDone = true; await meta.set('tourSeen', new Date().toISOString()); render(); } };
    return (seq === renderSeq) && centre(h('div', { class: 'tour', id: 'tour' }, h('div', { class: 'lockmark' }, icon(ic, 30)), h('h1', {}, ttl), h('p', { class: 'hint' }, txt),
      h('div', { class: 'dots', 'aria-hidden': 'true' }, TOUR.map((x, k) => h('span', { class: k === i ? 'on' : '' }))),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: async () => { state.tourDone = true; await meta.set('tourSeen', new Date().toISOString()); render(); } }, 'Skip'),
        h('button', { class: 'btn primary', id: 'tournext', onclick: next }, i < TOUR.length - 1 ? 'Next' : 'Get started'))));
  }
  let type = 'pin', first = null;
  const msg = h('p', { class: 'hint' }); const box = h('div'); const busy = h('p', { class: 'hint', hidden: true }, 'Securing your data…');
  const draw = () => {
    msg.textContent = first === null ? (type === 'pin' ? 'Choose a 4-digit PIN.' : 'Choose a passphrase: 10+ characters with letters, numbers and a special character.') : 'Type it again to confirm.';
    box.replaceChildren(secretInput(type, async v => {
      if (first === null) { const e = V.validateSecret(type, v); if (e) { toast(e, 'bad'); return; } first = v; draw(); return; }
      if (v !== first) { toast('They did not match. Start again.', 'bad'); first = null; draw(); return; }
      busy.hidden = false; await V.setup(type, v); state.lastActive = Date.now(); go('home');
    }, { label: first === null ? 'Next' : 'Set passphrase' }));
  };
  const pick = v => { type = v; first = null; segBox.replaceChildren(seg([['pin', '4-digit PIN'], ['pass', 'Passphrase']], type, pick, 'Lock type')); draw(); };
  const segBox = h('div'); pick('pin');
  (seq === renderSeq) && centre(h('div', { class: 'lockmark' }, icon('lock', 30)), h('h1', {}, 'Family Finance'),
    h('p', { class: 'hint' }, 'Set a lock for this device. It encrypts everything stored here and is never saved or sent anywhere. If you forget it, this device is reset and the data downloads again from OneDrive.'),
    segBox, msg, box, busy);
}

let bioTried = false;
async function viewLock() {
  const seq = renderSeq;
  const type = await V.lockType(); const bio = await Bio.enrolled();
  const msg = h('p', { class: 'hint', 'aria-live': 'assertive' }, type === 'pin' ? 'Enter your PIN' : 'Enter your passphrase');
  let waiting = false;
  const done = async () => { state.lastActive = Date.now(); bioTried = false; try { await X.recordOpen(); } catch (e) { /* streak is optional */ } const st0 = settings(); if (!state.resume && st0.lastView && TAB_OF[st0.lastView]) { state.resume = st0.lastView; Object.assign(state.tab, st0.lastTab || {}); }
    state.view = state.resume && TAB_OF[state.resume] ? state.resume : 'home'; render(); scheduleSync(800); };
  const tick = async () => {
    const w = await V.waitRemaining(); waiting = w > 0;
    if (waiting) { msg.textContent = 'Too many wrong tries. Try again in ' + Math.ceil(w / 1000) + ' s.'; setTimeout(tick, 1000); }
    else if (msg.dataset.waited) { msg.textContent = 'Enter your ' + (type === 'pin' ? 'PIN' : 'passphrase'); delete msg.dataset.waited; }
  };
  const useBio = async () => {
    try { msg.textContent = 'Waiting for fingerprint…'; const raw = await Bio.unlockKey(); await V.unlockWithRaw(raw); done(); }
    catch (e) { msg.textContent = e.message; }
  };
  const box = secretInput(type, async v => {
    if (waiting) return;
    msg.textContent = 'Checking…';
    const r = await V.unlock(v);
    if (r.ok) return done();
    if (r.wait > 0) { msg.dataset.waited = '1'; tick(); }
    else msg.textContent = 'Wrong ' + (type === 'pin' ? 'PIN' : 'passphrase') + '. ' + (V.FAIL_FREE - r.fails > 0 ? (V.FAIL_FREE - r.fails) + ' more tries before a waiting time.' : '');
  }, { disabled: () => waiting, bio: bio ? useBio : null });
  (seq === renderSeq) && centre(h('div', { class: 'lockmark' }, icon('lock', 30)), h('h1', {}, 'Family Finance'), msg, box,
    h('button', { class: 'link', onclick: () => go('forgot') }, 'Forgot PIN or passphrase?'));
  tick();
  if (bio && !bioTried && document.visibilityState === 'visible') { bioTried = true; setTimeout(useBio, 0); }
}

function viewForgot() {
  const conf = h('input', { class: 'field', 'aria-label': 'Type RESET to confirm', placeholder: 'Type RESET' });
  centre(h('h1', {}, 'Forgot your PIN?'),
    h('p', {}, 'Your PIN is not stored anywhere, so nobody can recover it. The only way back is to reset this device: it deletes the encrypted data on this phone or laptop. Your tracker in OneDrive is not touched. After the reset you set a new PIN, sign in with Microsoft and the data downloads again.'),
    h('p', { class: 'warn-text' }, 'Changes on this device that were not synced yet will be lost.'), conf,
    h('button', { class: 'btn danger wide', onclick: async () => { if (conf.value.trim().toUpperCase() !== 'RESET') { toast('Type RESET to confirm', 'bad'); return; } await V.resetDevice(); toast('This device was reset'); go('setup'); } }, 'Reset this device'),
    h('button', { class: 'link', onclick: () => go(V.isUnlocked() ? 'settings' : 'lock') }, 'Back'));
}

// ---------- settings
async function viewSettings() {
  const seq = renderSeq;
  const s = settings(); const theme = (await meta.get('theme')) || 'system'; const size = (await meta.get('textSize')) || 'system';
  const lockType = await V.lockType(); const bioOn = await Bio.enrolled(); const bioOk = await Bio.supported();
  const row = (t, d, ...ctl) => h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, t), d ? h('div', { class: 'set-d' }, d) : null), h('div', { class: 'set-c' }, ...ctl));
  const sel = (opts, val, on, label) => h('select', { class: 'field', 'aria-label': label, onchange: ev => on(ev.target.value) }, ...opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
  const saved = () => toast('Saved');
  const sw = (on, label, fn) => h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: fn });
  const body = [
    h('h2', { class: 'sec-h' }, 'Everyday'),
    CONFIG.demo ? demoCard() : null,
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'This device')),
      row('Who uses this device', 'Every change is tagged with this name.', sel([['', 'Not set'], ['Aravind', 'Aravind'], ['Madhu', 'Madhu']], s.deviceUser, v => saveSettings({ deviceUser: v }).then(saved), 'Who uses this device')),
      row('Device name', 'Shown in the tracker\'s Sync Log.', h('input', { class: 'field', id: 'devname', value: deviceName(), 'aria-label': 'Device name', onchange: e => saveSettings({ deviceName: e.target.value.trim() }).then(saved) }))),
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Lock')),
      row('Unlock with fingerprint', bioOk ? (bioOn ? 'On for this device. Your PIN still works.' : 'Use the phone\'s fingerprint or face unlock instead of typing the PIN.') : 'Not available: this device has no fingerprint or face unlock set up for the browser.',
        sw(bioOn, 'Unlock with fingerprint', async () => {
          if (bioOn) { await Bio.disable(); toast('Fingerprint unlock turned off'); return render(); }
          if (!bioOk) { toast('This device has no fingerprint or face unlock available for the app.', 'bad'); return; }
          askSecretThen('Turn on fingerprint', 'Enter your current ' + (lockType === 'pin' ? 'PIN' : 'passphrase') + ' once to link it to your fingerprint.', async v => {
            const raw = await V.rawKeyFor(v); await Bio.enroll(raw, who() || deviceName()); toast('Fingerprint unlock is on'); go('settings');
          });
        })),
      row('Lock after switching apps', 'Come back within this time and it stays open.', sel([[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']], s.graceSec, v => saveSettings({ graceSec: Number(v) }).then(saved), 'Grace time')),
      row('Lock when idle', 'While the app is open but not used.', sel([[1, '1 min'], [2, '2 min'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']], s.autoLockMin, v => saveSettings({ autoLockMin: Number(v) }).then(saved), 'Idle lock')),
      row(lockType === 'pin' ? '4-digit PIN' : 'Passphrase', 'Changing it turns fingerprint unlock off until you turn it on again.', h('button', { class: 'btn', onclick: () => go('changelock') }, 'Change'))),
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Appearance')),
      row('Theme', null, sel([['system', 'Same as phone'], ['light', 'Light'], ['dark', 'Dark']], theme, async v => { await meta.set('theme', v); applyLook(); }, 'Theme')),
      row('Hide amounts when the app opens', 'Privacy mode: every ₹ figure shows as dots until you tap the eye button at the top. Hidden again after every lock.', sw(s.hideOnOpen !== false, 'Hide amounts when the app opens', async () => { await saveSettings({ hideOnOpen: s.hideOnOpen === false }); render(); })),
      row('Text size', null, sel([['system', 'Same as phone'], ['small', 'Small'], ['default', 'Standard'], ['large', 'Large']], size, async v => { await meta.set('textSize', v); applyLook(); }, 'Text size'))),
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Help')),
      row('Tips', 'Every one-time tip in one place.', h('button', { class: 'btn', id: 'sethelp', onclick: () => go('help') }, 'Open'))),
    h('h2', { class: 'sec-h', id: 'advanced' }, 'Advanced'),
    CONFIG.demo ? null : installCard(),
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'New tracker version')),
      h('p', { class: 'hint' }, 'When Claude sends a newer tracker, move everything you entered into it. Your current file keeps its data.'), h('div', { class: 'spacer' }),
      h('div', { class: 'btns' }, h('button', { class: 'btn', id: 'setmove', onclick: () => go('move') }, 'Move to a new tracker version'))),
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Backup')),
      h('p', { class: 'hint' }, 'An encrypted file that only your current PIN or passphrase can open. Keep it in OneDrive.'), h('div', { class: 'spacer' }),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => go('backup') }, 'Export backup'), h('button', { class: 'btn', onclick: () => go('restore') }, 'Import backup'))),
    CONFIG.demo ? null : h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Testing')),
      h('p', { class: 'hint' }, 'Made-up figures to try the screens on a device not yet connected to the tracker.'), h('div', { class: 'spacer' }),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: loadSample }, 'Load sample data'), h('button', { class: 'btn', onclick: clearSample }, 'Remove sample data'))),
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Reset')),
      h('p', { class: 'hint' }, 'Deletes everything stored on this device. The tracker in OneDrive is not touched.'), h('div', { class: 'spacer' }),
      h('button', { class: 'btn danger', onclick: () => go('forgot') }, 'Reset this device')),
    h('p', { class: 'hint', style: { margin: '16px 4px' } }, 'Version ' + APP_VERSION + '. No analytics, no trackers, no third-party servers. Never type full account or card numbers, PAN, Aadhaar or passport numbers: last 4 digits only.'),
  ];
  (seq === renderSeq) && shell({ title: 'Settings', back: 'more', body });
}
function viewHelp() {
  const NAMES = { home: 'Home', spend: 'Money', addexpense: 'Add expense', reports: 'Reports', wealth: 'Wealth', tracker: 'More topics', monthly: 'Month-end update', recurring: 'Recurring', income: 'Income', lent: 'Money lent', events: 'Events', settings: 'Settings' };
  return { title: 'Help', back: 'settings', body: [h('section', { class: 'card', id: 'helplist' }, h('div', { class: 'card-h' }, h('h2', {}, 'Tips')),
    ...Object.keys(TIPS).map(k => h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, NAMES[k] || k), h('div', { class: 'set-d' }, TIPS[k]))))),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: async () => { await saveSettings({ tipsSeen: [] }); toast('Tips will show again once on each screen'); } }, 'Show tips again'))] };
}
// Sign in & tracker (0.12.0): its own screen under More › App, so connecting needs no trip through Settings
function viewSignin() {
  const s = settings();
  const whoRow = h('section', { class: 'card' }, h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, 'Who uses this device'), h('div', { class: 'set-d' }, 'Every change is tagged with this name.')),
    h('div', { class: 'set-c' }, h('select', { class: 'field', id: 'signinwho', 'aria-label': 'Who uses this device', onchange: ev => saveSettings({ deviceUser: ev.target.value }).then(() => { toast('Saved'); render(); }) },
      ...[['', 'Not set'], ['Aravind', 'Aravind'], ['Madhu', 'Madhu']].map(([v, l]) => h('option', { value: v, selected: v === (s.deviceUser || '') }, l))))));
  return { title: 'Sign in & tracker', back: 'tracker', body: [whoRow, CONFIG.demo ? demoCard() : syncCard()] };
}
function demoCard() {
  return h('section', { class: 'card', id: 'democard' }, h('div', { class: 'card-h' }, h('h2', {}, 'Demo copy')),
    h('p', { class: 'hint' }, 'This copy only holds made-up figures so you can try every screen. It cannot sign in to Microsoft or touch your tracker, and it keeps its data apart from your real app on this phone. Switch "Who uses this device" below to see the app as Madhu.'),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn', id: 'demoreset', onclick: async () => { for (const o of V.all('outbox')) await V.remove('outbox', o.opId); await loadDemo(true); toast('Demo data reset'); } }, 'Reset the demo data'));
}
function syncCard() {
  const acct = Auth.currentAccount(), file = V.get('sync', 'file'), st = V.get('sync', 'state') || {};
  const row = (t, d, ...ctl) => h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, t), d ? h('div', { class: 'set-d' }, d) : null), h('div', { class: 'set-c' }, ...ctl));
  const link = h('input', { class: 'field', id: 'sharelink', placeholder: 'Paste the OneDrive link to the tracker', 'aria-label': 'OneDrive link to the tracker', autocomplete: 'off' });
  return h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, 'Sync with the tracker')),
    !Auth.configured() ? h('p', { class: 'warn-text' }, 'Microsoft sign-in is not set up yet. Follow the setup guide (app registration), then add the ID to config.js.') : null,
    row('Microsoft account', acct ? (acct.username || acct.name) : 'Not signed in',
      acct ? h('button', { class: 'btn', onclick: () => Auth.signOut().then(render) }, 'Sign out') : h('button', { class: 'btn primary', disabled: !Auth.configured() || null, onclick: () => Auth.signIn().then(render).catch(e => toast(e.message, 'bad')) }, 'Sign in')),
    row('Tracker file', file ? file.name : 'Not connected', file ? h('button', { class: 'btn', onclick: async () => { await V.remove('sync', 'file'); render(); } }, 'Disconnect') : null),
    acct && !file ? h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'In OneDrive, open the tracker\'s Share menu, choose "Can edit" and copy the link. Madhu uses the link Aravind sends her.'), link,
      h('button', { class: 'btn primary', onclick: async () => {
        try { const f = await GraphFile.fromShareLink({ base: CONFIG.graphBase, getToken: () => Auth.getToken(true), link: link.value }); await V.put('sync', 'file', f); toast('Connected to ' + f.name); await doSync(true); }
        catch (e) { toast(e.message, 'bad'); }
      } }, 'Connect')) : null,
    row('Last sync', F.dateTime(st.lastSync) + (st.lastError ? ' · Last problem: ' + st.lastError : '')));
}

async function askSecretThen(title, explain, fn, back = 'settings') {
  const seq = renderSeq;
  const type = await V.lockType();
  const msg = h('p', { class: 'hint', 'aria-live': 'assertive' }, explain);
  (seq === renderSeq) && shell({ title, back, body: [h('div', { class: 'center' }, msg, secretInput(type, async v => { msg.textContent = 'Working…'; try { await fn(v, msg); } catch (e) { msg.textContent = e.message; } }, { label: 'Continue' }))] });
}
function viewBackup() {
  return askSecretThen('Export backup', 'Enter your current PIN or passphrase to encrypt the backup.', async v => {
    const txt = await V.exportBackup(v);
    const name = 'family-finance-backup-' + F.date(new Date()) + '.ffbackup';
    const url = URL.createObjectURL(new Blob([txt], { type: 'application/octet-stream' }));
    const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Backup saved as ' + name); go('settings');
  });
}
function viewRestore() {
  const file = h('input', { type: 'file', class: 'field', accept: '.ffbackup,application/json,application/octet-stream', 'aria-label': 'Backup file' });
  shell({ title: 'Import backup', back: 'settings', body: [h('section', { class: 'card stack' },
    h('p', {}, 'Choose a backup file. Its data replaces what is on this device now.'), file,
    h('button', { class: 'btn primary', onclick: async () => {
      if (!file.files[0]) { toast('Choose a file first', 'bad'); return; }
      const text = await file.files[0].text();
      askSecretThen('Open backup', 'Enter the PIN or passphrase that was in use when the backup was made.', async v => {
        const payload = await V.readBackup(text, v);
        await V.restoreBackup(payload); toast('Backup restored (' + payload.records.length + ' items)'); go('home');
      });
    } }, 'Next'))] });
}
async function viewChangeLock() {
  const seq = renderSeq;
  const curType = await V.lockType();
  let step = 'old', oldS = null, newType = curType, first = null;
  const msg = h('p', { class: 'hint', 'aria-live': 'assertive' }); const box = h('div'); const segBox = h('div', { hidden: true });
  const drawSeg = () => segBox.replaceChildren(seg([['pin', '4-digit PIN'], ['pass', 'Passphrase']], newType, v => { newType = v; first = null; drawSeg(); draw(); }, 'New lock type'));
  const draw = () => {
    if (step === 'old') { msg.textContent = 'Enter your current ' + (curType === 'pin' ? 'PIN' : 'passphrase') + '.'; box.replaceChildren(secretInput(curType, v => { oldS = v; step = 'new'; segBox.hidden = false; drawSeg(); draw(); }, { label: 'Next' })); return; }
    msg.textContent = first === null ? (newType === 'pin' ? 'Choose a new 4-digit PIN.' : 'Choose a new passphrase: 10+ characters with letters, numbers and a special character.') : 'Type it again to confirm.';
    box.replaceChildren(secretInput(newType, async v => {
      if (first === null) { const e = V.validateSecret(newType, v); if (e) { toast(e, 'bad'); return; } first = v; draw(); return; }
      if (v !== first) { toast('They did not match. Start again.', 'bad'); first = null; draw(); return; }
      msg.textContent = 'Re-encrypting…';
      try { await V.changeSecret(oldS, newType, v); toast('Lock changed'); go('settings'); }
      catch (e) { toast(e.message, 'bad'); step = 'old'; first = null; segBox.hidden = true; draw(); }
    }, { label: first === null ? 'Next' : 'Save' }));
  };
  draw();
  (seq === renderSeq) && shell({ title: 'Change lock', back: 'settings', body: [h('div', { class: 'center' }, segBox, msg, box)] });
}

// ---------- conflicts: both versions side by side, the person picks
function viewConflicts() {
  const list = V.all('conflict');
  const label = { date: 'Date', amount: 'Amount', category: 'Category', sub: 'Sub-category', mode: 'Payment mode', notes: 'Note', status: 'Status', value: 'Value' };
  const show = (k, v) => k === 'amount' ? F.inr(v) : k === 'date' ? F.date(v) : (v === null || v === undefined || v === '' ? '–' : String(v));
  const cards = list.map(c => {
    const op = c.op, r = c.remote;
    if (op.kind === 'setCells') return U.conflictCard(c);
    const mineVals = op.kind === 'deleteExpense' ? { status: 'Deleted' } : op.changes;
    const fields = Object.keys(label).filter(k => (mineVals && k in mineVals) || (r && String(r[k] ?? '') !== String(op.base?.[k] ?? '')));
    const why = c.reason === 'missing' ? 'This entry is no longer in the tracker.' : c.reason === 'not-owner' ? 'This entry was entered by ' + (r.enteredBy || r.by) + '. Only they can change it.' : 'This entry was changed in the tracker after you last synced' + (r && r.updatedAt ? ' (' + r.updatedAt + ')' : '') + '.';
    return h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, (r ? r.category : op.base?.category || 'Expense') + ' · ' + F.date(r ? r.date : op.base?.date))), h('p', { class: 'hint' }, why),
      r ? h('div', { class: 'tablewrap' }, h('table', { class: 'cmp' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Your change (' + op.by + ')'), h('th', {}, 'In the tracker now'))),
        h('tbody', {}, fields.map(k => h('tr', {}, h('th', {}, label[k]), h('td', {}, show(k, mineVals && k in mineVals ? mineVals[k] : op.base?.[k])), h('td', {}, show(k, r[k]))))))) : null,
      h('div', { class: 'btns', style: { marginTop: '12px' } },
        c.reason === 'changed' ? h('button', { class: 'btn primary', onclick: async () => { op.baseVersion = r.version; op.base = baseOf(r); op.opId = uuid(); await V.remove('conflict', c.op.opId); await queue(op); toast('Your change will be applied'); render(); } }, 'Keep mine') : null,
        h('button', { class: 'btn', onclick: async () => { await V.remove('conflict', c.op.opId); toast('Kept the tracker\'s version'); render(); } }, c.reason === 'changed' ? 'Keep the tracker\'s' : 'Discard my change')));
  });
  shell({ title: 'Choose which to keep', back: 'home', body: cards.length ? cards : [h('p', { class: 'empty' }, 'Nothing to resolve.')] });
}

// ---------- sample data (made up, for a device not connected to the tracker)
async function loadSample() {
  if (V.get('sync', 'file')) { toast('Sample data is only for a device not yet connected to the tracker', 'bad'); return; }
  try {
    const r = await fetch('./sample-snapshot.json'); const j = await r.json();
    await V.put('snapshot', 'latest', { ...j.snapshot, sample: true }); await V.put('entries', 'all', j.entries);
    if (!who()) await saveSettings({ deviceUser: 'Aravind' });
    toast('Sample data loaded'); go('home');
  } catch (e) { toast('Could not load sample data', 'bad'); }
}
// demo copy: the made-up sample loads by itself and history is seeded so every card has something to show
let demoLoading = false;
async function loadDemo(force) {
  if (!CONFIG.demo || demoLoading || (!force && snap())) return; demoLoading = true;
  try {
    const j = await (await fetch('./sample-snapshot.json')).json();
    await V.put('snapshot', 'latest', { ...j.snapshot, sample: true, demo: true }); await V.put('entries', 'all', j.entries);
    for (const x of (j.nwhist || [])) await V.put('nwhist', x.ym, x);
    if (!who()) await saveSettings({ deviceUser: 'Aravind' });
    await V.put('sync', 'state', { lastSync: new Date().toISOString(), lastError: null });
  } catch (e) { toast('Could not load the demo data', 'bad'); } finally { demoLoading = false; }
  render();
}
async function clearSample() {
  const s = snap();
  if (s && s.sample) { await V.remove('snapshot', 'latest'); await V.remove('entries', 'all'); }
  toast('Sample data removed'); render();
}

// ---------- router
let renderSeq = 0; // a slower, older render must not draw over a newer screen
async function render() {
  renderSeq++;
  if (!(await V.isSetUp())) { state.view = 'setup'; return viewSetup(); }
  if (!V.isUnlocked()) { if (state.view === 'forgot') return viewForgot(); return viewLock(); }
  if (CONFIG.demo && !snap() && !demoLoading) { loadDemo(); }
  if (state.hidden === undefined) state.hidden = settings().hideOnOpen !== false;
  F.setHidden(state.hidden);
  switch (state.view) {
    case 'settings': return viewSettings();
    case 'reports': return shell(R.viewReports());
    case 'recurring': return shell(X.viewRecurring());
    case 'activity': return shell(X.viewActivity());
    case 'events': return shell(C2.viewEvents());
    case 'lent': return shell(C2.viewLent());
    case 'income': state.moneyTab = 'income'; state.view = 'spend'; return shell(M.viewSpend());
    case 'addincome': return shell(I.viewAddIncome());
    case 'suggest': return shell(C2.viewSuggest());
    case 'backup': return viewBackup();
    case 'restore': return viewRestore();
    case 'changelock': return viewChangeLock();
    case 'forgot': return viewForgot();
    case 'conflicts': return viewConflicts();
    case 'spend': return shell(M.viewSpend());
    case 'addexpense': return shell(M.viewAddExpense());
    case 'wealth': return shell(W.viewWealth());
    case 'plan': state.tab.wealth = 'goals'; state.view = 'wealth'; return shell(W.viewWealth());
    case 'protection': return shell(W.viewProtection());
    case 'documents': return shell(W.viewDocuments());
    case 'alerts': case 'checks': return shell(W.viewAlerts());
    case 'help': return shell(viewHelp());
    case 'signin': return shell(viewSignin());
    case 'epf': return shell(V12.viewEPF());
    case 'grouping': return shell(TV.viewGrouping());
    case 'more': return shell(TV.viewMoreTopics());
    case 'monthly': return shell(U.viewMonthly());
    case 'tracker': return shell(TV.viewTopic());
    case 'formintl': state.formId = 'intl'; state.view = 'form'; return shell(FV.viewForm());
    case 'form': return shell(FV.viewForm());
    case 'formedit': return shell(FV.viewFormEdit());
    case 'kite': return shell(KV.viewKite());
    case 'intlpaste': return shell(KV.viewIntlPaste());
    case 'cas': return shell(CV.viewCas());
    case 'handover': return shell(HV.viewHandover());
    case 'year': return shell(YV.viewYear());
    case 'move': return shell(MV.viewMove());
    default: state.view = 'home'; return shell(M.viewHome());
  }
}

Object.assign(ctx, { V, F, settings, saveSettings, who, snap, go, render, queue, entriesView, baseOf, doSync, scheduleSync, lockNow, deviceName, connectSuggest });

(async () => {
  await applyLook();
  // 0.9.1: the lock screen (and the fingerprint prompt) no longer waits for the service worker or Microsoft sign-in
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.__NO_SW__) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* preview hosts may block it */ });
  }
  Auth.init().then(() => { if (V.isUnlocked() && ['settings', 'home', 'signin'].includes(state.view)) render(); }, e => console.warn(e.message));
  // pull down from the top of a screen to sync
  pullToSync();
  try { history.replaceState({ v: 'home', root: true }, ''); } catch (e) { /* ignore */ }
  window.addEventListener('popstate', ev => {
    const overlay = [...document.querySelectorAll('.scrim, .story')].pop();
    if (overlay) { overlay.remove(); history.pushState(ev.state && !ev.state.root ? ev.state : { v: state.view }, ''); return; }
    if (!V.isUnlocked()) return;
    const v = ev.state && ev.state.v; if (!v) return;
    state.view = v; window.scrollTo(0, 0); render();
  });
  // long-press shortcuts on the app icon open a screen straight after unlock
  const goTo = new URLSearchParams(location.search).get('go');
  if (goTo && TAB_OF[goTo]) { state.resume = goTo; try { history.replaceState({ v: 'home', root: true }, '', location.pathname); } catch (e) { /* ignore */ } }
  render();
})();
