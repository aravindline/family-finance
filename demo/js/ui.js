// UI building blocks: DOM helper (text only, never HTML strings), icons, toast, bottom sheet, charts.
import * as F from './fmt.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  setAttrs(el, attrs);
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v); // CSSOM: allowed by the strict CSP
    else el.setAttribute(k, v === true ? '' : v);
  }
}

// ---- icons: simple 24px line drawings (drawn for this app)
const P = {
  c_food: 'M5 3v8a2 2 0 0 0 4 0V3 M7 11v10 M17 3c-2 1-3 3-3 6s1 4 3 4v8',
  c_home: 'M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-5h4v5',
  c_bolt: 'M13 2L5 14h6l-1 8 8-12h-6z',
  c_car: 'M5 16V11l2-5h10l2 5v5 M3 16h18 M7 19a1.5 1.5 0 1 0 0-.1 M17 19a1.5 1.5 0 1 0 0-.1 M6 11h12',
  c_health: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z M9 11h6 M12 8v6',
  c_bag: 'M5 8h14l-1 12H6z M9 8V6a3 3 0 0 1 6 0v2',
  c_fun: 'M4 6h16v12H4z M10 9v6l5-3z',
  c_people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M16 5a3 3 0 0 1 0 6 M18 14c1.8.8 3 2.6 3 6',
  c_user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8',
  c_child: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M9 12h.01 M15 12h.01 M9.5 16c1.5 1 3.5 1 5 0 M12 5c0-2 2-2 2-2',
  c_star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  c_tag: 'M3 12V4h8l10 10-8 8z M7.5 8.5h.01',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  spend: 'M3 7h18v12H3z M3 10h18 M7 15h4',
  wealth: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  plan: 'M12 3a9 9 0 1 0 9 9 M12 7a5 5 0 1 0 5 5 M12 11a1 1 0 1 0 1 1 M12 12l8-8 M17 4h3v3',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  plus: 'M12 5v14 M5 12h14',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  eyeoff: 'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4 M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4z M10 20a2 2 0 0 0 4 0',
  sync: 'M20 11a8 8 0 0 0-14.3-4.9L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.3 4.9L20 16 M20 20v-4h-4',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  doc: 'M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M19 12l2-1-1-3-2 .3-1.4-1.4L17 5l-3-1-1 2h-2L10 4 7 5l.4 2L6 8.3 4 8 3 11l2 1v0l-2 1 1 3 2-.3 1.4 1.4L7 19l3 1 1-2h2l1 2 3-1-.4-2 1.4-1.4 2 .4 1-3z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', back: 'M19 12H5 M11 6l-6 6 6 6',
  finger: 'M12 11v4c0 2-.5 4-1.5 5.5 M8 10a4 4 0 0 1 8 0v3c0 2.5-.4 4.6-1.2 6.4 M5 9a7 7 0 0 1 13.6-2.4 M5 13v-1 M19 13c0 2-.3 3.8-.8 5.4',
  alert: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  check: 'M5 12l5 5 9-10', x: 'M6 6l12 12 M18 6L6 18',
  up: 'M4 17l6-6 4 4 6-7 M15 8h5v5',
  down: 'M4 7l6 6 4-4 6 7 M15 16h5v-5',
  flame: 'M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 .8 1.6 1.6 2.2 2.6 2.4C11.3 8.6 11 6 12 3z',
  play: 'M8 5v14l11-7z',
  chart: 'M4 20h16 M7 16v-5 M12 16V7 M17 16v-8',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
  wizard: 'M4 6h10 M4 12h16 M4 18h7 M17 4l3 3-3 3',
  pie: 'M12 3v9h9 M12 3a9 9 0 1 0 9 9',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  trash: 'M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v6 M12 8h.01',
  g_leaf: 'M5 19c0-8 5-14 15-15-1 10-7 15-15 15z M5 19l7-7',
  g_plane: 'M3 13l7-2 4-7h2l-2 7 5 1 2-3h1l-1 5-1 4h-1l-2-3-5 1 2 6h-2l-4-6-5 1z',
  g_cap: 'M2 9l10-5 10 5-10 5z M6 11v5c3 2 9 2 12 0v-5 M22 9v6',
  g_gift: 'M4 10h16v10H4z M3 7h18v3H3z M12 7v13 M12 7c-2-4-6-3-5 0 M12 7c2-4 6-3 5 0',
  bank: 'M3 10l9-6 9 6 M5 10v8 M10 10v8 M14 10v8 M19 10v8 M3 20h18',
  loan: 'M4 7h16v10H4z M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5 M7 7v10 M17 7v10',
  i_brief: 'M4 8h16v11H4z M9 8V5h6v3 M4 13h16',
  g_coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9 8h6 M9 11h6 M10 8c3 0 3 6 0 6l4 3',
  hand: 'M3 13l4-4 4 1 3-3 4 1 3 3-6 6-3-1-3 2-6-5z M10 10l3 3',
  msg: 'M4 5h16v11H9l-5 4z',
  note: 'M5 4h10l4 4v12H5z M15 4v4h4 M8 12h8 M8 16h5',
};
export function icon(name, size = 20) {
  return s('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    ...(P[name] || P.info).split(' M').map((d, i) => s('path', { d: (i ? 'M' : '') + d })));
}

// Category look: a fixed icon and colour per category (colour follows the category, never its rank).
const CAT = { 'Food': ['c_food', 2], 'Household': ['c_home', 3], 'Rent & Bills': ['c_bolt', 4], 'Travel': ['c_car', 1], 'Health': ['c_health', 8], 'Shopping': ['c_bag', 5],
  'Entertainment': ['c_fun', 7], 'Family & Social': ['c_people', 6], 'Personal': ['c_user', 1], 'Children': ['c_child', 5], 'One-time': ['c_star', 7],
  'Salary': ['i_brief', 1], 'Investment / savings income': ['up', 3], 'Rewards': ['c_star', 7], 'Gifts': ['g_gift', 6], 'Others': ['g_coin', 4] };
export function catColor(name) { const c = (CAT[name] || [0, 0])[1]; return c ? 'var(--s' + c + ')' : 'var(--muted)'; }
export function catIcon(name, size = 18) {
  const [ic, col] = CAT[name] || ['c_tag', 0];
  const el = h('span', { class: 'caticon', 'aria-hidden': 'true' }, icon(ic, size));
  el.style.setProperty('--cc', col ? 'var(--s' + col + ')' : 'var(--muted)'); return el;
}

// ---- toast and sheet
export function toast(msg, kind = 'info', action = null) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast ' + kind + (action ? ' has-action' : ''), role: 'status' }, h('span', {}, msg),
    action ? h('button', { class: 'toast-act', onclick: () => { t.remove(); action.fn(); } }, action.label) : null);
  document.body.append(t); setTimeout(() => t.remove(), action ? (action.ms || 6000) : kind === 'bad' ? 5000 : 3000);
}
// Light tap on save (Android; ignored where not supported).
export function haptic(ms = 12) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } }
export function sheet(title, ...content) {
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const scrim = h('div', { class: 'scrim', onclick: e => { if (e.target === scrim) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'row-between' }, h('h2', {}, title), h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: close }, icon('x'))), h('div', { class: 'spacer' }), ...content));
  document.addEventListener('keydown', esc);
  document.body.append(scrim);
  return close;
}

