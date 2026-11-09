// Year in review: one financial year (April to March) at a glance. Income, spending, savings rate, net worth change
// and goal progress, for the family or one person, with the year before for comparison where there is data.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, seg, card, empty, bar, tag } from './ui.js';

// FY that a date (YYYY-MM or YYYY-MM-DD) falls in: April 2026 to March 2027 is 2026
export const fyOf = d => { const y = Number(String(d).slice(0, 4)), m = Number(String(d).slice(5, 7)); return m >= 4 ? y : y - 1; };
export const fyLabel = y => 'FY ' + y + '-' + String((y + 1) % 100).padStart(2, '0');
const inFy = (d, y) => !!d && fyOf(d) === y;
const sum = (a, f) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const pctChange = (a, b) => (b ? (a - b) / Math.abs(b) : null);

export function yearData(s, entries, y, p) {
  const who = x => p === 'Family' || x === p;
  const inc = (s.income || []).filter(e => e.status !== 'Deleted' && inFy(e.date || e.month, y) && who(e.person));
  const sp = (entries || []).filter(e => e.status !== 'Deleted' && inFy(e.date, y) && who(e.by));
  const income = sum(inc, e => e.amount), spent = sum(sp, e => e.amount);
  const byCat = {}; for (const e of sp) byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0);
  const incCat = {}; for (const e of inc) incCat[e.category] = (incCat[e.category] || 0) + Number(e.amount || 0);
  const months = new Set([...inc.map(e => String(e.date || e.month).slice(0, 7)), ...sp.map(e => e.date.slice(0, 7))]);
  const byMonth = {}; for (const e of sp) { const m = e.date.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + Number(e.amount || 0); }
  const top = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0] || null;
  const k = p === 'Family' ? 'nwF' : p === 'Aravind' ? 'nwA' : 'nwM';
  const nwRows = (s.monthly || []).filter(r => inFy(r.month, y) && typeof r[k] === 'number' && r[k] !== 0);
  const nwStart = nwRows.length ? nwRows[0] : null, nwEnd = nwRows.length ? nwRows[nwRows.length - 1] : null;
  const savedInv = p === 'Family' ? sum((s.monthly || []).filter(r => inFy(r.month, y)), r => r.saved) : null;
  return { y, income, spent, left: income - spent, rate: income ? (income - spent) / income : null, byCat, incCat, months: months.size, topMonth: top,
    nwStart, nwEnd, nwKey: k, nwChange: nwStart && nwEnd && nwStart !== nwEnd ? nwEnd[k] - nwStart[k] : null, savedInv, nIncome: inc.length, nSpend: sp.length };
}

export function yearsWithData(s, entries) {
  const ys = new Set();
  for (const e of s.income || []) if (e.date || e.month) ys.add(fyOf(e.date || e.month));
  for (const e of entries || []) if (e.date) ys.add(fyOf(e.date));
  for (const r of s.monthly || []) if (r.month && (r.income || r.saved || r.nwF)) ys.add(fyOf(r.month));
  ys.add(fyOf(new Date().toISOString().slice(0, 10)));
  return [...ys].sort((a, b) => b - a);
}

