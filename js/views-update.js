// Month-end update wizard. It only queues edits to INPUT cells and rows of the app's own tables; the sync engine refuses
// formula cells and turns any cell changed elsewhere since the last sync into a choice for the user.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, seg, tag, card, empty } from './ui.js';
import * as W from './wealth.js';
import { withPending, deposits, depositForm, depositSheet, maturedToConfirm } from './views-v13.js';
import { epfBalance } from './views-v12.js';
import { incomeList } from './views-income.js';
import { isoToSerial, serialToISO } from './xlsx.js';
import { uuid } from './crypto.js';

const todaySerial = () => { const d = new Date(); return isoToSerial(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)); };
const parseNum = v => { const t = String(v ?? '').replace(/[,₹\s]/g, '').replace('−', '-'); if (t === '') return ''; if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(t)) return NaN; return Math.round(Number(t) * 100) / 100; };
const show = v => (v === null || v === undefined || v === '' ? '' : String(v));
function moneyInput(id, value, label, onChange) {
  return h('input', { class: 'field num', id, inputmode: 'decimal', value: show(value), 'aria-label': label, placeholder: '0', style: { textAlign: 'right', maxWidth: '170px' },
    oninput: e => onChange(e.target.value) });
}
// one money box per person, each with its own name and a faint tint so the two are never mixed up (phone and laptop)
const pbox = (who, input) => input ? h('label', { class: 'pbox ' + (who === 'Madhu' ? 'pm' : 'pa') }, h('span', { class: 'pbox-l' }, who), input) : null;
const fieldRow = (label, sub, input) => h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, label), sub ? h('div', { class: 'set-d' }, sub) : null), h('div', { class: 'set-c' }, input));

// pending edits from this device for a cell (so the wizard shows what you typed, not the stale value)
function pendingValue(sheet, ref) {
  let v; for (const op of ctx.V.all('outbox').filter(o => o.kind === 'setCells' && o.sheet === sheet).sort((a, b) => a.seq - b.seq)) for (const c of op.cells) if (c.ref === ref) v = c.value;
  return v;
}
const cur = (sheet, cell) => { const p = pendingValue(sheet, cell.ref); return p !== undefined ? p : cell.v; };

// ---------------------------------------------------------------- Month-end update
// Pick the month, then 8 steps. Saved & invested is the last step before closing and fills itself from the steps before
// (Aravind, 11 Nov 2026). FD / RD are kept in their own register (tracker v29): month-end asks only about new and matured
// ones. NPS is yearly (More › Cash & fixed income). EPF fills itself from the EPF sheet.
const STEPS = ['Month', 'Kite holdings', 'International prices', 'CAS statement', 'Bank balances and cash', 'New FD / RD', 'Loans', 'Saved & invested', 'Net worth and close the month'];
const S_BANK = 4, S_FD = 5, S_LOANS = 6, S_SAVED = 7;
const OA_STEP = { [S_BANK]: /savings|current account|bank|cash at home/i, [S_FD]: /fixed deposit|recurring deposit|corporate fd|post office|\bFD\b|\bRD\b|NSC|KVP|SCSS/i };
const OA_OTHER = /NPS|PPF|Sukanya|gold|silver|vehicle|money lent|rental/i; // yearly or worked out elsewhere: not in the monthly steps
const IS_EPF = /EPF|VPF/i;
// the row's Type decides; a row with no Type is placed by its name; anything that fits nowhere shows under Bank balances
const oaStep = (r, v28) => { const t = show(r.type.v) || show(r.name.v); if (IS_EPF.test(t)) return v28 ? 0 : S_FD; for (const k of [S_FD, S_BANK]) if (OA_STEP[k].test(t)) return k; return OA_OTHER.test(t) ? 0 : S_BANK; };
// rows from the blank tracker that nobody has used yet (shown only after "+ Add account")
const TEMPLATE = /^(Savings account \d+|Fixed deposit \d+|Recurring deposit|Corporate FD|Post office \(NSC \/ KVP \/ SCSS \/ MIS\))$/;
const MAX_SAVINGS = 4; // per person, as Aravind asked (10 Nov 2026); more can still be added from the topic screen
const PEOPLE = W.PEOPLE;
const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
// EPF going in for a month, from the EPF sheet (monthly contributions in force that month)
export function epfForMonth(s, ym) { return (s.epf || []).filter(e => e.kind === 'Monthly contribution' && e.from && e.from.slice(0, 7) <= ym && (!e.to || e.to.slice(0, 7) >= ym)).reduce((t, e) => t + (Number(e.amount) || 0), 0); }

