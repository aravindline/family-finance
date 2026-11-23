// App 0.16.0 (Aravind's go 21 Nov 2026; scope in feedback/after-0.14.0.md "ANSWERS for 0.16.0"): the app for any family.
//  S1 first-time setup (names, who uses this phone, plan basics, sections), S3 "Create my tracker" in the person's own
//  OneDrive, S4 sections on / off for the whole family (stored in the tracker), names 1 to 5 (more added later), S7
//  neutral wording, S8 help guide and tour, S9 feedback to the app's maker (address shown only after Send).
// Nothing here ever holds or shows another family's tracker link: the link stays on each phone (Settings › Sync).
import { ctx, state } from './ctx.js';
import * as P from './people.js';
import * as F from './fmt.js';
import { h, icon, toast, card, sheet } from './ui.js';
import * as Auth from './auth.js';
import { CONFIG } from './config.js';
import { GraphFile } from './graph.js';
import { Workbook, isoToSerial } from './xlsx.js';
import { TEMPLATE } from './views-move.js';
import { feedbackAddress } from './views-report.js';

const num = v => { const t = String(v ?? '').replace(/[,₹\s]/g, ''); return t === '' || isNaN(Number(t)) ? null : Number(t); };
const draftOf = () => Object.assign({ step: 0, names: ['', ''], me: '', sections: {} }, ctx.settings().setupDraft || {});
const saveDraft = d => ctx.saveSettings({ setupDraft: d });
const field = (label, sub, input) => h('label', { class: 'fblock', style: { marginBottom: '12px' } }, h('span', { class: 'flabel' }, label), sub ? h('span', { class: 'fsub' }, sub) : null, input);
const inp = (id, value, attrs = {}) => h('input', Object.assign({ class: 'field', id, value: value ?? '', autocomplete: 'off' }, attrs));
const sw = (on, label, fn, id) => h('button', { class: 'switch', role: 'switch', id, 'aria-checked': String(!!on), 'aria-label': label, onclick: fn });

// ---------------------------------------------------------------- does this device still need setting up?
export function needsStart() {
  if (CONFIG.demo) return false;
  if (CONFIG.skipTour && !CONFIG.showStart) return false; // test harness on this computer only (older suites connect by link)
  const st = ctx.settings();
  return !st.startDone && !ctx.V.get('sync', 'file') && !ctx.snap();
}

// ---------------------------------------------------------------- tour (S8): before the first lock, and again from Help
export const TOUR = [
  ['lock', 'Private by design', 'Everything on this phone is encrypted with your PIN. No ads, no trackers, no other servers. Amounts stay hidden until you tap the eye.'],
  ['plus', 'Log a spend in seconds', 'Tap +, type the amount, pick a category, done. Each entry is tagged to whoever logs it, and everyone in the family sees each other\'s.'],
  ['sync', 'Your tracker, in your OneDrive', 'The app keeps your money in an Excel tracker in your own OneDrive. It works offline and syncs when you are back online.'],
  ['wealth', 'See where you stand', 'Wealth shows net worth, investments and your early-retirement (FIRE) plan, worked out straight away from what you enter.'],
];
export function tourView(onDone, i = 0) {
  const [ic, ttl, txt] = TOUR[i];
  return h('div', { class: 'tour', id: 'tour' }, h('div', { class: 'lockmark' }, icon(ic, 30)), h('h1', {}, ttl), h('p', { class: 'hint' }, txt),
    h('div', { class: 'dots', 'aria-hidden': 'true' }, TOUR.map((x, k) => h('span', { class: k === i ? 'on' : '' }))),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => onDone() }, i < TOUR.length - 1 ? 'Skip' : 'Close'),
      h('button', { class: 'btn primary', id: 'tournext', onclick: () => (i < TOUR.length - 1 ? onDone(i + 1) : onDone()) }, i < TOUR.length - 1 ? 'Next' : 'Get started')));
}

