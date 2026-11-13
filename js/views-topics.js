// More, organised by money topic (Aravind, 9 Nov 2026). Each tile opens one page with that topic's screens and
// everything you type for it, so there is no separate "Update tracker" list any more.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, tag, card } from './ui.js';
import { formStatus } from './views-forms.js';
import { FORMS } from './forms.js';
import * as C2 from './views-c2.js';
import { yearData, fyOf, fyLabel } from './views-year.js';

// items: [kind, id, icon, title, sub, topic]. topic (forms only): show only that topic's rows of a shared sheet. kind: 'view' opens a screen, 'form' a tracker form, 'act' runs a function.
export const TOPICS = [
  { id: 'expenses', icon: 'spend', title: 'Expenses', sub: 'Recurring, events, expense lists', items: [
    ['view', 'recurring', 'calendar', 'Recurring', 'Rent and other fixed amounts, added after you approve'],
    ['view', 'events', 'c_tag', 'Events', 'Trips, festivals, functions and what they cost'],
    ['head', 'Lists'], ['form', 'expcatnames'], ['form', 'expcats'], ['form', 'paymodes'], ['icons', 'expense', 'c_tag', 'Category icons', 'Pick an icon for each expense category (this phone)']] },
  { id: 'income', icon: 'g_coin', title: 'Income', sub: 'Income lists', items: [
    ['head', 'Lists'], ['form', 'inccats'], ['form', 'incaccts'], ['icons', 'income', 'c_tag', 'Category icons', 'Pick an icon for each income category (this phone)']] },
  { id: 'equity', icon: 'up', title: 'Equity', sub: 'Kite (India), international stocks, other equity', items: [
    ['view', 'kite', 'upload', 'Kite holdings', 'Paste each account from Kite; account names'],
    ['form', 'intl', 'up', 'International holdings', 'US stocks, with the broker and currency of each'],
    ['form', 'brokers', 'gear', 'International brokers', 'Each broker\'s owner, holdings date, currency and ₹ rate'],
    ['view', 'intlpaste', 'upload', 'International prices', 'Paste the INDmoney Current Holdings screen for US prices'],
    ['form', 'currencies', 'g_coin', 'Currencies', 'USD and up to 5 more (e.g. JPY), with today\'s ₹ rate'],
    ['form', 'otherhold', 'pie', 'Other equity outside Kite', 'Equity ETFs, REITs, InvITs and shares from the CAS, unlisted shares, smallcase / PMS', 'equity'],
    ['head', 'Sectors'], ['form', 'sectors'], ['form', 'sectorlist']] },
  { id: 'mf', icon: 'pie', title: 'Mutual funds', sub: 'Equity, debt and arbitrage funds', items: [
    ['view', 'cas', 'doc', 'CAS statement', 'Upload the monthly CDSL PDF: every holding in it, and a quantity check'],
    ['form', 'otherhold', 'pie', 'Mutual fund folios', 'Funds held outside demat', 'mf']] },
  { id: 'cash', icon: 'bank', title: 'Cash & fixed income', sub: 'Bank, cash, bonds, FD / RD, EPF, gratuity, NPS, money lent', items: [
    ['form', 'assets', 'bank', 'Bank, cash and balances', 'Savings accounts, cash at home, NPS, PPF and more', 'cash'],
    ['form', 'otherhold', 'doc', 'Bonds, NCDs and G-secs', 'Bonds (e.g. Wint Wealth), NCDs, G-secs, T-bills and SDLs', 'cash'],
    ['view', 'deposits', 'calendar', 'FD / RD', 'Each FD and RD once, with its maturity; matured and closed ones'],
    ['view', 'epf', 'bank', 'EPF', 'Opening balance, monthly amount for the year, interest when credited'],
    ['view', 'gratuity', 'g_coin', 'Gratuity', 'Company, joining date and basic + DA, for Aravind and Madhu'],
    ['view', 'lent', 'hand', 'Money lent', 'Who owes you, and when to follow up']] },
  { id: 'gold', icon: 'g_coin', title: 'Gold & other assets', sub: 'Gold, silver, SGBs, schemes, lending, deposits, land, vehicles', items: [
    ['form', 'gold'],
    ['form', 'otherhold', 'g_coin', 'Gold, silver and other holdings', 'SGBs, gold and silver ETFs, digital gold or silver, jeweller gold schemes, chit funds, P2P and other lending', 'gold'],
    ['form', 'assets', 'bank', 'Rental deposit, land and other assets', 'Rental deposit, land / property, physical silver and other assets', 'gold'],
    ['form', 'vehicles']] },
  { id: 'loans', icon: 'loan', title: 'Loans', sub: 'Outstanding, rate, EMI and dates', items: [['form', 'loans']] },
  { id: 'fire', icon: 'flame', title: 'FIRE & goals', sub: 'Goals, FIRE assumptions', items: [['form', 'goals'], ['form', 'settings', 'gear']] },
  { id: 'yearly', icon: 'shield', title: 'Yearly & one-time', sub: 'Insurance, documents, handover, year in review', items: [
    ['view', 'protection', 'shield', 'Insurance', 'Policies, cover and renewals'],
    ['view', 'documents', 'doc', 'Documents and nominees', 'Where documents are kept, nominees'],
    ['view', 'handover', 'shield', 'Handover', 'If something happens: accounts, contacts, access and steps'],
    ['view', 'year', 'chart', 'Year in review', 'Financial year income, spending, savings rate, net worth and goals'],
    ['head', 'Update'], ['form', 'insurance'], ['form', 'documents'], ['form', 'nominees'], ['form', 'wills']] },
  { id: 'app', icon: 'gear', title: 'App', sub: 'Sign in, settings, suggestions, lock', items: [
    ['view', 'signin', 'sync', 'Sign in & tracker', 'Microsoft account, the tracker file, last sync'],
    ['view', 'settings', 'gear', 'Settings', 'Lock, fingerprint, theme, backup, new tracker version'],
    ['view', 'suggest', 'msg', 'Suggestion box', 'Ideas and problems with the app'],
    ['act', 'lock', 'lock', 'Lock now', 'Locks the app on this device'],
    ['head', 'Advanced lists'], ['view', 'grouping', 'pie', 'How holdings are grouped', 'Holding types and classes, and the grouping rules']] },
];
// "How holdings are grouped": one page, two lists
export function viewGrouping() {
  const s = ctx.snap();
  const row = f => h('li', { class: 'li tap', id: 'tp-' + f.id, onclick: () => { state.formId = f.id; ctx.go('form'); } }, h('span', { class: 'lead' }, icon('edit')), h('div', { class: 'body' }, h('div', { class: 'ttl' }, f.title), h('div', { class: 'sub' }, s ? f.sub + ' · ' + formStatus(f).text : 'Sync with the tracker first')), icon('right', 16));
  const F_ = id => FORMS.find(x => x.id === id);
  return { title: 'How holdings are grouped', back: 'tracker', body: [
    card('Types and classes', null, h('ul', { class: 'list' }, [F_('invmap')].filter(Boolean).map(row))),
    card('Grouping rules', null, h('ul', { class: 'list' }, [F_('typerules'), F_('typeover')].filter(Boolean).map(row)))] };
}

