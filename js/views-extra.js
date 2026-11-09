// Recurring fixed-amount entries (rent and the like). Nothing is logged until the person approves it.
// Templates live encrypted on this device (and in its backup); each belongs to the person using the device.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, card, empty, tag, sheet, catIcon, parseAmount, hasLongDigits, DIGITS_MSG } from './ui.js';
import { uuid } from './crypto.js';

const pad = n => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const dueDate = (ym, day) => { const [y, m] = ym.split('-').map(Number); const last = new Date(y, m, 0).getDate(); return ym + '-' + pad(Math.min(day, last)); };

export function templates() { return ctx.V.all('recurring').filter(t => !t.deleted).sort((a, b) => a.day - b.day); }
export function dueItems() {
  const who = ctx.who(); const out = []; const t0 = today(); const now = thisMonth();
  for (const t of templates()) {
    if (t.by !== who || t.paused) continue;
    for (let ym = t.start, i = 0; ym <= now && i < 24; ym = addMonths(ym, 1), i++) {
      const d = dueDate(ym, t.day); if (d > t0) break;
      if (!(t.handled || {})[ym]) out.push({ t, ym, date: d });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
async function mark(t, ym, what) { t.handled = Object.assign({}, t.handled, { [ym]: what }); await ctx.V.put('recurring', t.id, t); }
export async function approve(item, amount) {
  const { t, ym, date } = item;
  await ctx.queue({ kind: 'addExpense', entry: { id: uuid(), date, amount: Number(amount ?? t.amount), category: t.category, sub: t.sub || '', mode: t.mode || '', notes: t.name, by: ctx.who(), createdAt: new Date().toISOString() } });
  await mark(t, ym, 'added'); if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) { /* ignore */ }
  toast('Added ' + F.inr(amount ?? t.amount) + ' · ' + t.name);
}
export async function skip(item) { await mark(item.t, item.ym, 'skipped'); toast('Skipped ' + item.t.name + ' for ' + F.monthLabel(item.ym, true)); }

// Card for Home and Spend: one row per item waiting for approval.
export function dueCard() {
  const items = dueItems(); if (!items.length) return null;
  return h('section', { class: 'card alertcard', id: 'duecard' }, h('div', { class: 'card-h' }, h('h2', {}, 'Waiting for your approval'), tag(String(items.length), 'warn')),
    h('ul', { class: 'list' }, items.map(it => h('li', { class: 'li wrap' },
      h('span', { class: 'lead', 'aria-hidden': 'true' }, icon('calendar', 16)),
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, it.t.name + ' · ' + F.inr(it.t.amount)), h('div', { class: 'sub' }, 'Due ' + F.date(it.date) + ' · ' + it.t.category + (it.t.sub ? ' › ' + it.t.sub : ''))),
      h('div', { class: 'end btns tight' },
        h('button', { class: 'btn small', 'aria-label': 'Skip ' + it.t.name, onclick: async () => { await skip(it); ctx.render(); } }, 'Skip'),
        h('button', { class: 'btn primary small', 'aria-label': 'Add ' + it.t.name, onclick: async () => { await approve(it); ctx.render(); } }, 'Add'))))));
}

