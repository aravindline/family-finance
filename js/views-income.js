// Income: one entry per amount received, like daily expenses (tagged to whoever logs it): date, amount, category + sub-category, received account,
// note. Entries go to the tracker's Income Entries sheet (v22) through the outbox; the Income & Investment Tracker adds
// them up by month (Salary -> take-home columns, everything else -> Other income). The add screen is reached from the
// centre + button with an Expense | Income switch. Analytics: month on month, year on year, growth, spending,
// savings rate, Madhu vs Aravind.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, card, empty, tag, sheet, seg, haptic, columnChart, trendChart, catIcon, SERIES, swipeable , parseAmount } from './ui.js';
import { uuid } from './crypto.js';

const PEOPLE = ['Aravind', 'Madhu'];
const DEFAULT_CATS = [{ name: 'Salary', goes: 'Take-home', subs: ['Monthly payout', 'Variable pay', 'Bonus', 'Others'] },
  { name: 'Investment / savings income', goes: 'Other income', subs: ['Dividends', 'Interest', 'Others'] },
  { name: 'Rewards', goes: 'Other income', subs: [] }, { name: 'Gifts', goes: 'Other income', subs: [] }, { name: 'Others', goes: 'Other income', subs: [] }];
const pad = n => String(n).padStart(2, '0');
const localISO = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const isoToday = () => localISO(new Date());
const thisMonth = () => isoToday().slice(0, 7);
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const fyOf = ym => { const [y, m] = ym.split('-').map(Number); return m < 4 ? y - 1 : y; };
const fyLabel = y => 'FY ' + y + '-' + String(y + 1).slice(2);
const serialOf = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
const isoOfSerial = v => typeof v === 'number' ? new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10) : String(v || '').slice(0, 10);
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const growth = (now, before) => (before ? (now - before) / Math.abs(before) : null);
const gTag = g => g === null || !isFinite(g) ? h('span', { class: 'faint' }, '–') : tag((g >= 0 ? '+' : '−') + F.pct(Math.abs(g), 0), g >= 0 ? 'good' : 'warn');
const need22 = () => { const s = ctx.snap(); if (s && s.v22) return true; toast('Upload tracker v22 to OneDrive first (it has the Income Entries sheet).', 'bad'); return false; };
const LONG_DIGITS = /\d{5,}/; // full account numbers are never stored: last 4 digits only

export function incomeCats() {
  const c = ((ctx.snap() || {}).incomeCats || []).filter(x => x.name && !/^Spare \d+$/i.test(x.name));
  return c.length ? c : DEFAULT_CATS;
}
export function incomeAccounts() {
  const s = ctx.snap() || {};
  const set = new Set([...(s.incomeAccounts || []), ...((ctx.settings().incAccounts) || []), ...incomeList().map(e => e.account)].filter(Boolean));
  return [...set];
}
// entries from the tracker plus the ones waiting to sync, with pending edits applied; deleted ones left out
export function incomeList() {
  const s = ctx.snap() || {};
  const list = (s.income || []).map(e => ({ ...e }));
  const out = ctx.V.all('outbox');
  for (const o of out) if (o.kind === 'addRow' && o.table === 'tblIncome') {
    const v = o.values; const date = isoOfSerial(v.Date);
    list.push({ id: v['Entry ID'], date, month: date.slice(0, 7), person: v.Person, category: v.Category, sub: v['Sub-category'] || '', amount: Number(v['Amount (₹)']) || 0, account: v['Received account'] || '', notes: v.Notes || '', by: v['Entered by'], at: v['Entered at'], status: v.Status || 'Active', pending: true });
  }
  for (const o of out) if (o.kind === 'setRow' && o.table === 'tblIncome') {
    const x = list.find(i => i.id === o.id); if (!x) continue;
    if ('Amount (₹)' in o.changes) x.amount = Number(o.changes['Amount (₹)']) || 0;
    if ('Status' in o.changes) x.status = o.changes.Status;
    x.pending = true;
  }
  return list.filter(e => e.status !== 'Deleted' && e.month);
}
function aggregate(list) {
  const by = {};
  for (const e of list) {
    const b = by[e.month] || (by[e.month] = { total: 0, c: {}, p: {} });
    b.total += e.amount; b.c[e.category] = (b.c[e.category] || 0) + e.amount; b.p[e.person] = (b.p[e.person] || 0) + e.amount;
  }
  return by;
}
const tot = (by, m) => (by[m] ? by[m].total : 0);
function spentBy(who) {
  const by = {};
  for (const e of ctx.entriesView()) { if (!e.date || e.status === 'Deleted' || (who !== 'Family' && e.by !== who)) continue; const m = e.date.slice(0, 7); by[m] = (by[m] || 0) + (Number(e.amount) || 0); }
  return by;
}
const table = (head, rows, id) => h('div', { class: 'tablewrap' }, h('table', { class: 'cmp inc', id }, h('thead', {}, h('tr', {}, head.map(x => h('th', {}, x)))), h('tbody', {}, rows)));
const td = (x, cls = 'num') => h('td', { class: cls }, x);
const shortCat = c => c === 'Investment / savings income' ? 'Investment income' : c;