const isoNow = () => new Date().toISOString().slice(0, 10);
function headline(id, s) {
  if (!s) return null;
  if (id === 'expenses') { const ym = isoNow().slice(0, 7); const t = (ctx.entriesView() || []).filter(e => e.status !== 'Deleted' && String(e.date).slice(0, 7) === ym).reduce((a, e) => a + Number(e.amount || 0), 0); return ['Spent this month', F.inr(t)]; }
  if (id === 'income') { const y = fyOf(isoNow()); return ['Income in ' + fyLabel(y) + ' so far', F.inr(yearData(s, ctx.entriesView(), y, 'Family').income)]; }
  if (id === 'loans' && s.loanTotals) return ['Outstanding', F.inr(s.loanTotals.family || 0)];
  if (id === 'fire' && s.fire && typeof s.fire.progress === 'number') return ['FIRE progress', F.pct(s.fire.progress, 0)];
  return null;
}
function badge(id, s) {
  if (id === 'yearly') { const n = ((s && s.insurance) || []).filter(x => x.days !== null && x.days !== undefined && x.days <= 60).length; return n ? tag(n + ' due', 'warn') : null; }
  if (id === 'cash') { const n = C2.followUps().length; return n ? tag(n + ' due', 'warn') : null; }
  return null;
}

