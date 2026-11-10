// Home (dashboard), Spend and Add expense.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, haptic, sheet, miniSpark, catIcon, catColor, seg, tag, bar, card, moreBtn, empty, statusKind, statusIcon, trendChart, donut, ring, SERIES } from './ui.js';
import { uuid } from './crypto.js';
import { CONFIG } from './config.js';
import { streakChip, activity, activityList, dueItems, approve, skip } from './views-extra.js';
import { recapCard, openStory, openRecap, hasRecap, recapMonth } from './views-insight.js';
import * as C2 from './views-c2.js';
import { addSwitch, forPill, incomeList, viewIncome, micButton, amountRow, voiceSummary, parseVoice } from './views-income.js';
import { swipeable, parseAmount, hasLongDigits, DIGITS_MSG, confirmAmount } from './ui.js';
import { handoverItem } from './views-handover.js';

const PEOPLE = ['Family', 'Aravind', 'Madhu'];
const key = p => (p === 'Family' ? 'family' : p.toLowerCase());
const thisMonth = () => new Date().toISOString().slice(0, 7);
const isoToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// one person's latest month with income: income typed in the app vs what was spent for that person
function personLeft(s, p) {
  const inc = {}; for (const e of s.income || []) if (e.status !== 'Deleted' && e.person === p) inc[e.month] = (inc[e.month] || 0) + (Number(e.amount) || 0);
  const now = new Date().toISOString().slice(0, 7); const months = Object.keys(inc).filter(m => m < now && inc[m] > 0).sort(); const m = months.pop(); if (!m) return null;
  const spent = ctx.entriesView().filter(e => e.status !== 'Deleted' && e.by === p && String(e.date).startsWith(m)).reduce((t, e) => t + (Number(e.amount) || 0), 0);
  return { month: m + '-01', income: inc[m], spent, rate: (inc[m] - spent) / inc[m] };
}
export function personSeg(onChange) { return seg(PEOPLE, state.person, p => { state.person = p; (onChange || ctx.render)(); }, 'Person'); }
export function asOfLine(s) {
  return h('p', { class: 'asof' }, s.sample ? tag('SAMPLE DATA', 'sample') : null, ' As of last sync' + (s.asOf ? ' · tracker saved ' + F.date(s.asOf) : ''),
    s.provisional ? [' ', tag('PROVISIONAL', 'prov')] : null);
}
export function trendPoints(s, person) {
  const k = person === 'Family' ? 'nwF' : person === 'Aravind' ? 'nwA' : 'nwM';
  return (s.monthly || []).filter(r => typeof r[k] === 'number').slice(-12).map(r => ({ x: F.monthLabel(r.month), y: r[k] }));
}
function monthEntries(ym, who) { return ctx.entriesView().filter(e => (e.date || '').startsWith(ym) && (!who || who === 'All' || e.by === who)); }
const sum = (a, f) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);

// ---- budget alerts (shown on the Spend screen only, never as phone notifications)
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const byCategory = list => { const o = {}; for (const e of list) o[e.category] = (o[e.category] || 0) + Number(e.amount || 0); return o; };
export function budgetAlerts(ym, byCat, budgets, spent, projected) {
  const out = []; const isNow = ym === thisMonth(); const day = new Date().getDate(); const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();
  const total = Object.values(budgets).reduce((a, b) => a + (Number(b) || 0), 0);
  for (const [c, b] of Object.entries(budgets)) {
    if (!b) continue; const sp = byCat[c] || 0; const f = sp / b;
    if (f > 1) out.push({ kind: 'crit', rank: 3 + f, text: c + ': ' + F.inr(sp - b) + ' over its ' + F.inr(b) + ' budget' });
    else if (f >= 0.85) out.push({ kind: 'warn', rank: 2 + f, text: c + ': ' + F.pct(f, 0) + ' used, ' + F.inr(b - sp) + ' left' });
    else if (isNow && day >= 7 && sp / day * dim > b * 1.05) out.push({ kind: 'warn', rank: 1 + f, text: c + ': at this pace about ' + F.inr(sp / day * dim) + ' by month end, above the ' + F.inr(b) + ' budget' });
  }
  if (total && projected && spent <= total && projected > total * 1.05) out.push({ kind: 'warn', rank: 5, text: 'Whole month: at this pace about ' + F.inr(projected) + ', above the ' + F.inr(total) + ' budget' });
  return out.sort((a, b) => b.rank - a.rank);
}
// ---- insights: this month against the average of up to 3 earlier months that have entries
export function spendInsights(ym, whoF) {
  const cur = monthEntries(ym, whoF); if (!cur.length) return [];
  const prev = [1, 2, 3].map(n => monthEntries(addMonths(ym, -n), whoF)).filter(l => l.length);
  if (!prev.length) return [];
  const isNow = ym === thisMonth(); const day = new Date().getDate(); const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();
  const scale = isNow ? day / dim : 1; // compare like for like: earlier months cut to the same share of the month
  const now = byCategory(cur); const avg = {};
  for (const l of prev) for (const [c, v] of Object.entries(byCategory(l))) avg[c] = (avg[c] || 0) + v / prev.length;
  const span = prev.length === 1 ? 'last month' : 'your ' + prev.length + '-month average';
  const out = [];
  for (const c of new Set([...Object.keys(now), ...Object.keys(avg)])) {
    const a = (avg[c] || 0) * scale, n = now[c] || 0; if (a < 500 && n < 500) continue;
    const d = a ? (n - a) / a : null;
    if (d !== null && Math.abs(d) >= 0.2 && Math.abs(n - a) >= 500) out.push({ up: d > 0, size: Math.abs(n - a), text: c + ' is ' + F.pct(Math.abs(d), 0) + (d > 0 ? ' higher' : ' lower') + ' than ' + span + (isNow ? ' at this point of the month' : '') + ' (' + F.inr(n) + ' vs ' + F.inr(a) + ')' });
    else if (!a && n >= 1000) out.push({ up: true, size: n, text: c + ': ' + F.inr(n) + ' this month, nothing in the months before' });
  }
  const tn = cur.reduce((s, e) => s + Number(e.amount || 0), 0), ta = Object.values(avg).reduce((s, v) => s + v, 0) * scale;
  if (ta && Math.abs(tn - ta) / ta >= 0.1) out.unshift({ up: tn > ta, size: Infinity, text: 'Overall spending is ' + F.pct(Math.abs(tn - ta) / ta, 0) + (tn > ta ? ' higher' : ' lower') + ' than ' + span + (isNow ? ' at this point of the month' : '') });
  const days = {}; for (const e of cur) days[e.date] = (days[e.date] || 0) + Number(e.amount || 0);
  const big = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
  const res = out.sort((a, b) => b.size - a.size).slice(0, 4);
  if (big && cur.length >= 5) res.push({ up: null, text: 'Biggest day: ' + F.date(big[0]) + ', ' + F.inr(big[1]) });
  return res;
}