// ---------------------------------------------------------------- S1 + S3: how do you want to start?
export function viewStart() {
  const d = draftOf();
  if (d.mode === 'new') return wizard(d);
  if (d.mode === 'join') return joinView(d);
  const opt = (id, ic, t, sub, fn) => h('li', { class: 'li tap', id, onclick: fn }, h('span', { class: 'lead' }, icon(ic)), h('div', { class: 'body' }, h('div', { class: 'ttl' }, t), h('div', { class: 'sub', style: { whiteSpace: 'normal' } }, sub)), icon('right', 16));
  return { title: 'Welcome', body: [
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, 'Family Finance keeps your family\'s money in one Excel tracker in your own OneDrive. Pick how to start.'),
    card(null, null, h('ul', { class: 'list' },
      opt('startnew', 'plus', 'Start my family\'s tracker', 'First time: set up your family, then the app makes a new tracker in your OneDrive.', async () => { await saveDraft(Object.assign(d, { mode: 'new', step: 0 })); ctx.render(); }),
      opt('startjoin', 'sync', 'Join my family\'s tracker', 'Someone in your family already uses the app: open the link they shared with you.', async () => { await saveDraft(Object.assign(d, { mode: 'join' })); ctx.render(); }),
      opt('startdemo', 'chart', 'Look around first', 'Made-up figures on every screen. Nothing is saved to OneDrive.', () => ctx.loadSample()))),
    h('p', { class: 'hint', style: { margin: '8px 4px' } }, h('button', { class: 'link', id: 'startprivacy', onclick: () => ctx.go('privacy') }, 'Where your data goes'))] };
}

