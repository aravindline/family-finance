// App 0.14.0 (Aravind, 12 Nov 2026): the FIRE card on Wealth › Goals & FIRE and the FIRE details screen it opens
// (mock-up approved 12 Nov). The card answers one question: where you land at retirement compared with what you
// need. Every age and year comes from Settings through the FIRE Plan sheet; nothing is fixed in the app.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, s as svgEl, tag, card, empty, icon } from './ui.js';

const isNum = v => typeof v === 'number' && isFinite(v);
// what the screens need, in today's money; null when the tracker has no FIRE Plan figures yet
export function fireFigures(s) {
  const fp = s && s.firePlan; if (!fp || !isNum(fp.needed) || !isNum(fp.projected) || !(fp.needed > 0)) return null; // 0 = not yet worked out by Excel
  const f = s.fire || {}; const coast = s.coast && isNum(s.coast.year) ? s.coast : null;
  const retireAge = isNum(fp.retireAge) && fp.retireAge > 0 ? fp.retireAge : isNum(f.fireAge) && f.fireAge > 0 ? f.fireAge : null;
  const fireDate = f.fireDate || null; const fireYear = fireDate ? Number(fireDate.slice(0, 4)) : null;
  return { needed: fp.needed, projected: fp.projected, gap: fp.projected - fp.needed, onTrack: fp.projected >= fp.needed, retireAge, fireDate, fireYear,
    yearsToGo: isNum(f.yearsToGo) ? f.yearsToGo : null, corpusToday: isNum(f.corpusToday) ? f.corpusToday : fp.corpusToday, progress: isNum(f.progress) ? f.progress : null,
    coastYear: coast ? coast.year : null, coastAge: coast && isNum(coast.age) ? coast.age : null, monthlyNeeded: fp.monthlyNeeded, target: fp.target, actual: fp.actual,
    lasts: fp.lasts, living: fp.living, trips: fp.trips, inflation: fp.inflation, retBefore: fp.retBefore, retAfter: fp.retAfter, start: fp.start, model: fp.model || [] };
}
const statusTag = x => tag(x.onTrack ? 'On track' : 'Behind', x.onTrack ? 'ok' : 'warn');
const retireLine = x => [x.fireDate ? 'Retire ' + F.monthLabel(x.fireDate, true) : null, x.yearsToGo !== null ? Math.round(x.yearsToGo) + ' years to go' : null, "today's money"].filter(Boolean).join(' · ');

