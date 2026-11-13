// Drop C part 2: events, money lent, rollover budgets, chart notes, what moved, safety card,
// goal icons, suggestion box, learned categories and net worth in years of retirement spend.
// Records the tracker keeps (events, loans, repayments, budgets, notes) go through the outbox as
// addRow / setRow; the screens show them at once, marked "not synced" until the tracker has them.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, card, empty, tag, sheet, bar, seg, haptic, parseAmount, catIcon, setCatIcons, CAT_ICONS } from './ui.js';
import { uuid } from './crypto.js';

const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const thisMonth = () => today().slice(0, 7);
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const serial = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const sum = (a, f) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const need21 = () => { const s = ctx.snap(); if (s && s.v21) return true; toast('Upload tracker v21 to OneDrive first (it has the tables for this).', 'bad'); return false; };
const field = (label, el, hint) => h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, label), hint ? h('div', { class: 'set-d' }, hint) : null), h('div', { class: 'set-c' }, el));

// Pending outbox records of a table, so new items show before the next sync.
function pendingRows(table) { return ctx.V.all('outbox').filter(o => o.kind === 'addRow' && o.table === table).map(o => ({ ...o.values, _pending: true })); }
function pendingSets(table) { return ctx.V.all('outbox').filter(o => o.kind === 'setRow' && o.table === table); }
function applySets(list, table, idKey, map) {
  for (const op of pendingSets(table)) { const x = list.find(i => i[idKey] === op.id); if (x) { for (const [col, v] of Object.entries(op.changes)) if (map[col]) x[map[col]] = v; x.pending = true; } }
  return list;
}
async function addRow(table, idCol, values, what, summary) { await ctx.queue({ kind: 'addRow', table, idCol, values, what, summary }); ctx.scheduleSync(4000); haptic(); }
async function setRow(table, idCol, id, changes, base) { await ctx.queue({ kind: 'setRow', table, idCol, id, changes, base }); ctx.scheduleSync(4000); haptic(); }

