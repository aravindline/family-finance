// Reports: month-on-month spending by month, person and category (from daily entries).
import { ctx, state } from './ctx.js';
import * as C2 from './views-c2.js';
import * as F from './fmt.js';
import { h, s, icon, seg, tag, card, empty, columnChart, SERIES } from './ui.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const PEOPLE = ['Aravind', 'Madhu'];

function spark(vals) {
  const W = 72, H = 22, hi = Math.max(1, ...vals); const X = i => vals.length === 1 ? W / 2 : i * (W - 4) / (vals.length - 1) + 2;
  const d = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + (H - 2 - v / hi * (H - 4)).toFixed(1)).join(' ');
  return s('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, s('path', { d }));
}

export function viewReports() {
  const snap = ctx.snap() || {};
  const span = state.repSpan || 6; const who = state.repWho || 'All';
  const all = ctx.entriesView().filter(e => e.date && (who === 'All' || e.by === who));
  const end = thisMonth(); const months = []; for (let i = span - 1; i >= 0; i--) months.push(addMonths(end, -i));
  const first = all.map(e => e.date.slice(0, 7)).sort()[0];
  const shown = first ? months.filter(m => m >= first) : [];
  const head = h('div', { class: 'toolbar' }, seg([['6', '6 months'], ['12', '12 months']].map(x => x[1]), span + ' months', v => { state.repSpan = parseInt(v, 10); ctx.render(); }, 'Period'),
    seg([['All', 'Family'], ...PEOPLE], who, v => { state.repWho = v; ctx.render(); }, 'Whose spending'));
  if (!shown.length) return { title: 'Reports', back: 'spend', body: [head, card(null, null, empty('Reports appear once daily expenses are logged.'))] };

  const by = {}; for (const m of shown) by[m] = { total: 0, p: {}, c: {} };
  for (const e of all) { const m = e.date.slice(0, 7); const b = by[m]; if (!b) continue; const a = Number(e.amount || 0); b.total += a; b.p[e.by] = (b.p[e.by] || 0) + a; b.c[e.category] = (b.c[e.category] || 0) + a; }
  const lbl = m => F.monthLabel(m);
  const budget = who === 'All' ? Object.values(C2.availableBudgets(new Date().toISOString().slice(0, 7))).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
  const full = shown.filter(m => m < end); const avg = full.length ? full.reduce((t, m) => t + by[m].total, 0) / full.length : null;
  const isNowPartial = shown.includes(end);

  const monthly = card('Monthly spending', null,
    columnChart(shown.map(m => ({ x: lbl(m), parts: [by[m].total] })), { label: 'Spending by month', budget: budget || null }),
    C2.notesBlock('Monthly spending', shown),
    h('div', { class: 'kv', style: { marginTop: '10px' } },
      h('span', {}, 'Average of full months'), h('span', {}, avg === null ? '–' : F.inr(avg)),
      h('span', {}, 'Highest'), h('span', {}, (() => { const m = shown.slice().sort((a, b) => by[b].total - by[a].total)[0]; return lbl(m) + ' · ' + F.inr(by[m].total); })()),
      budget ? h('span', {}, 'Monthly budget') : null, budget ? h('span', {}, F.inr(budget)) : null),
    isNowPartial ? h('p', { class: 'hint', style: { marginTop: '6px' } }, F.monthLabel(end, true) + ' is still running.') : null);

  const people = who === 'All' ? card('Whose spending', null,
    columnChart(shown.map(m => ({ x: lbl(m), parts: PEOPLE.map(p => by[m].p[p] || 0) })), { series: PEOPLE, colors: [SERIES[0], SERIES[1]], label: 'Spending by person and month' }),
    h('div', { class: 'kv', style: { marginTop: '10px' } }, ...PEOPLE.flatMap(p => { const t = shown.reduce((a, m) => a + (by[m].p[p] || 0), 0); const g = shown.reduce((a, m) => a + by[m].total, 0); return [h('span', {}, p), h('span', {}, F.inr(t) + ' · ' + F.pct(g ? t / g : 0, 0))]; }))) : null;

  const cats = [...new Set(shown.flatMap(m => Object.keys(by[m].c)))];
  const rows = cats.map(c => { const vals = shown.map(m => by[m].c[c] || 0); const fv = full.map(m => by[m].c[c] || 0); const a = fv.length ? fv.reduce((x, y) => x + y, 0) / fv.length : 0; const last = full.length ? by[full[full.length - 1]].c[c] || 0 : 0; return { c, vals, fvals: fv.length ? fv : vals, a, last, total: vals.reduce((x, y) => x + y, 0) }; }).sort((a, b) => b.total - a.total);
  const lastLbl = full.length ? F.monthLabel(full[full.length - 1], true) : '';
  const catCard = card('By category', null, h('ul', { class: 'list', id: 'repcats' }, rows.map(r => {
    const d = r.a ? (r.last - r.a) / r.a : null; const k = d === null || Math.abs(d) < 0.15 ? '' : d > 0 ? 'warn' : 'good';
    return h('li', { class: 'li tap wrap', onclick: () => { state.spendCat = r.c; state.spendMonth = end; ctx.go('spend'); } },
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, r.c), h('div', { class: 'sub' }, 'Avg ' + F.inr(r.a) + ' a month' + (lastLbl ? ' · ' + lastLbl + ' ' + F.inr(r.last) : ''))),
      spark(r.fvals), h('div', { class: 'end' }, k ? tag((d > 0 ? '+' : '−') + F.pct(Math.abs(d), 0), k) : h('span', { class: 'faint' }, '≈ avg')));
  })), h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Lines show full months only. Tags compare ' + (lastLbl || 'last month') + ' with the average of those months. Tap a category to see its entries.'));

  const recapBtn = h('button', { class: 'btn', id: 'recapbtn', onclick: () => openRecap(state.repRecap || recapMonth()) }, icon('play', 16), 'Recap of ' + F.monthLabel(recapMonth(), true));
  return { title: 'Reports', back: 'spend', body: [head, h('div', { class: 'btns', style: { margin: '0 0 12px' } }, recapBtn), h('div', { class: 'grid two' }, monthly, people || catCard), people ? h('div', { class: 'spacer' }) : null, people ? catCard : null,
    h('p', { class: 'hint', style: { margin: '12px 4px' } }, 'From the daily expenses logged in the app' + (who !== 'All' ? ', logged by ' + who : '') + '. Budgets are family totals.')] };
}