const STEPS = ['Your family', 'This phone', 'Plan basics', 'Sections', 'Create the tracker'];
function wizard(d) {
  const step = Math.min(d.step || 0, STEPS.length - 1);
  const head = h('div', { class: 'stack', style: { margin: '0 4px 10px' } }, h('div', { class: 'label-sm', id: 'wizstep' }, 'Step ' + (step + 1) + ' of ' + STEPS.length + ' · ' + STEPS[step]));
  const nav = (canBack, nextLabel, onNext, id = 'wiznext') => h('div', { class: 'btns', style: { marginTop: '12px' } },
    h('button', { class: 'btn', id: 'wizback', onclick: async () => { if (step === 0) { d.mode = null; } else d.step = step - 1; await saveDraft(d); ctx.render(); window.scrollTo(0, 0); } }, 'Back'),
    nextLabel ? h('button', { class: 'btn primary', id, onclick: onNext }, nextLabel) : null);
  const next = async () => { d.step = step + 1; await saveDraft(d); ctx.render(); window.scrollTo(0, 0); };
  let body;
  if (step === 0) {
    const list = d.names.length ? d.names.slice(0, P.MAX) : [''];
    const box = h('div');
    const draw = () => box.replaceChildren(...list.map((n, i) => field(i === 0 ? 'Your name' : 'Name ' + (i + 1), i === 0 ? 'The FIRE plan\'s dates follow this person.' : i === 1 ? 'Partner or the other earner (optional).' : 'Anyone else who logs spends, for example a parent or a grown-up child (optional).',
      inp('famname' + i, n, { maxlength: 20, 'aria-label': 'Name ' + (i + 1), autocapitalize: 'words', oninput: e => { list[i] = e.target.value; } }))),
      list.length < P.MAX ? h('button', { class: 'btn small', id: 'famadd', onclick: () => { list.push(''); draw(); setTimeout(() => { const x = document.getElementById('famname' + (list.length - 1)); if (x) x.focus(); }, 30); } }, icon('plus', 14), 'Add a name') : null);
    draw();
    body = [card('Who is in your family?', null, h('p', { class: 'hint', style: { marginTop: 0 } }, '1 to 5 names. The first two have their own money columns (accounts, investments, loans, retirement age); everyone can log spends. You can add names later.'), box,
      nav(true, 'Next', async () => {
        const names = list.map(P.tidy).filter(Boolean);
        if (!names.length) return toast('Type your name first', 'bad');
        for (let i = 0; i < names.length; i++) { const e = P.checkName(names[i], names.slice(0, i)); if (e) return toast(names[i] + ': ' + e, 'bad'); }
        d.names = names; if (!names.includes(d.me)) d.me = names[0]; await next();
      }))];
  } else if (step === 1) {
    const box = h('div');
    const draw = () => box.replaceChildren(h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Who uses this phone', style: { flexWrap: 'wrap' } }, d.names.map(n =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(n === d.me), class: n === d.me ? 'on' : '', onclick: () => { d.me = n; draw(); } }, n))));
    draw();
    body = [card('Who uses this phone?', null, h('p', { class: 'hint', style: { marginTop: 0 } }, 'Every spend and change made on this phone is tagged with this name.'), box, nav(true, 'Next', next))];
  } else if (step === 2) {
    const two = d.names.length > 1; const pl = d.plan = d.plan || {};
    const set = k => e => { pl[k] = e.target.value; };
    body = [card('Plan basics', null, h('p', { class: 'hint', style: { marginTop: 0 } }, 'For your early-retirement (FIRE) plan. Leave anything you are not sure of blank: you can fill it in later under More › FIRE & goals.'),
      field(d.names[0] + ': date of birth', null, inp('pldob', pl.dob, { type: 'date', 'aria-label': 'Date of birth', onchange: set('dob') })),
      field(d.names[0] + ': stop working at age', null, inp('plret1', pl.retire1, { inputmode: 'numeric', 'aria-label': 'Stop working at age', oninput: set('retire1') })),
      two ? field(d.names[1] + ': birth year', null, inp('plborn2', pl.born2, { inputmode: 'numeric', 'aria-label': d.names[1] + ' birth year', oninput: set('born2') })) : null,
      two ? field(d.names[1] + ': stop working at age', null, inp('plret2', pl.retire2, { inputmode: 'numeric', 'aria-label': d.names[1] + ' stop working at age', oninput: set('retire2') })) : null,
      field('Plan until ' + d.names[0] + '\'s age', 'How long the money must last.', inp('pluntil', pl.until, { inputmode: 'numeric', 'aria-label': 'Plan until age', oninput: set('until') })),
      field('Household spending now, per month (₹)', null, inp('plnow', pl.spendNow, { inputmode: 'numeric', 'aria-label': 'Household spending now', oninput: set('spendNow') })),
      field('Spending after retirement, per month (₹)', 'In today\'s money.', inp('plafter', pl.spendAfter, { inputmode: 'numeric', 'aria-label': 'Spending after retirement', oninput: set('spendAfter') })),
      nav(true, 'Next', async () => {
        for (const [k, lo, hi, what] of [['retire1', 18, 90, 'Stop working age'], ['retire2', 18, 90, 'Stop working age'], ['until', 50, 110, 'Plan until age'], ['born2', 1920, new Date().getFullYear(), 'Birth year']]) {
          const v = num(pl[k]); if (pl[k] && (v === null || v < lo || v > hi)) return toast(what + ': type a number from ' + lo + ' to ' + hi, 'bad'); }
        for (const k of ['spendNow', 'spendAfter']) if (pl[k] && num(pl[k]) === null) return toast('Type the amount as a number', 'bad');
        await next(); }))];
  } else if (step === 3) {
    body = [card('What will you use?', null, h('p', { class: 'hint', style: { marginTop: 0 } }, 'Turn off what your family does not need, so the screens stay short. This is for the whole family and can be changed any time (More › App › Sections).'),
      sectionList(id => d.sections[id] !== false, async id => { d.sections[id] = d.sections[id] === false; await saveDraft(d); ctx.render(); }), nav(true, 'Next', next))];
  } else {
    const acct = Auth.currentAccount();
    const busy = state.creating;
    body = [card('Create your tracker', null,
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'The app makes a new Excel tracker called "Family Finance Tracker" in your own OneDrive, with your family\'s names in it. Only you can see it until you share it.'),
      h('div', { class: 'kv', id: 'wizsum' }, h('span', {}, 'Family'), h('span', {}, d.names.join(', ')), h('span', {}, 'This phone'), h('span', {}, d.me),
        h('span', {}, 'Sections off'), h('span', {}, P.SECTIONS.filter(s => d.sections[s.id] === false).map(s => s.label).join(', ') || 'None')),
      h('div', { class: 'spacer' }),
      !Auth.configured() ? h('p', { class: 'warn-text' }, 'Microsoft sign-in is not available in this copy of the app.') : null,
      acct ? h('p', { class: 'hint', id: 'wizacct' }, 'Signed in as ' + (acct.username || acct.name) + '.') : h('p', { class: 'hint' }, 'First sign in with your Microsoft account (the one your OneDrive uses). You come back here after signing in.'),
      busy ? h('p', { id: 'wizbusy' }, state.creating) : null,
      h('div', { class: 'btns', style: { marginTop: '12px' } },
        h('button', { class: 'btn', id: 'wizback', disabled: busy || null, onclick: async () => { d.step = step - 1; await saveDraft(d); ctx.render(); } }, 'Back'),
        acct ? h('button', { class: 'btn primary', id: 'wizcreate', disabled: busy || null, onclick: () => createTracker(d) }, 'Create my tracker')
          : h('button', { class: 'btn primary', id: 'wizsignin', disabled: !Auth.configured() || null, onclick: () => Auth.signIn().then(() => ctx.render()).catch(e => toast(e.message, 'bad')) }, 'Sign in with Microsoft')))];
  }
  return { title: 'Set up your family', body: [head, ...body] };
}