// ---------------------------------------------------------------- Events
export function events() {
  const s = ctx.snap() || {};
  const list = (s.events || []).map(e => ({ ...e }));
  for (const r of pendingRows('tblEvents')) list.push({ id: r['Event ID'], name: r.Event, start: r['Start date'] ? F_iso(r['Start date']) : null, end: r['End date'] ? F_iso(r['End date']) : null, budget: r['Budget (₹)'] || null, status: r.Status || 'Active', notes: r.Notes || '', pending: true });
  return applySets(list, 'tblEvents', 'id', { Status: 'status', 'Budget (₹)': 'budget', 'End date': 'end' });
}
function F_iso(v) { if (typeof v !== 'number') return v; const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10); }
export const activeEvents = () => events().filter(e => e.status !== 'Closed');
export function eventChips(f, redraw) {
  const ev = activeEvents(); if (!ev.length) return null;
  const box = h('div', { class: 'chips', role: 'group', 'aria-label': 'Event' });
  const draw = () => box.replaceChildren(...ev.map(e => h('button', { class: 'chip' + (f.event === e.name ? ' on' : ''), 'aria-pressed': String(f.event === e.name), onclick: () => { f.event = f.event === e.name ? '' : e.name; draw(); if (redraw) redraw(); } }, icon('c_tag', 14), e.name)));
  draw(); return [h('div', { class: 'label-sm' }, 'Event (optional)'), box];
}
export function viewEvents() {
  const entries = ctx.entriesView();
  const list = events().sort((a, b) => (a.status === 'Closed') - (b.status === 'Closed') || String(b.start || '').localeCompare(String(a.start || '')));
  const spentOf = name => sum(entries.filter(e => e.event === name), e => e.amount);
  const cards = list.map(e => {
    const sp = spentOf(e.name); const f = e.budget ? sp / e.budget : 0;
    return h('li', { class: 'li wrap tap', onclick: () => eventSheet(e, sp) }, h('span', { class: 'lead' }, icon('c_tag', 16)),
      h('div', { class: 'body' }, h('div', { class: 'row-between' }, h('span', { class: 'ttl' }, e.name), e.status === 'Closed' ? tag('CLOSED') : e.pending ? tag('NOT SYNCED', 'prov') : null),
        h('div', { class: 'sub' }, [e.start ? F.date(e.start) + (e.end ? ' to ' + F.date(e.end) : '') : null, entries.filter(x => x.event === e.name).length + ' spends'].filter(Boolean).join(' · ')),
        e.budget ? bar(f, f > 1 ? 'crit' : f > 0.85 ? 'warn' : 'good') : null),
      h('div', { class: 'end num' }, F.inr(sp), e.budget ? h('div', { class: 'sub' }, 'of ' + F.inr(e.budget)) : null));
  });
  return { title: 'Events', back: 'spend', body: [
    h('p', { class: 'hint', style: { margin: '4px 4px 12px' } }, 'Trips, festivals, functions: tag spends to an event when you add them, and see the total here.'),
    card(null, null, cards.length ? h('ul', { class: 'list', id: 'eventlist' }, cards) : empty('No events yet.')),
    h('button', { class: 'btn primary wide', id: 'addevent', style: { marginTop: '14px' }, onclick: () => eventForm() }, icon('plus', 18), 'New event')] };
}
function eventSheet(e, spent) {
  const close = sheet(e.name, h('div', { class: 'kv' }, h('span', {}, 'Dates'), h('span', {}, e.start ? F.date(e.start) + (e.end ? ' to ' + F.date(e.end) : '') : '–'),
    h('span', {}, 'Budget'), h('span', {}, e.budget ? F.inr(e.budget) : '–'), h('span', {}, 'Spent'), h('span', {}, F.inr(spent)),
    e.budget ? [h('span', {}, spent > e.budget ? 'Over by' : 'Left'), h('span', {}, F.inr(Math.abs(e.budget - spent)))] : null, h('span', {}, 'Status'), h('span', {}, e.status)),
    h('div', { class: 'spacer' }), h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => { close(); state.spendQ = ''; state.spendEvent = e.name; ctx.go('spend'); } }, 'See spends'),
      e.status !== 'Closed' ? h('button', { class: 'btn', id: 'closeevent', onclick: async () => { close(); if (!need21()) return; await setRow('tblEvents', 'Event ID', e.id, { Status: 'Closed' }, { Status: e.status }); toast('Event closed'); ctx.render(); } }, 'Close event')
        : h('button', { class: 'btn', onclick: async () => { close(); if (!need21()) return; await setRow('tblEvents', 'Event ID', e.id, { Status: 'Active' }, { Status: e.status }); toast('Event reopened'); ctx.render(); } }, 'Reopen')));
}
function eventForm() {
  const name = h('input', { class: 'field', id: 'evname', placeholder: 'e.g. Goa trip, Diwali', maxlength: 40, 'aria-label': 'Event name' });
  const start = h('input', { class: 'field', type: 'date', id: 'evstart', value: today(), 'aria-label': 'Start date' });
  const end = h('input', { class: 'field', type: 'date', id: 'evend', 'aria-label': 'End date' });
  const budget = h('input', { class: 'field', id: 'evbudget', inputmode: 'decimal', placeholder: 'Optional', 'aria-label': 'Budget' });
  const close = sheet('New event', field('Name', name), field('Start', start), field('End', end, 'Optional'), field('Budget (₹)', budget, 'Optional'), h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary wide', id: 'saveevent', onclick: async () => {
      const n = name.value.trim(); if (!n) return toast('Give the event a name', 'bad');
      if (events().some(e => e.name.toLowerCase() === n.toLowerCase())) return toast('There is already an event with that name', 'bad');
      if (!need21()) return;
      const b = budget.value.trim() ? parseAmount(budget.value) : null; if (Number.isNaN(b)) return toast('Type the budget as a number', 'bad');
      await addRow('tblEvents', 'Event ID', { 'Event ID': uuid(), Event: n, 'Start date': start.value ? serial(start.value) : null, 'End date': end.value ? serial(end.value) : null, 'Budget (₹)': b, Status: 'Active' }, 'event', n + (b ? ' · budget ₹' + b : ''));
      close(); toast('Event added'); ctx.render();
    } }, 'Save'));
  setTimeout(() => name.focus(), 50);
}

