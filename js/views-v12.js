// 0.12.0 (tracker v28): EPF set once a year, and holdings linked to goals. Both write only to the app's own tables
// (tblEPF, tblGoalLinks); the tracker works out the EPF balance, the monthly EPF figure and each goal's linked value.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, haptic, seg, tag, card, empty, sheet, bar, parseAmount } from './ui.js';
import { uuid } from './crypto.js';

const PEOPLE = ['Aravind', 'Madhu'];
const pad = n => String(n).padStart(2, '0');
const ymNow = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
const serialOfYm = ym => { const [y, m] = ym.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, 1) - Date.UTC(1899, 11, 30)) / 86400000); };
const ymOfSerial = v => { if (typeof v === 'string') return v.slice(0, 7); const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000); return d.toISOString().slice(0, 7); };
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + m2 - m1 + 1; };
const fyStart = () => { const d = new Date(); const y = d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear(); return y + '-04'; };
const fyEnd = () => { const [y] = fyStart().split('-').map(Number); return (y + 1) + '-03'; };
const pendingRows = table => ctx.V.all('outbox').filter(o => o.kind === 'addRow' && o.table === table).map(o => ({ ...o.values, _pending: true }));
const pendingSets = table => ctx.V.all('outbox').filter(o => o.kind === 'setRow' && o.table === table);
async function addRow(table, idCol, values, what, summary) { await ctx.queue({ kind: 'addRow', table, idCol, values, what, summary }); ctx.scheduleSync(4000); haptic(); }
async function setRow(table, idCol, id, changes, base) { await ctx.queue({ kind: 'setRow', table, idCol, id, changes, base }); ctx.scheduleSync(4000); haptic(); }
const needV28 = s => !(s && s.v28);
const moveNote = () => card(null, null, empty('This needs tracker v28. Move to it first: More › App › Settings › New tracker version.'));