// ---------------------------------------------------------------- Home
// Grey placeholders while the first download from OneDrive is running.
export function skeleton() {
  const bar = w => h('div', { class: 'sk', style: { width: w } });
  return h('div', { class: 'skeleton', 'aria-busy': 'true', 'aria-label': 'Loading your figures' },
    h('div', { class: 'sk hero' }), h('div', { class: 'grid tiles' }, [1, 2, 3, 4].map(() => h('div', { class: 'card' }, bar('50%'), bar('70%'), bar('40%')))),
    h('div', { class: 'card' }, bar('35%'), bar('90%'), bar('80%'), bar('85%')));
}
export function viewHome() {
  const s = ctx.snap();
  if (!s && (state.syncing || (ctx.V.get('sync', 'file') && navigator.onLine && !(ctx.V.get('sync', 'state') || {}).lastError))) return { title: 'Home', body: [skeleton()] };
  if (!s) return { title: 'Home', body: [card('Welcome', null, h('p', {}, 'Your figures appear here after the first sync with the tracker in OneDrive.'), h('div', { class: 'spacer' }),
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: () => { state.topic = 'app'; ctx.go('signin'); } }, 'Connect the tracker'), h('button', { class: 'btn', onclick: () => ctx.go('settings') }, 'Try with sample data')))] };
  const p = state.person;
  const ym = thisMonth(); const mine = monthEntries(ym, p === 'Family' ? 'All' : p);
  const spent = sum(mine, e => e.amount); const budget = p === 'Family' ? sum(Object.values(C2.availableBudgets(ym)), x => x) : 0;
  const frac = budget ? spent / budget : 0; const spentKind = budget ? (frac > 1 ? 'crit' : frac > 0.85 ? 'warn' : 'good') : '';
  const income = incomeList().filter(e => e.status !== 'Deleted' && (e.month || '') === ym && (p === 'Family' || e.person === p)).reduce((t, e) => t + (Number(e.amount) || 0), 0);
  const left = income - spent;
  const monthCard = h('section', { class: 'card monthcard-home', id: 'monthsofar' },
    h('div', { class: 'card-h' }, h('h2', {}, F.MONTHS[new Date().getMonth()] + ' so far' + (p === 'Family' ? '' : ' · ' + p)), h('button', { class: 'more', onclick: () => ctx.go('spend') }, 'Money', icon('right', 16))),
    h('div', { class: 'kv3' },
      h('div', {}, h('div', { class: 't-l' }, 'Spent'), h('div', { class: 't-v num', id: 'homespent' }, F.inr(spent)), h('div', { class: 't-s' }, budget ? 'of ' + F.inr(budget) + ' budget' : (p === 'Family' ? 'No budget set' : 'Logged for ' + p))),
      h('div', {}, h('div', { class: 't-l' }, 'Income received'), h('div', { class: 't-v num', id: 'homeincome' }, F.inr(income)), h('div', { class: 't-s' }, income ? 'this month' : 'None added yet')),
      h('div', {}, h('div', { class: 't-l' }, 'Balance'), h('div', { class: 't-v num', id: 'homeleft' }, income ? F.inr(left) : '–'), h('div', { class: 't-s' }, income ? F.pct(left / income, 0) + ' of income' : 'Add income to see this'))),
    budget ? bar(frac, spentKind) : null);
  const addBtns = h('div', { class: 'btns addrow', id: 'homeadd' },
    h('button', { class: 'btn primary', id: 'homeaddexp', onclick: () => { state.editing = null; ctx.go('addexpense'); } }, icon('plus', 18), 'Add expense'),
    h('button', { class: 'btn', id: 'homeaddinc', onclick: () => { state.editing = null; ctx.go('addincome'); } }, icon('plus', 18), 'Add income'));
  const recent = activity(2);
  const recentCard = card('Recent entries', moreBtn('All', () => ctx.go('activity')), recent.length ? activityList(recent) : empty('Nothing logged yet.', 'Add expense', () => ctx.go('addexpense')));
  return { title: 'Home', body: [h('div', { class: 'toolbar' }, personSeg()), monthCard, addBtns, todoCard(s), recapHome(ym, p), paceCard(ym, p), budgetsNearCard(ym, p), recentCard, streakChip()] };
}