// ---------------------------------------------------------------- Money lent
export function loans() {
  const s = ctx.snap() || {};
  const list = (s.lent || []).map(l => ({ ...l }));
  for (const r of pendingRows('tblLent')) list.push({ id: r['Loan ID'], by: r['Lent by'], borrower: r.Borrower, date: F_iso(r['Date lent']), amount: r['Amount (₹)'], followUp: r['Follow up on'] ? F_iso(r['Follow up on']) : null, notes: r.Notes || '', status: r.Status || 'Active', pending: true });
  applySets(list, 'tblLent', 'id', { Status: 'status', 'Follow up on': 'followUp' });
  const rep = (s.repaid || []).concat(pendingRows('tblRepaid').map(r => ({ id: r['Repayment ID'], loan: r['Loan ID'], date: F_iso(r.Date), amount: r['Amount (₹)'], by: r['Logged by'], pending: true })));
  return list.filter(l => l.status !== 'Deleted').map(l => {
    const paid = sum(rep.filter(r => r.loan === l.id), r => r.amount); const out = Math.max(0, (l.amount || 0) - paid);
    const fu = typeof l.followUp === 'number' ? F_iso(l.followUp) : l.followUp;
    return { ...l, followUp: fu, paid, outstanding: out, repayments: rep.filter(r => r.loan === l.id), state: out === 0 ? 'Settled' : fu && fu <= today() ? 'Follow up now' : 'Open' };
  });
}
export const followUps = () => loans().filter(l => l.state === 'Follow up now');
const PRESETS = [['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['3 months', 91]];
export function viewLent() {
  const list = loans(); const show = state.tab.lent || 'open';
  const shown = list.filter(l => show === 'all' || l.state !== 'Settled').sort((a, b) => (a.state === 'Settled') - (b.state === 'Settled') || String(a.followUp || '9').localeCompare(String(b.followUp || '9')));
  const tot = p => sum(list.filter(l => l.by === p), l => l.outstanding);
  const rows = shown.map(l => h('li', { class: 'li wrap tap', onclick: () => loanSheet(l) }, h('span', { class: 'lead' }, icon('hand', 16)),
    h('div', { class: 'body' }, h('div', { class: 'row-between' }, h('span', { class: 'ttl' }, l.borrower), l.state === 'Follow up now' ? tag('FOLLOW UP', 'warn') : l.state === 'Settled' ? tag('SETTLED', 'ok') : l.pending ? tag('NOT SYNCED', 'prov') : null),
      h('div', { class: 'sub' }, ['Lent by ' + l.by, F.date(l.date), l.followUp && l.state !== 'Settled' ? 'follow up ' + F.date(l.followUp) : null].filter(Boolean).join(' · '))),
    h('div', { class: 'end num' }, F.inr(l.outstanding), h('div', { class: 'sub' }, 'of ' + F.inr(l.amount)))));
  return { title: 'Money lent', back: 'more', body: [
    h('div', { class: 'tiles' }, ['Aravind', 'Madhu'].map(p => h('div', { class: 'tile' }, h('div', { class: 't-l' }, p + ' is owed'), h('div', { class: 't-v num' }, F.inr(tot(p)))))),
    h('div', { class: 'spacer' }),
    h('div', { class: 'toolbar' }, seg([['open', 'Open'], ['all', 'All']], show, v => { state.tab.lent = v; ctx.render(); }, 'Show')),
    card(null, null, rows.length ? h('ul', { class: 'list', id: 'lentlist' }, rows) : empty(show === 'open' ? 'Nobody owes you money.' : 'Nothing recorded yet.')),
    h('p', { class: 'hint', style: { margin: '10px 4px' } }, 'No interest. What is owed counts in the lender\'s net worth (cash), not in the FIRE corpus or the emergency fund.'),
    h('button', { class: 'btn primary wide', id: 'addloan', onclick: () => loanForm() }, icon('plus', 18), 'Record money lent')] };
}
function loanForm() {
  let by = ctx.who() || 'Aravind', fu = '';
  const who = h('div'); const drawWho = () => who.replaceChildren(seg(['Aravind', 'Madhu'], by, v => { by = v; drawWho(); }, 'Lent by')); drawWho();
  const borrower = h('input', { class: 'field', id: 'lborrower', placeholder: 'Name', maxlength: 40, 'aria-label': 'Borrower' });
  const amount = h('input', { class: 'field', id: 'lamount', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Amount' });
  const date = h('input', { class: 'field', type: 'date', id: 'ldate', value: today(), max: today(), 'aria-label': 'Date lent' });
  const fuBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Follow up' }); const fuIn = h('input', { class: 'field', type: 'date', id: 'lfollow', 'aria-label': 'Follow-up date', style: { width: 'auto' }, onchange: () => { fu = fuIn.value; drawFu(); } });
  const drawFu = () => fuBox.replaceChildren(...PRESETS.map(([l, d]) => { const v = addDays(date.value || today(), d); return h('button', { class: 'chip' + (fu === v ? ' on' : ''), onclick: () => { fu = fu === v ? '' : v; fuIn.value = fu; drawFu(); } }, l); }), fuIn);
  date.addEventListener('change', drawFu); drawFu();
  const notes = h('input', { class: 'field', id: 'lnotes', placeholder: 'Optional', maxlength: 80, 'aria-label': 'Note' });
  const close = sheet('Record money lent', field('Lent by', who), field('To', borrower), field('Amount (₹)', amount), field('Date', date), h('div', { class: 'label-sm' }, 'Follow up on'), fuBox, field('Note', notes), h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary wide', id: 'saveloan', onclick: async () => {
      const a = parseAmount(amount.value); const b = borrower.value.trim();
      if (!b) return toast('Who did you lend it to?', 'bad'); if (!(a > 0)) return toast('Type the amount', 'bad'); if (!need21()) return;
      await addRow('tblLent', 'Loan ID', { 'Loan ID': 'L-' + uuid().slice(0, 8), 'Lent by': by, Borrower: b, 'Date lent': serial(date.value || today()), 'Amount (₹)': a, 'Follow up on': fu ? serial(fu) : null, Notes: notes.value.trim() || null, Status: 'Active' }, 'loan', by + ' lent ₹' + a + ' to ' + b);
      close(); toast('Recorded ' + F.inr(a) + ' lent to ' + b); ctx.render();
    } }, 'Save'));
}
function loanSheet(l) {
  const close = sheet(l.borrower, h('div', { class: 'kv' }, h('span', {}, 'Lent by'), h('span', {}, l.by), h('span', {}, 'Lent on'), h('span', {}, F.date(l.date)), h('span', {}, 'Amount'), h('span', {}, F.inr(l.amount)),
    h('span', {}, 'Repaid'), h('span', {}, F.inr(l.paid)), h('span', {}, 'Still owed'), h('span', {}, F.inr(l.outstanding)), h('span', {}, 'Follow up on'), h('span', {}, l.followUp ? F.date(l.followUp) : '–'), l.notes ? [h('span', {}, 'Note'), h('span', {}, l.notes)] : null),
    l.repayments.length ? [h('div', { class: 'label-sm' }, 'Repayments'), h('ul', { class: 'list' }, l.repayments.map(r => h('li', { class: 'li' }, h('div', { class: 'body' }, h('div', { class: 'sub' }, F.date(r.date) + (r.by ? ' · logged by ' + r.by : ''))), h('div', { class: 'end num' }, F.inr(r.amount)))))] : null,
    h('div', { class: 'spacer' }),
    l.outstanding > 0 ? h('div', { class: 'btns' },
      h('button', { class: 'btn primary', id: 'repaybtn', onclick: () => { close(); repayForm(l); } }, 'Got money back'),
      h('button', { class: 'btn', onclick: () => { close(); followForm(l); } }, 'Change follow-up')) : null,
    h('button', { class: 'link', onclick: async () => { close(); if (!need21()) return; await setRow('tblLent', 'Loan ID', l.id, { Status: 'Deleted' }, { Status: l.status }); toast('Removed (kept in the tracker as Deleted)'); ctx.render(); } }, 'Remove this record'));
}
function repayForm(l) {
  const amount = h('input', { class: 'field', id: 'ramt', inputmode: 'decimal', value: String(l.outstanding), 'aria-label': 'Amount received' });
  const date = h('input', { class: 'field', type: 'date', id: 'rdate', value: today(), max: today(), 'aria-label': 'Date' });
  const close = sheet('Money back from ' + l.borrower, field('Amount (₹)', amount, 'Still owed ' + F.inr(l.outstanding)), field('Date', date), h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary wide', id: 'saverepay', onclick: async () => {
      const a = parseAmount(amount.value); if (!(a > 0)) return toast('Type the amount', 'bad'); if (a > l.outstanding + 0.001) return toast('That is more than what is owed', 'bad'); if (!need21()) return;
      await addRow('tblRepaid', 'Repayment ID', { 'Repayment ID': 'R-' + uuid().slice(0, 8), 'Loan ID': l.id, Date: serial(date.value || today()), 'Amount (₹)': a, 'Logged by': ctx.who(), Status: 'Active' }, 'repayment', l.borrower + ' repaid ₹' + a);
      close(); toast(a >= l.outstanding ? 'Settled. ' + l.borrower + ' owes nothing now.' : 'Recorded ' + F.inr(a)); ctx.render();
    } }, 'Save'));
}
function followForm(l) {
  let fu = l.followUp || '';
  const box = h('div', { class: 'chips' }); const inp = h('input', { class: 'field', type: 'date', value: fu, style: { width: 'auto' }, onchange: () => { fu = inp.value; draw(); } });
  const draw = () => box.replaceChildren(...PRESETS.map(([lab, d]) => { const v = addDays(today(), d); return h('button', { class: 'chip' + (fu === v ? ' on' : ''), onclick: () => { fu = v; inp.value = v; draw(); } }, lab); }), inp); draw();
  const close = sheet('Follow up with ' + l.borrower, box, h('div', { class: 'spacer' }), h('button', { class: 'btn primary wide', onclick: async () => { if (!need21()) return; await setRow('tblLent', 'Loan ID', l.id, { 'Follow up on': fu ? serial(fu) : null }, null); close(); toast('Follow-up set'); ctx.render(); } }, 'Save'));
}