// ---- figures for closing a month (tracker v29), with what was typed in this wizard laid over the last sync
function withEdits(s, E) {
  const ov = {}; for (const e of Object.values(E)) if (!e.text) ov[e.sheet + '!' + e.ref] = e.value;
  const cellOf = (sh, c) => (ov[sh + '!' + c.ref] !== undefined ? { ...c, v: ov[sh + '!' + c.ref] } : c);
  const oa = ((s.inputs && s.inputs.otherAssets) || []).map(r => ({ ...r, aravind: cellOf('Other Assets', r.aravind), madhu: cellOf('Other Assets', r.madhu) }));
  const loans = ((s.inputs && s.inputs.loans) || []).map(r => ({ ...r, aravind: cellOf('Loans', r.aravind), madhu: cellOf('Loans', r.madhu) }));
  return { ...withPending(s), inputs: { ...s.inputs, otherAssets: oa, loans } };
}
// Month Close rows as synced, with this device's rows still waiting to sync laid over them (closing two months in a row)
const MC = { income: 'Income (₹)', saved: 'Saved (₹)', invested: 'Invested (₹)', bank: 'Bank & cash (₹)', fdrd: 'FD / RD (₹)', cInd: 'Cost: Indian equity (₹)', cEqf: 'Cost: equity funds (₹)', cDebt: 'Cost: debt & arbitrage (₹)', cBonds: 'Cost: bonds (₹)', cGold: 'Cost: gold (₹)', cIntl: 'Cost: international (₹)', nw: 'Net worth (₹)', loans: 'Loans (₹)' };
function closes(s) {
  const list = (s.monthClose || []).map(r => ({ ...r }));
  for (const o of ctx.V.all('outbox').filter(o => o.table === 'tblMonthClose' && (o.kind === 'addRow' || o.kind === 'setRow')).sort((a, b) => a.seq - b.seq)) {
    const v = o.kind === 'addRow' ? o.values : o.changes; const id = o.kind === 'addRow' ? v['Close ID'] : o.id; if (!id) continue;
    let r = list.find(x => x.id === id); if (!r) { r = { id, month: id.slice(0, 7), person: id.slice(8), cls: {} }; list.push(r); }
    for (const [k, col] of Object.entries(MC)) if (v[col] !== undefined) r[k] = v[col] === '' ? null : Number(v[col]);
  }
  return list;
}
const prevClose = (s, p, ym) => closes(s).filter(r => r.person === p && r.month < ym).sort((a, b) => a.month.localeCompare(b.month)).pop() || null;
export function closeFigures(s0, ym, E = {}) {
  const s = withEdits(s0, E); const end = monthEnd(ym); const asOf = end < new Date().toISOString().slice(0, 10) ? end : undefined;
  const list = W.items(s, { epf: p => epfBalance(p) });
  const deps = (s.deposits || []).filter(d => !d.start || d.start <= end);
  const out = {};
  for (const p of PEOPLE) {
    const bank = W.bankCash(s, p), fdrd = Math.round(deps.filter(d => d.whose === p).reduce((t, d) => t + W.depositValue(d, asOf), 0));
    const c = W.costs(list, p); const cls = W.byClass(list, p);
    const loans = s.inputs.loans.length ? Math.round(s.inputs.loans.reduce((t, r) => t + (Number((p === 'Madhu' ? r.madhu : r.aravind).v) || 0), 0)) : W.loansOf(s, p);
    const nw = Math.round(Object.values(cls).reduce((t, v) => t + v, 0) - loans);
    const income = incomeList().filter(e => e.status !== 'Deleted' && e.month === ym && e.person === p).reduce((t, e) => t + (Number(e.amount) || 0), 0);
    const pc = prevClose(s, p, ym); let saved = null, invested = null, d = null;
    if (pc) {
      d = { bank: bank + fdrd - (pc.bank || 0) - (pc.fdrd || 0), ind: c.ind - (pc.cInd || 0), eqf: c.eqf - (pc.cEqf || 0), debt: c.debt - (pc.cDebt || 0), bonds: c.bonds - (pc.cBonds || 0), gold: c.gold - (pc.cGold || 0), intl: c.intl - (pc.cIntl || 0) };
      saved = Math.round(d.bank + d.debt + d.bonds); invested = Math.round(d.ind + d.eqf + d.gold + d.intl); // debt funds and bonds count as Saved only (Aravind, 11 Nov 2026)
    }
    out[p] = { bank, fdrd, cost: c, cls, loans, nw, income, prev: pc, d, saved, invested };
  }
  return out;
}