// ---- input guards (QA 9 Nov): no full account/card/ID numbers in free text; amounts as plain numbers only
export const LONG_DIGITS = /\d{5,}/;
export const DIGITS_MSG = 'Last 4 digits only. Please don\'t type a full account, card or ID number.';
export const hasLongDigits = (...t) => t.some(x => LONG_DIGITS.test(String(x || '')));
// '1,250.50' -> 1250.5; '1e5', '12abc', '-5' -> NaN; rounded to 2 decimals
export function parseAmount(raw) { const t = String(raw ?? '').replace(/[,₹\s]/g, ''); if (!/^\d+(\.\d+)?$/.test(t) && !/^\.\d+$/.test(t)) return NaN; return Math.round(Number(t) * 100) / 100; }
// "Is ₹X right?" before saving an expense above ₹1 lakh. Resolves true when confirmed.
export function confirmAmount(amount, fmt) {
  return new Promise(res => { let done = false; const fin = v => { if (!done) { done = true; close(); res(v); } };
    const close = sheet('Is ' + fmt(amount) + ' right?', h('p', { class: 'hint' }, 'That is more than ₹1 lakh. Check the zeros before saving.'), h('div', { class: 'spacer' }),
      h('div', { class: 'btns' }, h('button', { class: 'btn', id: 'amtfix', onclick: () => fin(false) }, 'Change it'), h('button', { class: 'btn primary', id: 'amtok', onclick: () => fin(true) }, 'Yes, save'))); });
}
// ---- small pieces
export const seg = (options, value, onPick, label) => h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
  ...options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('button', { role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '', onclick: () => onPick(v) }, l); }));