// ---------------------------------------------------------------- Rollover budgets
// A budget applies from its month onward. Unused budget carries forward and overspend reduces the
// next month, within the financial year (April to March); everything starts again each April.
function history() {
  const s = ctx.snap() || {};
  const h0 = (s.budgetHistory || []).map((b, i) => ({ ...b, i }));
  pendingRows('tblBudget').forEach((r, k) => h0.push({ from: F_iso(r['Effective from']).slice(0, 7), category: r.Category, amount: r['Monthly budget'], i: 1e6 + k, pending: true }));
  return h0;
}
export function budgetFor(ym, cat, hist = history()) {
  const s = ctx.snap() || {};
  if (!hist.length) return ym === thisMonth() ? (s.budgets || {})[cat] || 0 : 0; // tracker before v21: only this month's figure
  const rows = hist.filter(b => b.category === cat && b.from <= ym).sort((a, b) => a.from.localeCompare(b.from) || a.i - b.i);
  return rows.length ? rows[rows.length - 1].amount : 0;
}
const fyStart = ym => { const [y, m] = ym.split('-').map(Number); return (m >= 4 ? y : y - 1) + '-04'; };
export function budgetsFor(ym) {
  const s = ctx.snap() || {}; const hist = history(); const cats = new Set([...(s.categories || []), ...hist.map(b => b.category), ...Object.keys(s.budgets || {})]);
  const entries = ctx.entriesView(); const spentIn = (m, c) => sum(entries.filter(e => e.category === c && (e.date || '').startsWith(m)), e => e.amount);
  const out = {};
  for (const c of cats) {
    const b = budgetFor(ym, c, hist); if (!b) continue;
    let carry = 0;
    if (hist.length) for (let m = fyStart(ym); m < ym; m = addMonths(m, 1)) { const bm = budgetFor(m, c, hist); if (bm > 0) carry += bm - spentIn(m, c); }
    out[c] = { budget: b, carry, avail: b + carry };
  }
  return out;
}
export const availableBudgets = ym => Object.fromEntries(Object.entries(budgetsFor(ym)).map(([c, x]) => [c, x.avail]));
export function budgetEditor() {
  const s = ctx.snap() || {}; const ym = thisMonth(); const cur = budgetsFor(ym); const cats = s.categories || [];
  const ins = cats.map(c => [c, h('input', { class: 'field', inputmode: 'decimal', 'aria-label': 'Budget for ' + c, value: cur[c] ? String(cur[c].budget) : '', placeholder: '0', style: { width: '120px' } })]);
  const close = sheet('Monthly budgets', h('p', { class: 'hint' }, 'From ' + F.monthLabel(ym, true) + ' onward, never backwards. Unused budget carries forward and overspend reduces next month, until it all resets on 1 April.'),
    ...ins.map(([c, el]) => field(c, el, cur[c] && cur[c].carry ? (cur[c].carry > 0 ? '+' : '') + F.inr(cur[c].carry) + ' carried in' : null)), h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary wide', id: 'savebudgets', onclick: async () => {
      if (!need21()) return; let n = 0;
      for (const [c, el] of ins) {
        const v = el.value.trim() === '' ? 0 : Number(el.value.replace(/[,₹\s]/g, '')); if (!(v >= 0)) return toast('Check the amount for ' + c, 'bad');
        if (v !== (cur[c] ? cur[c].budget : 0)) { await ctx.queue({ kind: 'addRow', table: 'tblBudget', values: { 'Effective from': serial(ym + '-01'), Category: c, 'Monthly budget': v, 'Set by': ctx.who(), 'Set at': stamp() }, what: 'budget', summary: c + ' ₹' + v + ' from ' + ym }); n++; }
      }
      ctx.scheduleSync(4000); close(); toast(n ? n + ' budget' + (n > 1 ? 's' : '') + ' changed from this month' : 'No change'); ctx.render();
    } }, 'Save'));
}

