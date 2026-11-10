// Month-end update wizard and holdings paste. Both only queue edits to INPUT cells; the sync engine refuses formula cells
// and turns any cell changed elsewhere since the last sync into a choice for the user.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, seg, tag, card, empty } from './ui.js';
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
// Pick the month, then 8 steps one by one. NPS is yearly (More › Cash & fixed income). EPF fills itself from the EPF sheet
// (tracker v28; on older trackers its rows show with FD / RD).
const STEPS = ['Month', 'Kite holdings', 'International prices and currency rates', 'CAS statement', 'Saved & invested', 'Bank balances', 'FD / RD', 'Loans', 'Net worth and close the month'];
const S_BANK = 5, S_FD = 6, S_LOANS = 7;
const OA_STEP = { 5: /savings|current account|bank/i, 6: /fixed deposit|recurring deposit|corporate fd|post office|\bFD\b|\bRD\b|NSC|KVP|SCSS/i };
const OA_OTHER = /NPS|PPF|Sukanya|gold|silver|vehicle|money lent/i; // yearly or worked out elsewhere: not in the monthly steps
const IS_EPF = /EPF|VPF/i;
// the row's Type decides; a row with no Type is placed by its name; anything that fits nowhere shows under Bank balances
const oaStep = (r, v28) => { const t = show(r.type.v) || show(r.name.v); if (IS_EPF.test(t)) return v28 ? 0 : 6; for (const k of [6, 5]) if (OA_STEP[k].test(t)) return k; return OA_OTHER.test(t) ? 0 : 5; };
// rows from the blank tracker that nobody has used yet (shown only after "+ Add account")
const TEMPLATE = /^(Savings account \d+|Fixed deposit \d+|Recurring deposit|Corporate FD|Post office \(NSC \/ KVP \/ SCSS \/ MIS\))$/;
const MAX_SAVINGS = 4; // per person, as Aravind asked (10 Nov 2026); more can still be added from the topic screen
// EPF going in for a month, from the EPF sheet (monthly contributions in force that month)
export function epfForMonth(s, ym) { return (s.epf || []).filter(e => e.kind === 'Monthly contribution' && e.from && e.from.slice(0, 7) <= ym && (!e.to || e.to.slice(0, 7) >= ym)).reduce((t, e) => t + (Number(e.amount) || 0), 0); }
const fundIsDebt = t => /debt|arbitrage|liquid|gilt|money market|overnight|bond/i.test(t || '');
// invested amount (buy cost) per bucket from the holdings as last synced: Kite = everything in demat, CAS = folios outside demat
export function investedNow(s) {
  const o = { ind: 0, eqf: 0, debt: 0, intl: 0 };
  for (const x of s.holdings || []) { const t = x.type || ''; const v = Number(x.invested) || 0; if (/\bMF\b|fund/i.test(t)) o[fundIsDebt(t) ? 'debt' : 'eqf'] += v; else if (!/gold|SGB|bond/i.test(t)) o.ind += v; }
  for (const x of s.otherHoldings || []) { if (x.linked) continue; const t = x.type || ''; const v = Number(x.invested) || 0; if (!/\bMF\b|fund/i.test(t) || /gold/i.test(t)) continue; o[fundIsDebt(t) ? 'debt' : 'eqf'] += v; }
  for (const x of s.intl || []) o.intl += Number(x.invested) || 0;
  for (const k of Object.keys(o)) o[k] = Math.round(o[k]);
  return o;
}
// last month saved before this one (the incoming snapshot replaces the old one; invested = incoming minus previous)
export function investedDelta(s, ym) {
  const now = investedNow(s); const prev = (s.investedHist || []).filter(r => r.month < ym).sort((a, b) => a.month.localeCompare(b.month)).pop();
  if (!prev) return { now, prev: null };
  const d = {}; for (const k of Object.keys(now)) d[k] = now[k] - (prev[k] || 0);
  return { now, prev, d, equity: d.ind + d.eqf, intl: d.intl, debt: d.debt };
}
export function viewMonthly() {
  const s = ctx.snap(); const inp = s && s.inputs;
  if (!inp || !inp.monthly.length) return { title: 'Month-end update', back: 'more', body: [card(null, null, empty('Sync with the tracker first. The Month-end update needs the Income & Investment Tracker sheet.'))] };
  const W = state.wiz || (state.wiz = { step: 0, month: defaultMonth(inp), edits: {} });
  const row = inp.monthly.find(r => r.month === W.month) || inp.monthly[0];
  const ym = row.month.slice(0, 7);
  const L = inp.monthlyLabels || {};
  const E = W.edits; // key -> {sheet, ref, base, value, label}
  const setE = (k, sheet, cell, raw, label) => { const v = parseNum(raw); if (Number.isNaN(v)) return; E[k] = { sheet, ref: cell.ref, base: cell.v, value: v, label }; };
  const val = (k, sheet, cell) => (E[k] ? E[k].value : cur(sheet, cell));
  const MT = inp.monthlySheet || 'Monthly Tracker'; // renamed Income & Investment Tracker in v22
  const mField = (k, sub) => inp.monthlyFormula[k] || !row.cols[k] ? null : fieldRow(L[k] || k, sub, moneyInput('m-' + k, val('m' + k, MT, row.cols[k]), L[k] || k, v => setE('m' + k, MT, row.cols[k], v, (L[k] || k) + ' · ' + F.monthLabel(row.month, true))));
  const open = (view, extra) => { Object.assign(state, extra || {}); state.fromWiz = view; ctx.go(view); };
  const linkRow = (ttl, sub, view, extra, id) => h('li', { class: 'li tap', id, onclick: () => open(view, extra) }, h('span', { class: 'lead' }, icon('upload', 16)), h('div', { class: 'body' }, h('div', { class: 'ttl' }, ttl), h('div', { class: 'sub' }, sub)), icon('right', 16));
  const setT = (k, cell, text, label) => { E[k] = { sheet: 'Other Assets', ref: cell.ref, base: cell.v, value: text, label, text: true }; };
  const nm = r => (E['oaN' + r.row] ? E['oaN' + r.row].value : show(r.name.v));
  const hasVal = (k, cell) => { const v = val(k, 'Other Assets', cell); return v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v)); };
  W.added = W.added || {};
  const inUse = r => W.added[r.row] || hasVal('oaA' + r.row, r.aravind) || hasVal('oaM' + r.row, r.madhu) || !!show(r.where.v) || !TEMPLATE.test(show(r.name.v));
  const whoShown = r => { const a = hasVal('oaA' + r.row, r.aravind), m = hasVal('oaM' + r.row, r.madhu); if (W.added[r.row]) return { a: W.added[r.row] === 'Aravind' || a, m: W.added[r.row] === 'Madhu' || m }; return a || m ? { a, m } : { a: true, m: true }; };
  const stepRows = st => inp.otherAssets.filter(r => oaStep(r, s.v28) === st && !(r.aravind.f && r.madhu.f));
  const oaRows = st => h('div', {}, ...stepRows(st).filter(inUse).map(r => { const w = whoShown(r); return h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, nm(r)), h('div', { class: 'set-d' }, [E['oaB' + r.row] ? E['oaB' + r.row].value : r.where.v, r.type.v].filter(Boolean).join(' · '))),
    h('div', { class: 'set-c' }, r.aravind.f || !w.a ? null : pbox('Aravind', moneyInput('oa-a-' + r.row, val('oaA' + r.row, 'Other Assets', r.aravind), show(r.name.v) + ', Aravind', v => setE('oaA' + r.row, 'Other Assets', r.aravind, v, show(r.name.v) + ' · Aravind'))),
      r.madhu.f || !w.m ? null : pbox('Madhu', moneyInput('oa-m-' + r.row, val('oaM' + r.row, 'Other Assets', r.madhu), show(r.name.v) + ', Madhu', v => setE('oaM' + r.row, 'Other Assets', r.madhu, v, show(r.name.v) + ' · Madhu'))))); }));
  // "+ Add account": takes the next unused row of this step and names it for one person
  const addBox = st => {
    const free = stepRows(st).filter(r => !inUse(r)); const isBank = st === S_BANK;
    const count = who => stepRows(st).filter(r => inUse(r) && whoShown(r)[who === 'Aravind' ? 'a' : 'm'] && /savings/i.test(show(r.type.v) || show(r.name.v))).length;
    if (!free.length) return h('p', { class: 'hint' }, 'All rows are in use. More can be added in More › Cash & fixed income.');
    const A = W.addForm && W.addForm.st === st ? W.addForm : null;
    if (!A) return h('button', { class: 'btn', id: 'oaadd', style: { marginTop: '8px' }, onclick: () => { W.addForm = { st, who: ctx.who() || 'Aravind', name: '', bank: '' }; ctx.render(); } }, icon('plus', 16), isBank ? 'Add account' : 'Add FD / RD');
    const full = isBank && count(A.who) >= MAX_SAVINGS;
    return h('div', { class: 'card inset', id: 'oaaddform', style: { marginTop: '8px' } },
      fieldRow('Whose', null, seg(['Aravind', 'Madhu'], A.who, v => { A.who = v; ctx.render(); }, 'Whose account')),
      fieldRow('Name', 'e.g. HDFC savings ••1234 (last 4 digits only)', h('input', { class: 'field', id: 'oaaddname', maxlength: 40, value: A.name, oninput: e => { A.name = e.target.value; } })),
      fieldRow('Bank', null, h('input', { class: 'field', id: 'oaaddbank', maxlength: 40, value: A.bank, oninput: e => { A.bank = e.target.value; } })),
      full ? h('p', { class: 'warn-text' }, A.who + ' already has ' + MAX_SAVINGS + ' savings accounts here.') : null,
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { W.addForm = null; ctx.render(); } }, 'Cancel'),
        h('button', { class: 'btn primary', id: 'oaaddok', disabled: full, onclick: () => {
          const n = A.name.trim(); if (!n) return toast('Give the account a name', 'bad');
          if (/\d{5,}/.test(n + A.bank)) return toast('Last 4 digits only. Never type a full account number.', 'bad');
          const r = free[0]; W.added[r.row] = A.who;
          setT('oaN' + r.row, r.name, n, 'Other Assets · name of row ' + r.row); if (A.bank.trim()) setT('oaB' + r.row, r.where, A.bank.trim(), n + ' · bank');
          W.addForm = null; ctx.render(); } }, 'Add')));
  };
  const pendingPaste = ctx.V.all('outbox').some(o => o.kind === 'kitePaste' || (o.kind === 'setCells' && /Other Holdings|Intl/i.test(o.sheet || '')));
  const step = W.step;
  let content;
  if (step === 0) {
    const opts = inp.monthly.filter(r => r.month <= new Date().toISOString().slice(0, 10)).slice(-14).reverse();
    content = [h('p', { class: 'hint' }, 'Pick the month you are closing. Usually last month, done in the first days of this month.'), h('div', { class: 'spacer' }),
      h('div', { class: 'chips' }, opts.map(r => { const done = ['takeA', 'takeM', 'equity', 'nwA'].some(k => r.cols[k] && r.cols[k].v !== null); return h('button', { class: 'chip' + (W.month === r.month ? ' on' : ''), onclick: () => { if (W.month !== r.month) { W.month = r.month; W.edits = {}; W.auto = null; } ctx.render(); } }, F.monthLabel(r.month, true), done ? ' ✓' : ''); })),
      h('p', { class: 'hint', style: { marginTop: '10px' } }, '✓ = something is already logged for that month.')];
  } else if (step === 1) {
    content = [h('p', { class: 'hint' }, 'Paste each Kite account (India stocks, ETFs and funds in demat). Each paste replaces that account\'s rows.'), h('ul', { class: 'list' }, linkRow('Kite holdings', 'Opens the paste screen; come back here with Back', 'kite', null, 'wz-kite'))];
  } else if (step === 2) {
    content = [h('p', { class: 'hint' }, 'US stock prices from INDmoney, and today\'s rupee rates for USD and the other currencies.'), h('ul', { class: 'list' },
      linkRow('International prices', 'Paste the INDmoney Current Holdings screen', 'intlpaste', null, 'wz-intl'),
      linkRow('Currency rates', 'USD and the other currencies', 'form', { formId: 'currencies' }, 'wz-curr'))];
  } else if (step === 3) {
    content = [h('p', { class: 'hint' }, 'Upload the monthly CDSL CAS statement (PDF). It fills mutual fund folios outside demat and checks quantities.'), h('ul', { class: 'list' }, linkRow('CAS statement', 'Upload the PDF', 'cas', null, 'wz-cas'))];
  } else if (step === 4) {
    const dl = investedDelta(s, ym);
    // first visit to this step: fill equity, international and debt from the change in invested amount (only empty boxes)
    if (dl.d && !W.auto) { W.auto = true; for (const [k, v] of [['equity', dl.equity], ['intl', dl.intl], ['debt', dl.debt]]) { const c = row.cols[k]; if (c && !inp.monthlyFormula[k] && !E['m' + k] && (c.v === null || c.v === undefined || c.v === '')) setE('m' + k, MT, c, String(v), (L[k] || k) + ' · ' + F.monthLabel(row.month, true)); } }
    const note = !s.v27 ? h('p', { class: 'warn-text' }, 'Your tracker is older than v27, so "invested this month" can\'t be worked out. Type the figures yourself.')
      : dl.d ? h('div', { class: 'hint', id: 'autoinv' }, 'Worked out from the invested amount (buy cost) since ' + F.monthLabel(dl.prev.month, true) + ': Indian equity ' + F.signed(dl.d.ind, F.inr) + ', equity funds ' + F.signed(dl.d.eqf, F.inr) + ', international ' + F.signed(dl.d.intl, F.inr) + ', debt & arbitrage funds ' + F.signed(dl.d.debt, F.inr) + '. Sales show as minus. Change any box if needed.')
      : h('p', { class: 'hint', id: 'autoinv' }, 'First month: today\'s invested amounts are saved when you close the month, and from next month equity, international and debt fill in by themselves.');
    const spareUsed = k => { const c = row.cols[k]; return (L[k] && !/^Spare \d/i.test(L[k])) || (c && c.v !== null && c.v !== undefined && c.v !== ''); };
    const epfRow = inp.monthlyFormula.epf && row.cols.epf ? fieldRow(L.epf || 'EPF / VPF', 'From the EPF sheet (More › Cash & fixed income › EPF)', h('span', { class: 'num strong', id: 'm-epf-auto' }, F.inr(epfForMonth(s, ym)))) : mField('epf');
    content = [h('p', { class: 'hint' }, 'What went into each bucket this month (₹).'), note, pendingPaste ? h('p', { class: 'warn-text' }, 'A holdings paste is still waiting to sync. Sync first so these figures include it.') : null,
      h('div', { class: 'label-sm', style: { marginTop: '10px' } }, 'Filled for you · check'), ...['equity', 'intl', 'debt'].map(k => mField(k, 'From Kite, CAS and Intl Holdings')), epfRow,
      h('div', { class: 'label-sm', style: { marginTop: '14px' } }, 'Type if any'), mField('bank'), mField('gold'), mField('reits'), ...['spare1', 'spare2'].filter(spareUsed).map(k => mField(k))];
  } else if (step === S_BANK || step === S_FD) {
    const any = stepRows(step).length;
    content = any ? [h('p', { class: 'hint' }, step === S_BANK ? 'Month-end balance of each account. Leave unchanged if the same.' : 'Month-end value of each FD / RD. Leave unchanged if the same.'), oaRows(step), addBox(step)]
      : [empty('No ' + STEPS[step] + ' rows on the Other Assets sheet. Add them in More › Cash & fixed income.')];
  } else if (step === S_LOANS) {
    const rows = inp.loans;
    content = rows.length ? [h('p', { class: 'hint' }, 'Outstanding at month-end, from the lender\'s statement.'), ...rows.map(r => h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, show(r.name.v)), h('div', { class: 'set-d' }, show(r.lender.v))),
      h('div', { class: 'set-c' }, r.aravind.f ? null : pbox('Aravind', moneyInput('ln-a-' + r.row, val('lnA' + r.row, 'Loans', r.aravind), show(r.name.v) + ', Aravind', v => setE('lnA' + r.row, 'Loans', r.aravind, v, show(r.name.v) + ' · Aravind outstanding'))),
        r.madhu.f ? null : pbox('Madhu', moneyInput('ln-m-' + r.row, val('lnM' + r.row, 'Loans', r.madhu), show(r.name.v) + ', Madhu', v => setE('lnM' + r.row, 'Loans', r.madhu, v, show(r.name.v) + ' · Madhu outstanding'))))))] : [empty('No loans on the Loans sheet.')];
  } else {
    const nw = s.netWorth || {};
    const changes = Object.values(E).filter(e => !sameV(e.value, e.base));
    content = [h('p', { class: 'hint' }, 'Month-end net worth for the history chart. The tracker\'s current figure is shown; it updates after Excel recalculates.'),
      mField('nwA', 'Tracker now: ' + F.inr(nw.aravind)), mField('nwM', 'Tracker now: ' + F.inr(nw.madhu)),
      h('div', { class: 'btns', style: { marginTop: '8px' } }, h('button', { class: 'btn', onclick: () => { if (nw.aravind !== null && !inp.monthlyFormula.nwA) setE('mnwA', MT, row.cols.nwA, String(Math.round(nw.aravind)), (L.nwA || 'Aravind net worth') + ' · ' + F.monthLabel(row.month, true)); if (nw.madhu !== null && !inp.monthlyFormula.nwM) setE('mnwM', MT, row.cols.nwM, String(Math.round(nw.madhu)), (L.nwM || 'Madhu net worth') + ' · ' + F.monthLabel(row.month, true)); ctx.render(); } }, 'Use the tracker\'s figures')),
      h('div', { class: 'label-sm', style: { marginTop: '14px' } }, 'Changes to save'),
      changes.length ? h('ul', { class: 'list' }, changes.map(e => h('li', { class: 'li wrap' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, e.label), h('div', { class: 'sub' }, e.sheet + ' ' + e.ref)),
        h('div', { class: 'end num' }, e.value === '' ? 'blank' : e.text ? e.value : F.inr(e.value), h('div', { class: 'sub' }, 'was ' + (e.base === null || e.base === undefined || e.base === '' ? 'blank' : e.text ? String(e.base) : F.inr(e.base))))))) : empty('No changes yet.'),
      h('label', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, 'Mark balances as updated today'), h('div', { class: 'set-d' }, 'Sets "Last updated" on Other Assets and Loans so the Health Check is happy.')),
        h('input', { type: 'checkbox', id: 'markdates', checked: W.markDates !== false, onchange: e => { W.markDates = e.target.checked; } }))];
  }
  const next = () => { W.step = Math.min(STEPS.length - 1, step + 1); window.scrollTo(0, 0); ctx.render(); };
  const prev = () => { W.step = Math.max(0, step - 1); window.scrollTo(0, 0); ctx.render(); };
  const submit = async () => {
    const changes = Object.values(E).filter(e => !sameV(e.value, e.base));
    const bySheet = {};
    for (const e of changes) (bySheet[e.sheet] = bySheet[e.sheet] || []).push({ ref: e.ref, base: e.base ?? null, value: e.value, label: e.label });
    if (W.markDates !== false) for (const [k, sh] of [['otherAssets', 'Other Assets'], ['loans', 'Loans']]) {
      const d = inp.dates[k]; if (!d) continue; if (!changes.some(c => c.sheet === sh)) continue;
      (bySheet[sh] = bySheet[sh] || []).push({ ref: d.ref, base: d.v ?? null, value: todaySerial(), label: 'Last updated' });
    }
    let snap = false;
    if (s.v27) { // save this month's invested amounts so next month's "invested this month" works
      const now = investedNow(s); const vals = { 'Indian equity (₹)': now.ind, 'Equity funds (₹)': now.eqf, 'Debt & arbitrage funds (₹)': now.debt, 'International (₹)': now.intl, 'Saved on': new Date().toISOString().slice(0, 16).replace('T', ' '), 'Saved by': ctx.who() || '' };
      const had = (s.investedHist || []).find(r => r.month === ym);
      if (had) await ctx.queue({ kind: 'setRow', table: 'tblInvestedHist', idCol: 'Month', id: ym, changes: vals, base: { 'Indian equity (₹)': had.ind, 'Equity funds (₹)': had.eqf, 'Debt & arbitrage funds (₹)': had.debt, 'International (₹)': had.intl } });
      else await ctx.queue({ kind: 'addRow', table: 'tblInvestedHist', idCol: 'Month', values: Object.assign({ Month: ym }, vals), what: 'invested', summary: 'Invested amounts · ' + F.monthLabel(ym, true) });
      snap = true;
    }
    if (!Object.keys(bySheet).length && !snap) { toast('Nothing changed'); return; }
    for (const [sheet, cells] of Object.entries(bySheet)) await ctx.queue({ kind: 'setCells', sheet, cells, title: 'Month-end update · ' + F.monthLabel(row.month, true) });
    state.wiz = null; ctx.scheduleSync(3000); toast(F.monthLabel(row.month, true) + ' closed. It reaches the tracker with the next sync.'); ctx.go('home');
  };
  const last = step === STEPS.length - 1;
  return { title: 'Month-end update', back: 'more', body: [h('div', { style: { maxWidth: '680px' } },
    h('div', { class: 'row-between' }, h('h2', {}, STEPS[step] + (step > 0 ? ' · ' + F.monthLabel(row.month, true) : '')), h('span', { class: 'hint', style: { whiteSpace: 'nowrap' } }, step === 0 ? 'Start' : 'Step ' + step + ' of ' + (STEPS.length - 1))),
    h('div', { class: 'steps', 'aria-hidden': 'true' }, STEPS.map((x, i) => h('span', { class: i <= step ? 'on' : '' }))),
    h('section', { class: 'card' }, content),
    h('div', { class: 'sticky-save' }, step > 0 ? h('button', { class: 'btn', style: { flex: 1 }, onclick: prev }, 'Back') : null,
      !last ? h('button', { class: 'btn primary', style: { flex: 2 }, id: 'wiznext', onclick: next }, step >= 1 && step <= 3 ? 'Done, next' : 'Next') : h('button', { class: 'btn primary', style: { flex: 2 }, id: 'wizsave', onclick: submit }, 'Close the month')),
    h('p', { class: 'hint', style: { marginTop: '10px' } }, 'Income: add each entry from Home or the + button. NPS is updated once a year and EPF set once a year, both in More › Cash & fixed income.'))] };
}
const sameV = (a, b) => { const ea = a === null || a === undefined || a === '', eb = b === null || b === undefined || b === ''; if (ea || eb) return ea && eb; if (typeof a === 'string' && Number.isNaN(Number(a))) return a === String(b); return Number(a) === Number(b); };
function defaultMonth(inp) { const d = new Date(); const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1); const key = lm.getFullYear() + '-' + String(lm.getMonth() + 1).padStart(2, '0') + '-01'; const r = inp.monthly.find(x => x.month === key); return (r || inp.monthly[inp.monthly.length - 1]).month; }