export function viewMonthly() {
  const s = ctx.snap(); const inp = s && s.inputs;
  if (!inp || !inp.monthly.length) return { title: 'Month-end update', back: 'more', body: [card(null, null, empty('Sync with the tracker first. The Month-end update needs the Income & Investment Tracker sheet.'))] };
  const Wz = state.wiz || (state.wiz = { step: 0, month: defaultMonth(inp), edits: {} });
  const row = inp.monthly.find(r => r.month === Wz.month) || inp.monthly[0];
  const ym = row.month.slice(0, 7); const mon = F.monthLabel(row.month, true);
  const L = inp.monthlyLabels || {};
  const E = Wz.edits; // key -> {sheet, ref, base, value, label}
  const setE = (k, sheet, cell, raw, label) => { const v = parseNum(raw); if (Number.isNaN(v)) return; E[k] = { sheet, ref: cell.ref, base: cell.v, value: v, label }; };
  const val = (k, sheet, cell) => (E[k] ? E[k].value : cur(sheet, cell));
  const MT = inp.monthlySheet || 'Monthly Tracker'; // renamed Income & Investment Tracker in v22
  const mField = (k, sub) => inp.monthlyFormula[k] || !row.cols[k] ? null : fieldRow(L[k] || k, sub, moneyInput('m-' + k, val('m' + k, MT, row.cols[k]), L[k] || k, v => setE('m' + k, MT, row.cols[k], v, (L[k] || k) + ' · ' + mon)));
  const fillM = (k, v) => { const c = row.cols[k]; if (c && !inp.monthlyFormula[k] && !E['m' + k] && (c.v === null || c.v === undefined || c.v === '') && v !== null && v !== undefined) setE('m' + k, MT, c, String(Math.round(v)), (L[k] || k) + ' · ' + mon); };
  const open = (view, extra) => { Object.assign(state, extra || {}); state.fromWiz = view; ctx.go(view); };
  const linkRow = (ttl, sub, view, extra, id) => h('li', { class: 'li tap', id, onclick: () => open(view, extra) }, h('span', { class: 'lead' }, icon('upload', 16)), h('div', { class: 'body' }, h('div', { class: 'ttl' }, ttl), h('div', { class: 'sub' }, sub)), icon('right', 16));
  const setT = (k, cell, text, label) => { E[k] = { sheet: 'Other Assets', ref: cell.ref, base: cell.v, value: text, label, text: true }; };
  const nm = r => (E['oaN' + r.row] ? E['oaN' + r.row].value : show(r.name.v));
  const hasVal = (k, cell) => { const v = val(k, 'Other Assets', cell); return v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v)); };
  Wz.added = Wz.added || {};
  const inUse = r => Wz.added[r.row] || hasVal('oaA' + r.row, r.aravind) || hasVal('oaM' + r.row, r.madhu) || !!show(r.where.v) || !TEMPLATE.test(show(r.name.v));
  const whoShown = r => { const a = hasVal('oaA' + r.row, r.aravind), m = hasVal('oaM' + r.row, r.madhu); if (Wz.added[r.row]) return { a: Wz.added[r.row] === 'Aravind' || a, m: Wz.added[r.row] === 'Madhu' || m }; return a || m ? { a, m } : { a: true, m: true }; };
  const stepRows = st => inp.otherAssets.filter(r => oaStep(r, s.v28) === st && !(r.aravind.f && r.madhu.f));
  const oaRows = st => h('div', {}, ...stepRows(st).filter(inUse).map(r => { const w = whoShown(r); return h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, nm(r)), h('div', { class: 'set-d' }, [E['oaB' + r.row] ? E['oaB' + r.row].value : r.where.v, r.type.v].filter(Boolean).join(' · '))),
    h('div', { class: 'set-c' }, r.aravind.f || !w.a ? null : pbox('Aravind', moneyInput('oa-a-' + r.row, val('oaA' + r.row, 'Other Assets', r.aravind), show(r.name.v) + ', Aravind', v => setE('oaA' + r.row, 'Other Assets', r.aravind, v, show(r.name.v) + ' · Aravind'))),
      r.madhu.f || !w.m ? null : pbox('Madhu', moneyInput('oa-m-' + r.row, val('oaM' + r.row, 'Other Assets', r.madhu), show(r.name.v) + ', Madhu', v => setE('oaM' + r.row, 'Other Assets', r.madhu, v, show(r.name.v) + ' · Madhu'))))); }));
  // "+ Add account": takes the next unused row of this step and names it for one person
  const addBox = st => {
    const free = stepRows(st).filter(r => !inUse(r)); const isBank = st === S_BANK;
    const count = who => stepRows(st).filter(r => inUse(r) && whoShown(r)[who === 'Aravind' ? 'a' : 'm'] && /savings/i.test(show(r.type.v) || show(r.name.v))).length;
    if (!free.length) return h('p', { class: 'hint' }, 'All rows are in use. More can be added in More › Cash & fixed income.');
    const A = Wz.addForm && Wz.addForm.st === st ? Wz.addForm : null;
    if (!A) return h('button', { class: 'btn', id: 'oaadd', style: { marginTop: '8px' }, onclick: () => { Wz.addForm = { st, who: ctx.who() || 'Aravind', name: '', bank: '' }; ctx.render(); } }, icon('plus', 16), isBank ? 'Add account' : 'Add FD / RD');
    const full = isBank && count(A.who) >= MAX_SAVINGS;
    return h('div', { class: 'card inset', id: 'oaaddform', style: { marginTop: '8px' } },
      fieldRow('Whose', null, seg(PEOPLE, A.who, v => { A.who = v; ctx.render(); }, 'Whose account')),
      fieldRow('Name', 'e.g. HDFC savings ••1234 (last 4 digits only)', h('input', { class: 'field', id: 'oaaddname', maxlength: 40, value: A.name, oninput: e => { A.name = e.target.value; } })),
      fieldRow('Bank', null, h('input', { class: 'field', id: 'oaaddbank', maxlength: 40, value: A.bank, oninput: e => { A.bank = e.target.value; } })),
      full ? h('p', { class: 'warn-text' }, A.who + ' already has ' + MAX_SAVINGS + ' savings accounts here.') : null,
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { Wz.addForm = null; ctx.render(); } }, 'Cancel'),
        h('button', { class: 'btn primary', id: 'oaaddok', disabled: full, onclick: () => {
          const n = A.name.trim(); if (!n) return toast('Give the account a name', 'bad');
          if (/\d{5,}/.test(n + A.bank)) return toast('Last 4 digits only. Never type a full account number.', 'bad');
          const r = free[0]; Wz.added[r.row] = A.who;
          setT('oaN' + r.row, r.name, n, 'Other Assets · name of row ' + r.row); if (A.bank.trim()) setT('oaB' + r.row, r.where, A.bank.trim(), n + ' · bank');
          Wz.addForm = null; ctx.render(); } }, 'Add')));
  };
  const pendingPaste = ctx.V.all('outbox').some(o => o.kind === 'kitePaste' || (o.kind === 'setCells' && /Other Holdings|Intl/i.test(o.sheet || '')));
  const step = Wz.step;
  let content;
  if (step === 0) {
    const opts = inp.monthly.filter(r => r.month <= new Date().toISOString().slice(0, 10)).slice(-14).reverse();
    content = [h('p', { class: 'hint' }, 'Pick the month you are closing. Usually last month, done in the first days of this month.'), h('div', { class: 'spacer' }),
      h('div', { class: 'chips' }, opts.map(r => { const done = ['takeA', 'takeM', 'equity', 'nwA'].some(k => r.cols[k] && r.cols[k].v !== null); return h('button', { class: 'chip' + (Wz.month === r.month ? ' on' : ''), onclick: () => { if (Wz.month !== r.month) { Wz.month = r.month; Wz.edits = {}; Wz.auto = null; Wz.sv = null; } ctx.render(); } }, F.monthLabel(r.month, true), done ? ' ✓' : ''); })),
      h('p', { class: 'hint', style: { marginTop: '10px' } }, '✓ = something is already logged for that month.')];
  } else if (step === 1) {
    content = [h('p', { class: 'hint' }, 'Paste each Kite account (India stocks, ETFs and funds in demat). Each paste replaces that account\'s rows.'), h('ul', { class: 'list' }, linkRow('Kite holdings', 'Opens the paste screen; come back here with Back', 'kite', null, 'wz-kite'))];
  } else if (step === 2) {
    content = intlStep(s, E, setE);
    content.push(h('ul', { class: 'list' }, linkRow('Paste from INDmoney', 'The Current Holdings screen fills the INDmoney prices', 'intlpaste', null, 'wz-intl'),
      linkRow('Currency rates', 'USD and the other currencies', 'form', { formId: 'currencies' }, 'wz-curr')));
  } else if (step === 3) {
    content = [h('p', { class: 'hint' }, 'Upload the monthly CDSL CAS statement (PDF). It fills mutual funds (in folios and in demat) and checks quantities.'), h('ul', { class: 'list' }, linkRow('CAS statement', 'Upload the PDF', 'cas', null, 'wz-cas'))];
  } else if (step === S_BANK) {
    content = stepRows(step).length ? [h('p', { class: 'hint' }, 'Month-end balance of each account, and cash at home. This balance is the final figure, also when an FD or RD paid into it.'), oaRows(step), addBox(step)]
      : [empty('No bank rows on the Other Assets sheet. Add them in More › Cash & fixed income.')];
  } else if (step === S_FD) {
    content = s.v29 ? fdStep(ym) : stepRows(step).length ? [h('p', { class: 'hint' }, 'Month-end value of each FD / RD. Leave unchanged if the same.'), oaRows(step), addBox(step)]
      : [empty('No FD / RD rows on the Other Assets sheet. Add them in More › Cash & fixed income.')];
  } else if (step === S_LOANS) {
    const rows = inp.loans;
    content = rows.length ? [h('p', { class: 'hint' }, 'Outstanding at month-end, from the lender\'s statement.'), ...rows.map(r => h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, show(r.name.v)), h('div', { class: 'set-d' }, show(r.lender.v))),
      h('div', { class: 'set-c' }, r.aravind.f ? null : pbox('Aravind', moneyInput('ln-a-' + r.row, val('lnA' + r.row, 'Loans', r.aravind), show(r.name.v) + ', Aravind', v => setE('lnA' + r.row, 'Loans', r.aravind, v, show(r.name.v) + ' · Aravind outstanding'))),
        r.madhu.f ? null : pbox('Madhu', moneyInput('ln-m-' + r.row, val('lnM' + r.row, 'Loans', r.madhu), show(r.name.v) + ', Madhu', v => setE('lnM' + r.row, 'Loans', r.madhu, v, show(r.name.v) + ' · Madhu outstanding'))))))] : [empty('No loans on the Loans sheet.')];
  } else if (step === S_SAVED) {
    content = s.v29 ? savedStep(s, ym, row, E, fillM, mField, pendingPaste) : savedStepOld(s, ym, row, E, mField, setE, pendingPaste);
  } else {
    const nw = s.netWorth || {}; const fig = s.v29 ? closeFigures(s, ym, E) : null;
    if (fig && !Wz.nwAuto) { Wz.nwAuto = true; fillM('nwA', fig.Aravind.nw); fillM('nwM', fig.Madhu.nw); }
    const changes = Object.values(E).filter(e => !sameV(e.value, e.base));
    content = [h('p', { class: 'hint' }, fig ? 'Month-end net worth for the history chart, worked out from the steps before (all assets less loans). The tracker\'s own figure is shown too; it updates after Excel recalculates.' : 'Month-end net worth for the history chart. The tracker\'s current figure is shown; it updates after Excel recalculates.'),
      mField('nwA', 'Tracker now: ' + F.inr(nw.aravind)), mField('nwM', 'Tracker now: ' + F.inr(nw.madhu)),
      h('div', { class: 'btns', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => { if (nw.aravind !== null && !inp.monthlyFormula.nwA) setE('mnwA', MT, row.cols.nwA, String(Math.round(nw.aravind)), (L.nwA || 'Aravind net worth') + ' · ' + mon); if (nw.madhu !== null && !inp.monthlyFormula.nwM) setE('mnwM', MT, row.cols.nwM, String(Math.round(nw.madhu)), (L.nwM || 'Madhu net worth') + ' · ' + mon); ctx.render(); } }, 'Use the tracker\'s figures')),
      h('div', { class: 'label-sm', style: { marginTop: '14px' } }, 'Changes to save'),
      changes.length ? h('ul', { class: 'list' }, changes.map(e => h('li', { class: 'li wrap' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, e.label), h('div', { class: 'sub' }, e.sheet + ' ' + e.ref)),
        h('div', { class: 'end num' }, e.value === '' ? 'blank' : e.text ? e.value : F.inr(e.value), h('div', { class: 'sub' }, 'was ' + (e.base === null || e.base === undefined || e.base === '' ? 'blank' : e.text ? String(e.base) : F.inr(e.base))))))) : empty('No changes yet.'),
      h('label', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, 'Mark balances as updated today'), h('div', { class: 'set-d' }, 'Sets "Last updated" on Other Assets and Loans so the Health Check is happy.')),
        h('input', { type: 'checkbox', id: 'markdates', checked: Wz.markDates !== false, onchange: e => { Wz.markDates = e.target.checked; } }))];
  }
  const next = () => { Wz.step = Math.min(STEPS.length - 1, step + 1); window.scrollTo(0, 0); ctx.render(); };
  const prev = () => { Wz.step = Math.max(0, step - 1); window.scrollTo(0, 0); ctx.render(); };
  const submit = async () => {
    const changes = Object.values(E).filter(e => !sameV(e.value, e.base));
    const bySheet = {};
    for (const e of changes) (bySheet[e.sheet] = bySheet[e.sheet] || []).push({ ref: e.ref, base: e.base ?? null, value: e.value, label: e.label });
    if (Wz.markDates !== false) for (const [k, sh] of [['otherAssets', 'Other Assets'], ['loans', 'Loans']]) {
      const d = inp.dates[k]; if (!d) continue; if (!changes.some(c => c.sheet === sh)) continue;
      (bySheet[sh] = bySheet[sh] || []).push({ ref: d.ref, base: d.v ?? null, value: todaySerial(), label: 'Last updated' });
    }
    let rows = false;
    if (s.v29) { await saveClose(s, ym, E, Wz.sv || {}); rows = true; }
    else if (s.v27) { await saveInvestedHist(s, ym); rows = true; }
    if (!Object.keys(bySheet).length && !rows) { toast('Nothing changed'); return; }
    for (const [sheet, cells] of Object.entries(bySheet)) await ctx.queue({ kind: 'setCells', sheet, cells, title: 'Month-end update · ' + mon });
    state.wiz = null; ctx.scheduleSync(3000); toast(mon + ' closed. It reaches the tracker with the next sync.'); ctx.go('home');
  };
  const last = step === STEPS.length - 1;
  return { title: 'Month-end update', back: 'more', body: [h('div', { style: { maxWidth: '680px' } },
    h('div', { class: 'row-between' }, h('h2', {}, STEPS[step] + (step > 0 ? ' · ' + mon : '')), h('span', { class: 'hint', style: { whiteSpace: 'nowrap' } }, step === 0 ? 'Start' : 'Step ' + step + ' of ' + (STEPS.length - 1))),
    h('div', { class: 'steps', 'aria-hidden': 'true' }, STEPS.map((x, i) => h('span', { class: i <= step ? 'on' : '' }))),
    h('section', { class: 'card' }, content),
    h('div', { class: 'sticky-save' }, step > 0 ? h('button', { class: 'btn', style: { flex: 1 }, onclick: prev }, 'Back') : null,
      !last ? h('button', { class: 'btn primary', style: { flex: 2 }, id: 'wiznext', onclick: next }, step >= 1 && step <= 3 ? 'Done, next' : 'Next') : h('button', { class: 'btn primary', style: { flex: 2 }, id: 'wizsave', onclick: submit }, 'Close the month')),
    h('p', { class: 'hint', style: { marginTop: '10px' } }, 'Income: add each entry with the + button. NPS is updated once a year and EPF set once a year, both in More › Cash & fixed income.'))] };
}