// ---------------------------------------------------------------- Chart notes (shared through the tracker)
export function notesFor(chart) {
  const s = ctx.snap() || {};
  const list = (s.chartNotes || []).filter(n => n.chart === chart).map(n => ({ ...n }));
  for (const r of pendingRows('tblChartNotes')) if (r.Chart === chart) list.push({ id: r['Note ID'], chart, month: F_iso(r.Month).slice(0, 7), note: r.Note, by: r['Added by'], pending: true });
  const del = new Set(pendingSets('tblChartNotes').filter(o => o.changes.Status === 'Deleted').map(o => o.id));
  return list.filter(n => !del.has(n.id)).sort((a, b) => b.month.localeCompare(a.month));
}
export function notesBlock(chart, months) {
  const list = notesFor(chart);
  return h('div', { class: 'chartnotes' },
    list.length ? h('ul', { class: 'list' }, list.slice(0, 6).map(n => h('li', { class: 'li wrap' }, h('span', { class: 'lead' }, icon('note', 14)),
      h('div', { class: 'body' }, h('div', { class: 'sub strong' }, F.monthLabel(n.month, true) + ': ' + n.note), h('div', { class: 'sub faint' }, (n.by || '') + (n.pending ? ' · not synced' : ''))),
      n.by === ctx.who() ? h('button', { class: 'iconbtn', 'aria-label': 'Delete note', onclick: async () => { if (!need21()) return; await setRow('tblChartNotes', 'Note ID', n.id, { Status: 'Deleted' }, null); toast('Note deleted'); ctx.render(); } }, icon('trash', 16)) : null))) : null,
    h('button', { class: 'btn small', 'data-chart': chart, onclick: () => noteForm(chart, months) }, icon('note', 14), 'Add a note'));
}
function noteForm(chart, months) {
  const ms = (months && months.length ? months : [thisMonth()]).slice().reverse();
  const sel = h('select', { class: 'field', id: 'notemonth', 'aria-label': 'Month' }, ms.map(m => h('option', { value: m }, F.monthLabel(m, true))));
  const txt = h('input', { class: 'field', id: 'notetext', maxlength: 80, placeholder: 'e.g. bonus month, car service', 'aria-label': 'Note' });
  const close = sheet('Note on the chart', field('Month', sel), field('Note', txt), h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary wide', id: 'savenote', onclick: async () => {
      const t = txt.value.trim(); if (!t) return toast('Type the note', 'bad'); if (!need21()) return;
      await addRow('tblChartNotes', 'Note ID', { 'Note ID': 'N-' + uuid().slice(0, 8), Chart: chart, Month: serial(sel.value + '-01'), Note: t, 'Added by': ctx.who(), 'Added at': stamp(), Status: 'Active' }, 'chart note', chart + ' · ' + sel.value + ': ' + t);
      close(); toast('Note added for both of you'); ctx.render();
    } }, 'Save'));
  setTimeout(() => txt.focus(), 50);
}