// the new tracker: the shipped template in the family's own names, with what was typed at setup in Settings
export async function buildTracker(tplBytes, d, at = new Date().toISOString()) {
  const fam = (d.names || []).map(P.tidy).filter(Boolean); if (!fam.length) throw new Error('No names');
  const bytes = await P.personalise(tplBytes, P.nameMap(fam), { clean: true });
  const wb = await Workbook.open(bytes);
  const g = wb.grid('Settings'); const row = {};
  for (const [r, m] of g) { const b = m.get(2); if (typeof b === 'string' && b.trim()) row[b.trim()] = r; }
  const put = (label, v) => { if (v === null || v === undefined || v === '') return; const r = row[label]; if (!r) throw new Error('The tracker has no setting "' + label + '"'); wb.set('Settings', 'C' + r, v); };
  const L1 = fam[0], L2 = fam[1] || P.SLOT2, pl = d.plan || {};
  fam.forEach((n, i) => put('Family member ' + (i + 1) + ' name', n));
  put(L1 + "'s date of birth", pl.dob ? isoToSerial(pl.dob) : null);
  put(L1 + ' stops working at age', num(pl.retire1));
  if (fam[1]) { put(L2 + "'s birth year", num(pl.born2)); put(L2 + ' stops working at age', num(pl.retire2)); }
  put('Plan until ' + L1 + "'s age", num(pl.until));
  put('Plan starts (year)', Number(at.slice(0, 4)));
  put('Household now, per month (₹)', num(pl.spendNow));
  put('After retirement: living, per month (₹)', num(pl.spendAfter));
  for (const s of P.SECTIONS) if (d.sections && d.sections[s.id] === false) put(P.sectionLabel(s.id), 'No');
  wb.appendTableRow('tblAppMeta', { Key: 'created', Version: TEMPLATE.version, 'Updated at': at.replace('T', ' ').slice(0, 19), 'Updated by': 'Create my tracker' });
  return wb.save();
}
async function createTracker(d) {
  if (state.creating) return;
  state.creating = 'Making your tracker…'; ctx.render();
  try {
    const r = await fetch(TEMPLATE.path, { cache: 'no-store' }); if (!r.ok) throw new Error('Could not get the blank tracker (' + r.status + ').');
    const bytes = await buildTracker(new Uint8Array(await r.arrayBuffer()), d);
    state.creating = 'Saving it in your OneDrive…'; ctx.render();
    const f = await GraphFile.create({ base: CONFIG.graphBase, getToken: () => Auth.getToken(true), name: 'Family Finance Tracker.xlsx', bytes });
    await ctx.V.put('sync', 'file', f);
    await ctx.saveSettings({ deviceUser: d.me || d.names[0], setupDraft: null, startDone: new Date().toISOString(), family: d.names });
    state.creating = null; toast('Your tracker is ready: ' + f.name, 'good');
    ctx.go('home'); await ctx.doSync(true); state.setupDone = true; ctx.render();
  } catch (e) { state.creating = null; toast(e.message || String(e), 'bad'); ctx.render(); }
}