// ---- Home tiles (0.12.0): recap one tap away, spending pace, budgets near their limit
function recapHome(ym, p) {
  const whoF = p === 'Family' ? 'All' : p; const ins = spendInsights(ym, whoF); const lm = recapMonth();
  const rows = [];
  rows.push(h('li', { class: 'li tap', id: 'homerecapnow', onclick: () => openStory([...ins.map((x, i) => ({ k: 'Insight ' + (i + 1) + ' of ' + ins.length, sub: F.maskText(x.text) })), { k: F.monthLabel(ym, true), big: 'That\'s all', sub: 'Insights compare this month with the months before.' }], 'This month so far', 'insightstory', 'Close') },
    h('span', { class: 'lead', 'aria-hidden': 'true' }, icon('chart', 16)), h('div', { class: 'body' }, h('div', { class: 'ttl' }, F.MONTHS[new Date().getMonth()] + ' so far'), h('div', { class: 'sub' }, ins.length ? F.maskText(ins[0].text) : 'No insights yet this month')), icon('right', 16)));
  if (hasRecap(lm)) rows.push(h('li', { class: 'li tap', id: 'homerecaplast', onclick: () => { openRecap(lm); ctx.render(); } },
    h('span', { class: 'lead', 'aria-hidden': 'true' }, icon('play', 16)), h('div', { class: 'body' }, h('div', { class: 'ttl' }, F.monthLabel(lm, true) + ' recap'), h('div', { class: 'sub' }, 'Last month in a few cards')), icon('right', 16)));
  if (!ins.length && rows.length === 1) return null;
  return h('section', { class: 'card', id: 'homerecap' }, h('div', { class: 'card-h' }, h('h2', {}, 'Recap')), h('ul', { class: 'list' }, rows));
}
// spent so far this month against the same days of last month
function paceCard(ym, p) {
  const who = p === 'Family' ? 'All' : p; const day = new Date().getDate(); const lm = addMonths(ym, -1);
  const now = sum(monthEntries(ym, who), e => e.amount);
  const lastSame = sum(monthEntries(lm, who).filter(e => Number((e.date || '').slice(8, 10)) <= day), e => e.amount);
  const lastAll = sum(monthEntries(lm, who), e => e.amount);
  if (!now && !lastAll) return null;
  const max = Math.max(now, lastSame, 1); const diff = lastSame ? (now - lastSame) / lastSame : null;
  const line = (lbl, v, cls) => h('div', { class: 'pace-row' }, h('div', { class: 'row-between' }, h('span', { class: 'hint' }, lbl), h('span', { class: 'num strong' }, F.inr(v))), bar(v / max, cls));
  return h('section', { class: 'card', id: 'homepace' }, h('div', { class: 'card-h' }, h('h2', {}, 'Spending pace'), diff === null ? null : tag((diff > 0 ? '+' : '') + F.pct(diff, 0) + ' vs last month', diff > 0.1 ? 'warn' : 'good')),
    line('This month, day 1 to ' + day, now, diff !== null && diff > 0.1 ? 'warn' : 'good'), line(F.monthLabel(lm, true) + ', day 1 to ' + day, lastSame, ''),
    h('p', { class: 'hint', style: { marginTop: '6px' } }, F.monthLabel(lm, true) + ' in full: ' + F.inr(lastAll)));
}
// the 3 category budgets closest to (or over) their limit
function budgetsNearCard(ym, p) {
  if (p !== 'Family') return null;
  const bd = C2.budgetsFor(ym); const all = monthEntries(ym, 'All'); const byCat = {}; for (const e of all) byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount);
  const rows = Object.entries(bd).map(([c, x]) => ({ c, b: x.avail, sp: byCat[c] || 0 })).filter(x => x.b > 0 && x.sp > 0).map(x => ({ ...x, f: x.sp / x.b })).sort((a, b) => b.f - a.f).slice(0, 3);
  if (!rows.length) return null;
  return h('section', { class: 'card', id: 'homebudgets' }, h('div', { class: 'card-h' }, h('h2', {}, 'Budgets near their limit'), h('button', { class: 'more', onclick: () => C2.budgetEditor() }, 'Budgets', icon('right', 16))),
    rows.map(x => { const k = x.f > 1 ? 'crit' : x.f > 0.85 ? 'warn' : 'good';
      return h('div', { class: 'hbar' }, h('span', { class: 'ttl' }, x.c, x.f > 1 ? [' ', tag('Over', 'crit')] : null), h('span', { class: 'num' }, F.inr(x.sp), h('span', { class: 'faint' }, ' / ' + F.inr(x.b))), bar(x.f, k)); }));
}