// ---------------------------------------------------------------- What moved this month (balances kept on this phone)
export async function recordHistory(snap) {
  if (!snap || snap.sample) return;
  const ym = (snap.fileModified || new Date().toISOString()).slice(0, 7);
  const accounts = (snap.otherAssets || []).map(a => ({ name: a.name, aravind: a.aravind || 0, madhu: a.madhu || 0, family: a.family || 0 }));
  const classes = (snap.classes || []).map(c => ({ name: c.name, aravind: c.aravind || 0, madhu: c.madhu || 0, family: c.family || 0 }));
  await ctx.V.put('nwhist', ym, { ym, at: new Date().toISOString(), nw: snap.netWorth || {}, classes, accounts });
}
// ---------------------------------------------------------------- Safety card
export function safetyCard() {
  const s = ctx.snap(); if (!s) return null;
  const em = s.emergency || {}; const pr = s.protection || {};
  const term = Object.entries(pr).find(([l]) => /life cover \(term\)|term/i.test(l) && !/vs/i.test(l)); const health = Object.entries(pr).find(([l]) => /health/i.test(l));
  const renew = (s.insurance || []).filter(x => x.days !== null && x.days !== undefined && x.days <= 30);
  const noNom = (s.nominees || []).filter(n => !n.nominee).length;
  const row = (ok, ttl, sub, view) => h('li', { class: 'li tap', onclick: () => ctx.go(view) }, h('span', { class: 'statusic ' + (ok ? 'ok' : 'warn'), 'aria-hidden': 'true' }, icon(ok ? 'check' : 'alert', 14)), h('div', { class: 'body' }, h('div', { class: 'ttl' }, ttl), h('div', { class: 'sub' }, sub)));
  const hv = health ? (health[1].family ?? ((health[1].aravind || 0) + (health[1].madhu || 0))) : 0;
  return card('Safety net', null, h('ul', { class: 'list', id: 'safety' },
    row((em.monthsCovered || 0) >= (em.months || 6), 'Emergency fund', em.months ? (em.monthsCovered || 0).toFixed(1) + ' of ' + em.months + ' months covered' : 'Set the months to keep', 'plan'),
    row(!!(term && term[1].family), 'Life cover', term && term[1].family ? F.inrShort(term[1].family) + ' term cover' : 'No term cover recorded', 'protection'),
    row(hv > 0, 'Health cover', hv > 0 ? F.inrShort(hv) + ' recorded' : 'No health cover recorded', 'protection'),
    row(!renew.length, 'Renewals', renew.length ? renew.length + ' due within 30 days' : 'Nothing due within 30 days', 'protection'),
    row(!noNom, 'Nominees', noNom ? noNom + ' account' + (noNom > 1 ? 's' : '') + ' without a nominee' : 'All accounts listed have one', 'documents')));
}