// join: sign in, open the link a family member shared, then pick your own name from the tracker
function joinView(d) {
  const acct = Auth.currentAccount(), file = ctx.V.get('sync', 'file'), s = ctx.snap();
  const back = h('button', { class: 'btn', id: 'joinback', onclick: async () => { d.mode = null; await saveDraft(d); ctx.render(); } }, 'Back');
  const body = [];
  if (!acct) body.push(card('Join your family\'s tracker', null, h('p', { class: 'hint', style: { marginTop: 0 } }, 'Sign in with your own Microsoft account. Then open the link your family member shared with you (OneDrive › Share › Can edit).'),
    h('div', { class: 'btns' }, back, h('button', { class: 'btn primary', id: 'joinsignin', disabled: !Auth.configured() || null, onclick: () => Auth.signIn().then(() => ctx.render()).catch(e => toast(e.message, 'bad')) }, 'Sign in with Microsoft'))));
  else if (!file) {
    const link = h('input', { class: 'field', id: 'sharelink', placeholder: 'Paste the OneDrive link to the tracker', 'aria-label': 'OneDrive link to the tracker', autocomplete: 'off' });
    body.push(card('Open the shared tracker', null, h('p', { class: 'hint', style: { marginTop: 0 } }, 'Signed in as ' + (acct.username || acct.name) + '. Paste the link your family member sent you.'), link,
      h('div', { class: 'btns', style: { marginTop: '10px' } }, back, h('button', { class: 'btn primary', id: 'joinconnect', onclick: async () => {
        try { const f = await GraphFile.fromShareLink({ base: CONFIG.graphBase, getToken: () => Auth.getToken(true), link: link.value }); await ctx.V.put('sync', 'file', f); toast('Connected to ' + f.name); await ctx.doSync(true); ctx.render(); }
        catch (e) { toast(e.message, 'bad'); } } }, 'Connect'))));
  } else if (!s) body.push(card(null, null, h('p', { class: 'hint' }, 'Connected to ' + file.name + '. Reading the tracker…'), h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: () => ctx.doSync(true) }, 'Sync now'))));
  else {
    const names = (s.people && s.people.names) || P.names();
    body.push(card('Which one are you?', null, h('p', { class: 'hint', style: { marginTop: 0 } }, 'Every spend and change made on this phone is tagged with this name.'),
      h('ul', { class: 'list', id: 'joinwho' }, names.map(n => h('li', { class: 'li tap', 'data-name': n, onclick: async () => {
        await ctx.saveSettings({ deviceUser: n, setupDraft: null, startDone: new Date().toISOString() }); toast('Welcome, ' + n, 'good'); ctx.go('home'); } },
        h('span', { class: 'lead av' }, P.initial(n)), h('div', { class: 'body' }, h('div', { class: 'ttl' }, n)), icon('right', 16))))));
  }
  return { title: 'Join your family', body };
}

// ---------------------------------------------------------------- S4: sections on / off (family-wide, in the tracker)
function sectionList(isOn, toggle) {
  return h('div', { id: 'seclist' }, P.SECTIONS.map(s => h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, s.label), h('div', { class: 'set-d' }, s.sub)),
    h('div', { class: 'set-c' }, sw(isOn(s.id), s.label, () => toggle(s.id), 'sec-' + s.id)))));
}
// what is waiting to sync wins over what the tracker said last
export function pendingSettings() { const m = new Map(); for (const op of ctx.V.all('outbox').filter(o => o.kind === 'setCells' && o.sheet === 'Settings').sort((a, b) => a.seq - b.seq)) for (const c of op.cells) m.set(c.ref, c.value); return m; }
export function sectionsNow() {
  const s = ctx.snap(); const cells = (s && s.settingCells) || {}; const pm = pendingSettings(); const out = {};
  for (const sec of P.SECTIONS) { const c = cells[P.sectionLabel(sec.id)]; if (!c) continue; const v = pm.has(c.ref) ? pm.get(c.ref) : c.v; out[sec.id] = !/^no$/i.test(String(v ?? '').trim()); }
  return out;
}
export function viewSections() {
  const s = ctx.snap(); const cells = (s && s.settingCells) || {};
  if (!s || !cells[P.sectionLabel('kite')]) return { title: 'Sections', back: 'tracker', body: [card(null, null, h('p', { class: 'hint' }, s ? 'Your tracker gets the sections switches with its update to v32, at the next sync.' : 'Sync with the tracker first.'))] };
  const now = sectionsNow();
  return { title: 'Sections', back: 'tracker', body: [
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, 'Hide what your family does not use. This is saved in the tracker, so it applies to everyone in the family. Nothing is deleted: turn a section back on to see it again.'),
    card(null, null, sectionList(id => now[id] !== false, async id => {
      const c = cells[P.sectionLabel(id)]; const off = now[id] !== false;
      await ctx.queue({ kind: 'setCells', sheet: 'Settings', cells: [{ ref: c.ref, base: c.v ?? null, value: off ? 'No' : 'Yes', label: P.sectionLabel(id) }], title: 'Sections · ' + P.SECTIONS.find(x => x.id === id).label + (off ? ' off' : ' on') });
      P.setSections(sectionsNow()); toast(P.SECTIONS.find(x => x.id === id).label + (off ? ' hidden' : ' shown') + ' for the whole family'); ctx.render();
    }))] };
}