// ---- To do: shown only when something needs doing
function todoItems(s) {
  const out = []; const day = new Date().getDate(); const ym = thisMonth();
  for (const it of dueItems()) out.push({ icon: 'calendar', t: it.t.name + ' · ' + F.inr(it.t.amount), sub: 'Recurring, due ' + F.date(it.date) + ' · ' + it.t.category + (it.t.sub ? ' › ' + it.t.sub : ''),
    btns: [h('button', { class: 'btn small', 'aria-label': 'Skip ' + it.t.name, onclick: async () => { await skip(it); ctx.render(); } }, 'Skip'),
      h('button', { class: 'btn primary small', 'aria-label': 'Add ' + it.t.name, onclick: async () => { await approve(it); ctx.render(); } }, 'Add')] });
  for (const l of C2.followUps().slice(0, 3)) out.push({ icon: 'hand', id: 'followups', t: 'Ask ' + l.borrower + ' for ' + F.inr(l.outstanding), sub: 'Lent by ' + l.by + ' on ' + F.date(l.date) + ' · follow up was ' + F.date(l.followUp), go: 'lent' });
  { const bd = C2.budgetsFor(ym); const budgets = Object.fromEntries(Object.entries(bd).map(([c, x]) => [c, x.avail])); const all = monthEntries(ym, 'All'); const spent = sum(all, e => e.amount);
    const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate(); const projected = day > 3 ? spent / day * dim : null;
    const al = budgetAlerts(ym, byCategory(all), budgets, spent, projected);
    if (al.length) out.push({ icon: 'chart', id: 'budgetalerts', kind: al.some(a => a.kind === 'crit') ? 'crit' : 'warn', t: al.length === 1 ? 'Budget running ahead' : al.length + ' budgets running ahead', sub: al[0].text, go: 'spend' }); }
  const renew = (s.insurance || []).filter(x => x.days !== null && x.days !== undefined && x.days >= 0 && x.days <= 30);
  for (const x of renew) out.push({ icon: 'shield', t: x.name + ' renews in ' + x.days + ' days', sub: x.renewal ? 'On ' + F.date(x.renewal) : '', go: 'protection' });
  if (day <= 5 && !monthClosed(s, addMonths(ym, -1))) out.push({ icon: 'wizard', id: 'monthenddue', t: 'Month-end update for ' + F.monthLabel(addMonths(ym, -1), true), sub: 'Holdings, saved & invested, balances and net worth', go: 'monthly' });
  const ho = handoverItem(); if (ho) out.push(ho);
  const st = ctx.V.get('sync', 'state') || {}; if (st.lastError && !CONFIGDEMO()) out.push({ icon: 'sync', id: 'syncproblem', kind: 'crit', t: 'Sync problem', sub: String(st.lastError).slice(0, 120), go: 'signin' });
  return out;
}
const CONFIGDEMO = () => !!CONFIG.demo;
export function monthClosed(s, ym) {
  const inp = s && s.inputs; if (!inp || !inp.monthly) return true;
  const r = inp.monthly.find(x => (x.month || '').startsWith(ym)); if (!r) return true;
  return ['nwA', 'nwM'].some(k => r.cols[k] && r.cols[k].v !== null && r.cols[k].v !== undefined && r.cols[k].v !== '');
}
function todoCard(s) {
  const items = todoItems(s); if (!items.length) return null;
  return h('section', { class: 'card', id: 'todo' }, h('div', { class: 'card-h' }, h('h2', {}, 'To do'), tag(String(items.length), items.some(i => i.kind === 'crit') ? 'crit' : 'warn')),
    h('ul', { class: 'list', id: 'duecard' }, items.map(it => h('li', { class: 'li wrap' + (it.go ? ' tap' : ''), id: it.id || null, onclick: it.go ? () => ctx.go(it.go) : null },
      h('span', { class: 'lead', 'aria-hidden': 'true' }, icon(it.icon || 'info', 16)),
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, it.t), it.sub ? h('div', { class: 'sub' }, it.sub) : null),
      it.btns ? h('div', { class: 'end btns tight' }, ...it.btns) : icon('right', 16)))));
}

function entryLi(e) {
  const mine = (e.enteredBy || e.by) === ctx.who(); const li = h('li', { class: 'li tap' + (mine ? ' swipe' : ''), onclick: () => { if (!li.dataset.swiped) entrySheet(e); } }, catIcon(e.category),
    h('div', { class: 'body' }, h('div', { class: 'ttl' }, e.category + (e.sub ? ' · ' + e.sub : '')), h('div', { class: 'sub' }, [F.date(e.date), e.by + (e.enteredBy && e.enteredBy !== e.by ? ' (entered by ' + e.enteredBy + ')' : ''), e.event ? '# ' + e.event : null, e.mode, e.notes].filter(Boolean).join(' · '))),
    h('div', { class: 'end num' }, F.inr(e.amount), e.pending ? h('div', {}, tag('NOT SYNCED', 'prov')) : null));
  if (mine) swipeable(li, () => { state.editing = e; ctx.go('addexpense'); }, () => delEntry(e));
  return li;
}
function entrySheet(e) {
  const mine = (e.enteredBy || e.by) === ctx.who();
  const close = sheet(e.category + (e.sub ? ' · ' + e.sub : ''),
    h('div', { class: 'kv' }, h('span', {}, 'Amount'), h('span', {}, F.inr(e.amount)), h('span', {}, 'Date'), h('span', {}, F.date(e.date)), h('span', {}, 'Whose'), h('span', {}, e.by || '–'), e.enteredBy && e.enteredBy !== e.by ? [h('span', {}, 'Entered by'), h('span', {}, e.enteredBy)] : null,
      h('span', {}, 'Payment mode'), h('span', {}, e.mode || '–'), h('span', {}, 'Note'), h('span', {}, e.notes || '–'), h('span', {}, 'Status'), h('span', {}, e.pending ? 'Waiting to sync' : 'In the tracker')),
    h('div', { class: 'spacer' }),
    mine ? h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: () => { close(); state.editing = e; ctx.go('addexpense'); } }, icon('edit', 18), 'Edit'),
      h('button', { class: 'btn danger', onclick: async () => { close(); await delEntry(e); } }, icon('trash', 18), 'Delete'))
      : h('p', { class: 'hint' }, 'Only ' + (e.enteredBy || e.by) + ' can change or delete this entry, as they entered it.'));
}
async function delEntry(e) {
  const V = ctx.V; let undo;
  if (e.pending && e.version === 0) { const op = V.all('outbox').find(o => o.kind === 'addExpense' && o.entry.id === e.id); if (op) { await V.remove('outbox', op.opId); undo = async () => { await V.put('outbox', op.opId, op); }; } }
  else { const op = { kind: 'deleteExpense', id: e.id, baseVersion: e.version, base: ctx.baseOf(e) }; await ctx.queue(op); undo = async () => { if (!V.get('outbox', op.opId)) return toast('Already synced. Add it again if needed.', 'bad'); await V.remove('outbox', op.opId); }; }
  ctx.scheduleSync(7000); haptic();
  toast('Deleted ' + F.inr(e.amount) + ' · ' + e.category, 'info', undo ? { label: 'Undo', fn: async () => { await undo(); toast('Restored'); ctx.render(); } } : null); ctx.render();
}