// tags read in sentence case: 'NOT SYNCED' -> 'Not synced' (short codes like 'FD' or '3 DUE' numbers keep their case)
const sentence = t => (typeof t === 'string' && /[A-Z]{3,}/.test(t) && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t);
export const tag = (text, kind = 'plain') => h('span', { class: 'tag ' + kind }, sentence(text));
export function bar(frac, kind = '') { const b = h('div', { class: 'bar ' + kind, role: 'presentation' }, h('span', { style: { width: Math.max(0, Math.min(1, frac || 0)) * 100 + '%' } })); return b; }
export function card(title, more, ...content) {
  return h('section', { class: 'card' }, title ? h('div', { class: 'card-h' }, h('h2', {}, title), more || null) : null, ...content);
}
export const moreBtn = (label, on) => h('button', { class: 'more', onclick: on }, label, icon('right', 16));
export function empty(text, label, fn) { return label && fn ? h('div', { class: 'empty' }, h('p', {}, text), h('button', { class: 'btn small', onclick: fn }, label)) : h('p', { class: 'empty' }, text); }
export function statusKind(text) {
  const t = String(text || '').toLowerCase();
  if (/overdue|expired|behind|beyond|over budget|missing|attention|gap|not made|not updated/.test(t)) return /overdue|expired|beyond/.test(t) ? 'crit' : 'warn';
  if (/ok|on track|within|up to date|valid|covered|done|hit|ahead/.test(t)) return 'ok';
  return 'plain';
}
export function statusIcon(kind) { return h('span', { class: 'statusic ' + kind, 'aria-hidden': 'true' }, icon(kind === 'ok' ? 'check' : 'alert', 16)); }