// ---- step: International prices, one block per broker (price typed in the Current price column)
function intlStep(s, E, setE) {
  const rows = ((s.forms && s.forms.intl && s.forms.intl.rows) || []).filter(r => r.cells.A && show(r.cells.A.v));
  const meta = new Map((s.intl || []).map(x => [x.row, x]));
  if (!rows.length) return [h('p', { class: 'hint' }, 'No international holdings yet. Add them in More › Equity › International holdings.')];
  const groups = {}; for (const r of rows) { const x = meta.get(r.r) || {}; const b = x.broker || s.intlPlatform || 'INDmoney'; (groups[b] = groups[b] || []).push({ r, x }); }
  const out = [h('p', { class: 'hint' }, 'Today\'s price of each stock, in its own currency, broker by broker. Leave a box as it is if the price has not changed.')];
  for (const [b, list] of Object.entries(groups)) {
    out.push(h('div', { class: 'label-sm', style: { marginTop: '12px' } }, b));
    for (const { r, x } of list) { const c = r.cells.F; if (!c || !c.in) continue; const ref = { ref: 'F' + r.r, v: c.v };
      out.push(fieldRow(show(r.cells.A.v), [x.owner, x.qty ? x.qty + ' shares' : null, x.currency || 'USD'].filter(Boolean).join(' · '),
        moneyInput('ip-' + r.r, E['ip' + r.r] ? E['ip' + r.r].value : cur('Intl Holdings', ref), show(r.cells.A.v) + ' price', v => setE('ip' + r.r, 'Intl Holdings', ref, v, show(r.cells.A.v) + ' · price (' + (x.currency || 'USD') + ')')))); }
  }
  return out;
}
// ---- step: New FD / RD (tracker v29 register)
function fdStep(ym) {
  const list = deposits(); const end = monthEnd(ym);
  const fresh = list.filter(d => d.start && d.start.slice(0, 7) === ym); const due = maturedToConfirm(list, end);
  const li = d => h('li', { class: 'li tap', 'data-dep': d.id, onclick: () => depositSheet(d, ctx.render) }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, d.name, d.pending ? [' ', tag('Waiting to sync', 'prov')] : null),
    h('div', { class: 'sub' }, [d.whose, d.kind, d.maturity ? 'matures ' + F.date(d.maturity) : null].filter(Boolean).join(' · '))), h('div', { class: 'end num' }, F.inr(d.amount)));
  return [h('p', { class: 'hint' }, 'Only FDs and RDs opened this month. Existing ones carry forward by themselves, and an RD\'s instalment counts each month until it matures.'),
    h('div', { class: 'label-sm' }, 'Opened in ' + F.monthLabel(ym + '-01', true)), fresh.length ? h('ul', { class: 'list', id: 'fdnew' }, fresh.map(li)) : h('p', { class: 'hint' }, 'None yet.'),
    h('button', { class: 'btn', id: 'fdadd', style: { marginTop: '6px' }, onclick: () => depositForm({ start: ym + '-01' }) }, icon('plus', 16), 'Add FD / RD'),
    due.length ? [h('div', { class: 'label-sm', style: { marginTop: '14px' } }, 'Matured: confirm'), h('p', { class: 'hint' }, 'Tap each one to confirm the amount received (only a check; the savings balance stays the final figure).'), h('ul', { class: 'list', id: 'fddue' }, due.map(li))] : null];
}
// ---- step: Saved & invested (tracker v29): filled from the steps before, per person; each box can be changed
function savedStep(s, ym, row, E, fillM, mField, pendingPaste) {
  const Wz = state.wiz; const fig = closeFigures(s, ym, E); Wz.sv = Wz.sv || {};
  for (const p of PEOPLE) if (!Wz.sv[p]) Wz.sv[p] = { saved: fig[p].saved, invested: fig[p].invested, income: fig[p].income };
  if (!Wz.auto && PEOPLE.every(p => fig[p].d)) { Wz.auto = true; const sumD = k => PEOPLE.reduce((t, p) => t + fig[p].d[k], 0);
    fillM('bank', sumD('bank')); fillM('equity', sumD('ind') + sumD('eqf')); fillM('intl', sumD('intl')); fillM('gold', sumD('gold')); fillM('debt', sumD('debt') + sumD('bonds')); }
  const box = (p, k, label) => fieldRow(label, null, moneyInput('sv-' + k + '-' + p.toLowerCase(), Wz.sv[p][k], label + ', ' + p, v => { const n = parseNum(v); if (!Number.isNaN(n)) Wz.sv[p][k] = n === '' ? null : n; }));
  const first = PEOPLE.filter(p => !fig[p].d);
  const blocks = PEOPLE.map(p => { const f = fig[p];
    return h('div', { class: 'card inset', id: 'sv-' + p.toLowerCase(), style: { marginTop: '8px' } }, h('div', { class: 'row-between' }, h('strong', {}, p), h('span', { class: 'hint' }, 'Income ' + F.inr(f.income))),
      f.d ? h('p', { class: 'hint' }, 'Bank, cash and FD / RD ' + F.signed(f.d.bank, F.inr) + ' · debt funds and bonds ' + F.signed(f.d.debt + f.d.bonds, F.inr) + ' · equity ' + F.signed(f.d.ind + f.d.eqf, F.inr) + ' · international ' + F.signed(f.d.intl, F.inr) + ' · gold ' + F.signed(f.d.gold, F.inr) + ' (change in buy cost since ' + F.monthLabel(f.prev.month + '-01', true) + ')')
        : h('p', { class: 'hint' }, 'First month closed here: today\'s balances and buy costs become the starting point. Type what was saved and invested if you know it.'),
      box(p, 'saved', 'Saved'), box(p, 'invested', 'Invested')); });
  return [h('p', { class: 'hint' }, 'Saved = change in bank balances, cash at home and FD / RD, plus debt and arbitrage funds and bonds bought (not EPF or PPF). Invested = change in buy cost of equity (Kite and equity funds), international and gold. Debt funds count only in Saved, so Saved + Invested is everything put aside. Sales show as minus.'),
    pendingPaste ? h('p', { class: 'warn-text' }, 'A holdings paste is still waiting to sync. Sync first so these figures include it.') : null,
    first.length === PEOPLE.length ? null : h('p', { class: 'hint', id: 'autoinv' }, 'Filled for you. Change any box if needed.'),
    ...blocks,
    h('div', { class: 'label-sm', style: { marginTop: '14px' } }, 'Income & Investment Tracker · filled for you · check'), ...['bank', 'equity', 'intl', 'gold', 'debt'].map(k => mField(k)), epfLine(s, ym, row),
    h('div', { class: 'label-sm', style: { marginTop: '14px' } }, 'Type if any'), mField('nps'), mField('reits'), ...['spare1', 'spare2'].filter(k => spareUsed(row, k)).map(k => mField(k))];
}
// EPF / VPF going in this month comes from the EPF sheet (shown, not typed); not counted as saved
function epfLine(s, ym, row) { const inp = s.inputs; const L = inp.monthlyLabels || {}; return inp.monthlyFormula.epf && row.cols.epf ? fieldRow(L.epf || 'EPF / VPF', 'From the EPF sheet (More › Cash & fixed income › EPF)', h('span', { class: 'num strong', id: 'm-epf-auto' }, F.inr(epfForMonth(s, ym)))) : null; }
const spareUsed = (row, k) => { const L = (ctx.snap().inputs.monthlyLabels) || {}; const c = row.cols[k]; return (L[k] && !/^Spare \d/i.test(L[k])) || (c && c.v !== null && c.v !== undefined && c.v !== ''); };
// Month Close rows: one per person, found again by "<month> <person>" when a month is closed a second time
async function saveClose(s, ym, E, sv) {
  const fig = closeFigures(s, ym, E); const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  for (const p of PEOPLE) { const f = fig[p]; const id = ym + ' ' + p; const x = sv[p] || {};
    const nwCell = E[p === 'Aravind' ? 'mnwA' : 'mnwM'];
    const vals = { 'Close ID': id, Month: isoToSerial(ym + '-01'), Person: p, 'Income (₹)': f.income, 'Saved (₹)': x.saved ?? f.saved ?? '', 'Invested (₹)': x.invested ?? f.invested ?? '', 'Bank & cash (₹)': f.bank, 'FD / RD (₹)': f.fdrd,
      'Cost: Indian equity (₹)': f.cost.ind, 'Cost: equity funds (₹)': f.cost.eqf, 'Cost: debt & arbitrage (₹)': f.cost.debt, 'Cost: bonds (₹)': f.cost.bonds, 'Cost: gold (₹)': f.cost.gold, 'Cost: international (₹)': f.cost.intl,
      'Net worth (₹)': nwCell && nwCell.value !== '' ? nwCell.value : f.nw, 'Loans (₹)': f.loans, 'Saved on': now, 'Saved by': ctx.who() || '' };
    for (const c of W.CLASSES) vals[c + ' (₹)'] = Math.round(f.cls[c] || 0);
    for (const o of ctx.V.all('outbox').filter(o => o.kind === 'addRow' && o.table === 'tblMonthClose' && o.values['Close ID'] === id)) await ctx.V.remove('outbox', o.opId);
    const had = (s.monthClose || []).some(r => r.id === id);
    if (had) { const changes = { ...vals }; delete changes['Close ID']; await ctx.queue({ kind: 'setRow', table: 'tblMonthClose', idCol: 'Close ID', id, changes }); }
    else await ctx.queue({ kind: 'addRow', table: 'tblMonthClose', idCol: 'Close ID', values: vals, what: 'month close', summary: 'Month close · ' + p + ' · ' + F.monthLabel(ym + '-01', true) });
  }
}

