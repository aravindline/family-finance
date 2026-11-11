// Wealth, Plan, Protection, Documents, Alerts and the More menu. Read-only views of the tracker.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, seg, tag, bar, card, moreBtn, empty, statusKind, statusIcon, trendChart, SERIES, sheet, donut } from './ui.js';
import { personSeg, asOfLine, trendPoints } from './views-main.js';
import * as C2 from './views-c2.js';
import { slotsOf, slotLabel } from './views-kite.js';
import { goalSheet, goalLinked } from './views-v12.js';
import { EMERGENCY } from './wealth.js';
import * as V13 from './views-v13.js';

const key = p => (p === 'Family' ? 'family' : p.toLowerCase());
const sum = (a, f) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const noData = title => ({ title, body: [card(null, null, empty('No data yet. Sync with the tracker, or load sample data in Settings.'))] });
const li = (ttl, sub, end, endSub, opts = {}) => h('li', { class: 'li' + (opts.wrap ? ' wrap' : '') + (opts.onclick ? ' tap' : ''), onclick: opts.onclick || null }, opts.lead || null,
  h('div', { class: 'body' }, h('div', { class: 'ttl' }, ttl), sub ? h('div', { class: 'sub' }, sub) : null), end !== undefined && end !== null ? h('div', { class: 'end num' }, end, endSub ? h('div', { class: 'sub' }, endSub) : null) : null);
const ownerOk = (o, p) => p === 'Family' || !o || o === p || o === 'Family' || o === 'Joint';
const retCls = v => (v > 0 ? 'gain' : v < 0 ? 'loss' : '');
const tabs = (name, options) => { const v = state.tab[name] || options[0][0]; return [v, seg(options, v, x => { state.tab[name] = x; ctx.render(); ctx.saveSettings({ lastTab: Object.assign({}, state.tab) }); }, name)]; };