// ---- charts (SVG, no libraries). Every chart has a text equivalent nearby or a hover/tap readout.
// Area/line over time with a crosshair readout. points: [{x: label, y: number}]
export function trendChart(points, { height = 160, fmt = F.inrShort, compact = false, label = 'Trend' } = {}) {
  const W = 600, H = height, padL = compact ? 0 : 6, padR = compact ? 0 : 6, padT = compact ? 6 : 14, padB = compact ? 4 : 22;
  const ys = points.map(p => p.y); const lo = Math.min(...ys), hi = Math.max(...ys); const span = hi - lo || Math.abs(hi) || 1;
  const y0 = lo - span * 0.12, y1 = hi + span * 0.08;
  const X = i => padL + (points.length === 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (points.length - 1));
  const Y = v => padT + (1 - (v - y0) / (y1 - y0)) * (H - padT - padB);
  const d = points.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
  const area = d + ` L${X(points.length - 1).toFixed(1)} ${H - padB} L${X(0).toFixed(1)} ${H - padB} Z`;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label + ': ' + points.map(p => p.x + ' ' + fmt(p.y)).join(', '), height: compact ? 56 : H, style: { height: (compact ? 56 : H) + 'px' } });
  if (!compact) for (const f of [0.25, 0.5, 0.75]) svg.append(s('line', { class: 'grid-l', x1: 0, x2: W, y1: padT + f * (H - padT - padB), y2: padT + f * (H - padT - padB), 'vector-effect': 'non-scaling-stroke' }));
  svg.append(s('path', { class: 'area', d: area }), s('path', { class: 'ln', d, 'vector-effect': 'non-scaling-stroke' }));
  const wrap = h('div', { class: 'chart-wrap' }, svg);
  if (!compact) {
    const step = Math.max(1, Math.ceil(points.length / 6));
    const ticks = h('div', { class: 'row-between faint', style: { fontSize: '.7rem', marginTop: '2px' } }, ...points.filter((p, i) => i % step === 0 || i === points.length - 1).map(p => h('span', {}, p.x)));
    wrap.append(ticks);
  }
  const xh = s('line', { class: 'xh', y1: 0, y2: H, 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' }); svg.append(xh);
  const tip = h('div', { class: 'tip', hidden: true }); wrap.append(tip);
  const show = e => {
    const r = svg.getBoundingClientRect(); const fx = (e.clientX - r.left) / r.width * W;
    let i = 0, best = Infinity; points.forEach((p, k) => { const dd = Math.abs(X(k) - fx); if (dd < best) { best = dd; i = k; } });
    xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible');
    tip.hidden = false; tip.textContent = points[i].x + ' · ' + fmt(points[i].y); tip.style.left = (X(i) / W * r.width) + 'px';
  };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => { xh.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  return wrap;
}

// Column chart over months, optionally stacked (one segment per series). rows: [{x, parts:[n...]}]
// 4px rounded tops, 2px surface gaps between stacked segments, tap/hover readout, legend when >1 series.
export function columnChart(rows, { series = ['Total'], colors = [SERIES[0]], height = 170, fmt = F.inrShort, label = 'Columns', budget = null } = {}) {
  const W = 600, H = height, padT = 12, padB = 22; const n = rows.length || 1;
  const tot = rows.map(r => r.parts.reduce((a, b) => a + (b || 0), 0)); const hi = Math.max(1, ...tot, budget || 0) * 1.08;
  const slot = W / n, bw = Math.min(46, slot * 0.62); const Y = v => padT + (1 - v / hi) * (H - padT - padB);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', height: H, style: { height: H + 'px' },
    'aria-label': label + ': ' + rows.map((r, i) => r.x + ' ' + fmt(tot[i])).join(', ') });
  for (const f of [0.25, 0.5, 0.75]) svg.append(s('line', { class: 'grid-l', x1: 0, x2: W, y1: padT + f * (H - padT - padB), y2: padT + f * (H - padT - padB), 'vector-effect': 'non-scaling-stroke' }));
  rows.forEach((r, i) => {
    const x = i * slot + (slot - bw) / 2; let base = 0; const segs = r.parts.map((v, k) => ({ v: v || 0, k })).filter(p => p.v > 0);
    segs.forEach((p, j) => {
      const y1 = Y(base + p.v), y0 = Y(base); const top = j === segs.length - 1; const gap = j ? 1 : 0; const hgt = Math.max(0, y0 - y1 - gap);
      const rr = top ? Math.min(4, hgt) : 0;
      const d = `M${x} ${y1 + hgt} V${y1 + rr} Q${x} ${y1} ${x + rr} ${y1} H${x + bw - rr} Q${x + bw} ${y1} ${x + bw} ${y1 + rr} V${y1 + hgt} Z`;
      svg.append(s('path', { d, style: { fill: colors[p.k] || SERIES[p.k] } })); base += p.v;
    });
  });
  if (budget) svg.append(s('line', { x1: 0, x2: W, y1: Y(budget), y2: Y(budget), style: { stroke: 'var(--muted)', strokeDasharray: '4 4' }, 'vector-effect': 'non-scaling-stroke' }));
  const wrap = h('div', { class: 'chart-wrap' }, svg);
  const step = Math.max(1, Math.ceil(n / 6));
  wrap.append(h('div', { class: 'xlabels faint' }, ...rows.map((r, i) => h('span', { style: { width: (100 / n) + '%' } }, i % step === 0 || i === n - 1 ? r.x : ''))));
  const tip = h('div', { class: 'tip', hidden: true }); wrap.append(tip);
  const show = e => { const b = svg.getBoundingClientRect(); const i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - b.left) / b.width * n))); const r = rows[i];
    tip.hidden = false; tip.textContent = r.x + ' · ' + fmt(tot[i]) + (series.length > 1 ? ' (' + series.map((nm, k) => nm + ' ' + fmt(r.parts[k] || 0)).join(', ') + ')' : '');
    tip.style.left = Math.max(70, Math.min(b.width - 70, (i + 0.5) / n * b.width)) + 'px'; };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show); svg.addEventListener('pointerleave', () => { tip.hidden = true; });
  if (series.length > 1 || budget) wrap.append(h('div', { class: 'chartlegend' }, ...series.map((nm, k) => series.length > 1 ? h('span', {}, h('span', { class: 'sw', style: { background: colors[k] || SERIES[k] } }), nm) : null), budget ? h('span', {}, h('span', { class: 'sw dash' }), 'Budget') : null));
  return wrap;
}