export function viewYear() {
  const s = ctx.snap();
  if (!s) return { title: 'Year in review', back: 'more', body: [card(null, null, empty('Sync with the tracker first.'))] };
  const entries = ctx.entriesView();
  const years = yearsWithData(s, entries);
  if (!state.yrFy || !years.includes(state.yrFy)) state.yrFy = years[0];
  if (!state.yrPerson) state.yrPerson = 'Family';
  const y = state.yrFy, p = state.yrPerson;
  const d = yearData(s, entries, y, p), prev = yearData(s, entries, y - 1, p);
  const hasPrev = prev.nIncome + prev.nSpend > 0;
  const now = fyOf(new Date().toISOString().slice(0, 10));
  const cmp = (a, b, upGood = true) => { const c = hasPrev ? pctChange(a, b) : null; if (c === null) return null; const good = upGood ? c >= 0 : c <= 0; return h('span', { class: 'delta ' + (good ? 'up' : 'down') }, (c >= 0 ? '▲ ' : '▼ ') + F.pct(Math.abs(c), 0) + ' vs ' + fyLabel(y - 1)); };
  const row = (l, v, extra) => [h('span', {}, l), h('span', { class: 'num' }, v, extra ? h('span', { class: 'fsub' }, ' ', extra) : null)];

  const top = Object.entries(d.byCat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const goals = (s.goals || []).filter(g => p === 'Family' || g.owner === p || g.owner === 'Family' || g.owner === 'Both');
  const nwLine = d.nwChange !== null
    ? F.inr(d.nwEnd[d.nwKey]) + ' in ' + F.monthLabel(d.nwEnd.month) + ', ' + (d.nwChange >= 0 ? 'up ' : 'down ') + F.inr(Math.abs(d.nwChange)) + ' since ' + F.monthLabel(d.nwStart.month)
    : 'Needs month-end net worth for at least two months of this year (Month-end update).';
  return { title: 'Year in review', back: 'more', body: [
    h('h2', { class: 'formhead' }, 'Year in review'),
    h('div', { class: 'toolbar' },
      seg(years.slice(0, 4).map(v => [v, fyLabel(v)]), y, v => { state.yrFy = Number(v); ctx.render(); }, 'Financial year'),
      seg([['Family', 'Family'], ['Aravind', 'Aravind'], ['Madhu', 'Madhu']], p, v => { state.yrPerson = v; ctx.render(); }, 'Whose year')),
    h('p', { class: 'hint', style: { margin: '0 4px 12px' }, id: 'yrnote' }, fyLabel(y) + ' runs April ' + y + ' to March ' + (y + 1) + (y === now ? ', so it is still going: figures are to date.' : '.') + (d.months ? ' ' + d.months + ' month' + (d.months === 1 ? '' : 's') + ' with entries.' : '')),
    h('div', { class: 'grid two' },
      card('Money in and out', null, d.nIncome + d.nSpend ? h('div', { class: 'kv', id: 'yrmoney' },
        ...row('Income', F.inr(d.income), cmp(d.income, prev.income)),
        ...row('Spent', F.inr(d.spent), cmp(d.spent, prev.spent, false)),
        ...row('Left after spending', F.inr(d.left)),
        ...row('Savings rate', d.rate === null ? '–' : F.pct(d.rate, 0), hasPrev && prev.rate !== null && d.rate !== null ? h('span', { class: 'delta ' + (d.rate >= prev.rate ? 'up' : 'down') }, (d.rate >= prev.rate ? '▲ ' : '▼ ') + Math.abs(Math.round((d.rate - prev.rate) * 100)) + ' points') : null),
        ...(d.savedInv ? row('Saved & invested (monthly update)', F.inr(d.savedInv)) : [])) : empty('No income or spending entered for this year yet.'),
        d.rate !== null ? bar(Math.max(0, Math.min(1, d.rate)), d.rate >= 0.5 ? 'good' : d.rate >= 0.3 ? 'warn' : 'crit') : null,
        h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Savings rate here = income minus logged spending, divided by income. Spending is daily expenses only (no EMIs, insurance or investments).')),
      card('Net worth', null, h('p', { id: 'yrnw' }, nwLine)),
      card('Where the money went', null, top.length ? h('ul', { class: 'list', id: 'yrcats' }, top.map(([c, v]) => h('li', { class: 'li' }, h('div', { class: 'body' }, h('div', { class: 'row-between' }, h('div', { class: 'ttl' }, c), h('span', { class: 'num' }, F.inr(v))), bar(d.spent ? v / d.spent : 0, ''), h('div', { class: 'sub' }, F.pct(d.spent ? v / d.spent : 0, 0) + ' of spending'))))) : empty('No spending logged.'),
        d.topMonth ? h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Highest month: ' + F.monthLabel(d.topMonth[0] + '-01') + ' (' + F.inr(d.topMonth[1]) + ').') : null),
      card('Income by type', null, Object.keys(d.incCat).length ? h('div', { class: 'kv', id: 'yrinc' }, Object.entries(d.incCat).sort((a, b) => b[1] - a[1]).flatMap(([c, v]) => row(c, F.inr(v)))) : empty('No income entered.')),
      card('Goals', null, goals.length ? h('ul', { class: 'list', id: 'yrgoals' }, goals.map(g => h('li', { class: 'li' }, h('div', { class: 'body' },
        h('div', { class: 'row-between' }, h('div', { class: 'ttl' }, g.name), g.status ? tag(String(g.status).toUpperCase(), /behind/i.test(g.status) ? 'warn' : 'good') : null),
        bar(Math.max(0, Math.min(1, g.progress || 0)), /behind/i.test(g.status || '') ? 'warn' : 'good'),
        h('div', { class: 'sub' }, F.pct(g.progress || 0, 0) + ' saved · ' + F.inr(g.saved || 0) + ' of ' + F.inr(g.future || g.cost || 0) + (g.year ? ' by ' + g.year : '')))))) : empty('No goals set.'),
        h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Goal progress is as of today (the tracker keeps the current figure, not a year-end one).')))] };
}