// ---- before tracker v29: invested from the Invested History snapshot (family totals), as in 0.10.0
const fundIsDebt = t => /debt|arbitrage|liquid|gilt|money market|overnight|bond/i.test(t || '');
export function investedNow(s) {
  const o = { ind: 0, eqf: 0, debt: 0, intl: 0 };
  for (const x of s.holdings || []) { const t = x.type || ''; const v = Number(x.invested) || 0; if (/\bMF\b|fund/i.test(t)) o[fundIsDebt(t) ? 'debt' : 'eqf'] += v; else if (!/gold|SGB|bond/i.test(t)) o.ind += v; }
  for (const x of s.otherHoldings || []) { if (x.linked) continue; const t = x.type || ''; const v = Number(x.invested) || 0; if (!/\bMF\b|fund/i.test(t) || /gold/i.test(t)) continue; o[fundIsDebt(t) ? 'debt' : 'eqf'] += v; }
  for (const x of s.intl || []) o.intl += Number(x.invested) || 0;
  for (const k of Object.keys(o)) o[k] = Math.round(o[k]);
  return o;
}
export function investedDelta(s, ym) {
  const now = investedNow(s); const prev = (s.investedHist || []).filter(r => r.month < ym).sort((a, b) => a.month.localeCompare(b.month)).pop();
  if (!prev) return { now, prev: null };
  const d = {}; for (const k of Object.keys(now)) d[k] = now[k] - (prev[k] || 0);
  return { now, prev, d, equity: d.ind + d.eqf, intl: d.intl, debt: d.debt };
}
function savedStepOld(s, ym, row, E, mField, setE, pendingPaste) {
  const Wz = state.wiz; const inp = s.inputs; const L = inp.monthlyLabels || {}; const MT = inp.monthlySheet || 'Monthly Tracker'; const dl = investedDelta(s, ym);
  if (dl.d && !Wz.auto) { Wz.auto = true; for (const [k, v] of [['equity', dl.equity], ['intl', dl.intl], ['debt', dl.debt]]) { const c = row.cols[k]; if (c && !inp.monthlyFormula[k] && !E['m' + k] && (c.v === null || c.v === undefined || c.v === '')) setE('m' + k, MT, c, String(v), (L[k] || k) + ' · ' + F.monthLabel(row.month, true)); } }
  const note = !s.v27 ? h('p', { class: 'warn-text' }, 'Your tracker is older than v27, so "invested this month" can\'t be worked out. Type the figures yourself.')
    : dl.d ? h('div', { class: 'hint', id: 'autoinv' }, 'Worked out from the invested amount (buy cost) since ' + F.monthLabel(dl.prev.month, true) + '. Sales show as minus. Change any box if needed.')
    : h('p', { class: 'hint', id: 'autoinv' }, 'First month: today\'s invested amounts are saved when you close the month, and from next month these fill in by themselves.');
  const epfRow = epfLine(s, ym, row) || mField('epf');
  return [h('p', { class: 'hint' }, 'What went into each bucket this month (₹).'), note, pendingPaste ? h('p', { class: 'warn-text' }, 'A holdings paste is still waiting to sync. Sync first so these figures include it.') : null,
    h('div', { class: 'label-sm', style: { marginTop: '10px' } }, 'Filled for you · check'), ...['equity', 'intl', 'debt'].map(k => mField(k, 'From Kite, CAS and Intl Holdings')), epfRow,
    h('div', { class: 'label-sm', style: { marginTop: '14px' } }, 'Type if any'), mField('bank'), mField('gold'), mField('reits'), ...['spare1', 'spare2'].filter(k => spareUsed(row, k)).map(k => mField(k))];
}
async function saveInvestedHist(s, ym) {
  const now = investedNow(s); const vals = { 'Indian equity (₹)': now.ind, 'Equity funds (₹)': now.eqf, 'Debt & arbitrage funds (₹)': now.debt, 'International (₹)': now.intl, 'Saved on': new Date().toISOString().slice(0, 16).replace('T', ' '), 'Saved by': ctx.who() || '' };
  const had = (s.investedHist || []).find(r => r.month === ym);
  if (had) await ctx.queue({ kind: 'setRow', table: 'tblInvestedHist', idCol: 'Month', id: ym, changes: vals, base: { 'Indian equity (₹)': had.ind, 'Equity funds (₹)': had.eqf, 'Debt & arbitrage funds (₹)': had.debt, 'International (₹)': had.intl } });
  else await ctx.queue({ kind: 'addRow', table: 'tblInvestedHist', idCol: 'Month', values: Object.assign({ Month: ym }, vals), what: 'invested', summary: 'Invested amounts · ' + F.monthLabel(ym, true) });
}
const sameV = (a, b) => { const ea = a === null || a === undefined || a === '', eb = b === null || b === undefined || b === ''; if (ea || eb) return ea && eb; if (typeof a === 'string' && Number.isNaN(Number(a))) return a === String(b); return Number(a) === Number(b); };
function defaultMonth(inp) { const d = new Date(); const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1); const key = lm.getFullYear() + '-' + String(lm.getMonth() + 1).padStart(2, '0') + '-01'; const r = inp.monthly.find(x => x.month === key); return (r || inp.monthly[inp.monthly.length - 1]).month; }