// ---------------------------------------------------------------- Paste holdings (any broker) with column mapping
// Writes to the Other Holdings sheet: owner, platform, name, type, units, avg cost, price. Rows already there for the same
// owner + platform + name are updated in place; new names go into empty rows. Kite holdings keep using the Excel paste.
const FIELDS = [['name', 'Holding name / symbol', true], ['units', 'Quantity / units', true], ['avg', 'Average cost per unit', false], ['price', 'Current price per unit', false], ['value', 'Current value (₹), if no price', false], ['type', 'Asset type', false]];
export function parseTable(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  if (!lines.length) return { header: [], rows: [] };
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const split = l => { if (delim !== ',') return l.split(delim).map(x => x.trim()); const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  const all = lines.map(split);
  const numeric = r => r.filter(c => /^-?[\d,]+(\.\d+)?%?$/.test(c.replace(/[₹$\s]/g, ''))).length;
  const hasHeader = numeric(all[0]) === 0 && all.length > 1;
  return { header: hasHeader ? all[0] : all[0].map((_, i) => 'Column ' + (i + 1)), rows: hasHeader ? all.slice(1) : all };
}
export function guessMapping(header, saved) {
  const m = {}; const lower = header.map(x => x.toLowerCase());
  const used = new Set(); const find = (...res) => { for (const re of res) { const i = lower.findIndex((x, j) => !used.has(j) && re.test(x)); if (i >= 0) { used.add(i); return i; } } return -1; };
  if (saved && saved.sig === header.join('|')) return { ...saved.map };
  m.avg = find(/avg|average|cost price|buy price/); m.value = find(/cur.*val|current value|market value|present value/); m.price = find(/ltp|current|last price|market price|nav|price/);
  m.name = find(/symbol|instrument|scheme|fund|stock|name|ticker/); m.units = find(/^qty|quantity|units|shares|holding/);
  if (m.value < 0) m.value = find(/value/); m.type = find(/type|category|asset/);
  return m;
}
export function viewHoldings() {
  const s = ctx.snap(); const inp = s && s.inputs;
  if (!inp) return { title: 'Paste holdings', back: 'more', body: [card(null, null, empty('Sync with the tracker first.'))] };
  const H = state.hold || (state.hold = { text: '', owner: ctx.who() || 'Aravind', platform: '', step: 0 });
  const saved = (ctx.settings().holdMaps || {})[H.platform.toLowerCase()];
  const parsed = parseTable(H.text);
  if (!H.map || H.sig !== parsed.header.join('|')) { H.map = guessMapping(parsed.header, saved); H.sig = parsed.header.join('|'); }
  const colSel = (k, label, req) => h('div', { class: 'set' }, h('div', { class: 'set-l' }, h('div', { class: 'set-t' }, label + (req ? ' *' : ''))),
    h('div', { class: 'set-c' }, h('select', { class: 'field', 'aria-label': label, onchange: e => { H.map[k] = Number(e.target.value); ctx.render(); } }, h('option', { value: -1 }, '— not in my data —'), parsed.header.map((c, i) => h('option', { value: i, selected: H.map[k] === i }, c)))));
  // build preview rows
  const num = v => { const n = parseNum(String(v ?? '').replace(/%$/, '')); return n === '' ? null : n; };
  const items = parsed.rows.map((r, i) => {
    const g = k => (H.map[k] >= 0 ? r[H.map[k]] : undefined);
    const it = { i, name: (g('name') || '').trim(), units: num(g('units')), avg: num(g('avg')), price: num(g('price')), value: num(g('value')), type: (g('type') || '').trim() };
    it.errors = [];
    if (!it.name) it.errors.push('no name');
    if (it.units === null || Number.isNaN(it.units)) it.errors.push('quantity is not a number');
    if ((it.price === null || Number.isNaN(it.price)) && (it.value === null || Number.isNaN(it.value))) it.errors.push('no price or value');
    if (/^total/i.test(it.name)) it.skip = true;
    return it;
  }).filter(x => !x.skip);
  const ok = items.filter(x => !x.errors.length);
  const existing = inp.otherHoldings.filter(r => show(r.owner.v) === H.owner && show(r.platform.v).toLowerCase() === H.platform.trim().toLowerCase() && r.name.v);
  const known = new Set(s.assetTypes || []);
  const body = [];
  body.push(card('1. Whose holdings, and where', null,
    fieldRow('Owner', null, seg(['Aravind', 'Madhu'], H.owner, v => { H.owner = v; ctx.render(); }, 'Owner')),
    fieldRow('Platform', 'e.g. Groww, INDmoney, Wint Wealth, Coin', h('input', { class: 'field', id: 'platform', value: H.platform, 'aria-label': 'Platform', onchange: e => { H.platform = e.target.value.trim(); H.map = null; ctx.render(); } })),
    h('p', { class: 'hint', style: { marginTop: '6px' } }, 'Kite holdings: keep pasting them on the Paste Holdings sheet in Excel, which the tracker reads directly.')));
  body.push(card('2. Paste the table', null, h('p', { class: 'hint' }, 'Copy the holdings table from the website or a CSV/Excel file, including the header row, and paste it here. Nothing leaves this device until you save.'), h('div', { class: 'spacer' }),
    h('textarea', { class: 'field', id: 'holdpaste', rows: 6, 'aria-label': 'Pasted holdings', placeholder: 'Symbol\tQty\tAvg\tLTP…', onchange: e => { H.text = e.target.value; H.map = null; ctx.render(); } }, H.text),
    h('div', { class: 'btns', style: { marginTop: '8px' } }, h('label', { class: 'btn' }, icon('upload', 18), 'Open a CSV file', h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv', hidden: true, onchange: async e => { const f = e.target.files[0]; if (f) { H.text = await f.text(); H.map = null; ctx.render(); } } })))));
  if (parsed.rows.length) {
    body.push(card('3. Match the columns', saved ? tag('REMEMBERED', 'ok') : null, ...FIELDS.map(([k, l, r]) => colSel(k, l, r)), h('p', { class: 'hint', style: { marginTop: '6px' } }, 'Saved for this platform, so next month it is automatic even if the columns move.')));
    body.push(card('4. Check before saving', tag(ok.length + ' OK' + (items.length - ok.length ? ' · ' + (items.length - ok.length) + ' with errors' : ''), items.length - ok.length ? 'warn' : 'ok'),
      h('ul', { class: 'list' }, items.slice(0, 60).map(x => {
        const ex = existing.find(r => show(r.name.v).toLowerCase() === x.name.toLowerCase());
        const typeNote = x.type && !known.has(x.type) ? ' · type "' + x.type + '" is new to the tracker' : '';
        return h('li', { class: 'li wrap' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, x.name || '(no name)'), h('div', { class: 'sub' }, (x.units ?? '–') + ' units' + (x.avg !== null ? ' · avg ' + x.avg : '') + (x.price !== null ? ' · price ' + x.price : x.value !== null ? ' · value ' + F.inr(x.value) : '') + typeNote)),
          x.errors.length ? tag(x.errors.join(', ').toUpperCase(), 'crit') : tag(ex ? 'UPDATE' : 'NEW', ex ? 'plain' : 'prov'));
      })), items.length > 60 ? h('p', { class: 'hint' }, '…and ' + (items.length - 60) + ' more') : null));
    body.push(h('div', { class: 'sticky-save' }, h('button', { class: 'btn primary wide', id: 'holdsave', disabled: !ok.length || !H.platform || null, onclick: () => saveHoldings(H, ok, existing, inp) }, !H.platform ? 'Type the platform first' : 'Save ' + ok.length + ' holdings')));
  }
  return { title: 'Paste holdings', back: 'more', body: [h('div', { style: { maxWidth: '720px' } }, body)] };
}
async function saveHoldings(H, ok, existing, inp) {
  const used = new Set(inp.otherHoldingsUsed || []); const range = inp.otherHoldingsRange;
  const free = []; for (let r = range.first; r <= range.last; r++) if (!used.has(r)) free.push(r);
  const byRow = new Map(inp.otherHoldings.map(r => [r.row, r]));
  const cells = [];
  const put = (cell, value, label) => { if (!cell || cell.f) return; if (sameV(value, cell.v) && typeof value === 'number') return; if (!(typeof value === 'number') && show(value) === show(cell.v)) return; cells.push({ ref: cell.ref, base: cell.v ?? null, value, label }); };
  let added = 0, updated = 0;
  for (const x of ok) {
    let r = existing.find(e => show(e.name.v).toLowerCase() === x.name.toLowerCase());
    if (r) updated++; else { const rowN = free.shift(); if (!rowN) { toast('The Other Holdings sheet is full. Add rows to its table in Excel.', 'bad'); return; } r = byRow.get(rowN) || mkRow(rowN); added++; put(r.owner, H.owner, 'Owner'); put(r.platform, H.platform, 'Platform'); put(r.name, x.name, 'Holding name'); put(r.currency, 'INR', 'Currency'); if (x.type) put(r.type, x.type, 'Asset type'); }
    const lbl = x.name + ' · ';
    if (x.units !== null) put(r.units, x.units, lbl + 'Units');
    if (x.avg !== null) put(r.avg, x.avg, lbl + 'Avg cost');
    if (x.price !== null) put(r.price, x.price, lbl + 'Price'); else if (x.value !== null) put(r.value, x.value, lbl + 'Value');
  }
  const d = inp.dates.otherHoldings; if (d) cells.push({ ref: d.ref, base: d.v ?? null, value: todaySerial(), label: 'Last updated' });
  await ctx.queue({ kind: 'setCells', sheet: 'Other Holdings', cells, title: 'Holdings · ' + H.owner + ' · ' + H.platform });
  const maps = Object.assign({}, ctx.settings().holdMaps, { [H.platform.toLowerCase()]: { sig: H.sig, map: H.map } });
  await ctx.saveSettings({ holdMaps: maps });
  state.hold = null; toast(added + ' new, ' + updated + ' updated. It will reach the tracker with the next sync.'); ctx.go('wealth');
}
function mkRow(r) { const c = col => ({ ref: col + r, v: null }); return { row: r, owner: c('A'), platform: c('B'), name: c('C'), type: c('D'), currency: c('F'), units: c('G'), avg: c('H'), price: c('I'), invested: c('J'), value: c('K') }; }

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