// ---------------------------------------------------------------- EPF
export function epfEntries() {
  const s = ctx.snap() || {};
  const list = (s.epf || []).map(e => ({ ...e }));
  for (const r of pendingRows('tblEPF')) list.push({ id: r['Entry ID'], person: r.Person, kind: r.Kind, amount: Number(r['Amount (₹)']) || 0, from: r['From month'] ? ymOfSerial(r['From month']) : '', to: r['To month'] ? ymOfSerial(r['To month']) : '', notes: r.Notes || '', by: r['Entered by'], pending: true });
  for (const op of pendingSets('tblEPF')) { const x = list.find(i => i.id === op.id); if (x && op.changes.Status === 'Deleted') x.deleted = true; }
  return list.filter(e => !e.deleted);
}
// same rule as the EPF sheet: monthly amounts count from "From" to "To" (or this month), this month included
export function epfBalance(person, list = epfEntries()) {
  const now = ymNow(); let t = 0;
  for (const e of list.filter(x => x.person === person)) {
    if (e.kind === 'Monthly contribution') { if (!e.from) continue; const end = e.to && e.to.slice(0, 7) < now ? e.to.slice(0, 7) : now; t += Math.max(0, monthsBetween(e.from.slice(0, 7), end)) * e.amount; }
    else t += e.amount;
  }
  return t;
}
export function viewEPF() {
  const s = ctx.snap();
  if (needV28(s)) return { title: 'EPF', back: 'tracker', body: [moveNote()] };
  const list = epfEntries();
  const kindLbl = { 'Opening balance': 'Opening balance', 'Monthly contribution': 'Every month', 'Interest credited': 'Interest' };
  const people = PEOPLE.map(p => {
    const mine = list.filter(e => e.person === p);
    const rows = mine.sort((a, b) => String(a.from).localeCompare(String(b.from))).map(e => h('li', { class: 'li wrap tap', onclick: () => epfSheet(e) },
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, kindLbl[e.kind] || e.kind, e.pending ? [' ', tag('Waiting to sync', 'prov')] : null),
        h('div', { class: 'sub' }, e.kind === 'Monthly contribution' ? F.monthLabel(e.from + '-01', true) + ' to ' + (e.to ? F.monthLabel(e.to.slice(0, 7) + '-01', true) : 'no end') : e.from ? F.monthLabel(e.from.slice(0, 7) + '-01', true) : '')),
      h('div', { class: 'end num' }, F.inr(e.amount), e.kind === 'Monthly contribution' ? h('div', { class: 'sub' }, 'a month') : null)));
    return h('section', { class: 'card', id: 'epf-' + p.toLowerCase() }, h('div', { class: 'card-h' }, h('h2', {}, p), h('span', { class: 'num strong' }, F.inr(epfBalance(p, list)))),
      rows.length ? h('ul', { class: 'list' }, rows) : empty('Nothing set yet.'));
  });
  return { title: 'EPF', back: 'tracker', body: [h('div', { style: { maxWidth: '680px' } },
    h('p', { class: 'hint' }, 'Set this once a year: the opening balance, then the monthly amount (your share plus the employer\'s) for April to March. Add interest when it is credited. The balance and each month\'s EPF fill themselves; EPF is not in the Month-end update.'),
    h('div', { class: 'btns', style: { margin: '10px 0' } },
      h('button', { class: 'btn primary', id: 'epfmonthly', onclick: () => epfForm('Monthly contribution') }, icon('plus', 16), 'Monthly amount'),
      h('button', { class: 'btn', id: 'epfopening', onclick: () => epfForm('Opening balance') }, 'Opening balance'),
      h('button', { class: 'btn', id: 'epfinterest', onclick: () => epfForm('Interest credited') }, 'Interest credited')),
    ...people)] };
}
function monthInput(id, value, label) { return h('input', { class: 'field', type: 'month', id, value, 'aria-label': label, style: { width: 'auto' } }); }
function epfForm(kind) {
  const f = { person: ctx.who() || 'Aravind' };
  const amt = h('input', { class: 'field', id: 'epfamt', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Amount' });
  const from = monthInput('epffrom', kind === 'Monthly contribution' ? fyStart() : kind === 'Opening balance' ? fyStart() : ymNow(), kind === 'Monthly contribution' ? 'From month' : 'Month');
  const to = kind === 'Monthly contribution' ? monthInput('epfto', fyEnd(), 'To month') : null;
  const who = h('div'); const drawWho = () => who.replaceChildren(seg(PEOPLE, f.person, v => { f.person = v; drawWho(); }, 'Whose EPF'));
  drawWho();
  const title = { 'Monthly contribution': 'Monthly EPF amount', 'Opening balance': 'EPF opening balance', 'Interest credited': 'EPF interest credited' }[kind];
  const sh = sheet(title, h('div', { class: 'stack' }, who,
    h('div', { class: 'label-sm' }, kind === 'Monthly contribution' ? 'Amount each month (₹), your share plus the employer\'s' : 'Amount (₹)'), amt,
    h('div', { class: 'label-sm' }, kind === 'Monthly contribution' ? 'From' : kind === 'Opening balance' ? 'Balance as of' : 'Credited in'), from,
    to ? [h('div', { class: 'label-sm' }, 'To (leave as March for the financial year)'), to] : null,
    h('button', { class: 'btn primary', id: 'epfsave', onclick: async () => {
      const v = parseAmount(amt.value); if (!(v > 0)) return toast('Type the amount', 'bad');
      if (!from.value) return toast('Pick the month', 'bad');
      if (to && to.value && to.value < from.value) return toast('"To" must be on or after "From"', 'bad');
      const id = 'EPF-' + uuid().slice(0, 8);
      await addRow('tblEPF', 'Entry ID', { 'Entry ID': id, Person: f.person, Kind: kind, 'Amount (₹)': v, 'From month': serialOfYm(from.value), 'To month': to && to.value ? serialOfYm(to.value) : null, Notes: '', 'Entered by': ctx.who() || '', 'Entered at': stamp(), Status: 'Active' },
        'EPF', f.person + ' · ' + kind + ' · ₹' + v);
      sh(); toast('Saved. It reaches the tracker with the next sync.'); ctx.render();
    } }, 'Save')));
  setTimeout(() => amt.focus(), 60);
}
function epfSheet(e) {
  const sh = sheet(e.kind + ' · ' + e.person, h('div', { class: 'stack' },
    h('p', {}, F.inr(e.amount) + (e.kind === 'Monthly contribution' ? ' a month, ' + F.monthLabel(e.from + '-01', true) + ' to ' + (e.to ? F.monthLabel(e.to.slice(0, 7) + '-01', true) : 'no end') : '')),
    h('p', { class: 'hint' }, 'To change it, delete it and add it again.'),
    h('button', { class: 'btn danger', id: 'epfdel', onclick: async () => {
      if (e.pending) { const op = ctx.V.all('outbox').find(o => o.kind === 'addRow' && o.table === 'tblEPF' && o.values['Entry ID'] === e.id); if (op) await ctx.V.remove('outbox', op.opId); }
      else await setRow('tblEPF', 'Entry ID', e.id, { Status: 'Deleted' }, { Status: 'Active' });
      sh(); toast('Deleted'); ctx.render();
    } }, 'Delete')));
}

// ---------------------------------------------------------------- Goal links
// What can be linked, grouped the way Aravind asked: class › account holder › holding (e.g. Equity › Aravind › ITC)
export const LINK_CLASSES = ['Equity', 'Mutual funds', 'Bonds & debt', 'International', 'FD / RD', 'Savings account', 'Other'];
const isFund = t => /\bMF\b|fund|ETF/i.test(t || '');
const isDebtT = t => /debt|bond|arbitrage|liquid|gilt|money market|overnight|SGB/i.test(t || '');
export function linkables() {
  const s = ctx.snap() || {}; const out = [];
  const add = (cls, owner, name, value, ret, extra) => { if (!name || !owner) return; const k = cls + '|' + owner + '|' + name; const x = out.find(o => o.key === k); if (x) { x.value += value || 0; return; } out.push({ key: k, cls, owner, name, value: value || 0, ret, ...extra }); };
  for (const x of s.holdings || []) { const t = x.type || ''; const cls = isFund(t) && !/ETF/i.test(t) ? (isDebtT(t) ? 'Bonds & debt' : 'Mutual funds') : isDebtT(t) ? 'Bonds & debt' : 'Equity'; add(cls, x.owner, x.name, x.current); }
  for (const x of s.otherHoldings || []) { if (x.linked) continue; const t = x.type || ''; add(isDebtT(t) ? 'Bonds & debt' : isFund(t) ? 'Mutual funds' : 'Other', x.owner, x.name, x.current); }
  for (const x of s.intl || []) add('International', x.owner, x.name, x.current);
  for (const r of s.otherAssets || []) {
    const t = (r.type || '') + ' ' + (r.name || '');
    const cls = /savings|current account|bank/i.test(t) ? 'Savings account' : /deposit|\bFD\b|\bRD\b|post office|NSC|KVP|SCSS/i.test(t) ? 'FD / RD' : /EPF|VPF|NPS|PPF|Sukanya/i.test(t) ? 'Other' : /gold|silver|vehicle|money lent/i.test(t) ? null : 'Other';
    if (!cls) continue;
    if (r.aravind) add(cls, 'Aravind', r.name, r.aravind); if (r.madhu) add(cls, 'Madhu', r.name, r.madhu);
  }
  return out;
}
export function goalLinks() {
  const s = ctx.snap() || {};
  const list = (s.goalLinks || []).map(x => ({ ...x }));
  for (const r of pendingRows('tblGoalLinks')) list.push({ id: r['Link ID'], goal: r.Goal, cls: r.Class, owner: r.Owner, holding: r.Holding, share: Number(r['Share %']) || 1, pending: true });
  for (const op of pendingSets('tblGoalLinks')) { const x = list.find(i => i.id === op.id); if (!x) continue; if (op.changes.Status === 'Deleted') x.deleted = true; if (op.changes['Share %'] !== undefined) x.share = Number(op.changes['Share %']) || 1; x.pending = true; }
  return list.filter(x => !x.deleted);
}
// value of one link worked out here too, so a new link shows its value before Excel recalculates
export function linkValue(l, items = linkables()) { const it = items.find(i => i.cls === l.cls && i.owner === l.owner && i.name === l.holding) || items.find(i => i.owner === l.owner && i.name === l.holding); return it ? Math.round(it.value * (l.share || 1)) : 0; }
export function goalLinked(goalName, links = goalLinks(), items = linkables()) { return links.filter(l => l.goal === goalName).reduce((t, l) => t + linkValue(l, items), 0); }
// share of a holding already given to goals (100% each by default), so the picker can say what is left
const usedShare = (it, links, exceptGoal) => links.filter(l => l.owner === it.owner && l.holding === it.name && l.goal !== exceptGoal).reduce((t, l) => t + (l.share || 1), 0);

export function goalSheet(g) {
  const s = ctx.snap();
  const links = goalLinks(); const items = linkables(); const mine = links.filter(l => l.goal === g.name);
  const linked = goalLinked(g.name, links, items); const target = g.future || g.cost || 0; const set = (g.saved || 0) + linked; const frac = target ? Math.min(1, set / target) : 0;
  const body = h('div', { class: 'stack', id: 'goalsheet' },
    target ? h('div', {}, h('div', { class: 'row-between' }, h('span', { class: 'hint' }, 'Covered'), h('span', { class: 'num strong', id: 'goalpct' }, F.pct(set / target, 0))), bar(frac, frac >= 1 ? 'good' : ''),
      h('p', { class: 'hint' }, F.inr(set) + ' of ' + F.inr(target) + (g.future && g.cost ? ' (today\'s ' + F.inr(g.cost) + ' grown to ' + (g.year || 'the target year') + ')' : ''))) : h('p', { class: 'hint' }, 'Add the cost and year in More › FIRE & goals to see how much is covered.'),
    h('div', { class: 'label-sm' }, 'Linked investments'),
    mine.length ? h('ul', { class: 'list', id: 'goallinks' }, mine.map(l => h('li', { class: 'li wrap' },
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, l.holding, l.pending ? [' ', tag('Waiting to sync', 'prov')] : null), h('div', { class: 'sub' }, l.cls + ' · ' + l.owner + ((l.share || 1) < 1 ? ' · ' + F.pct(l.share, 0) + ' of it' : ''))),
      h('div', { class: 'end num' }, F.inr(linkValue(l, items)), h('div', {}, h('button', { class: 'link', onclick: () => { close(); splitSheet(g, l); } }, 'Share'), ' · ', h('button', { class: 'link', 'aria-label': 'Remove ' + l.holding, onclick: async () => { await unlink(l); close(); goalSheet(g); } }, 'Remove')))))) : h('p', { class: 'hint' }, 'Nothing linked yet.'),
    needV28(s) ? h('p', { class: 'warn-text' }, 'Linking needs tracker v28. Move to it first: More › App › Settings › New tracker version.')
      : h('button', { class: 'btn primary', id: 'goallinkadd', onclick: () => { close(); linkPicker(g); } }, icon('plus', 16), mine.length ? 'Link one more' : 'Link an investment'));
  const sh = sheet(g.name, body); function close() { sh(); }
}
async function unlink(l) {
  if (l.pending && !(ctx.snap().goalLinks || []).some(x => x.id === l.id)) { const op = ctx.V.all('outbox').find(o => o.kind === 'addRow' && o.table === 'tblGoalLinks' && o.values['Link ID'] === l.id); if (op) await ctx.V.remove('outbox', op.opId); }
  else await setRow('tblGoalLinks', 'Link ID', l.id, { Status: 'Deleted' }, null);
  toast('Removed from the goal');
}
// step by step: class › account holder › holding
function linkPicker(g, st = {}) {
  const items = linkables(); const links = goalLinks();
  const already = new Set(links.filter(l => l.goal === g.name).map(l => l.owner + '|' + l.holding));
  let title, list;
  if (!st.cls) {
    title = 'Link to ' + g.name + ' · step 1 of 3';
    list = LINK_CLASSES.map(c => { const n = items.filter(i => i.cls === c).length; return n ? h('li', { class: 'li tap', 'data-cls': c, onclick: () => { sh(); linkPicker(g, { cls: c }); } }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, c), h('div', { class: 'sub' }, n + (n === 1 ? ' holding' : ' holdings'))), icon('right', 16)) : null; }).filter(Boolean);
  } else if (!st.owner) {
    title = st.cls + ' · step 2 of 3';
    list = PEOPLE.map(p => { const n = items.filter(i => i.cls === st.cls && i.owner === p).length; return n ? h('li', { class: 'li tap', 'data-owner': p, onclick: () => { sh(); linkPicker(g, { ...st, owner: p }); } }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, p), h('div', { class: 'sub' }, n + (n === 1 ? ' holding' : ' holdings'))), icon('right', 16)) : null; }).filter(Boolean);
  } else {
    title = st.cls + ' · ' + st.owner + ' · step 3 of 3';
    list = items.filter(i => i.cls === st.cls && i.owner === st.owner).sort((a, b) => b.value - a.value).map(i => {
      const used = usedShare(i, links, g.name); const left = Math.max(0, 1 - used); const isIn = already.has(i.owner + '|' + i.name);
      return h('li', { class: 'li tap' + (isIn || left <= 0 ? ' dim' : ''), 'data-holding': i.name, onclick: async () => {
        if (isIn) return toast('Already linked to this goal');
        if (left <= 0) return toast('All of it is already linked to other goals. Change its share there first.', 'bad');
        const id = 'GL-' + uuid().slice(0, 8);
        await addRow('tblGoalLinks', 'Link ID', { 'Link ID': id, Goal: g.name, Class: i.cls, Owner: i.owner, Holding: i.name, 'Share %': left < 1 ? Math.round(left * 100) / 100 : 1, 'Added by': ctx.who() || '', 'Added at': stamp(), Status: 'Active' },
          'goal link', g.name + ' ← ' + i.name + ' (' + i.owner + ')');
        sh(); toast(i.name + ' linked to ' + g.name + (left < 1 ? ' (' + F.pct(left, 0) + ', the part not used by other goals)' : '')); goalSheet(g);
      } }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, i.name), h('div', { class: 'sub' }, isIn ? 'Already linked here' : used ? F.pct(left, 0) + ' free, the rest is linked to other goals' : '')), h('div', { class: 'end num' }, F.inr(i.value)));
    });
  }
  const back = st.owner ? { cls: st.cls } : st.cls ? {} : null;
  const sh = sheet(title, h('div', { class: 'stack', id: 'linkpicker' }, list.length ? h('ul', { class: 'list' }, list) : empty('Nothing here yet. Sync after pasting holdings or adding balances.'),
    back ? h('button', { class: 'btn', onclick: () => { sh(); linkPicker(g, back); } }, 'Back') : null));
}
// optional split: what share of this holding counts for this goal
function splitSheet(g, l) {
  const inp = h('input', { class: 'field', id: 'goalshare', inputmode: 'decimal', value: String(Math.round((l.share || 1) * 100)), 'aria-label': 'Share in percent', style: { maxWidth: '120px' } });
  const sh = sheet('Share of ' + l.holding, h('div', { class: 'stack' },
    h('p', { class: 'hint' }, 'By default all of it (100%) counts for one goal. Give a smaller share to split it with another goal.'),
    h('label', { class: 'row-between' }, h('span', {}, 'Share for ' + g.name + ' (%)'), inp),
    h('button', { class: 'btn primary', id: 'goalsharesave', onclick: async () => {
      const p = Number(String(inp.value).replace('%', '')); if (!(p > 0 && p <= 100)) return toast('Type a share from 1 to 100', 'bad');
      const others = goalLinks().filter(x => x.owner === l.owner && x.holding === l.holding && x.id !== l.id).reduce((t, x) => t + (x.share || 1), 0);
      if (others + p / 100 > 1.0001) return toast('Other goals already use ' + F.pct(others, 0) + ' of it. Lower theirs first.', 'bad');
      if (l.pending && !(ctx.snap().goalLinks || []).some(x => x.id === l.id)) { const op = ctx.V.all('outbox').find(o => o.kind === 'addRow' && o.table === 'tblGoalLinks' && o.values['Link ID'] === l.id); if (op) { op.values['Share %'] = p / 100; await ctx.V.put('outbox', op.opId, op); } }
      else await setRow('tblGoalLinks', 'Link ID', l.id, { 'Share %': p / 100 }, null);
      sh(); toast('Saved'); goalSheet(g);
    } }, 'Save')));
}