// Wealth › Goals & FIRE: one card, one takeaway; tapping it opens the details
export function fireCard(s) {
  const x = fireFigures(s);
  const open = () => { state.fireBack = state.view; ctx.go('fire'); };
  if (!x) return card('FIRE', null, empty('Fill FIRE assumptions (More › FIRE & goals) and open the tracker once in Excel to see your FIRE plan.'));
  const frac = x.projected > 0 ? Math.min(1, x.needed / x.projected) : 0; // where "needed" sits on the projected bar
  return h('section', { class: 'card tap', id: 'firecard', role: 'button', tabindex: 0, 'aria-label': 'FIRE, opens FIRE details', onclick: open, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
    h('div', { class: 'row-between' }, h('h2', { class: 'ttl strong', style: { margin: 0, fontSize: '1rem' } }, 'FIRE'), statusTag(x)),
    h('p', { class: 'num', style: { fontSize: '1.4rem', fontWeight: 800, margin: '6px 0 2px' } }, F.inrShort(x.projected), ' ', h('span', { class: 'hint', style: { fontWeight: 500, fontSize: '.85rem' } }, 'projected' + (isNum(x.retireAge) ? ' at ' + x.retireAge : ''))),
    h('div', { class: 'firebar', 'aria-hidden': 'true' }, h('span', { class: 'fill' + (x.onTrack ? '' : ' warn'), style: { width: (x.onTrack ? 100 : Math.max(0, Math.min(100, x.projected / x.needed * 100))) + '%' } }),
      x.onTrack ? h('span', { class: 'mark', style: { left: (frac * 100).toFixed(1) + '%' } }) : null),
    h('div', { class: 'row-between hint', style: { fontSize: '.78rem', marginTop: '4px' } }, h('span', {}, 'Needed ' + F.inrShort(x.needed)), h('span', { class: x.onTrack ? 'gain' : 'loss' }, (x.onTrack ? 'Extra ' : 'Short ') + F.inrShort(Math.abs(x.gap)))),
    h('p', { class: 'hint', style: { marginTop: '6px' } }, retireLine(x)),
    h('div', { style: { textAlign: 'right', marginTop: '2px' } }, h('span', { class: 'more' }, 'FIRE details', icon('right', 16))));
}

// the corpus each year in today's money (the FIRE Plan sheet's model is in nominal ₹), from today to retirement
function pathPoints(x) {
  if (!x.model.length || !isNum(x.inflation) || !isNum(x.start)) return [];
  const base = x.start - 1; const pts = [];
  if (isNum(x.corpusToday)) pts.push({ year: base, age: x.model[0] && isNum(x.model[0].age) ? x.model[0].age - 1 : null, v: x.corpusToday });
  for (const r of x.model) { if (!isNum(r.closing)) continue; pts.push({ year: r.year, age: r.age, v: r.closing / Math.pow(1 + x.inflation, r.year - base) }); if (x.fireYear && r.year >= x.fireYear) break; }
  return pts;
}
function pathChart(x) {
  const pts = pathPoints(x); if (pts.length < 2) return null;
  const W = 600, H = 190, L = 54, R = 12, T = 12, B = 26;
  const hi = Math.max(x.needed, ...pts.map(p => p.v)) * 1.08; const yTick = niceStep(hi);
  const X = i => L + i * (W - L - R) / (pts.length - 1); const Y = v => T + (1 - v / hi) * (H - T - B);
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', id: 'firepath', 'aria-label': "Projected corpus in today's money: " + pts.map(p => p.year + ' ' + F.inrShort(p.v)).join(', ') + '. Needed ' + F.inrShort(x.needed) + '.' });
  for (let v = 0; v <= hi; v += yTick) { svg.append(svgEl('line', { class: 'grid-l', x1: L, x2: W - R, y1: Y(v), y2: Y(v) }), svgEl('text', { x: L - 6, y: Y(v) + 3, 'text-anchor': 'end' }, F.isHidden() ? '' : F.inrShort(v).replace('.00', ''))); }
  const step = Math.max(1, Math.ceil(pts.length / 5));
  pts.forEach((p, i) => { if (i % step === 0 || i === pts.length - 1) svg.append(svgEl('text', { x: X(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle' }, String(p.year))); });
  svg.append(svgEl('line', { class: 'need', x1: L, x2: W - R, y1: Y(x.needed), y2: Y(x.needed) }));
  svg.append(svgEl('path', { class: 'ln', d: pts.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ') }));
  svg.append(svgEl('circle', { class: 'dot', cx: X(pts.length - 1), cy: Y(pts[pts.length - 1].v), r: 4.5 }));
  const ci = x.coastYear ? pts.findIndex(p => p.year === x.coastYear) : -1;
  if (ci >= 0) { svg.append(svgEl('circle', { class: 'coast', cx: X(ci), cy: Y(pts[ci].v), r: 4.5 }), svgEl('text', { x: X(ci) + 8, y: Y(pts[ci].v) + 14, class: 'strongtxt' }, 'Coast FIRE ' + x.coastYear)); }
  return h('div', { class: 'chart-wrap' }, svg,
    h('div', { class: 'legend-row' }, h('span', {}, h('i', { class: 'sw-line' }), 'Projected'), h('span', {}, h('i', { class: 'sw-line dash' }), 'Needed')));
}
function niceStep(hi) { const raw = hi / 4; const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }

const kv = rows => h('div', { class: 'kv' }, rows.filter(Boolean).flatMap(([a, b, cls]) => [h('span', {}, a), h('span', { class: cls || '' }, b)]));
const money = v => (isNum(v) ? F.inrShort(v) : '–');
const pctv = v => (isNum(v) ? F.pct(v, v * 100 % 1 ? 1 : 0) : '–');

export function viewFire() {
  const s = ctx.snap(); const x = fireFigures(s); const back = state.fireBack || 'wealth';
  if (!x) return { title: 'FIRE', back, body: [card(null, null, empty('Fill FIRE assumptions (More › FIRE & goals) and open the tracker once in Excel to see your FIRE plan.'))] };
  const lasts = x.lasts === null || x.lasts === undefined || x.lasts === '' ? '–' : String(x.lasts);
  const needM = isNum(x.monthlyNeeded) ? (x.monthlyNeeded > 0 ? F.inrShort(x.monthlyNeeded) : '₹0 (already on track)') : '–';
  const body = [
    card('At retirement', statusTag(x), kv([
      ['Retire', (x.fireDate ? F.monthLabel(x.fireDate, true) : '–') + (isNum(x.retireAge) ? ' · age ' + x.retireAge : '')],
      ['Projected corpus', money(x.projected)], ['Needed', money(x.needed)],
      [x.onTrack ? 'Extra' : 'Short', money(Math.abs(x.gap)), x.onTrack ? 'gain' : 'loss']]),
      h('p', { class: 'hint', style: { marginTop: '6px' } }, "All in today's money.")),
    card('Path to FIRE', null, pathChart(x) || empty('The yearly path appears after the tracker is next opened in Excel.')),
    card('Today', null, kv([['FIRE corpus', money(x.corpusToday)], ['Progress', x.progress === null ? '–' : F.pct(x.progress, 0)], ['Coast FIRE', x.coastYear ? String(x.coastYear) + (isNum(x.coastAge) ? ' · age ' + x.coastAge : '') : '–']]),
      x.coastYear ? h('p', { class: 'hint', style: { marginTop: '6px' } }, 'Coast FIRE: from ' + x.coastYear + ' you could stop adding money and still reach your number' + (isNum(x.retireAge) ? ' by ' + x.retireAge : '') + '.') : null),
    card('Monthly investing', null, kv([['Needed', needM], ['Your target', money(x.target)], isNum(x.actual) && x.actual > 0 ? ['Actual (last 12 months)', money(x.actual)] : null])),
    card('After FIRE', null, kv([['Money lasts until age', lasts]])),
    h('details', { class: 'card', id: 'fireassum' }, h('summary', { class: 'ttl strong' }, 'Assumptions'),
      h('div', { style: { marginTop: '8px' } }, kv([['Retirement age', isNum(x.retireAge) ? String(x.retireAge) : '–'], ['Spend after FIRE', isNum(x.living) ? F.inr((x.living || 0) + (x.trips || 0)) + ' / month' : '–'],
        ['Inflation', pctv(x.inflation)], ['Returns before / after', pctv(x.retBefore) + ' / ' + pctv(x.retAfter)]])),
      h('div', { class: 'btns', style: { marginTop: '8px' } }, h('button', { class: 'btn', id: 'fireedit', onclick: () => { state.formId = 'settings'; state.formBack = 'fire'; ctx.go('form'); } }, 'Change in FIRE assumptions'))),
    s.provisional ? h('p', { class: 'hint', style: { margin: '8px 4px' } }, 'These figures update after the tracker is next opened in Excel.') : null];
  return { title: 'FIRE', back, body };
}