// "For Aravind / Madhu": whose expense or income this is. Preset to whoever uses the phone; one tap switches to the
// other person when entering for them. Entered by is always the phone's user, and only they can change the entry later.
export function forPill(f, key) {
  const b = h('button', { class: 'forpill', id: 'forwho', type: 'button' });
  const draw = () => { const other = f[key] !== ctx.who(); b.className = 'forpill' + (other ? ' other' : ''); b.setAttribute('aria-label', 'For ' + f[key] + '. Tap to enter it for ' + (f[key] === 'Aravind' ? 'Madhu' : 'Aravind'));
    b.replaceChildren(icon('c_user', 14), h('span', {}, 'For ' + f[key]), icon('sync', 12)); };
  b.onclick = () => { f[key] = f[key] === 'Aravind' ? 'Madhu' : 'Aravind'; haptic(); draw(); };
  draw(); return b;
}
// Expense | Income switch shown at the top of both add screens (Expense is the default, on the left)
export function addSwitch(current, pill) {
  return h('div', { class: 'addtop' }, seg(['Expense', 'Income'], current, v => { if (v !== current) ctx.go(v === 'Income' ? 'addincome' : 'addexpense', { replace: true }); }, 'Add an expense or income'), pill || null);
}

// ---------------------------------------------------------------- Income screen
export function viewIncome() {
  const who = state.incWho || 'Family'; const mode = state.incMode || 'Month on month';
  const all = incomeList(); const list = who === 'Family' ? all : all.filter(e => e.person === who);
  const head = h('div', { class: 'toolbar' }, seg(['Family', ...PEOPLE], who, v => { state.incWho = v; ctx.render(); }, 'Whose income'),
    seg(['Month on month', 'Year on year'], mode, v => { state.incMode = v; ctx.render(); }, 'Compare'));
  const addBtn = h('div', { class: 'btns', style: { margin: '0 0 12px' } }, h('button', { class: 'btn primary', id: 'addincbtn', onclick: () => ctx.go('addincome') }, icon('plus', 16), 'Add income'));
  const s = ctx.snap() || {};
  const note = !s.v22 ? h('p', { class: 'warn-text', style: { margin: '0 4px 12px' } }, 'The tracker in OneDrive is older than v22, so income can\'t be saved until v22 is uploaded.') : null;
  if (!list.length) return { title: 'Income', back: 'more', body: [head, addBtn, note, card(null, null, empty('No income entries yet. Use the + button and switch to Income, or the button above.'))] };

  const by = aggregate(list); const now = thisMonth();
  const months = Object.keys(by).filter(m => m <= now).sort(); const latest = months[months.length - 1] || now;
  const prev = addMonths(latest, -1), lastYear = addMonths(latest, -12);
  const summary = card('Latest month · ' + F.monthLabel(latest, true), null,
    h('div', { class: 'num', id: 'inclatest' }, F.inr(tot(by, latest))),
    h('div', { class: 'kv', style: { marginTop: '8px' } },
      h('span', {}, 'vs ' + F.monthLabel(prev, true)), h('span', {}, gTag(growth(tot(by, latest), tot(by, prev))), ' ', F.inr(tot(by, prev))),
      h('span', {}, 'vs ' + F.monthLabel(lastYear, true)), h('span', {}, gTag(growth(tot(by, latest), tot(by, lastYear))), ' ', F.inr(tot(by, lastYear)))));

  const cats = [...new Set(list.map(e => e.category))].sort((a, b) => list.filter(e => e.category === b).reduce((t, e) => t + e.amount, 0) - list.filter(e => e.category === a).reduce((t, e) => t + e.amount, 0));
  const shown = cats.slice(0, 6); const rest = cats.slice(6); const series = rest.length ? [...shown, 'More'] : shown;
  const partsOf = m => { const b = by[m] || { c: {} }; const p = shown.map(c => b.c[c] || 0); if (rest.length) p.push(rest.reduce((a, c) => a + (b.c[c] || 0), 0)); return p; };

  let body;
  if (mode === 'Month on month') {
    const span = []; for (let i = 11; i >= 0; i--) span.push(addMonths(latest, -i));
    const spent = spentBy(who); const monthly = s.monthly || [];
    const rate = m => { const r = monthly.find(x => (x.month || '').slice(0, 7) === m); return r && r.savingsRate !== null && r.savingsRate !== undefined && r.saved ? r.savingsRate : null; };
    const byCat = card('Income by month', null,
      columnChart(span.map(m => ({ x: F.monthLabel(m), parts: partsOf(m) })), { series: series.map(shortCat), colors: SERIES, label: 'Income by month and category' }),
      table(['Month', 'Income', 'vs last month'], span.slice().reverse().filter(m => by[m]).map(m => h('tr', {}, td(F.monthLabel(m), ''), td(F.inr(tot(by, m))), td(gTag(growth(tot(by, m), tot(by, addMonths(m, -1))))))), 'incmom'));
    const sav = card('Income, spending and savings', null,
      trendChart(span.map(m => ({ x: F.monthLabel(m), y: tot(by, m) ? (tot(by, m) - (spent[m] || 0)) / tot(by, m) : 0 })), { fmt: v => F.pct(v, 0), label: 'Share of income left after spending' }),
      table(['Month', 'Income', 'Spent', 'Left', 'Saved'], span.slice().reverse().filter(m => by[m] || spent[m]).map(m => { const i = tot(by, m), sp = spent[m] || 0; const r = rate(m);
        return h('tr', {}, td(F.monthLabel(m), ''), td(F.inrShort(i)), td(F.inrShort(sp)), td(i ? F.pct((i - sp) / i, 0) : '–'), td(r === null ? '–' : F.pct(r, 0))); }), 'incsavings'),
      h('p', { class: 'hint', style: { marginTop: '6px' } }, 'Left = share of income left after daily spending (the line). Spent = daily expenses' + (who === 'Family' ? '' : ' for ' + who) + '. Saved = the tracker\'s savings rate (saved and invested ÷ income), once that month is filled in.'));
    body = [byCat, sav];
  } else {
    const fy = fyOf(latest); const fyMonths = y => Array.from({ length: 12 }, (_, k) => addMonths(y + '-04', k));
    const cur = fyMonths(fy), old = fyMonths(fy - 1); const lastIdx = cur.indexOf(latest);
    const sumOf = (ms, f) => ms.reduce((a, m) => a + f(m), 0);
    const ytdCur = cur.slice(0, lastIdx + 1), ytdOld = old.slice(0, lastIdx + 1);
    const catRows = cats.map(c => { const a = sumOf(ytdCur, m => (by[m] && by[m].c[c]) || 0), b = sumOf(ytdOld, m => (by[m] && by[m].c[c]) || 0); return h('tr', {}, td(shortCat(c), ''), td(F.inr(b)), td(F.inr(a)), td(gTag(growth(a, b)))); });
    const tA = sumOf(ytdCur, m => tot(by, m)), tB = sumOf(ytdOld, m => tot(by, m));
    catRows.push(h('tr', { class: 'totrow' }, td('Total', ''), td(F.inr(tB)), td(F.inr(tA)), td(gTag(growth(tA, tB)))));
    const yoyCat = card(fyLabel(fy) + ' vs ' + fyLabel(fy - 1), null, h('p', { class: 'hint' }, 'April to ' + F.monthLabel(latest) + ' in both years.'), table(['Category', fyLabel(fy - 1), fyLabel(fy), 'Growth'], catRows, 'incyoy'));
    const monthRows = cur.map((m, k) => { const a = tot(by, m), b = tot(by, old[k]); if (!a && !b) return null; return h('tr', {}, td(F.monthLabel(m), ''), td(F.inr(b)), td(F.inr(a)), td(gTag(growth(a, b)))); }).filter(Boolean);
    const yoyMonth = card('Same month, a year apart', null, table(['Month', fyLabel(fy - 1), fyLabel(fy), 'Growth'], monthRows, 'incyoym'));
    const years = [...new Set(Object.keys(by).map(fyOf))].sort();
    const fyRows = years.map((y, i) => { const a = sumOf(fyMonths(y), m => tot(by, m)); const b = i ? sumOf(fyMonths(years[i - 1]), m => tot(by, m)) : null; return h('tr', {}, td(fyLabel(y), ''), td(F.inr(a)), td(b === null ? '–' : gTag(growth(a, b)))); });
    const fyCard = card('Financial-year totals', null, table(['Year', 'Income', 'Growth'], fyRows, 'incfy'), h('p', { class: 'hint', style: { marginTop: '6px' } }, 'The running year is part-way, so its growth looks lower until March.'));
    body = [yoyCat, yoyMonth, fyCard];
  }
  let vs = null;
  if (who === 'Family') {
    const span = []; for (let i = 11; i >= 0; i--) span.push(addMonths(latest, -i));
    const fy = fyOf(latest); const ytd = []; for (let m = fy + '-04'; m <= latest; m = addMonths(m, 1)) ytd.push(m);
    const ytdOld = ytd.map(m => addMonths(m, -12)); const allYtd = ytd.reduce((t, m) => t + tot(by, m), 0);
    const pRows = PEOPLE.map(p => { const a = ytd.reduce((t, m) => t + ((by[m] && by[m].p[p]) || 0), 0), b = ytdOld.reduce((t, m) => t + ((by[m] && by[m].p[p]) || 0), 0);
      return h('tr', {}, td(p, ''), td(F.inr(a)), td(allYtd ? F.pct(a / allYtd, 0) : '–'), td(gTag(growth(a, b)))); });
    vs = card('Madhu vs Aravind', null,
      columnChart(span.map(m => ({ x: F.monthLabel(m), parts: PEOPLE.map(p => (by[m] && by[m].p[p]) || 0) })), { series: PEOPLE, colors: [SERIES[0], SERIES[1]], label: 'Income by person and month' }),
      table(['Person', fyLabel(fy) + ' so far', 'Share', 'vs last year'], pRows, 'incvs'));
  }
  const entries = list.filter(e => e.month === latest).sort((a, b) => b.date.localeCompare(a.date));
  const entCard = card('Entries in ' + F.monthLabel(latest, true), null, h('ul', { class: 'list', id: 'inclist' }, entries.map(entryLi)));
  return { title: 'Income', back: 'more', body: [head, addBtn, note, summary, h('div', { class: 'spacer' }), ...body.flatMap(c => [c, h('div', { class: 'spacer' })]), vs, vs ? h('div', { class: 'spacer' }) : null, entCard] };
}
function entryLi(e) {
  const li = h('li', { class: 'li tap', onclick: () => { if (!li.dataset.swiped) entrySheet(e); } }, h('span', { class: 'lead', 'aria-hidden': 'true' }, catIcon(e.category, 18)),
    h('div', { class: 'body' }, h('div', { class: 'row-between' }, h('span', { class: 'ttl' }, e.sub ? e.sub : shortCat(e.category)), e.pending ? tag('NOT SYNCED', 'prov') : null),
      h('div', { class: 'sub' }, [F.date(e.date), e.person, e.account, e.notes].filter(Boolean).join(' · '))),
    h('div', { class: 'end num' }, F.inr(e.amount)));
  if ((e.by || e.person) === ctx.who()) swipeable(li, () => entrySheet(e, true), () => delIncome(e)); // only the person who entered it
  return li;
}
async function delIncome(e) {
  const V = ctx.V; let undo;
  const add = V.all('outbox').find(o => o.kind === 'addRow' && o.table === 'tblIncome' && o.values['Entry ID'] === e.id);
  if (add) { await V.remove('outbox', add.opId); undo = async () => { await V.put('outbox', add.opId, add); }; }
  else { const op = { kind: 'setRow', table: 'tblIncome', idCol: 'Entry ID', id: e.id, changes: { Status: 'Deleted' }, base: { Status: e.status } }; await ctx.queue(op); undo = async () => { if (!V.get('outbox', op.opId)) return toast('Already synced. Add it again if needed.', 'bad'); await V.remove('outbox', op.opId); }; }
  ctx.scheduleSync(7000); haptic();
  toast('Deleted ' + F.inr(e.amount) + ' · ' + (e.sub || shortCat(e.category)), 'info', { label: 'Undo', fn: async () => { await undo(); toast('Restored'); ctx.render(); } });
  ctx.render();
}
function entrySheet(e, focusAmount) {
  const mine = (e.by || e.person) === ctx.who(); // whoever typed it may change it
  const amt = h('input', { class: 'field', id: 'incedit', inputmode: 'decimal', value: String(e.amount), 'aria-label': 'Amount' });
  const close = () => document.querySelectorAll('.scrim').forEach(x => x.remove());
  sheet(shortCat(e.category) + (e.sub ? ' · ' + e.sub : ''),
    h('div', { class: 'kv' }, h('span', {}, 'Date'), h('span', {}, F.date(e.date)), h('span', {}, 'Whose'), h('span', {}, e.person), h('span', {}, 'Received in'), h('span', {}, e.account || '–'),
      h('span', {}, 'Note'), h('span', {}, e.notes || '–'), h('span', {}, 'Entered by'), h('span', {}, e.by || e.person || '–')),
    mine ? h('div', { class: 'stack', style: { marginTop: '12px' } }, h('div', { class: 'label-sm' }, 'Amount (₹)'), amt,
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', id: 'incsave', onclick: async () => { const v = parseAmount(amt.value); if (!(v > 0)) return toast('Type an amount above zero', 'bad'); close(); if (!need22()) return;
          await ctx.queue({ kind: 'setRow', table: 'tblIncome', idCol: 'Entry ID', id: e.id, changes: { 'Amount (₹)': v }, base: { 'Amount (₹)': e.amount } }); ctx.scheduleSync(4000); haptic(); toast('Changed'); ctx.render(); } }, 'Save'),
        h('button', { class: 'btn danger', id: 'incdel', onclick: async () => { close(); if (!need22()) return;
          await ctx.queue({ kind: 'setRow', table: 'tblIncome', idCol: 'Entry ID', id: e.id, changes: { Status: 'Deleted' }, base: { Status: e.status } }); ctx.scheduleSync(4000); haptic(); toast('Deleted. The row stays in the tracker, marked Deleted.'); ctx.render(); } }, 'Delete')))
      : h('p', { class: 'hint', style: { marginTop: '12px' } }, 'Only ' + (e.by || e.person || 'the person who logged it') + ' can change this entry.'));
  if (focusAmount && mine) setTimeout(() => { amt.focus(); amt.select(); }, 80);
}