// Manage screen
export function viewRecurring() {
  const s = ctx.snap() || {}; const cats = s.categories || []; const subs = s.subcategories || {}; const modes = s.paymentModes || [];
  const who = ctx.who();
  if (!who) return { title: 'Recurring', back: 'spend', body: [card(null, null, empty('Choose who uses this device in Settings first.'))] };
  const E = state.recEdit;
  if (E) {
    const f = E; const field = (label, el) => h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, label)), h('div', { class: 'set-c' }, el));
    const inp = (k, attrs) => h('input', { class: 'field', value: f[k] ?? '', oninput: e => { f[k] = e.target.value; }, ...attrs });
    const sel = (k, opts, label) => h('select', { class: 'field', 'aria-label': label, onchange: e => { f[k] = e.target.value; if (k === 'category') { f.sub = ''; ctx.render(); } } }, h('option', { value: '' }, '—'), opts.map(o => h('option', { value: o, selected: f[k] === o }, o)));
    const save = async () => {
      const amount = parseAmount(f.amount); const day = Number(f.day);
      if (!String(f.name || '').trim()) return toast('Give it a name, like Rent', 'bad');
      if (hasLongDigits(f.name)) return toast(DIGITS_MSG, 'bad');
      if (!(amount > 0)) return toast('Type the amount', 'bad');
      if (!f.category) return toast('Pick a category', 'bad');
      if (!(day >= 1 && day <= 31)) return toast('Due day must be 1 to 31', 'bad');
      const t = { id: f.id || uuid(), name: f.name.trim().slice(0, 40), amount, category: f.category, sub: f.sub || '', mode: f.mode || '', day, by: who, start: f.start || thisMonth(), handled: f.handled || {}, paused: !!f.paused };
      if (!f.id) { // a new item never asks for months before it was set up, nor for this month if its day has passed
        if (dueDate(t.start, day) < today() && t.start === thisMonth() && !f.askThisMonth) t.handled[t.start] = 'before set-up';
      }
      await ctx.V.put('recurring', t.id, t); state.recEdit = null; toast('Saved'); ctx.render();
    };
    const isNew = !f.id; const passed = isNew && Number(f.day) && dueDate(thisMonth(), Number(f.day)) < today();
    return { title: isNew ? 'New recurring' : 'Edit recurring', back: 'recurring', body: [h('div', { style: { maxWidth: '640px' } }, h('section', { class: 'card' },
      field('Name', inp('name', { id: 'rname', placeholder: 'e.g. Rent', maxlength: 40, 'aria-label': 'Name' })),
      field('Amount (₹)', inp('amount', { id: 'ramount', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Amount', style: { maxWidth: '150px', textAlign: 'right' } })),
      field('Due day of the month', inp('day', { id: 'rday', inputmode: 'numeric', placeholder: '1-31', 'aria-label': 'Due day', style: { maxWidth: '90px', textAlign: 'right' }, onchange: () => ctx.render() })),
      field('Category', sel('category', cats, 'Category')),
      (subs[f.category] || []).length ? field('Sub-category', sel('sub', subs[f.category], 'Sub-category')) : null,
      modes.length ? field('Paid by', sel('mode', modes, 'Paid by')) : null,
      passed ? h('label', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, 'Also ask for this month'), h('div', { class: 'set-d' }, 'The due day has already passed this month.')), h('input', { type: 'checkbox', checked: !!f.askThisMonth, onchange: e => { f.askThisMonth = e.target.checked; } })) : null,
      !isNew ? h('label', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, 'Paused'), h('div', { class: 'set-d' }, 'Stops asking until you turn this off.')), h('input', { type: 'checkbox', checked: !!f.paused, onchange: e => { f.paused = e.target.checked; } })) : null),
      h('p', { class: 'hint', style: { margin: '10px 4px' } }, 'On the due day the app asks you on Home. Nothing is logged until you tap Add. Keep this for fixed amounts like rent; loan EMIs, insurance and investments are not expenses here.'),
      h('div', { class: 'sticky-save' }, !isNew ? h('button', { class: 'btn danger', style: { flex: 1 }, onclick: async () => { await ctx.V.put('recurring', f.id, Object.assign({}, f, { deleted: true })); state.recEdit = null; toast('Removed'); ctx.render(); } }, 'Remove') : null,
        h('button', { class: 'btn primary', style: { flex: 2 }, id: 'rsave', onclick: save }, 'Save')))] };
  }
  const list = templates();
  const mine = list.filter(t => t.by === who);
  return { title: 'Recurring', back: 'spend', body: [dueCard(), h('section', { class: 'card' }, mine.length ? h('ul', { class: 'list' }, mine.map(t => h('li', { class: 'li tap', onclick: () => { state.recEdit = Object.assign({}, t); ctx.render(); } },
      h('span', { class: 'lead', 'aria-hidden': 'true' }, String(t.day)),
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, t.name), h('div', { class: 'sub' }, 'Every month on day ' + t.day + ' · ' + t.category + (t.paused ? ' · paused' : ''))),
      h('div', { class: 'end num' }, F.inr(t.amount)), icon('right', 16)))) : empty('Nothing set up yet. Add rent or any other fixed monthly amount.')),
    h('button', { class: 'btn primary wide', id: 'radd', style: { marginTop: '12px' }, onclick: () => { state.recEdit = { start: thisMonth() }; ctx.render(); } }, icon('plus', 18), 'Add recurring'),
    h('p', { class: 'hint', style: { margin: '10px 4px' } }, 'Saved on this device and in its encrypted backup. Each person sets up their own.')] };
}