// ---------------------------------------------------------------- Spend
export function moneySwitch() { return h('div', { class: 'toolbar', id: 'moneyswitch' }, seg([['spending', 'Spending'], ['income', 'Income']], state.moneyTab || 'spending', v => { state.moneyTab = v; window.scrollTo(0, 0); ctx.render(); }, 'Spending or income')); }
export function viewSpend() {
  if (state.moneyTab === 'income') { const r = viewIncome(); return { title: 'Money', body: [moneySwitch(), ...r.body] }; }
  const s = ctx.snap() || {};
  const ym = state.spendMonth || thisMonth(); const whoF = state.spendWho || 'All'; const catF = state.spendCat || ''; const q = (state.spendQ || '').toLowerCase();
  const shift = n => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); state.spendMonth = d.toISOString().slice(0, 7); state.spendCat = ''; ctx.render(); };
  const all = monthEntries(ym, whoF);
  const spent = sum(all, e => e.amount);
  const bdet = C2.budgetsFor(ym); const budgets = Object.fromEntries(Object.entries(bdet).map(([c, x]) => [c, x.avail])); const budget = whoF === 'All' ? sum(Object.values(budgets), x => x) : 0;
  const carried = sum(Object.values(bdet), x => x.carry); const evF = state.spendEvent || '';
  const anyPending = all.some(e => e.pending);
  const isNow = ym === thisMonth(); const day = new Date().getDate(); const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();
  const projected = isNow && day > 3 ? spent / day * dim : null;
  const frac = budget ? spent / budget : 0; const kind = !budget ? 'good' : frac > 1 ? 'crit' : frac > 0.85 ? 'warn' : 'good';

  const head = h('div', { class: 'toolbar' },
    h('div', { class: 'row-between', style: { flex: '1 1 220px' } }, h('button', { class: 'iconbtn', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('left')), h('h2', { id: 'spendmonth' }, F.monthLabel(ym, true)),
      h('button', { class: 'iconbtn', 'aria-label': 'Next month', disabled: isNow || null, onclick: () => shift(1) }, icon('right'))),
    seg([['All', 'Family'], 'Aravind', 'Madhu'], whoF, v => { state.spendWho = v; ctx.render(); }, 'Whose spending'));
  const tools = h('div', { class: 'btnrow', id: 'moneytools' },
    h('button', { class: 'btn', id: 'reportsbtn', onclick: () => ctx.go('reports') }, icon('chart', 16), 'Reports'),
    h('button', { class: 'btn', id: 'budgetsbtn', onclick: () => C2.budgetEditor() }, icon('pie', 16), 'Budgets'),
    h('button', { class: 'btn', id: 'recurringbtn', onclick: () => ctx.go('recurring') }, icon('sync', 16), 'Recurring'),
    h('button', { class: 'btn', id: 'eventsbtn', onclick: () => ctx.go('events') }, icon('calendar', 16), 'Events'));

  const summary = h('section', { class: 'card' }, h('div', { class: 'row-between' },
    h('div', {}, h('p', { class: 'hint' }, 'Spent' + (whoF !== 'All' ? ' for ' + whoF : '')), h('p', { class: 'num', style: { fontSize: '1.7rem', fontWeight: 800 } }, F.inr(spent)),
      budget ? h('p', { class: 'hint' }, (spent <= budget ? F.inr(budget - spent) + ' left of ' : F.inr(spent - budget) + ' over ') + F.inr(budget) + (carried ? ' (incl. ' + (carried > 0 ? '+' : '−') + F.inr(Math.abs(carried)) + ' carried)' : '')) : h('p', { class: 'hint' }, whoF === 'All' ? 'No budgets yet. Tap Budgets below to set them.' : 'Budgets are for the family total.'),
      projected ? h('p', { class: 'hint' }, 'At this pace: about ' + F.inr(projected) + ' by month end (estimate)') : null),
    budget ? h('div', { style: { textAlign: 'center' } }, ring(frac, kind === 'good' ? 'good' : kind, F.pct(frac, 0)), h('div', { class: 'hint' }, kind === 'crit' ? 'Over budget' : kind === 'warn' ? 'Near budget' : 'Within budget')) : null),
    anyPending ? h('p', { class: 'asof', style: { marginTop: '8px' } }, tag('PROVISIONAL', 'prov'), ' Includes entries not yet in the tracker.') : null);

  // categories vs budget
  const byCat = {}; for (const e of all) byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount);
  const names = [...new Set([...(s.categories || []), ...Object.keys(byCat)])].filter(c => byCat[c] || (whoF === 'All' && budgets[c]));
  names.sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0));
  const cats = card('By category', catF ? h('button', { class: 'more', onclick: () => { state.spendCat = ''; ctx.render(); } }, 'Show all') : null,
    names.length ? h('div', {}, names.map(c => {
      const sp = byCat[c] || 0, b = whoF === 'All' ? budgets[c] : 0; const f = b ? sp / b : 0; const k2 = b ? (f > 1 ? 'crit' : f > 0.85 ? 'warn' : 'good') : '';
      return h('div', { class: 'hbar', role: 'button', tabindex: 0, style: { cursor: 'pointer', opacity: catF && catF !== c ? 0.45 : 1 }, onclick: () => { state.spendCat = catF === c ? '' : c; ctx.render(); } },
        h('span', { class: 'ttl' }, c, b && f > 1 ? [' ', tag('OVER', 'crit')] : null), h('span', { class: 'num' }, F.inr(sp), b ? h('span', { class: 'faint' }, ' / ' + F.inr(b)) : null),
        b ? bar(f, k2) : bar(spent ? sp / spent : 0));
    })) : empty('No spending this month.'));

  // insights as story cards, one short card above By category
  const ins = spendInsights(ym, whoF);
  const insCard = ins.length ? h('section', { class: 'card recap-card tap', id: 'insights', role: 'button', tabindex: 0, 'aria-label': ins.length + ' insights for ' + F.monthLabel(ym, true) + '. Open',
    onclick: () => openStory([...ins.map((x, i) => ({ k: 'Insight ' + (i + 1) + ' of ' + ins.length, sub: F.maskText(x.text) })), { k: F.monthLabel(ym, true), big: 'That\'s all', sub: 'Insights compare this month with the months before.' }], 'Insights for ' + F.monthLabel(ym, true), 'insightstory', 'Close insights') },
    h('div', { class: 'row-between' }, h('div', {}, h('p', { class: 'ttl strong' }, ins.length + (ins.length === 1 ? ' insight' : ' insights') + ' for ' + F.monthLabel(ym, true)), h('p', { class: 'hint' }, F.maskText(ins[0].text))), icon('right', 18))) : null;

  // list with search
  const search = h('div', { class: 'search' }, icon('search', 16), h('input', { class: 'field', type: 'search', placeholder: 'Search notes, category, amount', 'aria-label': 'Search expenses', value: state.spendQ || '',
    oninput: e => { state.spendQ = e.target.value; const pos = e.target.selectionStart; ctx.render(); const el = document.querySelector('.search input'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } } }));
  const shown = all.filter(e => (!evF || e.event === evF) && (!catF || e.category === catF) && (!q || [e.category, e.sub, e.notes, e.mode, e.by, String(e.amount)].join(' ').toLowerCase().includes(q)));
  const days = {}; for (const e of shown) (days[e.date] = days[e.date] || []).push(e);
  const list = Object.keys(days).sort().reverse().map(d => [h('div', { class: 'daygroup' }, h('span', {}, F.date(d)), h('span', { class: 'num' }, F.inr(sum(days[d], e => e.amount)))), h('ul', { class: 'list card', style: { padding: '0 14px' } }, days[d].map(entryLi))]);

  // earlier months as cards: total and a thin strip of the top categories
  const past = []; for (let n = 1; n <= 6; n++) { const m = addMonths(ym, -n); const l = monthEntries(m, whoF); if (l.length) past.push([m, l]); }
  const monthCards = past.length ? h('div', {}, h('div', { class: 'label-sm', style: { marginTop: '18px' } }, 'Earlier months'), h('div', { class: 'monthcards' }, past.map(([m, l]) => {
    const tot = sum(l, e => e.amount); const bc = Object.entries(byCategory(l)).sort((a, b) => b[1] - a[1]); const top = bc.slice(0, 4); const rest = tot - sum(top, x => x[1]);
    const strip = h('div', { class: 'catstrip', 'aria-hidden': 'true' }, [...top.map(([c, v]) => { const sp = h('span'); sp.style.flexGrow = String(v); sp.style.background = catColor(c); return sp; }), rest > 0 ? (() => { const sp = h('span'); sp.style.flexGrow = String(rest); sp.style.background = 'var(--line)'; return sp; })() : null]);
    return h('button', { class: 'monthcard', 'aria-label': F.monthLabel(m, true) + ', ' + F.inr(tot) + '. Top: ' + top.map(x => x[0]).join(', '), onclick: () => { state.spendMonth = m; state.spendCat = ''; window.scrollTo(0, 0); ctx.render(); } },
      h('div', { class: 'row-between' }, h('span', { class: 'ttl' }, F.monthLabel(m, true)), h('span', { class: 'num strong' }, F.inr(tot))), strip,
      h('div', { class: 'sub faint' }, top.slice(0, 3).map(x => x[0]).join(' · ')));
  }))) : null;

  return { title: 'Money', body: [moneySwitch(), head, tools, isNow ? recapCard() : null, summary, insCard, cats, h('div', { class: 'spacer' }), search,
    catF ? h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Showing ' + catF + ' only.') : null,
    evF ? h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Event: ' + evF + ' · ', h('button', { class: 'link', onclick: () => { state.spendEvent = ''; ctx.render(); } }, 'show all')) : null,
    list.length ? list : empty(q || catF ? 'No matching entries.' : 'No expenses this month yet.'),
    h('button', { class: 'btn primary wide', style: { marginTop: '14px' }, onclick: () => { state.editing = null; ctx.go('addexpense'); } }, icon('plus', 18), 'Add expense'), monthCards] };
}