// ---------------------------------------------------------------- Add income
export function viewAddIncome() {
  if (!ctx.who()) { setTimeout(() => { toast('Choose who uses this device in Settings first', 'bad'); ctx.go('settings'); }); return { title: 'Add income', body: [] }; }
  const cats = incomeCats(); const st = ctx.settings();
  const f = state.incForm || (state.incForm = { date: isoToday(), person: ctx.who(), category: cats[0].name, sub: (st.incLastSub || {})[cats[0].name] || '', account: st.incLastAccount || '', notes: '', amount: '' });
  const amt = h('input', { id: 'incamount', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Amount in rupees', value: f.amount, autocomplete: 'off', oninput: e => { f.amount = e.target.value; } });
  const catBox = h('div', { class: 'chips catgrid', role: 'group', 'aria-label': 'Income category' }), subBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Income sub-category' }); const subWrap = h('div');
  const drawSubs = () => { const c = cats.find(x => x.name === f.category); const list = c ? c.subs : []; subWrap.hidden = !list.length; subBox.replaceChildren(...list.map(x => h('button', { class: 'chip' + (f.sub === x ? ' on' : ''), 'aria-pressed': String(f.sub === x), onclick: () => { f.sub = f.sub === x ? '' : x; drawSubs(); } }, x))); };
  const drawCats = () => catBox.replaceChildren(...cats.map(c => h('button', { class: 'chip cat' + (f.category === c.name ? ' on' : ''), 'aria-pressed': String(f.category === c.name), 'aria-label': c.name, onclick: () => { f.category = c.name; f.sub = (st.incLastSub || {})[c.name] || ''; drawCats(); drawSubs(); } }, catIcon(c.name, 20), shortCat(c.name))));
  drawCats(); drawSubs(); subWrap.append(h('div', { class: 'label-sm' }, 'Sub-category'), subBox);
  const yest = () => { const d = new Date(); d.setDate(d.getDate() - 1); return localISO(d); };
  const dateIn = h('input', { class: 'field', type: 'date', id: 'incdate', value: f.date, 'aria-label': 'Date received', max: isoToday(), style: { width: 'auto' }, onchange: () => { f.date = dateIn.value; drawDates(); } });
  const dateBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Date received' });
  const drawDates = () => dateBox.replaceChildren(
    h('button', { class: 'chip' + (f.date === isoToday() ? ' on' : ''), onclick: () => { f.date = isoToday(); dateIn.value = f.date; drawDates(); } }, 'Today'),
    h('button', { class: 'chip' + (f.date === yest() ? ' on' : ''), onclick: () => { f.date = yest(); dateIn.value = f.date; drawDates(); } }, 'Yesterday'), dateIn);
  drawDates();
  const accBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Received account' });
  const newAcc = h('input', { class: 'field', id: 'incnewacc', placeholder: 'New account, e.g. HDFC salary a/c ••1234', 'aria-label': 'New received account', maxlength: 40, hidden: true });
  const drawAcc = () => accBox.replaceChildren(...incomeAccounts().map(a => h('button', { class: 'chip' + (f.account === a ? ' on' : ''), 'aria-pressed': String(f.account === a), onclick: () => { f.account = f.account === a ? '' : a; newAcc.hidden = true; drawAcc(); } }, a)),
    h('button', { class: 'chip', id: 'incaddacc', onclick: () => { newAcc.hidden = false; f.account = ''; drawAcc(); newAcc.focus(); } }, icon('plus', 14), 'New'));
  drawAcc();
  const notes = h('input', { class: 'field', id: 'incnotes', placeholder: 'Note (optional), e.g. HDFC Bank dividend', 'aria-label': 'Note', value: f.notes, maxlength: 120, oninput: e => { f.notes = e.target.value; } });
  const save = async again => {
    const v = parseAmount(amt.value);
    if (!(v > 0)) { toast('Type an amount, like 250 or 1,250.50', 'bad'); amt.focus(); return; }
    if (!f.date) { toast('Pick a date', 'bad'); return; }
    let account = f.account;
    if (!newAcc.hidden && newAcc.value.trim()) account = newAcc.value.trim();
    if (LONG_DIGITS.test(account) || LONG_DIGITS.test(notes.value)) { toast('Last 4 digits only. Never type a full account number.', 'bad'); return; }
    if (!need22()) return;
    const id = 'INC-' + uuid().slice(0, 8);
    await ctx.queue({ kind: 'addRow', table: 'tblIncome', idCol: 'Entry ID', what: 'income',
      summary: f.date + ' · ' + f.person + ' · ' + f.category + (f.sub ? ' › ' + f.sub : '') + ' · ₹' + v,
      values: { 'Entry ID': id, Date: serialOf(f.date), Person: f.person, Category: f.category, 'Sub-category': f.sub || '', 'Amount (₹)': v, 'Received account': account || '', Notes: notes.value.trim(), 'Entered by': ctx.who(), 'Entered at': stamp(), Status: 'Active' } });
    const accs = account && !incomeAccounts().includes(account) ? [...(st.incAccounts || []), account] : st.incAccounts;
    ctx.saveSettings({ incLastSub: Object.assign({}, st.incLastSub, { [f.category]: f.sub }), incLastAccount: account || st.incLastAccount || '', incAccounts: accs || [] }).catch(() => {});
    ctx.scheduleSync(7000); haptic();
    toast('Added ' + F.inr(v) + ' · ' + shortCat(f.category));
    state.incForm = null;
    if (again) ctx.render(); else ctx.go('income', { replace: true });
  };
  amt.addEventListener('keydown', e => { if (e.key === 'Enter') save(false); });
  setTimeout(() => amt.focus(), 60);
  return { title: 'Add income', back: 'home', body: [h('div', { style: { maxWidth: '640px' } },
    addSwitch('Income', forPill(f, 'person')),
    h('label', { class: 'amount' }, h('span', {}, '₹'), amt),
    h('div', { class: 'label-sm' }, 'Category'), catBox, subWrap,
    h('div', { class: 'label-sm' }, 'Date received'), dateBox,
    h('div', { class: 'label-sm' }, 'Received in'), accBox, newAcc,
    h('div', { class: 'label-sm' }, 'Note'), notes,
    h('div', { class: 'sticky-save' }, h('button', { class: 'btn primary', style: { flex: 2 }, id: 'saveinc', onclick: () => save(false) }, 'Save'), h('button', { class: 'btn', style: { flex: 1 }, id: 'saveincagain', onclick: () => save(true) }, 'Save + new')))] };
}