// ---- Streak: days in a row the app was opened on this device (missing a day starts again).
const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export function streakInfo(days) {
  const set = new Set(days || []); const d = new Date(); let n = 0;
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  let best = 0, run = 0, prev = null;
  for (const k of [...set].sort()) { const cur = new Date(k + 'T00:00:00'); run = prev && (cur - prev) / 86400000 === 1 ? run + 1 : 1; best = Math.max(best, run); prev = cur; }
  return { current: n, best };
}
const MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
export async function recordOpen() {
  const st = ctx.settings(); const k = dayKey(new Date()); const days = (st.openDays || []).slice(-400);
  if (days.includes(k)) return;
  days.push(k); const info = streakInfo(days); await ctx.saveSettings({ openDays: days });
  if (MILESTONES.includes(info.current)) setTimeout(() => toast(info.current + ' days in a row. Keep the habit going!'), 900);
}
export function streakChip() {
  const info = streakInfo(ctx.settings().openDays); if (!info.current) return null;
  const today = dayKey(new Date()); const logged = ctx.entriesView().some(e => e.date === today && e.by === ctx.who());
  return h('div', { class: 'streak', id: 'streak' }, h('span', { class: 'streak-n' }, icon('flame', 16), info.current + '-day streak'),
    h('span', { class: 'faint' }, info.best > info.current ? 'Best ' + info.best + ' · ' : '', logged ? 'Logged today ✓' : 'Nothing logged today yet'));
}

// ---- Shared activity feed: who added or changed what (from the daily entries both of you log).
export function activity(limit = 50) {
  const ev = [];
  for (const e of ctx.entriesView()) {
    const when = e.createdAt || (e.date ? e.date + 'T12:00:00' : '');
    const verb = e.status === 'Deleted' ? 'deleted' : e.pending ? 'added (not synced yet)' : 'added';
    ev.push({ e, who: e.by || 'Someone', verb, when: e.status === 'Deleted' && e.updatedAt ? e.updatedAt : when, changed: !!(e.updatedAt && e.createdAt && e.updatedAt > e.createdAt && e.status !== 'Deleted') });
  }
  return ev.filter(x => x.when).sort((a, b) => String(b.when).localeCompare(String(a.when))).slice(0, limit);
}
export function activityList(items) {
  const me = ctx.who(); const seen = ctx.settings().feedSeen || '';
  return h('ul', { class: 'list feed' }, items.map(x => h('li', { class: 'li wrap' },
    h('span', { class: 'lead av ' + (x.who === 'Madhu' ? 'm' : 'a'), 'aria-hidden': 'true' }, x.who[0]),
    h('div', { class: 'body' }, h('div', { class: 'ttl' }, (x.who === me ? 'You' : x.who) + ' ' + x.verb + ' ' + F.inr(x.e.amount) + ' · ' + x.e.category + (x.changed ? ' (edited)' : '')),
      h('div', { class: 'sub' }, [F.ago(x.when), x.e.sub, x.e.notes].filter(Boolean).join(' · '))),
    x.who !== me && seen && x.when > seen ? tag('NEW', 'good') : null)));
}
export function viewActivity() {
  const items = activity(80); setTimeout(() => ctx.saveSettings({ feedSeen: new Date().toISOString() }), 1500);
  return { title: 'Family activity', back: 'home', body: [h('section', { class: 'card' }, items.length ? activityList(items) : empty('Nothing logged yet.')),
    h('p', { class: 'hint', style: { margin: '10px 4px' } }, 'Everyone\'s daily entries, newest first. Month-end updates are listed in the tracker\'s Sync Log.')] };
}