// a topic with one screen opens that screen straight away (no "Loans › Loans" double tap); Back returns to More
function openTopic(t) {
  state.topic = t.id; state.fromTopic = null; const only = t.items.filter(i => i[0] !== 'head');
  if (only.length === 1 && only[0][0] === 'form') { state.formId = only[0][1]; state.formBack = 'more'; return ctx.go('form'); }
  if (only.length === 1 && only[0][0] === 'view') { state.formBack = 'more'; return ctx.go(only[0][1]); }
  ctx.go('tracker');
}
export function viewMoreTopics() {
  const s = ctx.snap();
  const month = h('section', { class: 'card', id: 'monthstrip' }, h('div', { class: 'li tap', onclick: () => ctx.go('monthly') }, h('span', { class: 'lead' }, icon('wizard')),
    h('div', { class: 'body' }, h('div', { class: 'ttl' }, 'Month-end update'), h('div', { class: 'sub' }, 'Pick the month, then 8 short steps; saved and invested fill in by themselves')), icon('right', 16)));
  const tiles = h('div', { class: 'tiles', id: 'topics' }, TOPICS.map(t => h('button', { type: 'button', class: 'tile', 'data-topic': t.id, onclick: () => openTopic(t) },
    h('div', { class: 't-l' }, icon(t.icon, 16), badge(t.id, s)), h('div', { class: 't-v tile-name', style: { fontSize: '1rem' } }, t.title), h('div', { class: 't-s', style: { whiteSpace: 'normal' } }, t.sub))));
  return { title: 'More', body: [month, h('div', { class: 'spacer' }), tiles] };
}

export function viewTopic() {
  const t = TOPICS.find(x => x.id === state.topic) || TOPICS[0]; const s = ctx.snap();
  const row = (id, ic, ttl, sub, onclick) => h('li', { class: 'li tap', id: 'tp-' + id, onclick }, h('span', { class: 'lead' }, icon(ic)), h('div', { class: 'body' }, h('div', { class: 'ttl' }, ttl), h('div', { class: 'sub' }, sub)), icon('right', 16));
  const groups = [[null, []]];
  for (const it of t.items) {
    if (it[0] === 'head') { groups.push([it[1], []]); continue; }
    const list = groups[groups.length - 1][1];
    if (it[0] === 'view') list.push(row(it[1], it[2], it[3], it[4], () => { state.fromTopic = it[1]; ctx.go(it[1]); }));
    else if (it[0] === 'topic') list.push(row(it[1] + '-link', it[2], it[3], it[4], () => { state.topic = it[1]; ctx.render(); window.scrollTo(0, 0); }));
    else if (it[0] === 'icons') list.push(row('icons-' + it[1], it[2], it[3], it[4], () => { state.iconKind = it[1]; state.fromTopic = 'caticons'; ctx.go('caticons'); }));
    else if (it[0] === 'act') list.push(row(it[1], it[2], it[3], it[4], () => ctx.lockNow()));
    else { const f = FORMS.find(x => x.id === it[1]); if (!f) continue; list.push(row(f.id, it[2] || 'edit', it[3] || f.title, s ? (it[4] ? it[4] + ' · ' : '') + formStatus(f, it[5] || null).text : 'Sync with the tracker first', () => { state.formId = f.id; state.formTopic = it[5] || null; state.formTitle = it[5] ? it[3] : null; state.formSub = it[5] ? it[4] : null; ctx.go('form'); })); }
  }
  const hl = headline(t.id, s);
  const waiting = ctx.V.all('outbox').filter(o => o.kind === 'setCells').length;
  return { title: t.title, back: 'more', body: [
    hl ? h('div', { class: 'tile', style: { cursor: 'default', marginBottom: '12px' }, id: 'tphead' }, h('div', { class: 't-l' }, hl[0]), h('div', { class: 't-v' }, hl[1])) : null,
    ...groups.filter(g => g[1].length).map(([head, items]) => card(head, null, h('ul', { class: 'list' }, items))),
    waiting ? h('p', { class: 'hint', style: { margin: '8px 4px' } }, waiting + ' change' + (waiting === 1 ? '' : 's') + ' waiting to sync.') : null] };
}