// ---------------------------------------------------------------- Wealth
// The four Investments rows: always shown, even at ₹0.
export const INV_GROUPS = [['ind', 'Indian equity'], ['intl', 'International equity'], ['mf', 'Mutual funds'], ['gb', 'Gold & bonds']];
export function invGroup(x, src) {
  const t = String(x.type || '') + ' ' + String(x.name || '');
  if (src === 'intl') return 'intl';
  if (src === 'kite') return /\bMF\b|fund/i.test(x.type || '') ? 'mf' : /gold|SGB|bond/i.test(x.type || '') ? 'gb' : 'ind';
  if (/gold|bond|SGB|NCD/i.test(x.type || '')) return 'gb';
  if (/\bMF\b|fund|ETF/i.test(x.type || '')) return 'mf';
  if (/\bUS\b|international|intl/i.test(t)) return 'intl';
  return 'ind';
}
export function checksCount(s) { return (s.health || []).filter(x => statusKind(x.status) !== 'ok').length; }
export function viewWealth() {
  const s = ctx.snap(); if (!s) return noData('Wealth');
  const p = state.person, k = key(p);
  const [tab, tabSeg] = tabs('wealth', [['overview', 'Overview'], ['invest', 'Investments'], ['assets', 'Assets & loans'], ['goals', 'Goals & FIRE']]);
  tabSeg.classList.add('grid2');
  const body = [h('div', { class: 'toolbar' }, tabSeg), tab === 'goals' ? null : h('div', { class: 'toolbar' }, personSeg())];

  if (tab === 'overview') {
    const pts = trendPoints(s, p);
    const t = s.totals || {}; const A = t.assets || {}, L = t.loans || {}, N = t.netWorth || {};
    const nw = s.netWorth ? s.netWorth[k] : N[k]; let delta = null; if (pts.length >= 2) delta = pts[pts.length - 1].y - pts[pts.length - 2].y;
    const y = C2.nwYears(s, p);
    const nwCard = h('section', { class: 'card nwcard', id: 'nwcard' },
      h('div', { class: 'row-between' }, h('p', { class: 'label' }, (p === 'Family' ? 'Family' : p + '\'s') + ' net worth'), delta !== null ? h('span', { class: 'hint' }, (delta >= 0 ? '▲ ' : '▼ ') + F.inrShort(Math.abs(delta)) + ' in ' + pts[pts.length - 1].x) : null),
      h('p', { class: 'big num' }, F.inrShort(nw)),
      y !== null ? h('p', { class: 'hint', id: 'nwyears' }, F.isHidden() ? 'Years of retirement spend: hidden' : '≈ ' + y.toFixed(1) + ' years of retirement spend (' + F.inr(s.retireMonthly || 72500) + ' a month)') : null,
      asOfLine(s));
    const n = checksCount(s);
    const checksRow = h('section', { class: 'card tap', id: 'checksrow', role: 'button', tabindex: 0, onclick: () => ctx.go('checks') },
      h('div', { class: 'row-between' }, h('div', {}, h('p', { class: 'ttl strong' }, 'Checks'), h('p', { class: 'hint' }, n ? n + (n === 1 ? ' thing needs' : ' things need') + ' attention' : 'All checks are fine')),
        h('div', { class: 'row-between', style: { gap: '6px' } }, n ? tag(String(n), 'warn') : tag('All fine', 'ok'), icon('right', 18))));
    const classes = (s.classes || []).map((c, i) => ({ name: c.name, value: c[k] || 0, color: SERIES[i % SERIES.length], alloc: (s.allocation || []).find(a => a.name === c.name) })).filter(c => c.value > 0);
    const total = sum(classes, c => c.value);
    const mix = card('Asset mix', null,
      classes.length ? h('div', { class: 'donut-wrap' }, donut(classes, { centre: F.inrShort(total), sub: 'total assets' }),
        h('ul', { class: 'list legend' }, classes.map(c => h('li', { class: 'li' }, h('span', { class: 'sw', style: { background: c.color } }), h('div', { class: 'body' }, h('div', { class: 'ttl' }, c.name),
          p === 'Family' && c.alloc && c.alloc.target ? h('div', { class: 'sub' }, 'Target ' + F.pct(c.alloc.target, 0)) : null),
          h('div', { class: 'end' }, F.pct(c.value / total, 0), h('div', { class: 'sub' }, F.inrShort(c.value))))))) : empty('No assets recorded yet.'),
      s.retirementOutside ? h('p', { class: 'hint', style: { marginTop: '8px' } }, 'EPF / NPS / PPF outside the investable split: ' + F.inrShort(s.retirementOutside)) : null);
    body.push(nwCard, checksRow, h('div', { class: 'grid two' },
      (s.v29 && V13.nwTrendCard(s, p, C2.notesBlock('Net worth', (s.monthly || []).slice(-12).map(r => r.month.slice(0, 7))))) || card('Net worth by month', null, pts.length >= 2 ? trendChart(pts, { label: 'Net worth by month' }) : empty('Month-end net worth appears after two months are closed in the Month-end update.'),
        h('div', { class: 'spacer' }), C2.notesBlock('Net worth', (s.monthly || []).slice(-12).map(r => r.month.slice(0, 7)))),
      s.v29 ? null : C2.whatMovedCard(p),
      card('Summary', null, h('div', { class: 'kv' }, h('span', {}, 'Total assets'), h('span', {}, F.inr(A[k])), h('span', {}, 'Loans'), h('span', { class: 'loss' }, F.inr(L[k])),
        h('span', {}, 'Net worth'), h('span', {}, F.inr(N[k]))),
        p === 'Family' && N.aravind !== undefined ? [h('div', { class: 'spacer' }), h('div', { class: 'kv' }, h('span', {}, 'Aravind'), h('span', {}, F.inr(N.aravind) + ' · ' + F.pct(N.family ? N.aravind / N.family : 0, 0)), h('span', {}, 'Madhu'), h('span', {}, F.inr(N.madhu) + ' · ' + F.pct(N.family ? N.madhu / N.family : 0, 0)))] : null),
      s.v29 ? V13.mixCard(s, p) : mix,
      p === 'Family' && (s.allocation || []).some(a => a.target) ? card('Allocation vs your target', null, h('ul', { class: 'list' }, s.allocation.filter(a => a.target || a.value).map(a =>
        li(a.name, 'Actual ' + F.pct(a.pct, 1) + ' · target ' + F.pct(a.target, 0), a.status ? tag(a.status, statusKind(a.status)) : null, a.move ? (a.move > 0 ? 'Below target by ' : 'Above target by ') + F.inrShort(Math.abs(a.move)) : null, { wrap: true }))),
        h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Figures from your Allocation & Risk sheet. This is not advice to buy or sell.')) : null));
  }

  if (tab === 'goals') {
    const plan = viewPlan(); body.push(...plan.body,
      h('section', { class: 'card tap', id: 'yearlink', role: 'button', tabindex: 0, onclick: () => ctx.go('year'), style: { marginTop: '12px' } },
        h('div', { class: 'row-between' }, h('div', {}, h('p', { class: 'ttl strong' }, 'Year in review'), h('p', { class: 'hint' }, 'The financial year in a few figures')), icon('right', 18))),
      h('div', { class: 'btns', style: { marginTop: '4px' } }, h('button', { class: 'btn', id: 'fireassump', onclick: () => { state.formId = 'settings'; ctx.go('form'); } }, 'FIRE assumptions')));
  }

  if (tab === 'invest') {
    const hold = (s.holdings || []).filter(x => ownerOk(x.owner, p)).map(x => ({ ...x, g: invGroup(x, 'kite') }));
    // US stocks are listed one by one from Intl Holdings, so the two summary rows that link to it are left out (no double count)
    const others = [...(s.otherHoldings || []).filter(x => !x.linked).map(x => ({ ...x, g: invGroup(x, 'other') })), ...(s.intl || []).map(x => ({ ...x, type: x.type || 'US stocks', g: 'intl' }))].filter(x => ownerOk(x.owner, p));
    const all = [...hold, ...others]; const G = state.invGroup || '';
    const rows = INV_GROUPS.map(([id, name]) => { const l = all.filter(x => x.g === id); const pf = perfByType(l.map(x => ({ ...x, type: name }))).total; return { id, name, n: l.length, ...pf }; });
    const tot = perfByType(all.map(x => ({ ...x, type: 'all' }))).total;
    const famNote = p === 'Family' ? null : h('p', { class: 'hint', style: { marginBottom: '8px' } }, 'Whole family: limits and stress cases are set for the family portfolio.');
    const invCard = h('section', { class: 'card', id: 'invrows' }, h('div', { class: 'card-h' }, h('h2', {}, 'Investments' + (p === 'Family' ? '' : ' · ' + p)), G ? h('button', { class: 'more', onclick: () => { state.invGroup = ''; state.invSub = ''; ctx.render(); } }, 'Show all') : null),
      ...rows.map(r => h('button', { class: 'invrow' + (G === r.id ? ' on' : ''), 'aria-pressed': String(G === r.id), id: 'inv-' + r.id, onclick: () => { state.invGroup = G === r.id ? '' : r.id; state.invSub = ''; ctx.render(); } },
        h('div', { class: 'body' }, h('div', { class: 'ttl' }, r.name), h('div', { class: 'sub' }, 'Invested ' + F.inrShort(r.invested) + (r.n ? ' · ' + r.n + ' holding' + (r.n === 1 ? '' : 's') : ''))),
        h('div', { class: 'end' }, h('div', { class: 'num' }, F.inrShort(r.current)), h('div', { class: 'sub ' + retCls(r.pnl) }, r.invested ? F.signed(r.pnl) + ' · ' + F.pct(r.ret, 1) : '–')))),
      h('div', { class: 'kv', id: 'perftotal', style: { marginTop: '10px', borderTop: '1px solid var(--line)', paddingTop: '10px' } }, h('span', {}, 'Total invested'), h('span', {}, F.inr(tot.invested)), h('span', {}, 'Current value'), h('span', {}, F.inr(tot.current)), h('span', {}, 'Gain / loss'), h('span', { class: retCls(tot.pnl) }, tot.invested ? F.signed(tot.pnl, F.inr) + ' (' + F.pct(tot.ret, 1) + ')' : '–')),
      h('p', { class: 'hint', style: { marginTop: '8px' } }, 'By class: Kite, other platforms and international, as last synced. Tap a row to narrow the lists below to it and open its holdings at the bottom.'));
    const inG = G ? all.filter(x => x.g === G) : all;
    const sub = state.invSub || ''; const shown = inG.filter(x => !sub || (x.type || 'Other') === sub);
    const subs = [...new Set(inG.map(x => x.type || 'Other'))];
    const subChips = G && subs.length > 1 ? h('div', { class: 'chips', id: 'invsubs', style: { margin: '0 0 10px' } }, [['', 'All'], ...subs.map(x => [x, x])].map(([v, l]) => h('button', { class: 'chip' + (sub === v ? ' on' : ''), onclick: () => { state.invSub = v; ctx.render(); } }, l))) : null;
    const stocks = all.filter(x => x.g === 'ind' || x.g === 'intl');
    const funds = all.filter(x => x.g === 'mf' || x.g === 'gb');
    const seeAll = (state.holdOpen || G) ? holdingsCard(shown.filter(x => hold.includes(x)), shown.filter(x => !hold.includes(x)), G ? (INV_GROUPS.find(g => g[0] === G) || [])[1] : null)
      : h('button', { class: 'btn wide', id: 'seeallhold', onclick: () => { state.holdOpen = true; ctx.render(); } }, 'See all holdings (' + shown.length + ')');
    body.push(invCard, h('div', { class: 'grid two' }, topTenCard(G === 'mf' || G === 'gb' ? [] : (G ? inG : stocks)), sectorCard(s, p), fundsCard(G === 'ind' || G === 'intl' ? [] : (G ? inG : funds))),
      h('div', { class: 'spacer' }),
      h('div', { class: 'grid two' }, acctCard(s, hold, others),
        card('Concentration', p === 'Family' ? null : tag('Family', 'plain'), famNote, concentration(s)),
        card('Stress test', p === 'Family' ? null : tag('Family', 'plain'), (s.stress || []).length ? h('ul', { class: 'list' }, s.stress.map(x => li(x.name, 'Portfolio after: ' + F.inrShort(x.after) + ' · Aravind ' + F.pct(x.fallA, 0) + ', Madhu ' + F.pct(x.fallM, 0), h('span', { class: 'loss' }, '−' + F.inrShort(Math.abs(x.loss || 0))), tag(x.status || '–', statusKind(x.status)), { wrap: true }))) : empty('Set the stress cases on the Settings sheet.'))),
      h('div', { class: 'spacer' }), (state.holdOpen || G) ? subChips : null, seeAll);
  }

  if (tab === 'assets') {
    const oa = (s.otherAssets || []).filter(x => p === 'Family' || x[k]);
    const loans = (s.loans || []).filter(x => p === 'Family' || x[k]);
    body.push(h('div', { class: 'grid two' },
      ...ASSET_GROUPS.map(([title, re, link]) => { const tn = x => x.type || x.name || ''; const l = oa.filter(x => title === 'Bank, deposits and other assets' ? !ASSET_GROUPS.slice(1).some(g => g[1].test(tn(x))) : re.test(tn(x)));
        if (!l.length && title !== 'Bank, deposits and other assets') return null;
        return card(title, link ? moreBtn(link[1], () => ctx.go(link[0])) : null, l.length ? h('ul', { class: 'list' }, l.map(x => li(x.name, [x.where, x.type].filter(Boolean).join(' · '), F.inr(p === 'Family' ? x.family : x[k]), p === 'Family' && x.aravind && x.madhu ? 'A ' + F.inrShort(x.aravind) + ' · M ' + F.inrShort(x.madhu) : null))) : empty('Nothing on the Other Assets sheet yet.')); }),
      card('Loans', null, loans.length ? h('ul', { class: 'list' }, loans.map(x => li(x.name, [x.lender, x.rate ? F.pct(x.rate, 2) : '', x.emi ? 'EMI ' + F.inr(x.emi) : '', x.emisLeft ? x.emisLeft + ' EMIs left' : '', x.lastEmi ? 'ends ' + F.monthLabel(x.lastEmi, true) : (x.closes ? 'closes ' + F.monthLabel(x.closes, true) : '')].filter(Boolean).join(' · '),
        F.inr(p === 'Family' ? x.total : x[k]), x.interestLeft ? 'Interest left ' + F.inrShort(x.interestLeft) : null, { wrap: true }))) : empty('No loans recorded.'),
        loans.length ? h('div', { class: 'kv', style: { marginTop: '10px' } }, h('span', {}, 'Total EMI a month'), h('span', {}, F.inr(sum(loans, x => x.emi)))) : null)));
  }
  return { title: 'Wealth', body };
}
// ---- 0.12.0 Investments lists: top 10s (stocks), sectors, funds & bonds
const TOPS = [['value', 'Largest'], ['best', 'Best %'], ['worst', 'Worst %'], ['gain', 'Top gains ₹'], ['loss', 'Top losses ₹']];
function topTenCard(rows) {
  const mode = state.topMode || 'value';
  // one line per stock: the same symbol in several accounts adds up
  const by = new Map(); for (const x of rows) { const g = by.get(x.name) || { name: x.name, current: 0, invested: 0 }; by.set(x.name, g); g.current += Number(x.current) || 0; g.invested += Number(x.invested) || 0; }
  const list = [...by.values()].map(x => ({ ...x, pnl: x.invested ? x.current - x.invested : null, ret: x.invested ? (x.current - x.invested) / x.invested : null }));
  const pick = { value: l => l.sort((a, b) => b.current - a.current), best: l => l.filter(x => x.ret !== null).sort((a, b) => b.ret - a.ret), worst: l => l.filter(x => x.ret !== null).sort((a, b) => a.ret - b.ret),
    gain: l => l.filter(x => x.pnl > 0).sort((a, b) => b.pnl - a.pnl), loss: l => l.filter(x => x.pnl < 0).sort((a, b) => a.pnl - b.pnl) }[mode](list).slice(0, 10);
  const end = x => mode === 'gain' || mode === 'loss' ? [h('span', { class: retCls(x.pnl) }, F.signed(x.pnl, F.inrShort)), h('div', { class: 'sub' }, x.ret !== null ? F.pct(x.ret, 1) : '')]
    : mode === 'value' ? [F.inrShort(x.current), h('div', { class: 'sub ' + retCls(x.ret) }, x.ret !== null ? F.pct(x.ret, 1) : '')] : [h('span', { class: retCls(x.ret) }, F.pct(x.ret, 1)), h('div', { class: 'sub' }, F.inrShort(x.current))];
  return h('section', { class: 'card', id: 'topten' }, h('div', { class: 'card-h' }, h('h2', {}, 'Stocks · top 10')),
    h('div', { class: 'chips', id: 'topmode', style: { marginBottom: '8px' } }, TOPS.map(([v, l]) => h('button', { class: 'chip' + (mode === v ? ' on' : ''), 'aria-pressed': String(mode === v), onclick: () => { state.topMode = v; ctx.render(); } }, l))),
    pick.length ? h('ol', { class: 'list numbered' }, pick.map((x, i) => h('li', { class: 'li' }, h('span', { class: 'lead num faint' }, String(i + 1)), h('div', { class: 'body' }, h('div', { class: 'ttl' }, x.name)), h('div', { class: 'end num' }, ...end(x))))) : empty(mode === 'gain' ? 'No stock is in profit.' : mode === 'loss' ? 'No stock is at a loss.' : 'No stocks yet.'),
    h('p', { class: 'hint', style: { marginTop: '6px' } }, '% = return on buy cost. ₹ = gain or loss in rupees.'));
}
function sectorCard(s, p) {
  const list = (s.sectors || []).filter(x => x.value);
  return card('Sectors · direct stocks', p === 'Family' ? null : tag('Family', 'plain'), list.length ? h('table', { class: 'cmp', id: 'sectors' }, h('thead', {}, h('tr', {}, h('th', {}, 'Sector'), h('th', { class: 'num' }, 'Value'), h('th', { class: 'num' }, 'Share'))),
    h('tbody', {}, list.sort((a, b) => b.value - a.value).map(x => h('tr', {}, h('td', {}, x.name, statusKind(x.status) !== 'ok' && x.status ? [' ', tag(x.status, statusKind(x.status))] : null), h('td', { class: 'num' }, F.inrShort(x.value)), h('td', { class: 'num' }, F.pct(x.pct, 1)))))) : empty('Appears once Kite holdings are pasted and sectors are set.'));
}
function fundsCard(rows) {
  const list = [...rows].sort((a, b) => (b.current || 0) - (a.current || 0));
  return card('Mutual funds, bonds & debt', null, list.length ? h('ul', { class: 'list', id: 'fundlist' }, list.slice(0, state.fundAll ? 500 : 10).map(x => li(x.name, [x.owner, x.type, x.platform || x.account].filter(Boolean).join(' · '), F.inrShort(x.current), h('span', { class: retCls(x.ret) }, x.ret !== null && x.ret !== undefined ? F.pct(x.ret, 1) : ''), { wrap: true }))) : empty('No funds or bonds yet.'),
    list.length > 10 && !state.fundAll ? h('button', { class: 'btn wide', style: { marginTop: '8px' }, onclick: () => { state.fundAll = true; ctx.render(); } }, 'Show all ' + list.length) : null);
}
const ASSET_GROUPS = [['Bank, deposits and other assets', /^$/], ['Retirement (EPF, NPS, PPF)', /EPF|VPF|NPS|PPF|Sukanya/i], ['Gold & silver', /gold|silver/i], ['Vehicles', /vehicle/i], ['Money lent', /money lent/i, ['lent', 'Details']]];
// performance by asset type, worked out from the holdings rows themselves (so the person filter is exact)
function perfByType(rows) {
  const by = new Map(); let unknown = 0; const total = { invested: 0, current: 0, pnl: 0, base: 0 };
  for (const x of rows) {
    const cur = Number(x.current) || 0; if (!cur && !x.invested) continue; const t = x.type || 'Other';
    const g = by.get(t) || { type: t, invested: 0, current: 0, pnl: 0, base: 0 }; by.set(t, g);
    g.current += cur; total.current += cur;
    if (Number(x.invested) > 0) { g.invested += Number(x.invested); g.base += cur; total.invested += Number(x.invested); total.base += cur; } else unknown++;
  }
  const fin = g => ({ ...g, pnl: g.invested ? g.base - g.invested : null, ret: g.invested ? (g.base - g.invested) / g.invested : null });
  return { rows: [...by.values()].map(fin).sort((a, b) => b.current - a.current), total: fin(total), unknown };
}
function concentration(s) {
  const over = (s.stocks || []).filter(x => statusKind(x.status) !== 'ok' && x.value);
  const secOver = (s.sectors || []).filter(x => statusKind(x.status) !== 'ok' && x.value);
  const top = (s.stocks || []).filter(x => x.value).slice(0, 5);
  if (!top.length && !(s.sectors || []).length) return empty('Appears once Kite holdings are pasted in the tracker.');
  return [h('p', { class: 'hint' }, over.length || secOver.length ? (over.length + ' stock' + (over.length === 1 ? '' : 's') + ' and ' + secOver.length + ' sector' + (secOver.length === 1 ? '' : 's') + ' above your limits.') : 'All stocks and sectors are within your limits.'),
    h('ul', { class: 'list' }, top.map(x => li(x.name, x.sector || 'No sector', F.pct(x.pct, 1), x.status, {})))];
}
// one line per demat account (from the Kite paste) and per other platform; tap one to see only its holdings
function acctCard(s, hold, others) {
  const slots = slotsOf(s); const groups = new Map();
  const add = (key, label, x) => { const g = groups.get(key) || { key, label, n: 0, inv: 0, cur: 0 }; groups.set(key, g); g.n++; g.inv += x.invested || 0; g.cur += x.current || 0; };
  for (const x of hold) { const sl = slots.find(y => y.code === x.account); add(x.account || 'Kite', sl ? 'Kite · ' + slotLabel(sl) : 'Kite · ' + (x.account || 'account') + (x.owner ? ' · ' + x.owner : ''), x); }
  for (const x of others) add(x.platform || 'Other', (x.platform || 'Other') + (x.owner ? ' · ' + x.owner : ''), x);
  const list = [...groups.values()].sort((a, b) => b.cur - a.cur); if (!list.length) return null;
  const sel = state.holdAcct || '';
  return card('By account', sel ? h('button', { class: 'more', onclick: () => { state.holdAcct = ''; ctx.render(); } }, 'Show all') : null,
    h('ul', { class: 'list', id: 'byacct' }, list.map(g => h('li', { class: 'li tap' + (g.key === sel ? ' on' : ''), 'aria-pressed': String(g.key === sel), onclick: () => { state.holdAcct = g.key === sel ? '' : g.key; ctx.render(); } },
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, g.label), h('div', { class: 'sub' }, g.n + ' holding' + (g.n === 1 ? '' : 's') + (g.inv ? ' · invested ' + F.inrShort(g.inv) : ''))),
      h('div', { class: 'end num' }, F.inrShort(g.cur), g.inv ? h('div', { class: 'sub ' + retCls(g.cur - g.inv) }, F.signed(g.cur - g.inv) + ' · ' + F.pct((g.cur - g.inv) / g.inv, 1)) : null)))),
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Tap an account to list only its holdings below.'));
}
function holdingsCard(hold, others, title) {
  const q = (state.holdQ || '').toLowerCase(); const sort = state.holdSort || 'value'; const acct = state.holdAcct || '';
  const all = [...hold.map(x => ({ ...x, src: x.account, key: x.account || 'Kite' })), ...others.map(x => ({ ...x, src: x.platform || 'Other', key: x.platform || 'Other' }))].filter(x => (!acct || x.key === acct) && (!q || (x.name + ' ' + x.type + ' ' + x.src).toLowerCase().includes(q)));
  all.sort((a, b) => sort === 'value' ? (b.current || 0) - (a.current || 0) : sort === 'gain' ? (b.ret || 0) - (a.ret || 0) : (a.ret || 0) - (b.ret || 0));
  const total = sum(all, x => x.current);
  return h('section', { class: 'card span2', id: 'holdings' }, h('div', { class: 'card-h' }, h('h2', {}, (title || 'Holdings') + ' (' + all.length + ')'), h('span', { class: 'hint num' }, F.inrShort(total))),
    h('div', { class: 'toolbar' }, h('div', { class: 'search', style: { flex: '1 1 200px' } }, icon('search', 16), h('input', { class: 'field', type: 'search', placeholder: 'Search holdings', 'aria-label': 'Search holdings', value: state.holdQ || '',
      oninput: e => { state.holdQ = e.target.value; const pos = e.target.selectionStart; ctx.render(); const el = document.querySelector('.search input'); if (el) { el.focus(); el.setSelectionRange(pos, pos); } } })),
      seg([['value', 'Largest'], ['gain', 'Best'], ['loss', 'Worst']], sort, v => { state.holdSort = v; ctx.render(); }, 'Sort holdings')),
    all.length ? h('ul', { class: 'list' }, all.slice(0, state.holdAll ? 1000 : 25).map(x => li(x.name, [x.owner, x.type, x.src].filter(Boolean).join(' · '), F.inrShort(x.current), h('span', { class: retCls(x.ret) }, x.ret !== null && x.ret !== undefined ? F.pct(x.ret, 1) : '')))) : empty('No holdings match.'),
    all.length > 25 && !state.holdAll ? h('button', { class: 'btn wide', style: { marginTop: '8px' }, onclick: () => { state.holdAll = true; ctx.render(); } }, 'Show all ' + all.length) : null);
}

// ---------------------------------------------------------------- Plan (FIRE, monthly target, emergency fund, goals)
export function viewPlan() {
  const s = ctx.snap(); if (!s) return noData('Plan');
  const f = s.fire || {}; const em = s.emergency || {};
  const onTrack = f.ratio >= 1;
  const fireCard = card(F.maskText(f.title) || 'FIRE plan', null,
    f.neededToday || f.projectedToday ? [
      h('div', { class: 'row-between', style: { alignItems: 'flex-start' } },
        h('div', {}, h('p', { class: 'hint' }, 'Projected vs needed (today\'s ₹)'), h('p', { class: 'num', style: { fontSize: '1.5rem', fontWeight: 800 } }, F.inrShort(f.projectedToday)), h('p', { class: 'hint' }, 'needed ' + F.inrShort(f.neededToday))),
        tag(onTrack ? 'ON TRACK' : 'BEHIND', onTrack ? 'ok' : 'warn')),
      bar(f.ratio, onTrack ? 'good' : 'warn'),
      h('div', { class: 'kv', style: { marginTop: '12px' } },
        f.fireAge ? [h('span', {}, 'FIRE age'), h('span', {}, f.fireAge + (f.fireDate ? ' · ' + F.monthLabel(f.fireDate, true) : ''))] : null,
        f.yearsToGo !== null && f.yearsToGo !== undefined ? [h('span', {}, 'Time to go'), h('span', {}, F.years(f.yearsToGo))] : null,
        f.progress !== null && f.progress !== undefined ? [h('span', {}, 'Progress today'), h('span', {}, F.pct(f.progress, 1))] : null,
        f.monthlyNeeded ? [h('span', {}, f.labels && f.labels.I ? f.labels.I : 'Monthly investing needed'), h('span', {}, F.inrShort(f.monthlyNeeded))] : null,
        f.lastsUntil ? [h('span', {}, 'Money lasts until age'), h('span', {}, String(f.lastsUntil))] : null,
        s.coast && typeof s.coast.year === 'number' ? [h('span', {}, 'Coast FIRE year'), h('span', { id: 'coastyear' }, s.coast.year + (typeof s.coast.age === 'number' ? ' · age ' + s.coast.age : ''))] : null),
      s.coast ? h('p', { class: 'hint' }, 'Coast FIRE: the year from which, at today\'s pace, you could stop adding money and the corpus would still grow to what retirement needs.') : null,
      (f.notes || []).length ? h('p', { class: 'hint', style: { marginTop: '10px' } }, F.maskText(f.notes.join(' · '))) : null]
      : empty('Fill the Settings sheet in the tracker to see the FIRE plan.'));
  const bk = (s.buckets || []).filter(b => b.target || b.actual);
  const target = card('Monthly saving & investing', null, bk.length ? h('div', {}, bk.map(b => h('div', { class: 'hbar' }, h('span', { class: 'ttl' }, b.name), h('span', { class: 'num' }, F.inrShort(b.actual), h('span', { class: 'faint' }, ' / ' + F.inrShort(b.target))),
    b.target ? bar(b.actual / b.target, b.actual >= b.target ? 'good' : 'warn') : null))) : empty('Set your monthly target on the Settings sheet.'),
    s.targetPerMonth ? h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Target ' + F.inr(s.targetPerMonth) + ' a month (excl. EPF). Actual is the average for the year so far.') : null);
  const emCard = card('Emergency fund', null, em.target ? [h('div', { class: 'kv' }, h('span', {}, 'Have'), h('span', {}, F.inr(em.have)), h('span', {}, 'Target (' + (em.months || '–') + ' months)'), h('span', {}, F.inr(em.target)),
    h('span', {}, 'Monthly outflows'), h('span', {}, F.inr(em.outflows)), h('span', {}, 'Months covered'), h('span', {}, em.monthsCovered !== null ? em.monthsCovered.toFixed(1) : '–')), bar(em.have / em.target, em.have >= em.target ? 'good' : 'warn')] : empty('Set the months to keep on the Settings sheet.'),
    (() => { const lk = goalLinked(EMERGENCY); return [h('p', { class: 'hint', style: { marginTop: '8px' } }, lk ? 'Linked FDs and funds: ' + F.inr(lk) + '. These are left out of the asset mix.' : 'Link the FDs and arbitrage funds you keep for emergencies. Without links, all cash and deposits count.'),
      h('button', { class: 'btn', id: 'emlink', onclick: () => goalSheet({ name: EMERGENCY, cost: em.target || 0 }) }, icon('plus', 16), lk ? 'Linked FDs and funds' : 'Link FDs and funds')]; })());
  const goals = card('Goals', null, (s.goals || []).length ? h('ul', { class: 'list' }, s.goals.map(g => h('li', { class: 'li tap', 'data-goal': g.name, onclick: () => goalSheet(g) }, C2.goalIcon(g.name, 20), h('div', { class: 'body' },
    h('div', { class: 'row-between' }, h('span', { class: 'ttl' }, g.name), tag(g.status || '–', statusKind(g.status))),
    (() => { const lk = goalLinked(g.name); const set = (g.saved || 0) + lk; const tgt = g.future || g.cost || 0; const pr = tgt ? Math.min(1, set / tgt) : g.progress;
      return [h('div', { class: 'sub' }, [g.owner, 'by ' + (g.year || '–'), F.inrShort(set) + ' of ' + F.inrShort(tgt) + (tgt ? ' · ' + F.pct(set / tgt, 0) : ''), lk ? 'linked ' + F.inrShort(lk) : 'tap to link investments'].join(' · ')), bar(pr, statusKind(g.status) === 'ok' ? 'good' : 'warn')]; })(),
    g.neededPerMonth ? h('div', { class: 'sub', style: { marginTop: '4px' } }, 'Needs ' + F.inr(g.neededPerMonth) + ' a month · putting in ' + F.inr(g.monthly || 0)) : null, C2.forecastLine(g))))) : empty('Add goals on the Goals sheet.'));
  const hist = (s.monthly || []).filter(r => r.savingsRate !== null && r.income).slice(-12);
  const rate = card('Savings rate by month', null, hist.length >= 2 ? trendChart(hist.map(r => ({ x: F.monthLabel(r.month), y: r.savingsRate })), { fmt: v => F.pct(v, 0), label: 'Savings rate by month', height: 130 }) : empty('Appears after two months are logged.'));
  return { title: 'Goals & FIRE', back: 'wealth', body: [h('div', { class: 'grid two' }, fireCard, target, emCard, rate, h('div', { class: 'span2' }, goals))] };
}

// ---------------------------------------------------------------- Protection (insurance)
export function viewProtection() {
  const s = ctx.snap(); if (!s) return noData('Insurance');
  const pol = (s.insurance || []).filter(x => x.sum || x.premium || x.insurer);
  const pr = s.protection || {};
  const summary = card('Cover', null, Object.keys(pr).length ? h('div', { class: 'kv' }, Object.entries(pr).flatMap(([l, v]) => [h('span', {}, l), h('span', {}, typeof v.family === 'number' ? (/vs yearly|\(x\)/.test(l) ? v.family.toFixed(1) + '×' : F.inr(v.family)) : (typeof v.aravind === 'number' || typeof v.madhu === 'number' ? 'Aravind ' + F.inrShort(v.aravind || 0) + ' · Madhu ' + F.inrShort(v.madhu || 0) : '–'))])) : empty('No cover recorded.'));
  const list = card('Policies', null, pol.length ? h('ul', { class: 'list' }, pol.sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9)).map(x => li(x.name, [x.type, x.covers, x.insurer, x.nominee ? 'nominee ' + x.nominee : 'no nominee'].filter(Boolean).join(' · '),
    F.inrShort(x.sum), (x.renewal ? 'renews ' + F.date(x.renewal) : '') + (x.days !== null && x.days !== undefined && x.days <= 60 ? ' (' + x.days + ' days)' : ''), { wrap: true, lead: statusIcon(statusKind(x.status || (x.nominee ? 'ok' : 'missing'))) }))) : empty('Add policies on the Insurance sheet.'));
  return { title: 'Insurance', back: 'more', body: [h('div', { class: 'grid two' }, list, summary)] };
}

// ---------------------------------------------------------------- Documents and nominees (read-only)
export function viewDocuments() {
  const s = ctx.snap(); if (!s) return noData('Documents');
  const docs = s.documents || []; const nom = s.nominees || []; const con = s.contacts || [];
  const missing = nom.filter(n => !n.nominee || statusKind(n.status) !== 'ok');
  return { title: 'Documents', back: 'more', body: [h('div', { class: 'grid two' },
    card('Documents (' + docs.length + ')', null, docs.length ? h('ul', { class: 'list' }, docs.map(d => li(d.name, [d.owner, d.where].filter(Boolean).join(' · '), d.expiry ? F.date(d.expiry) : null, d.status || null, { wrap: true, lead: statusIcon(d.expiry ? statusKind(d.status) : 'ok') }))) : empty('No documents listed.')),
    card('Nominees', missing.length ? tag(missing.length + ' GAPS', 'warn') : tag('ALL SET', 'ok'), nom.length ? h('ul', { class: 'list' }, nom.map(n => li(n.name, [n.institution, n.owner, n.nominee ? 'nominee ' + n.nominee : 'no nominee'].filter(Boolean).join(' · '), null, null, { wrap: true, lead: statusIcon(n.nominee && statusKind(n.status) === 'ok' ? 'ok' : 'warn') }))) : empty('No accounts listed.')),
    con.length ? card('Emergency contacts (old list)', null, h('ul', { class: 'list' }, con.map(c => li(c.name, [c.role, c.phone, c.email, c.notes].filter(Boolean).join(' · '), null, null, { wrap: true }))), h('p', { class: 'hint' }, 'Contacts now live in Handover.')) : null),
    h('p', { class: 'hint', style: { margin: '12px 4px' } }, 'To change these: More › Yearly & one-time. Contacts are in Handover. Never store full account numbers, PAN, Aadhaar or passport numbers.')] };
}

// ---------------------------------------------------------------- Alerts (Health Check)
const FIX = [[/insurance/i, 'protection', 'Open insurance'], [/estate|nominee|document/i, 'documents', 'Open documents'], [/goal|fire|emergency/i, 'plan', 'Open plan'],
  [/expense|spending/i, 'spend', 'Open spend'], [/allocation|sector|stock|risk|holding/i, 'wealth', 'Open wealth'], [/loan|asset/i, 'wealth', 'Open wealth'], [/monthly/i, 'monthly', 'Month-end update']];
export function viewAlerts() {
  const s = ctx.snap(); if (!s) return noData('Checks');
  const items = (s.health || []).map(x => ({ ...x, kind: statusKind(x.status) }));
  const order = { crit: 0, warn: 1, plain: 2, ok: 3 };
  const filter = state.tab.alerts || 'open';
  const shown = items.filter(x => filter === 'all' || x.kind !== 'ok').sort((a, b) => order[a.kind] - order[b.kind]);
  return { title: 'Checks', back: 'wealth', body: [C2.safetyCard(), h('div', { class: 'spacer' }), h('div', { class: 'toolbar' }, seg([['open', 'Needs attention (' + items.filter(x => x.kind !== 'ok').length + ')'], ['all', 'All checks (' + items.length + ')']], filter, v => { state.tab.alerts = v; ctx.render(); }, 'Show')),
    shown.length ? h('section', { class: 'card' }, h('ul', { class: 'list' }, shown.map(x => {
      const fx = FIX.find(([re]) => re.test(x.area + ' ' + x.fix + ' ' + x.check));
      return h('li', { class: 'li wrap' }, statusIcon(x.kind === 'plain' ? 'warn' : x.kind), h('div', { class: 'body' }, h('div', { class: 'ttl' }, x.check), h('div', { class: 'sub' }, F.maskText(x.detail)), h('div', { class: 'sub faint' }, x.area + ' · fix in: ' + (x.fix || '–'))),
        fx && x.kind !== 'ok' ? h('button', { class: 'more', onclick: () => ctx.go(fx[1]) }, 'Open', icon('right', 14)) : null);
    }))) : card(null, null, empty('Nothing needs attention.')),
    h('p', { class: 'hint', style: { margin: '12px 4px' } }, 'Safety net from your figures; the rest from the tracker\'s Health Check sheet, as of the last sync.')] };
}

export { sheet };