// ---- One search for screens, settings, entries, holdings, policies and documents.
const PLACES = [
  ['Home', 'home', 'home', 'dashboard to do this month'], ['Money', 'spend', 'spend', 'spend spending expenses budget month income'], ['Add expense', 'addexpense', 'plus', 'new log'],
  ['Reports', 'reports', 'chart', 'trends month category person'], ['Wealth', 'wealth', 'wealth', 'net worth investments assets loans allocation'],
  ['Goals & FIRE', 'plan', 'plan', 'plan fire retirement goals emergency fund'], ['Insurance', 'protection', 'shield', 'policy cover renewal'],
  ['Documents', 'documents', 'doc', 'nominee will'], ['Checks', 'checks', 'alert', 'alerts health check attention safety net'],
  ['Month-end update', 'monthly', 'wizard', 'monthly saved invested balances net worth wizard'], ['Kite holdings', 'kite', 'upload', 'stocks equity demat paste accounts'],
  ['CAS statement', 'cas', 'doc', 'mutual funds folios cdsl pdf'], ['Income', 'income', 'g_coin', 'salary bonus dividend'], ['Year in review', 'year', 'chart', 'financial year fy annual'],
  ['Handover', 'handover', 'shield', 'contacts access accounts emergency'], ['Money lent', 'lent', 'hand', 'owes loan given follow up'], ['Events', 'events', 'c_tag', 'trip festival function'],
  ['New tracker version', 'move', 'upload', 'move new version migrate copy'],
  ['Recurring', 'recurring', 'calendar', 'rent fixed monthly approval'], ['Family activity', 'activity', 'spend', 'feed madhu aravind'],
  ['Settings', 'settings', 'gear', 'sync onedrive'], ['Help', 'help', 'info', 'tips'], ['How holdings are grouped', 'grouping', 'pie', 'investment types type rules'], ['Settings › Fingerprint', 'settings', 'finger', 'biometric unlock'],
  ['Settings › Lock timing', 'settings', 'lock', 'grace auto lock pin'], ['Settings › Hide amounts', 'settings', 'eye', 'privacy mode'],
  ['Settings › Theme and text size', 'settings', 'gear', 'dark light font'], ['Settings › Backup', 'settings', 'gear', 'export import restore'],
];
export function openSearch() {
  const input = h('input', { class: 'field', type: 'search', id: 'cmdq', placeholder: 'Search screens, settings, entries…', 'aria-label': 'Search everything', autocomplete: 'off' });
  const out = h('div', { class: 'cmd-results', 'aria-live': 'polite' });
  let close;
  const goTo = (view, fn) => { close(); if (fn) fn(); ctx.go(view); };
  const draw = () => {
    const q = input.value.trim().toLowerCase(); const s = ctx.snap() || {};
    if (!q) { out.replaceChildren(h('p', { class: 'hint' }, 'Try: rent, food 450, fingerprint, term plan, flexi')); return; }
    const words = q.split(/\s+/); const hit = txt => words.every(w => txt.toLowerCase().includes(w));
    const groups = [];
    const pl = PLACES.filter(p => hit(p[0] + ' ' + p[3])).slice(0, 6);
    if (pl.length) groups.push(['Screens and settings', pl.map(p => h('li', { class: 'li tap', onclick: () => goTo(p[1]) }, h('span', { class: 'lead' }, icon(p[2], 16)), h('div', { class: 'body' }, h('div', { class: 'ttl' }, p[0])), icon('right', 16)))]);
    const en = ctx.entriesView().filter(e => e.status !== 'Deleted' && hit([e.category, e.sub, e.notes, e.mode, e.by, e.amount, F.date(e.date)].join(' '))).slice(0, 8);
    if (en.length) groups.push(['Expenses', en.map(e => h('li', { class: 'li tap', onclick: () => goTo('spend', () => { state.spendMonth = e.date.slice(0, 7); state.spendQ = input.value.trim(); state.spendCat = ''; }) },
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, e.category + (e.sub ? ' · ' + e.sub : '')), h('div', { class: 'sub' }, [F.date(e.date), e.by, e.notes].filter(Boolean).join(' · '))), h('div', { class: 'end num' }, F.inr(e.amount))))]);
    const ho = [...(s.holdings || []), ...(s.otherHoldings || [])].filter(x => x && x.name && hit(x.name + ' ' + (x.owner || '') + ' ' + (x.platform || x.type || ''))).slice(0, 5);
    if (ho.length) groups.push(['Holdings', ho.map(x => h('li', { class: 'li tap', onclick: () => goTo('wealth', () => { state.tab.wealth = 'invest'; }) }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, x.name), h('div', { class: 'sub' }, [x.owner, x.platform || x.type].filter(Boolean).join(' · '))), h('div', { class: 'end num' }, F.inrShort(x.value ?? x.current))))]);
    const ins = (s.insurance || []).filter(x => x.name && hit(x.name + ' ' + (x.type || '') + ' ' + (x.insurer || ''))).slice(0, 4);
    if (ins.length) groups.push(['Insurance', ins.map(x => h('li', { class: 'li tap', onclick: () => goTo('protection') }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, x.name), h('div', { class: 'sub' }, x.renewal ? 'renews ' + F.date(x.renewal) : '')), icon('right', 16)))]);
    const docs = (s.documents || []).filter(x => x.name && hit(x.name + ' ' + (x.owner || '') + ' ' + (x.where || ''))).slice(0, 4);
    if (docs.length) groups.push(['Documents', docs.map(x => h('li', { class: 'li tap', onclick: () => goTo('documents') }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, x.name), h('div', { class: 'sub' }, [x.owner, x.where].filter(Boolean).join(' · '))), icon('right', 16)))]);
    out.replaceChildren(...(groups.length ? groups.map(([g, items]) => h('div', {}, h('div', { class: 'label-sm' }, g), h('ul', { class: 'list' }, items))) : [h('p', { class: 'hint' }, 'Nothing found for "' + input.value.trim() + '".')]));
  };
  input.addEventListener('input', draw);
  close = sheet('Search', input, h('div', { class: 'spacer' }), out); draw(); setTimeout(() => input.focus(), 50);
}