// Tiny trend line for a tile (decorative; the tile text carries the figure).
export function miniSpark(vals, label = 'Trend') {
  const W = 120, H = 24; const v = vals.length ? vals : [0]; const hi = Math.max(...v), lo = Math.min(0, ...v); const sp = hi - lo || 1;
  const X = i => v.length === 1 ? W / 2 : i * (W - 2) / (v.length - 1) + 1; const Y = n => H - 2 - (n - lo) / sp * (H - 4);
  const d = v.map((n, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(n).toFixed(1)).join(' ');
  return s('svg', { class: 'minispark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
    s('path', { class: 'ms-a', d: d + ` L${X(v.length - 1)} ${H} L${X(0)} ${H} Z` }), s('path', { class: 'ms-l', d, 'vector-effect': 'non-scaling-stroke' }));
}
// Donut for parts of a whole, with a legend that carries names and values (never colour alone).
export function donut(parts, { centre = '', sub = '', fmt = F.inrShort } = {}) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value || 0), 0) || 1;
  const R = 52, CX = 66, CY = 66, SW = 16, C = 2 * Math.PI * R;
  const svg = s('svg', { viewBox: '0 0 132 132', role: 'img', 'aria-label': parts.map(p => p.name + ' ' + F.pct(p.value / total, 0)).join(', ') });
  svg.append(s('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: 'var(--surface-2)', 'stroke-width': SW }));
  let off = 0; const gap = parts.filter(p => p.value > 0).length > 1 ? 2 : 0;
  for (const p of parts) {
    const len = Math.max(0, p.value || 0) / total * C; if (len <= 0) continue;
    const seg = s('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: p.color, 'stroke-width': SW, 'stroke-dasharray': `${Math.max(0, len - gap)} ${C}`, 'stroke-dashoffset': -off, transform: `rotate(-90 ${CX} ${CY})` });
    seg.append(s('title', {}, p.name + ': ' + fmt(p.value) + ' (' + F.pct(p.value / total, 1) + ')'));
    svg.append(seg); off += len;
  }
  svg.append(s('text', { x: CX, y: CY - 2, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 800, fill: 'var(--text)' }, centre));
  if (sub) svg.append(s('text', { x: CX, y: CY + 14, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)' }, sub));
  return svg;
}

// Progress ring for a single ratio (0..1+). Text sits beside it, so the ring is decoration plus value.
export function ring(frac, kind = 'good', text = '') {
  const R = 26, C = 2 * Math.PI * R, f = Math.max(0, Math.min(1, frac || 0));
  const col = kind === 'crit' ? 'var(--critical)' : kind === 'warn' ? 'var(--warning)' : 'var(--brand)';
  return s('svg', { class: 'ring', viewBox: '0 0 64 64', 'aria-hidden': 'true' },
    s('circle', { cx: 32, cy: 32, r: R, fill: 'none', stroke: 'var(--surface-2)', 'stroke-width': 7 }),
    s('circle', { cx: 32, cy: 32, r: R, fill: 'none', stroke: col, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-dasharray': `${f * C} ${C}`, transform: 'rotate(-90 32 32)' }),
    s('text', { x: 32, y: 36, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 800, fill: 'var(--text)' }, text));
}
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

// Swipe right to edit, left to delete (own entries only), like Gmail: the row slides over a coloured strip that says
// what will happen ("Edit" / "Delete"); past the threshold the action runs. Tap still opens the row.
export function swipeable(li, onRight, onLeft) {
  const LIMIT = 90;
  const c = h('div', { class: 'swc' }); while (li.firstChild) c.append(li.firstChild);
  const bg = h('div', { class: 'swbg', 'aria-hidden': 'true' }, h('span', { class: 'swl' }, icon('edit', 16), 'Edit'), h('span', { class: 'swr' }, 'Delete', icon('trash', 16)));
  li.classList.add('swipe'); li.append(bg, c);
  let x0 = null, y0 = 0, dx = 0, locked = null;
  li.addEventListener('pointerdown', ev => { if (ev.pointerType === 'mouse') return; x0 = ev.clientX; y0 = ev.clientY; dx = 0; locked = null; delete li.dataset.swiped; });
  li.addEventListener('pointermove', ev => {
    if (x0 === null) return; const mx = ev.clientX - x0, my = ev.clientY - y0;
    if (locked === null && (Math.abs(mx) > 10 || Math.abs(my) > 10)) locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (locked !== 'x') return; dx = mx; c.style.transition = 'none'; c.style.transform = 'translateX(' + Math.max(-160, Math.min(160, dx)) + 'px)';
    li.classList.toggle('to-edit', dx > 0); li.classList.toggle('to-del', dx < 0); li.classList.toggle('sw-go', Math.abs(dx) > LIMIT);
  });
  const end = act => { if (x0 === null) return; x0 = null; c.style.transition = ''; c.style.transform = ''; li.classList.remove('to-edit', 'to-del', 'sw-go');
    if (locked === 'x' && Math.abs(dx) > 10) { li.dataset.swiped = '1'; setTimeout(() => delete li.dataset.swiped, 50); }
    if (!act) return; // a cancelled gesture (the browser took over) never edits or deletes
    if (locked === 'x' && dx > LIMIT) onRight(); else if (locked === 'x' && dx < -LIMIT) onLeft(); };
  li.addEventListener('pointerup', () => end(true)); li.addEventListener('pointercancel', () => end(false));
  return li;
}