// ---------------------------------------------------------------- Net worth in years of retirement spend
export function nwYears(snap, person) {
  if (!snap) return null; const nw = snap.netWorth ? snap.netWorth[person === 'Family' ? 'family' : person.toLowerCase()] : null;
  const m = snap.retireMonthly || 72500; if (typeof nw !== 'number' || !m) return null;
  return nw / (m * 12);
}

// ---------------------------------------------------------------- Goal icons (chosen on each phone)
const GOAL_ICONS = ['c_home', 'g_leaf', 'c_car', 'c_child', 'g_cap', 'g_plane', 'c_health', 'g_gift', 'g_coin', 'flame', 'shield', 'c_star'];
export function goalIcon(name, size = 18) {
  const ic = (ctx.settings().goalIcons || {})[name] || (/land|farm|agri/i.test(name) ? 'g_leaf' : /house|home|plot/i.test(name) ? 'c_home' : /car/i.test(name) ? 'c_car' : /child|kid|educat/i.test(name) ? 'g_cap' : /trip|travel/i.test(name) ? 'g_plane' : 'c_star');
  return h('button', { class: 'goalic', 'aria-label': 'Change icon for ' + name, onclick: e => { e.stopPropagation(); pickGoalIcon(name); } }, icon(ic, size));
}
function pickGoalIcon(name) {
  const close = sheet('Icon for ' + name, h('div', { class: 'icongrid' }, GOAL_ICONS.map(ic => h('button', { class: 'chip', 'aria-label': ic, onclick: async () => { await ctx.saveSettings({ goalIcons: Object.assign({}, ctx.settings().goalIcons, { [name]: ic }) }); close(); ctx.render(); } }, icon(ic, 22)))),
    h('p', { class: 'hint' }, 'Saved on this phone only.'));
}
// ---------------------------------------------------------------- Category icons (chosen on each phone, like goal icons)
export function viewCatIcons() {
  const s = ctx.snap() || {}; const inc = state.iconKind === 'income';
  const names = inc ? (s.incomeCats || []).map(c => c.name) : (s.categories || []);
  const pick = name => { const close = sheet('Icon for ' + name, h('div', { class: 'icongrid', id: 'caticongrid' }, CAT_ICONS.map(ic => h('button', { class: 'chip', 'aria-label': ic, 'data-icon': ic, onclick: async () => {
    await ctx.saveSettings({ catIcons: Object.assign({}, ctx.settings().catIcons, { [name]: ic }) }); setCatIcons(ctx.settings().catIcons); close(); ctx.render(); } }, icon(ic, 22)))), h('p', { class: 'hint' }, 'Saved on this phone only.')); };
  return { title: inc ? 'Income category icons' : 'Expense category icons', back: 'tracker', body: [card(null, null, names.length ? h('ul', { class: 'list', id: 'caticons' }, names.map(n => h('li', { class: 'li tap', 'data-cat': n, onclick: () => pick(n) }, catIcon(n), h('div', { class: 'body' }, h('div', { class: 'ttl' }, n)), h('span', { class: 'hint' }, 'Change')))) : empty('Sync with the tracker first.'),
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Tap a category to pick its icon. New categories you add get one here too.'))] };
}
export function forecastLine(g) {
  if (!g.forecast) return null;
  if (g.projected === null || g.projected === undefined) return h('div', { class: 'sub' }, 'Forecast on: set a monthly contribution in the tracker.');
  const ok = (g.cover || 0) >= 1;
  return h('div', { class: 'sub ' + (ok ? 'gain' : 'loss') }, 'Forecast: ' + F.inrShort(g.projected) + ' by ' + (g.year || '–') + ' at ' + F.inr(g.monthly || 0) + '/month · ' + (ok ? 'enough' : F.pct(g.cover || 0, 0) + ' of the cost'));
}

// ---------------------------------------------------------------- Learned category (this phone only)
const words = t => [...new Set(String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !/^\d+$/.test(w)))];
export async function learn(note, category) {
  const ws = words(note); if (!ws.length || !category) return;
  const L = Object.assign({}, ctx.settings().learn);
  for (const w of ws) { const m = Object.assign({}, L[w]); m[category] = (m[category] || 0) + 1; L[w] = m; }
  const keys = Object.keys(L); if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) delete L[k];
  await ctx.saveSettings({ learn: L });
}
export function guessCategory(note, cats) {
  const L = ctx.settings().learn || {}; const score = {};
  for (const w of words(note)) for (const [c, n] of Object.entries(L[w] || {})) if (cats.includes(c)) score[c] = (score[c] || 0) + n;
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : '';
}

// ---------------------------------------------------------------- Suggestion box (separate file in OneDrive)
export function viewSuggest() {
  const file = ctx.V.get('sync', 'suggestFile'); const mine = ctx.V.all('suggest').sort((a, b) => b.at.localeCompare(a.at));
  const remote = (ctx.V.get('sync', 'suggestRows') || {}).rows || [];
  const area = h('select', { class: 'field', id: 'sgarea', 'aria-label': 'Screen or area' }, ['Home', 'Money', 'Add expense', 'Add income', 'Wealth', 'Goals & FIRE', 'Month-end update', 'Money lent', 'Events', 'Settings', 'Other'].map(a => h('option', { value: a }, a)));
  let pr = 'Medium'; const prBox = h('div'); const drawPr = () => prBox.replaceChildren(seg(['High', 'Medium', 'Low'], pr, v => { pr = v; drawPr(); }, 'Priority')); drawPr();
  const text = h('textarea', { class: 'field', id: 'sgtext', rows: 3, maxlength: 400, placeholder: 'What would make the app better?', 'aria-label': 'Suggestion' });
  const link = h('input', { class: 'field', id: 'sglink', placeholder: 'OneDrive link to Suggestion_Box.xlsx', 'aria-label': 'Suggestion box link' });
  const status = id => { const r = remote.find(x => x.ID === id); return r ? r.Status || 'New' : null; };
  return { title: 'Suggestion box', back: 'more', body: [
    card('New suggestion', null, field('About', area), field('Priority', prBox), text, h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary wide', id: 'sendsg', onclick: async () => {
        const t = text.value.trim(); if (!t) return toast('Type your suggestion', 'bad');
        const rec = { id: 'S-' + uuid().slice(0, 8), at: new Date().toISOString(), area: area.value, text: t, priority: pr, by: ctx.who() || 'Aravind', sent: false };
        await ctx.V.put('suggest', rec.id, rec); toast(file ? 'Saved. It goes to the suggestion box at the next sync.' : 'Saved on this phone. Connect the suggestion box file below to send it.'); ctx.scheduleSync(2000); ctx.render();
      } }, 'Save suggestion')),
    card('Your suggestions', null, mine.length ? h('ul', { class: 'list', id: 'sglist' }, mine.map(x => h('li', { class: 'li wrap' }, h('span', { class: 'lead' }, icon('msg', 16)),
      h('div', { class: 'body' }, h('div', { class: 'sub strong' }, x.text), h('div', { class: 'sub faint' }, [x.area, x.priority, F.date(x.at.slice(0, 10)), x.sent ? 'Status: ' + (status(x.id) || 'New') : 'not sent yet'].join(' · ')))))) : empty('None yet.')),
    card('Suggestion box file', null, file ? h('p', { class: 'hint' }, 'Connected: ' + file.name) : [h('p', { class: 'hint' }, 'Put Suggestion_Box.xlsx in OneDrive, share it with "Can edit", and paste its link here.'), link,
      h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: async () => { try { await ctx.connectSuggest(link.value); toast('Suggestion box connected'); ctx.render(); } catch (e) { toast(e.message, 'bad'); } } }, 'Connect')],
      file ? h('button', { class: 'link', onclick: async () => { await ctx.V.remove('sync', 'suggestFile'); ctx.render(); } }, 'Disconnect') : null)] };
}