// ---------------------------------------------------------------- names: see them, add more later (up to 5)
export function viewFamily() {
  const s = ctx.snap(); const cells = (s && s.settingCells) || {}; const pm = pendingSettings();
  const slots = [1, 2, 3, 4, 5].map(i => { const c = cells['Family member ' + i + ' name']; return c ? { i, ref: c.ref, base: c.v, v: pm.has(c.ref) ? pm.get(c.ref) : c.v } : null; }).filter(Boolean);
  if (!s || !slots.length) return { title: 'Family', back: 'tracker', body: [card(null, null, h('p', { class: 'hint' }, s ? 'Your tracker gets the family names with its update to v32, at the next sync.' : 'Sync with the tracker first.'))] };
  const have = slots.filter(x => x.v); const free = slots.find(x => !x.v);
  const renaming = ctx.V.all('outbox').some(o => o.kind === 'renameSlot2');
  const add = h('div');
  const openAdd = () => {
    const input = inp('famnew', '', { maxlength: 20, 'aria-label': 'New name', autocapitalize: 'words' });
    const holder = free && free.i === 2;
    const close = sheet('Add a name', h('p', { class: 'hint' }, holder ? 'This person gets the second money column (accounts, investments, loans, retirement age), which the tracker now shows as "' + P.SLOT2 + '".' : 'This person can log spends and own goals, policies and documents.'), input,
      h('div', { class: 'btns', style: { marginTop: '10px' } }, h('button', { class: 'btn primary', id: 'famsave', onclick: async () => {
        const n = P.tidy(input.value); const e = P.checkName(n, have.map(x => x.v)); if (e) return toast(e, 'bad');
        if (holder) await ctx.queue({ kind: 'renameSlot2', to: n, title: 'Family · ' + n + ' added' });
        await ctx.queue({ kind: 'setCells', sheet: 'Settings', cells: [{ ref: free.ref, base: free.base ?? null, value: n, label: 'Family member ' + free.i + ' name' }], title: 'Family · ' + n + ' added' });
        close(); toast(n + ' added. Everyone sees the name after the next sync.', 'good'); ctx.render(); } }, 'Add'), h('button', { class: 'btn', onclick: () => close() }, 'Cancel')));
    setTimeout(() => input.focus(), 50);
  };
  return { title: 'Family', back: 'tracker', body: [
    card('Names', null, h('ul', { class: 'list', id: 'famlist' }, have.map(x => h('li', { class: 'li' }, h('span', { class: 'lead av' + (x.i === 2 ? ' m' : x.i === 1 ? ' a' : '') }, P.initial(x.v)),
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, x.v), h('div', { class: 'sub' }, x.i <= 2 ? 'Own money columns' + (x.i === 1 ? ' · FIRE plan dates' : '') : 'Logs spends'))))),
      h('p', { class: 'hint' }, 'Names are set once, so past entries always match. ' + (free ? 'You can add ' + (6 - free.i) + ' more.' : 'The family has the most names the app holds (5).')),
      free && !renaming ? h('div', { class: 'btns' }, h('button', { class: 'btn', id: 'famaddbtn', onclick: openAdd }, icon('plus', 16), 'Add a name')) : null, add)] };
}