// ---- Monthly recap story: swipe or tap through a few cards about one month.
export function recapMonth() { return addMonths(thisMonth(), -1); }
export function hasRecap(ym = recapMonth()) { return ctx.entriesView().some(e => (e.date || '').startsWith(ym)); }
export function openRecap(ym = recapMonth()) {
  const snap = ctx.snap() || {}; const all = ctx.entriesView().filter(e => (e.date || '').startsWith(ym));
  const prev = ctx.entriesView().filter(e => (e.date || '').startsWith(addMonths(ym, -1)));
  const tot = all.reduce((a, e) => a + Number(e.amount || 0), 0), ptot = prev.reduce((a, e) => a + Number(e.amount || 0), 0);
  const budget = Object.values(C2.availableBudgets(new Date().toISOString().slice(0, 7))).reduce((a, b) => a + (Number(b) || 0), 0);
  const cats = {}; for (const e of all) cats[e.category] = (cats[e.category] || 0) + Number(e.amount || 0);
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const ppl = PEOPLE.map(p => ({ p, v: all.filter(e => e.by === p).reduce((a, e) => a + Number(e.amount || 0), 0), n: all.filter(e => e.by === p).length }));
  const days = {}; for (const e of all) days[e.date] = (days[e.date] || 0) + Number(e.amount || 0);
  const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate(); const quiet = dim - Object.keys(days).length;
  const big = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
  const mrow = (snap.monthly || []).find(r => (r.month || '').startsWith(ym)); const prow = (snap.monthly || []).find(r => (r.month || '').startsWith(addMonths(ym, -1)));
  const M = F.monthLabel(ym, true);
  const slides = [
    { k: 'Your ' + M, big: F.inr(tot), sub: 'spent across ' + all.length + ' entries' + (budget ? (tot <= budget ? ', ' + F.inr(budget - tot) + ' under budget' : ', ' + F.inr(tot - budget) + ' over budget') : '') },
    ptot ? { k: 'Compared with ' + F.monthLabel(addMonths(ym, -1), true), big: (tot <= ptot ? '−' : '+') + F.pct(Math.abs(tot - ptot) / ptot, 0), sub: tot <= ptot ? F.inr(ptot - tot) + ' less than the month before' : F.inr(tot - ptot) + ' more than the month before' } : null,
    top.length ? { k: 'Where it went', list: top.map(([c, v], i) => [(i + 1) + '. ' + c, F.inr(v) + ' · ' + F.pct(tot ? v / tot : 0, 0)]) } : null,
    { k: 'Whose spending', list: ppl.map(x => [x.p, F.inr(x.v) + ' · ' + x.n + ' entries']) },
    big ? { k: 'Biggest day', big: F.date(big[0]), sub: F.inr(big[1]) + ' that day · ' + quiet + ' days with no spending' } : null,
    mrow && typeof mrow.savingsRate === 'number' ? { k: 'Saved', big: F.pct(mrow.savingsRate, 0), sub: 'of income saved or invested' + (typeof mrow.saved === 'number' ? ' (' + F.inr(mrow.saved) + ')' : '') } : null,
    mrow && prow && typeof mrow.nwF === 'number' && typeof prow.nwF === 'number' ? { k: 'Family net worth', big: (mrow.nwF >= prow.nwF ? '+' : '−') + F.inrShort(Math.abs(mrow.nwF - prow.nwF)).replace('−', ''), sub: 'in ' + M + ', now ' + F.inrShort(mrow.nwF) } : null,
    { k: 'That was ' + M, big: 'Keep going', sub: 'Small daily logs add up to the big goals.' },
  ].filter(Boolean);
  openStory(slides, M + ' recap', 'recap', 'Close recap');
  const st = ctx.settings(); if (st.recapSeen !== ym) ctx.saveSettings({ recapSeen: ym });
}
// Story viewer: full-screen cards, tap the right two-thirds or swipe left for the next one.
export function openStory(slides, label, id, closeLabel = 'Close') {
  let i = 0;
  const bars = h('div', { class: 'story-bars' }, slides.map(() => h('span')));
  const body = h('div', { class: 'story-body', 'aria-live': 'polite' });
  const draw = () => {
    [...bars.children].forEach((b, j) => b.classList.toggle('on', j <= i));
    const sl = slides[i];
    body.replaceChildren(...[h('p', { class: 'story-k' }, sl.k), sl.big ? h('p', { class: 'story-big num' }, sl.big) : null, sl.sub ? h('p', { class: 'story-sub' }, sl.sub) : null,
      sl.list ? h('ul', { class: 'story-list' }, sl.list.map(([a, b]) => h('li', {}, h('span', {}, a), h('span', { class: 'num' }, b)))) : null].filter(Boolean));
  };
  const close = () => { ov.remove(); document.removeEventListener('keydown', key); };
  const next = () => { if (i < slides.length - 1) { i++; draw(); } else close(); };
  const back = () => { if (i > 0) { i--; draw(); } };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') back(); };
  let sx = null;
  const ov = h('div', { class: 'story', role: 'dialog', 'aria-label': label, id,
    onpointerdown: e => { sx = e.clientX; },
    onpointerup: e => { if (e.target.closest('.story-x')) return; const dx = sx === null ? 0 : e.clientX - sx; sx = null;
      if (Math.abs(dx) > 40) return dx < 0 ? next() : back(); const r = ov.getBoundingClientRect(); (e.clientX - r.left < r.width / 3) ? back() : next(); } },
    bars, h('button', { class: 'iconbtn story-x', 'aria-label': closeLabel, onclick: close }, '✕'), body,
    h('p', { class: 'story-hint' }, 'Tap or swipe for the next card'));
  document.body.append(ov); document.addEventListener('keydown', key); draw();
}
export function recapCard() {
  const ym = recapMonth(); const d = new Date().getDate();
  if (d > 7 || !hasRecap(ym) || ctx.settings().recapSeen === ym) return null;
  return h('section', { class: 'card recap-card tap', id: 'recapcard', role: 'button', tabindex: 0, onclick: () => { openRecap(ym); ctx.render(); } },
    h('div', { class: 'row-between' }, h('div', {}, h('p', { class: 'ttl strong' }, 'Your ' + F.monthLabel(ym, true) + ' recap is ready'), h('p', { class: 'hint' }, 'A quick look back in a few cards')), icon('right', 18)));
}