// ---------------------------------------------------------------- conflict card for cell edits
export function conflictCard(c) {
  const op = c.op; const V = ctx.V;
  const showV = (v, label) => (v === null || v === undefined || v === '' ? 'blank' : typeof v === 'number' ? (/updated/i.test(label || '') ? F.date(serialToISO(v)) : F.inr(v)) : String(v));
  const why = c.reason === 'full' ? 'The Kite holdings did not fit: ' + c.remote + '. Ask Claude for a tracker with more rows.' : c.reason === 'formula' ? 'The tracker now has a formula in a cell this change wanted to write. The app never overwrites formulas, so this change cannot be applied.' : 'These cells were changed in the tracker after this device last synced.';
  return h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', {}, op.title || op.sheet)), h('p', { class: 'hint' }, why),
    h('div', { class: 'tablewrap' }, h('table', { class: 'cmp' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Your change (' + op.by + ')'), h('th', {}, 'In the tracker now'))),
      h('tbody', {}, (c.cells || []).map(x => h('tr', {}, h('th', {}, x.label || x.ref), h('td', {}, showV(x.value, x.label)), h('td', {}, x.reason === 'formula' ? 'formula' : showV(x.remote, x.label))))))),
    h('div', { class: 'btns', style: { marginTop: '12px' } },
      c.reason === 'changed' ? h('button', { class: 'btn primary', onclick: async () => { const rem = new Map((c.cells || []).map(x => [x.ref, x.remote])); op.cells = op.cells.map(x => (rem.has(x.ref) ? { ...x, base: rem.get(x.ref) } : x)); op.opId = uuid(); await V.remove('conflict', c.op.opId); await ctx.queue(op); toast('Your change will be applied'); ctx.render(); } }, 'Keep mine') : null,
      h('button', { class: 'btn', onclick: async () => { await V.remove('conflict', c.op.opId); toast('Kept the tracker\'s version'); ctx.render(); } }, c.reason === 'changed' ? 'Keep the tracker\'s' : 'Discard my change')));
}