// ---------------------------------------------------------------- S8: a short guide
const GUIDE = [
  ['Getting started', ['One person starts the family\'s tracker (Welcome › Start my family\'s tracker). The app makes it in their OneDrive.',
    'To bring in others: in OneDrive, open "Family Finance Tracker", tap Share, choose "Can edit" and send them the link. On their phone they install the app and pick "Join my family\'s tracker".',
    'Each phone has its own PIN or passphrase. Nobody can recover it; if forgotten, the phone is reset and the data downloads again from OneDrive.']],
  ['Every day', ['Tap + to log a spend: amount, category, done. Switch to Income at the top for money coming in.', 'Tap the mic and say it, like "450 lunch UPI yesterday".', 'Swipe one of your entries right to edit it, or left to delete it.']],
  ['Once a month', ['More › Month-end update walks you through balances, holdings and loans in a few short steps.', 'Paste your Kite holdings and upload the CAS statement if you use them (More › Equity, More › Mutual funds).']],
  ['Wealth and FIRE', ['Wealth shows net worth, the mix of your money and your early-retirement (FIRE) plan.', 'The plan uses the ages and spending under More › FIRE & goals › FIRE assumptions. Every figure updates as soon as you change something.']],
  ['Sync and sign-in', ['The app works offline and syncs with the tracker every few minutes when online. Pull down from the top to sync now.', 'Microsoft asks about once a day to confirm the sign-in; the app does it when you unlock.']],
  ['Make it yours', ['More › App › Family: the names (add more later, up to 5).', 'More › App › Sections: hide what your family does not use.', 'Settings: lock, fingerprint, theme, text size.']],
];
export function viewGuide() {
  return { title: 'Guide', back: 'help', body: [
    ...GUIDE.map(([t, items], i) => card(t, null, h('ul', { class: 'steps-list', id: 'guide' + i }, items.map((x, k) => h('li', {}, h('span', { class: 'stepn' }, String(k + 1)), h('span', {}, x)))))),
    h('div', { class: 'btns' }, h('button', { class: 'btn', id: 'guidetour', onclick: () => { state.tourAt = 0; ctx.go('tour'); } }, 'Play the tour'))] };
}
export function viewTour() {
  const i = state.tourAt || 0;
  return tourView(n => { if (n === undefined) { state.tourAt = 0; ctx.go('help'); } else { state.tourAt = n; ctx.render(); } }, i);
}

// ---------------------------------------------------------------- S9: feedback to the app's maker
export function viewFeedback(appVersion) {
  const W = state.fb || (state.fb = { text: '', kind: 'Idea' });
  const ta = h('textarea', { class: 'field', id: 'fbtext', rows: 5, maxlength: 1500, placeholder: 'What would make the app better for you?', 'aria-label': 'Your feedback', oninput: e => { W.text = e.target.value; } }, W.text);
  const sent = h('p', { class: 'hint', id: 'fbsent', hidden: true }, 'Your email app should open with your message. If it does not, send it to ', h('span', { id: 'fbaddr' }), '.');
  const send = e => {
    if (!W.text.trim()) { e.preventDefault(); toast('Write your feedback first', 'bad'); ta.focus(); return; }
    const a = feedbackAddress(); const body = W.kind + ': ' + W.text.trim() + '\n\nApp version: ' + String(appVersion).split(' ')[0];
    btn.href = 'mailto:' + a + '?subject=' + encodeURIComponent('Family Finance: ' + W.kind.toLowerCase()) + '&body=' + encodeURIComponent(body);
    sent.hidden = false; sent.querySelector('#fbaddr').textContent = a;
  };
  const btn = h('a', { class: 'btn primary', id: 'fbsend', href: '#', role: 'button', onclick: send }, 'Send by email');
  const kinds = h('div'); const drawK = () => kinds.replaceChildren(h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Kind' }, ['Idea', 'Problem', 'Question'].map(k =>
    h('button', { type: 'button', role: 'radio', 'aria-checked': String(k === W.kind), class: k === W.kind ? 'on' : '', onclick: () => { W.kind = k; drawK(); } }, k)))); drawK();
  return { title: 'Send feedback', back: 'help', body: [card(null, null,
    h('p', { class: 'hint', style: { marginTop: 0 } }, 'Tell the person who makes this app what works and what does not. Only what you write here and the app version are sent: no amounts, no names, no tracker link.'),
    kinds, h('div', { class: 'spacer' }), ta, h('div', { class: 'btns', style: { marginTop: '10px' } }, btn), sent)] };
}
