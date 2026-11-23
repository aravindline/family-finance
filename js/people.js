// The family's names (app 0.16.0, Aravind 15 Nov 2026: "min 1 and max 5 names, addition can be done later").
// Names live in the tracker (Settings › Family, tracker v32). The tracker the app ships with is built around two
// placeholder names (BAKED); "Create my tracker" writes the family's own names into the new file (personalise), so
// every label, list and formula in that file uses them. Member 1 and member 2 hold the money columns; members 3 to 5
// log expenses and income and can own goals, insurance and documents.
// Sections (tracker v32, Settings › Sections): optional parts of the app, shown or hidden for the whole family.
import { readZip, writeZip, text, bytes } from './zip.js';

export const BAKED = ['Aravind', 'Madhu'];
export const SLOT2 = 'Person 2'; // the second money holder's name in a tracker made for a family of one
export const MAX = 5;

// ---------------------------------------------------------------- names
let cur = null; // set by app.js from the snapshot (or setup) so every screen reads the same list
// live lists (changed in place, so a screen's `const PEOPLE = HOLDERS` always reads the current names)
export const HOLDERS = [], VIEWS = [], MEMBERS = [];
export function setNames(list) {
  const l = (list || []).map(x => String(x || '').trim()).filter(Boolean); cur = l.length ? l.slice(0, MAX) : null;
  const n = names(); HOLDERS.splice(0, HOLDERS.length, ...[n[0], n[1]].filter(Boolean)); VIEWS.splice(0, VIEWS.length, 'Family', ...(HOLDERS.length > 1 ? HOLDERS : [])); // a family of one: only the family view
  MEMBERS.splice(0, MEMBERS.length, ...n);
}
export function names() { return cur || BAKED; }
export const p1 = () => names()[0];
export const p2 = () => names()[1] || ''; // '' in a family of one
// the money holders (one or two people): person views, per-person columns, net worth by person
export const holders = () => [p1(), p2()].filter(Boolean);
export const members = () => names();
export const isP2 = n => !!n && n === p2();
export const other = n => (n === p1() ? p2() : p1()) || p1();
export const tagOf = n => (n === p2() ? 'M' : 'A'); // handover table prefixes in the tracker (tblHOA / tblHOM)
export const initial = n => String(n || '?').trim().charAt(0).toUpperCase();

// ---------------------------------------------------------------- name rules
const RESERVED = ['family', 'both', 'parents', 'all', 'person 2', 'everyone'];
export function checkName(n, others = []) {
  const v = String(n || '').trim().replace(/\s+/g, ' ');
  if (!v) return 'Type a name.';
  if (v.length > 20) return 'Keep the name to 20 letters or fewer.';
  if (!/^[\p{L}][\p{L} .-]*$/u.test(v)) return 'Use letters, spaces, dots or hyphens only.';
  if (RESERVED.includes(v.toLowerCase())) return '"' + v + '" is used by the app. Pick another name.';
  if (others.some(o => String(o || '').trim().toLowerCase() === v.toLowerCase())) return 'Each name must be different.';
  return null;
}
export const tidy = n => String(n || '').trim().replace(/\s+/g, ' ');

// ---------------------------------------------------------------- sections
export const SECTIONS = [
  { id: 'kite', label: 'Kite holdings', sub: 'Paste Indian stocks and ETFs from Kite', views: ['kite'] },
  { id: 'intl', label: 'International stocks', sub: 'US stocks, brokers, currencies', views: ['intlpaste', 'formintl'], forms: ['intl', 'brokers', 'currencies'] },
  { id: 'cas', label: 'CAS statement', sub: 'Monthly CDSL statement upload', views: ['cas'] },
  { id: 'epf', label: 'EPF', sub: 'EPF register', views: ['epf'] },
  { id: 'gratuity', label: 'Gratuity', sub: 'Gratuity from your employer', views: ['gratuity'], forms: ['gratuity'] },
  { id: 'deposits', label: 'FD / RD', sub: 'Fixed and recurring deposits', views: ['deposits'] },
  { id: 'loans', label: 'Loans', sub: 'Loans and EMIs', forms: ['loans'] },
  { id: 'lent', label: 'Money lent', sub: 'Money you lent and follow-ups', views: ['lent'] },
  { id: 'events', label: 'Events', sub: 'Trips and functions on expenses', views: ['events'] },
  { id: 'fire', label: 'FIRE plan', sub: 'Early-retirement plan and progress', views: ['fire'] },
  { id: 'handover', label: 'Handover', sub: 'What the family needs if something happens', views: ['handover'] },
  { id: 'year', label: 'Year in review', sub: 'Financial-year review', views: ['year'] },
];
export const sectionLabel = id => 'Show in the app: ' + SECTIONS.find(s => s.id === id).label + ' (Yes / No)';
let secOff = new Set();
export function setSections(map) { secOff = new Set(Object.entries(map || {}).filter(([, v]) => v === false).map(([k]) => k)); }
export const on = id => !secOff.has(id);
export function viewOn(view) { const s = SECTIONS.find(x => (x.views || []).includes(view)); return !s || on(s.id); }
export function formOn(id) { const s = SECTIONS.find(x => (x.forms || []).includes(id)); return !s || on(s.id); }

// ---------------------------------------------------------------- the tracker in the family's own names
// Words in the shipped tracker that only fit its first family; a tracker made by "Create my tracker" gets these instead.
const CLEAN = [['Land loan (hometown)', 'Land loan'], ["'s birth year (Dec)", "'s birth year"]];
const isXml = n => /\.(xml|rels)$/.test(n) && !/styles\.xml$|theme\d*\.xml$/.test(n);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// whole-word replace (a name inside a longer word is left alone)
function swapAll(s, pairs) {
  let out = s;
  pairs.forEach(([from], i) => { out = out.replace(new RegExp('(?<![\\p{L}\\d_])' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\d_])', 'gu'), '\u0000' + i + '\u0000'); });
  pairs.forEach(([, to], i) => { out = out.split('\u0000' + i + '\u0000').join(esc(to)); });
  return out;
}
// map: [[from, to], ...]. clean: also replace the first family's own wording. Returns new bytes.
export async function personalise(buf, map, { clean = true } = {}) {
  const z = await readZip(buf); const pairs = map.filter(([a, b]) => a && b && a !== b);
  if (!pairs.length && !clean) return buf;
  for (const [n, data] of z.files) {
    if (!isXml(n)) continue;
    let t = text(data); const t0 = t;
    if (pairs.length) t = swapAll(t, pairs);
    if (clean) for (const [a, b] of CLEAN) t = t.split(esc(a)).join(esc(b));
    if (t !== t0) z.files.set(n, bytes(t));
  }
  return writeZip(z.order, z.files);
}
// the names a tracker made for this family carries, for personalise(): [first family's name, this family's name]
export function nameMap(fam) {
  const a = tidy(fam[0]) || BAKED[0], b = tidy(fam[1]) || SLOT2;
  return [[BAKED[0], a], [BAKED[1], b]];
}
setNames(null);
