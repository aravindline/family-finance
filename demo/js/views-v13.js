// 0.13.0 (tracker v29, Aravind's feedback on 0.12.0): Home tiles, FD / RD register, gratuity, editable targets.
// Like every screen, these only queue edits to input cells or rows of the app's own tables.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, haptic, seg, tag, card, empty, sheet, bar, parseAmount, trendChart, donut, SERIES } from './ui.js';
import { uuid } from './crypto.js';
import { isoToSerial } from './xlsx.js';
import * as W from './wealth.js';
import { goalLinks, epfBalance } from './views-v12.js';

const PEOPLE = W.PEOPLE;
const pad = n => String(n).padStart(2, '0');
const addMonths = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); };
const thisMonth = () => new Date().toISOString().slice(0, 7);
const isoToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const pencil = () => icon('edit', 14);
const pendingRows = table => ctx.V.all('outbox').filter(o => o.kind === 'addRow' && o.table === table).map(o => ({ ...o.values, _op: o.opId }));
const pendingSets = table => ctx.V.all('outbox').filter(o => o.kind === 'setRow' && o.table === table);
const needV29 = () => card(null, null, empty('This needs tracker v29. Move to it first: More › App › Settings › New tracker version.'));
const isoOf = v => (typeof v === 'number' ? new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

// ---------------------------------------------------------------- FD / RD register
export function deposits() {
  const s = ctx.snap() || {}; const list = (s.deposits || []).map(d => ({ ...d }));
  for (const r of pendingRows('tblDeposits')) list.push({ id: r['Deposit ID'], name: r.Name, bank: r.Bank, whose: r.Whose, kind: r.Kind, amount: Number(r['Amount (₹)']) || 0, rate: Number(r['Rate %']) || 0,
    start: isoOf(r.Start), maturity: isoOf(r.Maturity), paysInto: r['Pays into'] || '', status: r.Status || 'Active', notes: r.Notes || '', pending: true, opId: r._op });
  for (const op of pendingSets('tblDeposits')) { const x = list.find(i => i.id === op.id); if (!x) continue; const c = op.changes; if (c.Status) x.status = c.Status; if (c['Amount received (₹)'] !== undefined) x.received = c['Amount received (₹)']; if (c['Closed on']) x.closedOn = isoOf(c['Closed on']); x.pending = true; }
  return list.filter(d => d.status !== 'Deleted');
}
// the snapshot with this device's FD / RD changes that have not synced yet (for the live figures)
export const withPending = s => (s ? { ...s, deposits: deposits() } : s);
const dStatus = d => { if (d.status && d.status !== 'Active') return d.status; if (!d.maturity) return 'Active'; const days = Math.round((Date.parse(d.maturity) - Date.now()) / 86400000); return days < 0 ? 'Matured: confirm' : days <= 30 ? 'Matures in ' + days + ' days' : 'Active'; };
export function maturedToConfirm(list = deposits(), upTo = isoToday()) { return list.filter(d => (d.status || 'Active') === 'Active' && d.maturity && d.maturity <= upTo); }

export function viewDeposits() {
  const s = ctx.snap(); if (!s || !s.v29) return { title: 'FD / RD', back: 'tracker', body: [needV29()] };
  const list = deposits();
  const people = PEOPLE.map(p => {
    const mine = list.filter(d => d.whose === p).sort((a, b) => String(a.maturity).localeCompare(String(b.maturity)));
    const tot = mine.reduce((t, d) => t + W.depositValue(d), 0);
    return h('section', { class: 'card', id: 'dep-' + p.toLowerCase() }, h('div', { class: 'card-h' }, h('h2', {}, p), h('span', { class: 'num strong' }, F.inr(tot))),
      mine.length ? h('ul', { class: 'list' }, mine.map(d => h('li', { class: 'li wrap tap', 'data-dep': d.id, onclick: () => depositSheet(d) },
        h('div', { class: 'body' }, h('div', { class: 'ttl' }, d.name, d.pending ? [' ', tag('Waiting to sync', 'prov')] : null),
          h('div', { class: 'sub' }, [d.kind, d.bank, d.rate ? F.pct(d.rate, 2).replace(/\.00%$/, '%') : null, d.maturity ? 'matures ' + F.date(d.maturity) : null, dStatus(d) !== 'Active' ? dStatus(d) : null].filter(Boolean).join(' · '))),
        h('div', { class: 'end num' }, F.inr(W.depositValue(d)), d.kind === 'RD' ? h('div', { class: 'sub' }, F.inr(d.amount) + ' a month') : null)))) : empty('None yet.'));
  });
  return { title: 'FD / RD', back: 'tracker', body: [h('div', { style: { maxWidth: '680px' } },
    h('p', { class: 'hint' }, 'Enter each FD or RD once, with its maturity. Its value (the principal; an RD adds its instalments each month) is carried forward on its own and is not counted as new saving. Month-end asks only about new ones and those that matured.'),
    h('div', { class: 'btns', style: { margin: '10px 0' } }, h('button', { class: 'btn primary', id: 'depadd', onclick: () => depositForm() }, icon('plus', 16), 'Add FD / RD')),
    ...people)] };
}
export function depositForm(prefill = {}) {
  const s = ctx.snap() || {};
  const f = { whose: prefill.whose || ctx.who() || 'Aravind', kind: prefill.kind || 'FD' };
  const inp = (id, label, attrs = {}) => h('input', { class: 'field', id, 'aria-label': label, ...attrs });
  const name = inp('depname', 'Name', { maxlength: 40, placeholder: 'e.g. SBI FD ••1234' }), bank = inp('depbank', 'Bank', { maxlength: 40 });
  const amt = inp('depamt', 'Amount', { inputmode: 'decimal', placeholder: '0' }), rate = inp('deprate', 'Interest rate', { inputmode: 'decimal', placeholder: 'e.g. 7.1' });
  const start = inp('depstart', 'Start date', { type: 'date', value: prefill.start || isoToday() }), mat = inp('depmat', 'Maturity date', { type: 'date' });
  const accts = ((s.inputs && s.inputs.otherAssets) || []).filter(r => /savings/i.test(String(r.type.v || r.name.v || ''))).map(r => String(r.name.v || '')).filter(Boolean);
  const pays = h('select', { class: 'field', id: 'deppays', 'aria-label': 'Pays into' }, h('option', { value: '' }, '–'), ...accts.map(a => h('option', { value: a }, a)));
  const amtLbl = h('div', { class: 'label-sm' }); const drawAmt = () => { amtLbl.textContent = f.kind === 'RD' ? 'Monthly instalment (₹)' : 'Amount (₹)'; };
  const top = h('div'); const drawTop = () => top.replaceChildren(seg(PEOPLE, f.whose, v => { f.whose = v; drawTop(); }, 'Whose'), h('div', { class: 'spacer' }), seg([['FD', 'FD'], ['RD', 'RD'], ['Corporate FD', 'Corporate FD']], f.kind, v => { f.kind = v; drawTop(); drawAmt(); }, 'Kind'));
  drawTop(); drawAmt();
  const sh = sheet('Add FD / RD', h('div', { class: 'stack', id: 'depform' }, top,
    h('div', { class: 'label-sm' }, 'Name'), name, h('div', { class: 'label-sm' }, 'Bank'), bank, amtLbl, amt, h('div', { class: 'label-sm' }, 'Interest rate (% a year)'), rate,
    h('div', { class: 'label-sm' }, 'Start'), start, h('div', { class: 'label-sm' }, 'Maturity'), mat, h('div', { class: 'label-sm' }, 'Pays into (interest and maturity)'), pays,
    h('button', { class: 'btn primary', id: 'depsave', onclick: async () => {
      const a = parseAmount(amt.value), r = Number(String(rate.value).replace('%', '')); const nm = name.value.trim();
      if (!nm) return toast('Give it a name', 'bad');
      if (!(a > 0)) return toast('Type the amount', 'bad'); if (!(r >= 0 && r < 30)) return toast('Type the rate, like 7.1', 'bad');
      if (!start.value || !mat.value || mat.value <= start.value) return toast('Pick the start and a later maturity date', 'bad');
      const id = 'DEP-' + uuid().slice(0, 8);
      await ctx.queue({ kind: 'addRow', table: 'tblDeposits', idCol: 'Deposit ID', values: { 'Deposit ID': id, Name: nm, Bank: bank.value.trim(), Whose: f.whose, Kind: f.kind, 'Amount (₹)': a, 'Rate %': Math.round(r * 100) / 10000,
        Start: isoToSerial(start.value), Maturity: isoToSerial(mat.value), 'Pays into': pays.value, Status: 'Active', Notes: '', 'Entered by': ctx.who() || '', 'Entered at': stamp() }, what: 'FD / RD', summary: f.whose + ' · ' + nm + ' · ₹' + a });
      ctx.scheduleSync(4000); haptic(); sh(); toast('Saved. It reaches the tracker with the next sync.'); ctx.render();
    } }, 'Save')));
  setTimeout(() => name.focus(), 60);
}
export function depositSheet(d, onDone) {
  const sug = W.maturityAmount(d); const yi = W.yearlyInterest(d);
  const recv = h('input', { class: 'field', id: 'deprecv', inputmode: 'decimal', value: sug ? String(sug) : '', 'aria-label': 'Amount received' });
  const on = h('input', { class: 'field', id: 'depon', type: 'date', value: d.maturity && d.maturity <= isoToday() ? d.maturity : isoToday(), 'aria-label': 'Closed on' });
  const close = async status => {
    const a = parseAmount(recv.value); if (!(a > 0)) return toast('Type the amount received', 'bad');
    await ctx.queue({ kind: 'setRow', table: 'tblDeposits', idCol: 'Deposit ID', id: d.id, changes: { Status: status, 'Closed on': isoToSerial(on.value || isoToday()), 'Amount received (₹)': a }, base: { Status: d.status || 'Active' } });
    ctx.scheduleSync(4000); sh(); toast(d.name + ': ' + status.toLowerCase() + '. Type the new savings balance in Month-end (it stays the final figure).'); onDone ? onDone() : ctx.render();
  };
  const active = (d.status || 'Active') === 'Active';
  const sh = sheet(d.name, h('div', { class: 'stack', id: 'depsheet' },
    h('div', { class: 'kv' }, h('span', {}, 'Whose'), h('span', {}, d.whose), h('span', {}, 'Kind'), h('span', {}, d.kind + (d.bank ? ' · ' + d.bank : '')),
      h('span', {}, d.kind === 'RD' ? 'Instalment' : 'Amount'), h('span', {}, F.inr(d.amount) + (d.kind === 'RD' ? ' a month' : '')), h('span', {}, 'Rate'), h('span', {}, F.pct(d.rate || 0, 2)),
      h('span', {}, 'Start · maturity'), h('span', {}, F.date(d.start) + ' · ' + F.date(d.maturity)), h('span', {}, 'Value now'), h('span', {}, F.inr(W.depositValue(d))),
      yi ? [h('span', {}, 'Interest a year'), h('span', {}, F.inr(yi) + ' (paid out yearly)')] : null,
      sug ? [h('span', {}, 'At maturity (suggested)'), h('span', { id: 'depsug' }, F.inr(sug))] : null, d.paysInto ? [h('span', {}, 'Pays into'), h('span', {}, d.paysInto)] : null),
    active ? [h('p', { class: 'hint' }, 'When it matures or you close it, confirm the amount that reached your bank. It is only a check: the savings balance you type at month-end stays the final figure.'),
      h('div', { class: 'label-sm' }, 'Amount received (₹)'), recv, h('div', { class: 'label-sm' }, 'On'), on,
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', id: 'depmatured', onclick: () => close('Matured') }, 'Matured'), h('button', { class: 'btn', id: 'depclosed', onclick: () => close('Closed early') }, 'Closed early'))]
      : h('p', { class: 'hint' }, (d.status || '') + (d.received ? ': ' + F.inr(d.received) + ' received' : '') + (d.closedOn ? ' on ' + F.date(d.closedOn) : '') + '.'),
    h('button', { class: 'btn danger', id: 'depdel', onclick: async () => {
      if (d.pending && d.opId) await ctx.V.remove('outbox', d.opId); else await ctx.queue({ kind: 'setRow', table: 'tblDeposits', idCol: 'Deposit ID', id: d.id, changes: { Status: 'Deleted' }, base: { Status: d.status || 'Active' } });
      sh(); toast('Deleted'); onDone ? onDone() : ctx.render();
    } }, 'Delete')));
}

// ---------------------------------------------------------------- Gratuity (same rules as the Gratuity sheet)
const yearsCounted = (from, to) => { if (!from || !to || to < from) return 0; const a = new Date(from + 'T00:00:00Z'), b = new Date(to + 'T00:00:00Z');
  let y = b.getUTCFullYear() - a.getUTCFullYear(), m = b.getUTCMonth() - a.getUTCMonth(), d = b.getUTCDate() - a.getUTCDate(); if (d < 0) m--; if (m < 0) { y--; m += 12; }
  const md = d < 0 ? 1 : d; return y + (m > 6 || (m === 6 && md > 0) ? 1 : 0); };
export function gratuityFor(s, p) {
  const g = s.gratuity && s.gratuity[p]; if (!g || !g.joined || !g.basic) return null;
  const set = l => { const c = s.settingCells && s.settingCells[l]; return c && typeof c.v === 'number' ? c.v : null; };
  const share = set('Wages for gratuity: at least this share of total pay') ?? 0.5, need = g.fixedTerm ? (set('Years to qualify, fixed-term employee') ?? 1) : (set('Years of service to qualify') ?? 5);
  const limit = set('Gratuity tax-free limit (₹)') ?? 2000000, growth = set('Salary growth a year') ?? 0;
  const wages = Math.max(g.basic, share * (g.total || 0)); const today = isoToday();
  const q = new Date(g.joined + 'T00:00:00Z'); q.setUTCFullYear(q.getUTCFullYear() + need); const qualifies = q.toISOString().slice(0, 10);
  const monthsLeft = Math.max(0, (q.getUTCFullYear() - new Date().getFullYear()) * 12 + q.getUTCMonth() - new Date().getMonth());
  const nowYears = yearsCounted(g.joined, today);
  const retireYear = p === 'Aravind' ? (s.plan && s.plan.dobYear && s.plan.retireA ? s.plan.dobYear + s.plan.retireA : null) : (s.plan && s.plan.madhuBorn && s.plan.retireM ? s.plan.madhuBorn + s.plan.retireM : null);
  const retireDate = retireYear ? retireYear + '-12-31' : null; const yrsRet = retireDate ? yearsCounted(g.joined, retireDate) : null;
  const wagesRet = retireYear ? Math.round(wages * Math.pow(1 + growth, Math.max(0, retireYear - new Date().getFullYear()))) : null;
  const atRet = yrsRet !== null && yrsRet >= need ? Math.round(15 / 26 * wagesRet * yrsRet) : (yrsRet !== null ? 0 : null);
  return { ...g, wages, need, qualifies, monthsLeft, nowYears, today: today >= qualifies ? Math.round(15 / 26 * wages * nowYears) : 0, atQualify: Math.round(15 / 26 * wages * need),
    retireYear, yrsRet, wagesRet, atRet, taxFree: atRet !== null ? Math.min(atRet, limit) : null, taxable: atRet !== null ? Math.max(0, atRet - limit) : null, limit };
}
export function viewGratuity() {
  const s = ctx.snap(); if (!s || !s.gratuity) return { title: 'Gratuity', back: 'tracker', body: [needV29()] };
  const cards = PEOPLE.map(p => { const g = gratuityFor(s, p);
    return h('section', { class: 'card', id: 'grat-' + p.toLowerCase() }, h('div', { class: 'card-h' }, h('h2', {}, p + (g && g.company ? ' · ' + g.company : '')), g && g.atRet ? h('span', { class: 'num strong' }, F.inr(g.atRet)) : null),
      !g ? empty('Add the joining date and monthly basic + DA.') : h('div', { class: 'kv' },
        h('span', {}, 'Joined'), h('span', {}, F.date(g.joined)), h('span', {}, 'Wages used'), h('span', {}, F.inr(g.wages) + ' a month'),
        h('span', {}, 'Years counted today'), h('span', {}, String(g.nowYears)),
        h('span', {}, 'Qualifies on'), h('span', {}, F.date(g.qualifies) + (g.monthsLeft ? ' (' + g.monthsLeft + ' months to go)' : ' (done)')),
        h('span', {}, 'If leaving today'), h('span', { id: 'grat-today-' + p.toLowerCase() }, g.today ? F.inr(g.today) : 'Nothing yet (needs ' + g.need + ' years)'),
        h('span', {}, 'At ' + g.need + ' years'), h('span', {}, F.inr(g.atQualify) + ' (today\'s wages)'),
        g.retireYear ? [h('span', {}, 'At retirement (Dec ' + g.retireYear + ')'), h('span', {}, F.inr(g.atRet) + ' · ' + g.yrsRet + ' years · wages ' + F.inr(g.wagesRet))] : null,
        g.atRet ? [h('span', {}, 'Tax-free · taxable'), h('span', {}, F.inr(g.taxFree) + ' · ' + F.inr(g.taxable))] : null));
  });
  return { title: 'Gratuity', back: 'tracker', body: [h('div', { style: { maxWidth: '680px' } },
    h('p', { class: 'hint' }, 'Gratuity = 15/26 × monthly wages (basic + DA) × years of service; more than 6 months of a year counts as a full year. It is paid after ' + ((s.settingCells && s.settingCells['Years of service to qualify'] || {}).v || 5) + ' years (1 year for a fixed-term job). Wages are at least half of total pay under the labour codes. The FIRE plan uses the figure at retirement for both of you.'),
    h('div', { class: 'btns', style: { margin: '10px 0' } }, h('button', { class: 'btn primary', id: 'gratedit', onclick: () => { state.formId = 'gratuity'; ctx.go('form'); } }, icon('edit', 16), 'Edit details')),
    ...cards)] };
}

// ---------------------------------------------------------------- targets (Settings cells), edited from Home
export function editTarget(t, kind, title, after) {
  if (!t || !t.ref) return toast('Needs tracker v29: More › App › Settings › New tracker version', 'bad');
  const inp = h('input', { class: 'field num', id: 'tgtval', inputmode: 'decimal', value: t.v === null || t.v === undefined ? '' : kind === 'pct' ? String(Math.round(t.v * 1000) / 10) : String(t.v), 'aria-label': title, placeholder: kind === 'pct' ? 'e.g. 30' : 'e.g. 250000' });
  const sh = sheet(title, h('div', { class: 'stack' }, h('label', { class: 'row-between' }, h('span', {}, kind === 'pct' ? 'Target (%)' : 'Target (₹ a month)'), inp),
    h('p', { class: 'hint' }, 'Saved on the Settings sheet; both of you see it.'),
    h('button', { class: 'btn primary', id: 'tgtsave', onclick: async () => {
      const raw = String(inp.value).replace(/[,₹%\s]/g, ''); const v = raw === '' ? '' : Number(raw);
      if (v !== '' && !(v >= 0)) return toast('Type a number', 'bad');
      await ctx.queue({ kind: 'setCells', sheet: 'Settings', cells: [{ ref: t.ref, base: t.v ?? null, value: v === '' ? '' : kind === 'pct' ? v / 100 : v, label: t.label }], title: 'Target · ' + t.label });
      ctx.scheduleSync(3000); sh(); toast('Target saved'); after ? after() : ctx.render();
    } }, 'Save')));
  setTimeout(() => inp.focus(), 60);
}
function editMix(p, tg) {
  const parts = ['Growth', 'Safety', 'Gold']; if (!tg || parts.some(k => !tg[k] || !tg[k].ref)) return toast('Needs tracker v29', 'bad');
  const ins = Object.fromEntries(parts.map(k => [k, h('input', { class: 'field num', id: 'mix-' + k.toLowerCase(), inputmode: 'decimal', value: String(Math.round((tg[k].v || 0) * 100)), 'aria-label': k + ' %', style: { maxWidth: '90px' } })]));
  const sh = sheet('Mix target · ' + p, h('div', { class: 'stack' }, ...parts.map(k => h('label', { class: 'row-between' }, h('span', {}, k), ins[k])),
    h('p', { class: 'hint' }, 'Growth = equity, international, REITs. Safety = debt, cash, deposits, EPF and PPF. Gold = gold and silver. Must add up to 100.'),
    h('button', { class: 'btn primary', id: 'mixsave', onclick: async () => {
      const v = Object.fromEntries(parts.map(k => [k, Number(String(ins[k].value).replace('%', ''))]));
      if (parts.some(k => !(v[k] >= 0)) || Math.abs(parts.reduce((t, k) => t + v[k], 0) - 100) > 0.01) return toast('The three must add up to 100', 'bad');
      await ctx.queue({ kind: 'setCells', sheet: 'Settings', cells: parts.map(k => ({ ref: tg[k].ref, base: tg[k].v ?? null, value: v[k] / 100, label: tg[k].label })), title: 'Mix target · ' + p });
      ctx.scheduleSync(3000); sh(); toast('Mix target saved'); ctx.render();
    } }, 'Save')));
}

// ---------------------------------------------------------------- Home tiles (approved 11 Nov 2026): last closed month
export function lastMonth() { return addMonths(thisMonth(), -1); }
export function closeFor(s, ym, p) {
  const rows = (s.monthClose || []).filter(r => r.month === ym && (p === 'Family' ? PEOPLE.includes(r.person) : r.person === p)); if (!rows.length) return null;
  const sum = k => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0); const cls = {}; for (const r of rows) for (const [c, v] of Object.entries(r.cls || {})) cls[c] = (cls[c] || 0) + (Number(v) || 0);
  return { income: sum('income'), saved: sum('saved'), invested: sum('invested'), nw: sum('nw'), cls };
}
const tile = (id, title, sub, big, barFrac, foot) => h('section', { class: 'card hometile', id }, h('h2', {}, title), h('span', { class: 'hint' }, sub), h('span', { class: 'big num' }, big),
  barFrac === null || barFrac === undefined ? null : bar(barFrac, barFrac >= 1 ? 'good' : ''), foot || null);
const tgtBtn = (label, onclick, id) => h('button', { class: 'tgtbtn', id, 'aria-label': 'Edit ' + label, onclick }, label, ' ', pencil());
export function homeTiles(s, p) {
  const lm = lastMonth(); const mon = F.MONTHS[Number(lm.slice(5)) - 1]; const c = closeFor(s, lm, p); const T = s.targets || {};
  const notYet = 'After ' + mon + ' is closed in Month-end';
  const sr = T.savingsRate && T.savingsRate[p]; const it = T.invest && T.invest[p];
  const rate = c && c.income ? c.saved / c.income : null;
  const t1 = tile('tile-rate', 'Savings rate', mon + ' · of income', rate === null ? '–' : F.pct(rate, 0), rate !== null && sr && sr.v ? rate / sr.v : null,
    h('div', {}, rate === null ? h('span', { class: 'hint' }, notYet) : null, tgtBtn(sr && sr.v ? 'Target ' + F.pct(sr.v, 0) : 'Set target', () => editTarget(sr, 'pct', 'Savings-rate target · ' + p), 'tgt-rate')));
  const t2 = tile('tile-inv', 'Invested', mon, c ? F.inrShort(c.invested) : '–', c && it && it.v ? c.invested / it.v : null,
    h('div', {}, c ? null : h('span', { class: 'hint' }, notYet), tgtBtn(it && it.v ? 'Target ' + F.inrShort(it.v) : 'Set target', () => editTarget(it, 'money', 'Invest target · ' + p), 'tgt-inv')));
  let t3, t4;
  if (p === 'Family') {
    const f = s.fire || {}; const coast = s.coast && typeof s.coast.year === 'number' ? s.coast.year : null;
    t3 = tile('tile-fire', 'FIRE', 'Progress', typeof f.progress === 'number' ? F.pct(f.progress, 0) : '–', typeof f.progress === 'number' ? f.progress : null,
      h('span', { class: 'hint' }, coast ? 'Coast FIRE ' + coast : s.coast && s.coast.year ? String(s.coast.year) : 'Coast FIRE after Excel recalculates'));
    const prev = closeFor(s, addMonths(lm, -1), 'Family');
    let nw = c ? c.nw : null, before = prev ? prev.nw : null;
    if (nw === null) { const m = (s.monthly || []).find(r => (r.month || '').startsWith(lm)); const m0 = (s.monthly || []).find(r => (r.month || '').startsWith(addMonths(lm, -1))); nw = m && m.nwF; before = m0 && m0.nwF; }
    if (nw === null || nw === undefined) nw = s.netWorth ? s.netWorth.family : null;
    let moved = null; if (c && prev) { const d = Object.keys(c.cls).map(k => [k, (c.cls[k] || 0) - (prev.cls[k] || 0)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]; if (d && d[1]) moved = 'Mostly ' + d[0].replace(/^Equity$/, 'Indian equity').toLowerCase().replace(/^./, x => x.toUpperCase()); }
    const delta = typeof nw === 'number' && typeof before === 'number' ? nw - before : null;
    t4 = tile('tile-nw', 'Net worth', delta !== null ? 'vs ' + F.MONTHS[Number(addMonths(lm, -1).slice(5)) - 1] : c ? mon + ' close' : 'Now', typeof nw === 'number' ? F.inrShort(nw) : '–', null,
      h('div', {}, delta !== null ? h('div', { class: 'num strong ' + (delta >= 0 ? 'gain' : 'loss') }, F.signed(delta, F.inrShort)) : null, moved ? h('span', { class: 'hint' }, moved) : null));
  } else {
    t3 = spendWatch(lm, p);
    t4 = mixTile(s, p);
  }
  return h('div', { class: 'grid tiles2', id: 'hometiles' }, t1, t2, t3, t4,
    s.provisional ? h('p', { class: 'hint span2' }, 'FIRE and net worth update after the tracker is next opened in Excel.') : null);
}
// last month's spend against the average of the 3 months before it, and the category that moved most
function spendWatch(lm, p) {
  const mine = ym => ctx.entriesView().filter(e => e.status !== 'Deleted' && e.by === p && String(e.date).startsWith(ym));
  const sum = l => l.reduce((t, e) => t + (Number(e.amount) || 0), 0);
  const last = mine(lm); const prev = [1, 2, 3].map(k => mine(addMonths(lm, -k))).filter(l => l.length);
  const avg = prev.length ? prev.reduce((t, l) => t + sum(l), 0) / prev.length : null;
  const mon = F.MONTHS[Number(lm.slice(5)) - 1];
  let top = null; if (prev.length) { const by = l => { const o = {}; for (const e of l) o[e.category] = (o[e.category] || 0) + Number(e.amount || 0); return o; };
    const a = {}; for (const l of prev) for (const [k, v] of Object.entries(by(l))) a[k] = (a[k] || 0) + v / prev.length; const n = by(last);
    top = [...new Set([...Object.keys(a), ...Object.keys(n)])].map(k => [k, (n[k] || 0) - (a[k] || 0)]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0]; }
  const d = avg ? sum(last) / avg - 1 : null;
  return tile('tile-spend', 'Spend watch', mon + ' vs 3-month average', F.inrShort(sum(last)), null,
    h('div', {}, d !== null ? h('div', { class: 'num strong ' + (d > 0.1 ? 'loss' : 'gain') }, (d >= 0 ? '+' : '') + F.pct(d, 0)) : h('span', { class: 'hint' }, 'Needs earlier months'),
      top && top[1] ? h('span', { class: 'hint' }, top[0] + ' ' + F.signed(top[1], F.inrShort)) : null));
}
function mixTile(s, p) {
  const list = W.items(withPending(s), { epf: q => epfBalance(q) }); const m = W.mixOf(list, p, goalLinks());
  const tg = s.targets && s.targets.mix && s.targets.mix[p]; const tv = k => (tg && tg[k] && typeof tg[k].v === 'number' ? tg[k].v : null);
  const rows = ['Growth', 'Safety', 'Gold'].map(k => h('div', { class: 'mixrow' }, h('span', {}, k), h('span', { class: 'num' }, m.pct ? F.pct(m.pct[k], 0) : '–', tv(k) !== null ? h('span', { class: 'faint' }, ' / ' + F.pct(tv(k), 0)) : null)));
  return h('section', { class: 'card hometile', id: 'tile-mix' }, h('h2', {}, 'Mix'), h('span', { class: 'hint' }, 'Now · vs target'), ...rows,
    tgtBtn('Target', () => editMix(p, tg), 'tgt-mix'));
}

// ---------------------------------------------------------------- Wealth: net worth by month from Month Close, with what moved it
const CLASS_NAME = c => (c === 'Equity' ? 'Indian equity' : c);
export function nwTrendCard(s, p, notes = null) {
  const months = [...new Set((s.monthClose || []).map(r => r.month))].sort(); if (!months.length) return null;
  const rows = months.map(m => ({ m, c: closeFor(s, m, p) })).filter(x => x.c);
  const pts = rows.map(x => ({ x: F.monthLabel(x.m + '-01'), y: x.c.nw }));
  const moves = rows.slice(1).map((x, i) => { const pr = rows[i].c; const d = W.CLASSES.map(k => [k, (x.c.cls[k] || 0) - (pr.cls[k] || 0)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const ln = -((x.c.loans || 0) - (pr.loans || 0)); const top = Math.abs(ln) > Math.abs(d[0][1]) ? ['Loans repaid', ln] : d[0]; return { m: x.m, nw: x.c.nw, dnw: x.c.nw - pr.nw, top }; }).reverse().slice(0, 6);
  return card('Net worth by month', null, pts.length >= 2 ? trendChart(pts, { label: 'Net worth by month' }) : h('p', { class: 'hint' }, 'The trend appears after a second month is closed.'),
    moves.length ? h('ul', { class: 'list', id: 'nwmoves' }, moves.map(x => h('li', { class: 'li' }, h('span', { class: 'lead', 'aria-hidden': 'true' }, icon(x.dnw >= 0 ? 'up' : 'down', 16)),
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, F.monthLabel(x.m + '-01', true)), h('div', { class: 'sub' }, x.top && x.top[1] ? 'Moved most: ' + CLASS_NAME(x.top[0]) + ' ' + F.signed(x.top[1], F.inrShort) : '')),
      h('div', { class: 'end num ' + (x.dnw >= 0 ? 'gain' : 'loss') }, F.signed(x.dnw, F.inrShort), h('div', { class: 'sub' }, F.inrShort(x.nw)))))) : null,
    h('p', { class: 'hint faint' }, 'From Month Close: one row per person each time a month is closed in Month-end.'), notes);
}

// Asset mix with everything in it (cash and FD / RD too), then less the emergency fund and less loans (item 12)
export function mixCard(s, p) {
  const list = W.items(withPending(s), { epf: q => epfBalance(q) }); const who = p === 'Family' ? null : p;
  const cls = W.byClass(list, who); const parts = W.CLASSES.map((c, i) => ({ name: CLASS_NAME(c), value: Math.round(cls[c] || 0), color: SERIES[i % SERIES.length] })).filter(c => c.value > 0);
  const total = parts.reduce((t, c) => t + c.value, 0);
  const keys = W.emergencyKeys(goalLinks()); const em = Math.round(list.filter(x => (!who || x.owner === who) && keys.has(x.owner + '|' + x.name)).reduce((t, x) => t + x.value, 0));
  const loans = p === 'Family' ? W.loansOf(s, 'Family') : W.loansOf(s, p);
  return card('Asset mix', null, parts.length ? h('div', { class: 'donut-wrap' }, donut(parts, { centre: F.inrShort(total), sub: 'all assets' }),
    h('ul', { class: 'list legend', id: 'mixlist' }, parts.map(c => h('li', { class: 'li' }, h('span', { class: 'sw', style: { background: c.color } }), h('div', { class: 'body' }, h('div', { class: 'ttl' }, c.name)),
      h('div', { class: 'end' }, F.pct(c.value / total, 0), h('div', { class: 'sub' }, F.inrShort(c.value))))))) : empty('No assets recorded yet.'),
    parts.length ? h('div', { class: 'kv', id: 'mixnet', style: { marginTop: '10px' } }, h('span', {}, 'All assets'), h('span', { class: 'num' }, F.inr(total)),
      h('span', {}, 'Less emergency fund (linked)'), h('span', { class: 'num' }, em ? '−' + F.inr(em) : 'none linked'),
      h('span', {}, 'Less loans'), h('span', { class: 'num loss' }, loans ? '−' + F.inr(loans) : F.inr(0)),
      h('span', { class: 'strong' }, 'Left after both'), h('span', { class: 'num strong' }, F.inr(total - em - loans))) : null,
    s.provisional ? h('p', { class: 'hint' }, 'Worked out in the app from the last sync and what you typed since.') : null);
}