// Smart defaults: which category is usually logged at this time of day (on this device).
const bucket = (d = new Date()) => { const hr = d.getHours(); return hr < 5 ? 'night' : hr < 11 ? 'morning' : hr < 15 ? 'midday' : hr < 19 ? 'evening' : 'night'; };
function rememberPick(f) { const st = ctx.settings(); const p = Object.assign({}, st.picks); const b = Object.assign({}, p[bucket()]); b[f.category] = (b[f.category] || 0) + 1; p[bucket()] = b; ctx.saveSettings({ picks: p }); }
function suggestCategory(cats) { const b = (ctx.settings().picks || {})[bucket()] || {}; const best = Object.entries(b).filter(([c]) => cats.includes(c)).sort((x, y) => y[1] - x[1])[0]; return best && best[1] >= 3 ? best[0] : ''; }

// ---------------------------------------------------------------- Add / edit expense (fast: amount, category, save)
export function viewAddExpense() {
  if (!ctx.who()) { setTimeout(() => { toast('Choose who uses this device in Settings first', 'bad'); ctx.go('settings'); }); return { title: 'Add expense', body: [] }; }
  const s = ctx.snap() || {}; const cats = s.categories || []; const subs = s.subcategories || {}; const modes = s.paymentModes || [];
  const ed = state.editing; const st = ctx.settings();
  const sug = ed ? '' : suggestCategory(cats);
  const f = { by: ed ? ed.by || ctx.who() : ctx.who(), date: ed ? ed.date : isoToday(), amount: ed ? String(ed.amount) : '', category: ed ? ed.category : sug, sub: ed ? ed.sub : (sug ? (st.lastSub || {})[sug] || '' : ''), mode: ed ? ed.mode : (st.lastMode || ''), notes: ed ? ed.notes : '', event: ed ? ed.event || '' : '' }; let catTouched = !!ed;
  if (state.voiceExp) { Object.assign(f, state.voiceExp); state.voiceExp = null; catTouched = true; } // filled by voice, then redrawn
  const amt = h('input', { id: 'amount', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Amount in rupees', value: f.amount, autocomplete: 'off' });
  const catBox = h('div', { class: 'chips catgrid', role: 'group', 'aria-label': 'Category' }), subBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Sub-category' }), modeBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Payment mode' });
  const subWrap = h('div');
  const drawSubs = () => { const list = subs[f.category] || []; subWrap.hidden = !list.length; subBox.replaceChildren(...list.map(x => h('button', { class: 'chip' + (f.sub === x ? ' on' : ''), 'aria-pressed': String(f.sub === x), onclick: () => { f.sub = f.sub === x ? '' : x; drawSubs(); } }, x))); };
  const drawCats = () => catBox.replaceChildren(...cats.map(c => h('button', { class: 'chip cat' + (f.category === c ? ' on' : ''), 'aria-pressed': String(f.category === c), 'aria-label': c, onclick: () => { f.category = c; catTouched = true; f.sub = (st.lastSub || {})[c] || ''; drawCats(); drawSubs(); } }, catIcon(c, 20), c)));
  const drawModes = () => modeBox.replaceChildren(...modes.map(m => h('button', { class: 'chip' + (f.mode === m ? ' on' : ''), 'aria-pressed': String(f.mode === m), onclick: () => { f.mode = f.mode === m ? '' : m; drawModes(); } }, m)));
  drawCats(); drawSubs(); drawModes();
  subWrap.append(h('div', { class: 'label-sm' }, 'Sub-category (optional)'), subBox);
  const dateIn = h('input', { class: 'field', type: 'date', id: 'edate', value: f.date, 'aria-label': 'Date', max: isoToday(), style: { width: 'auto' }, onchange: () => { f.date = dateIn.value; drawDates(); } });
  const dateBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Date' });
  const yest = () => { const d = new Date(); d.setDate(d.getDate() - 1); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const drawDates = () => dateBox.replaceChildren(
    h('button', { class: 'chip' + (f.date === isoToday() ? ' on' : ''), onclick: () => { f.date = isoToday(); dateIn.value = f.date; drawDates(); } }, 'Today'),
    h('button', { class: 'chip' + (f.date === yest() ? ' on' : ''), onclick: () => { f.date = yest(); dateIn.value = f.date; drawDates(); } }, 'Yesterday'), dateIn);
  drawDates();
  const notes = h('input', { class: 'field', id: 'enotes', placeholder: 'Note (optional)', 'aria-label': 'Note', value: f.notes, maxlength: 120 });
  const learnHint = h('span', { class: 'faint', id: 'learnhint' });
  notes.addEventListener('input', () => { if (catTouched) return; const g = C2.guessCategory(notes.value, cats); if (g && g !== f.category) { f.category = g; f.sub = (st.lastSub || {})[g] || ''; drawCats(); drawSubs(); learnHint.textContent = ' · ' + g + ', learned from your notes'; } });
  const save = async again => {
    const amount = parseAmount(amt.value);
    if (!(amount > 0)) { toast('Type an amount, like 250 or 1,250.50', 'bad'); amt.focus(); return; }
    if (!f.category) { toast('Pick a category', 'bad'); return; }
    if (!f.date) { toast('Pick a date', 'bad'); return; }
    if (hasLongDigits(notes.value)) { toast(DIGITS_MSG, 'bad'); notes.focus(); return; }
    if (amount > 100000 && !(ed && Number(ed.amount) === amount) && !(await confirmAmount(amount, F.inr))) { amt.focus(); return; }
    const vals = { by: f.by, date: f.date, amount, category: f.category, sub: f.sub, mode: f.mode, notes: notes.value.trim(), event: f.event || '' };
    if (vals.event && !(ctx.snap() || {}).v21) { toast('Events need tracker v21 in OneDrive first', 'bad'); return; }
    ctx.saveSettings({ lastMode: f.mode, lastSub: Object.assign({}, st.lastSub, { [f.category]: f.sub }) }).catch(() => {}); // the entry itself is written first, below
    const V = ctx.V;
    let undo = null;
    if (!ed) { const op = { kind: 'addExpense', entry: { id: uuid(), ...vals, enteredBy: ctx.who(), createdAt: new Date().toISOString() } }; await ctx.queue(op); undo = async () => { if (!V.get('outbox', op.opId)) return toast('Already synced. Delete it from the list if needed.', 'bad'); await V.remove('outbox', op.opId); }; }
    else if (ed.pending && ed.version === 0) { const op = V.all('outbox').find(o => o.kind === 'addExpense' && o.entry.id === ed.id); const old = { ...op.entry }; Object.assign(op.entry, vals); await V.put('outbox', op.opId, op); undo = async () => { const cur = V.get('outbox', op.opId); if (!cur) return toast('Already synced. Edit it again if needed.', 'bad'); cur.entry = old; await V.put('outbox', op.opId, cur); }; }
    else { const changes = {}; for (const [k, v] of Object.entries(vals)) if (String(v) !== String(ed[k] ?? '')) changes[k] = v; if (Object.keys(changes).length) { const op = { kind: 'editExpense', id: ed.id, baseVersion: ed.version, base: ctx.baseOf(ed), changes }; await ctx.queue(op); undo = async () => { if (!V.get('outbox', op.opId)) return toast('Already synced. Edit it again if needed.', 'bad'); await V.remove('outbox', op.opId); }; } }
    ctx.scheduleSync(7000); haptic(); rememberPick(f); C2.learn(vals.notes, vals.category).catch(() => {});
    toast(ed ? 'Saved' : 'Added ' + F.inr(amount) + ' · ' + f.category + (f.by !== ctx.who() ? ' for ' + f.by : ''), 'info', undo ? { label: 'Undo', fn: async () => { await undo(); toast(ed ? 'Change undone' : 'Removed'); ctx.render(); } } : null);
    state.editing = null;
    if (again) { ctx.render(); } else ctx.go('spend');
  };
  amt.addEventListener('keydown', e => { if (e.key === 'Enter') save(false); });
  setTimeout(() => amt.focus(), 60);
  return { title: ed ? 'Edit expense' : 'Add expense', back: 'spend', body: [h('div', { style: { maxWidth: '640px' } },
    ed ? h('div', { class: 'addtop' }, forPill(f, 'by')) : addSwitch('Expense', forPill(f, 'by')),
    amountRow(h('label', { class: 'amount' }, h('span', {}, '₹'), amt), micButton(alts => {
      const v = parseVoice(alts, 'expense', { cats, subs, modes, events: C2.activeEvents().map(e => e.name) });
      const fill = { ...f, amount: amt.value, notes: notes.value };
      if (v.amount != null) fill.amount = String(v.amount);
      if (v.category) { fill.category = v.category; fill.sub = v.sub || ''; }
      else if (v.notes && !fill.category) { const g = C2.guessCategory(v.notes, cats); if (g) { fill.category = g; fill.sub = ''; v.category = g; } }
      for (const k of ['date', 'mode', 'event', 'by']) if (v[k]) fill[k] = v[k];
      if (v.notes && !fill.notes) fill.notes = v.notes;
      state.voiceExp = fill; ctx.render(); toast(voiceSummary(v), v.amount != null || v.category ? 'info' : 'bad');
    })),
    h('div', { class: 'label-sm' }, 'Category', sug ? h('span', { class: 'faint' }, ' · suggested for this time of day') : null, learnHint), cats.length ? catBox : h('p', { class: 'hint' }, 'Sync once to get your categories.'),
    subWrap,
    h('div', { class: 'label-sm' }, 'Date'), dateBox,
    modes.length ? [h('div', { class: 'label-sm' }, 'Paid by (optional)'), modeBox] : null,
    h('div', { class: 'label-sm' }, 'Note'), notes,
    C2.eventChips(f),
    h('div', { class: 'sticky-save' }, h('button', { class: 'btn primary', style: { flex: 2 }, id: 'saveexp', onclick: () => save(false) }, 'Save'), !ed ? h('button', { class: 'btn', style: { flex: 1 }, id: 'saveagain', onclick: () => save(true) }, 'Save + new') : null))] };
}
