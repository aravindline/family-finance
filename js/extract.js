// Reads everything the screens show from the tracker, as Excel last calculated it.
// Blocks are found by their labels, not fixed rows, so small layout changes in the tracker don't break the app.
// Anything missing simply comes back empty; the screens then say "not set up yet".
import { serialToISO } from './xlsx.js';
import { extractForms } from './forms.js';

const C = l => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
const str = v => (v === null || v === undefined ? '' : String(v));
const iso = v => (typeof v === 'number' ? serialToISO(v) : v ? String(v).slice(0, 10) : null);

function sheetGrid(wb, name) { try { return wb.hasSheet(name) ? wb.grid(name) : null; } catch (e) { return null; } }
function at(g, r, c) { const m = g && g.get(r); return m ? (m.get(c) ?? null) : null; }
function findRow(g, col, test, from = 1, to = 2000) {
  if (!g) return null;
  for (let r = from; r <= to; r++) { const v = at(g, r, col); if (v !== null && test(str(v))) return r; }
  return null;
}
const starts = p => s => s.trim().toLowerCase().startsWith(p.toLowerCase());
function tbl(wb, name) { try { return wb.tables[name] ? wb.tableObjects(name) : []; } catch (e) { return []; } }

export function extractSnapshot(wb) {
  const out = { v: 2 };
  out.fileModified = wb.modified();

  // ---- lists for expense entry (typed header text, never depends on recalculation)
  const ex = sheetGrid(wb, 'Expenses'), ec = sheetGrid(wb, 'Expense Categories');
  const cats = [], subs = {};
  for (let i = 0; i < 16; i++) {
    const hd = at(ex, 26, 3 + i); if (!hd) continue; const c = str(hd).replace(/ \(₹\)$/, '');
    if (/^Spare \d+$/.test(c)) continue;
    cats.push(c); subs[c] = []; for (let col = 3; col <= 10; col++) { const s = at(ec, 6 + i, col); if (s) subs[c].push(str(s)); }
  }
  out.categories = cats; out.subcategories = subs;
  out.paymentModes = []; for (let r = 6; r <= 15; r++) { const m = at(ec, r, C('L')); if (m) out.paymentModes.push(str(m)); }
  out.budgets = {};
  const bh = findRow(ex, 1, starts('Category'), 1, 25) || 5;
  for (let r = bh + 1; r <= bh + 16; r++) { const c = at(ex, r, 1), b = num(at(ex, r, 2)); if (c && b) out.budgets[str(c)] = b; }

  // ---- dashboard: where the money is
  const d = sheetGrid(wb, 'Dashboard');
  const per = r => ({ aravind: num(at(d, r, C('D'))), madhu: num(at(d, r, C('E'))), family: num(at(d, r, C('F'))) });
  out.classes = []; out.totals = {};
  const ac = findRow(d, C('B'), starts('Asset class'), 1, 60);
  if (ac) {
    for (let r = ac + 1; r < ac + 20; r++) {
      const lab = str(at(d, r, C('B'))); if (!lab) continue;
      if (/^total assets/i.test(lab)) out.totals.assets = per(r);
      else if (/^less: loans/i.test(lab)) out.totals.loans = per(r);
      else if (/^net worth/i.test(lab)) { out.totals.netWorth = per(r); break; }
      else out.classes.push({ name: lab, ...per(r) });
    }
  }
  // headline tiles (labels in one row, values in the next)
  out.kpi = {};
  const kr = findRow(d, C('B'), s => /target achieved/i.test(s), 1, 30);
  if (kr) for (const col of 'BDFIKMP') { const l = at(d, kr, C(col)); if (l) out.kpi[str(l)] = at(d, kr + 1, C(col)); }
  // monthly picture (selected FY)
  out.picture = {};
  const mp = findRow(d, C('I'), s => s === 'Total income', 1, 40);
  if (mp) for (let r = mp; r < mp + 10; r++) { const l = at(d, r, C('I')); if (!l) continue; const v = at(d, r, C('L')); if (v !== null) out.picture[str(l)] = v; else out.nudges = (out.nudges || []).concat(str(l)); }
  // performance by type
  out.perfByType = [];
  const pt = findRow(d, C('I'), s => s === 'Asset type', 1, 80);
  if (pt) for (let r = pt + 1; r < pt + 15; r++) {
    const t = str(at(d, r, C('I'))); if (!t) continue; const row = { type: t, invested: num(at(d, r, C('J'))), current: num(at(d, r, C('K'))), pnl: num(at(d, r, C('L'))), ret: num(at(d, r, C('M'))) };
    if (/^total$/i.test(t)) { out.perfTotal = row; break; }
    if (row.current) out.perfByType.push(row);
  }
  // protection summary
  out.protection = {};
  const pr = findRow(d, C('B'), s => s === 'Cover', 1, 120);
  if (pr) for (let r = pr + 1; r < pr + 6; r++) { const l = str(at(d, r, C('B'))); if (l) out.protection[l] = per(r); }
  // FIRE block
  out.fire = {};
  const fr = findRow(d, C('B'), starts('Needed at 40'), 1, 140) || findRow(d, C('B'), starts('Needed at'), 1, 140);
  if (fr) {
    out.fire.labels = {};
    for (const col of 'BDFIKM') { const l = at(d, fr, C(col)); if (l) out.fire.labels[col] = str(l); }
    // the Dashboard shows these in ₹ crore (B, D) and ₹ lakh (I); convert back to rupees
    const cr = v => (num(v) === null ? null : num(v) * 1e7), lk = v => (num(v) === null ? null : num(v) * 1e5);
    out.fire.neededToday = cr(at(d, fr + 1, C('B'))); out.fire.projectedToday = cr(at(d, fr + 1, C('D')));
    out.fire.ratio = num(at(d, fr + 1, C('F'))); out.fire.monthlyNeeded = lk(at(d, fr + 1, C('I')));
    out.fire.lastsUntil = at(d, fr + 1, C('K')); out.fire.yearsToFire = num(at(d, fr + 1, C('M')));
    out.fire.notes = 'BDFIKM'.split('').map(col => str(at(d, fr + 3, C(col)))).filter(Boolean);
    const title = at(d, fr - 2, C('B')); if (title) out.fire.title = str(title);
  }

  // ---- monthly tracker (history)
  out.monthly = tbl(wb, 'tblMonthly').map(r => ({
    month: iso(r['Month']), fy: str(r['FY']), income: num(r['Total income (₹)']), expenses: num(r['Expenses (₹)']),
    saved: num(r['Total saved & invested (₹)']), target: num(r['Target (₹)']), vsTarget: num(r['vs target, excl. EPF (₹)']), savingsRate: num(r['Savings rate']),
    nwA: num(r['Aravind net worth (₹)']), nwM: num(r['Madhu net worth (₹)']), nwF: num(r['Family net worth (₹)']),
    takeA: num(r['Aravind take-home (₹)']), takeM: num(r['Madhu take-home (₹)']),
  })).filter(r => r.month && (r.income || r.saved || r.nwF || r.nwA || r.nwM));

  // ---- monthly expenses by category (from the tracker)
  out.expenseMonths = tbl(wb, 'tblExpenses').map(r => ({ month: iso(r['Month']), total: num(r['Total (₹)']) })).filter(r => r.month && r.total);

  // ---- allocation & risk
  const a = sheetGrid(wb, 'Allocation & Risk');
  out.allocation = []; out.stocks = []; out.sectors = []; out.stress = [];
  const ah = findRow(a, 1, s => s === 'Asset class', 1, 40);
  if (ah) for (let r = ah + 1; r < ah + 15; r++) {
    const l = str(at(a, r, 1)); if (!l) continue;
    const row = { name: l, value: num(at(a, r, 2)), pct: num(at(a, r, 3)), target: num(at(a, r, 4)), drift: num(at(a, r, 5)), move: num(at(a, r, 6)), status: str(at(a, r, 7)) };
    if (/^investable/i.test(l)) { out.investable = row; continue; }
    if (/^EPF/i.test(l)) { out.retirementOutside = row.value; break; }
    out.allocation.push(row);
  }
  const sh = findRow(a, 1, s => s === 'Stock', 1, 80);
  if (sh) for (let r = sh + 1; r < sh + 40; r++) { const l = str(at(a, r, 1)); if (/above the limit/i.test(l)) { out.stockLimitNote = str(at(a, r, 4)); break; } if (l) out.stocks.push({ name: l, value: num(at(a, r, 2)), pct: num(at(a, r, 3)), sector: str(at(a, r, 4)), status: str(at(a, r, 7)) }); }
  const sc = findRow(a, 1, s => s === 'Sector', 1, 120);
  if (sc) for (let r = sc + 1; r < sc + 40; r++) { const l = str(at(a, r, 1)); if (/^unassigned/i.test(l) || /above the limit/i.test(l)) break; if (l) out.sectors.push({ name: l, value: num(at(a, r, 2)), pct: num(at(a, r, 3)), status: str(at(a, r, 7)) }); }
  const sth = findRow(a, 1, s => s === 'Scenario', 1, 200);
  if (sth) for (let r = sth + 1; r < sth + 10; r++) { const l = str(at(a, r, 1)); if (!l || num(at(a, r, 6)) === null) break; out.stress.push({ name: l, loss: num(at(a, r, 2)), fall: num(at(a, r, 3)), fallA: num(at(a, r, 4)), fallM: num(at(a, r, 5)), after: num(at(a, r, 6)), status: str(at(a, r, 7)) }); }

  // ---- goals sheet: monthly target, emergency fund, FIRE, goals table
  const g = sheetGrid(wb, 'Goals');
  out.buckets = [];
  const bk = findRow(g, 1, s => s === 'Bucket', 1, 30);
  if (bk) for (let r = bk + 1; r < bk + 12; r++) {
    const l = str(at(g, r, 1)); if (!l) continue;
    const row = { name: l, share: at(g, r, 2), target: num(at(g, r, 3)), actual: num(at(g, r, 4)), gap: num(at(g, r, 5)), status: str(at(g, r, 6)) };
    out.buckets.push(row); if (/^total/i.test(l)) break;
  }
  const lab = (p, from = 1, to = 60) => { const r = findRow(g, 1, starts(p), from, to); return r ? at(g, r, 3) : null; };
  out.targetPerMonth = num(lab('Target per month'));
  out.emergency = { months: num(lab('Months of outflows to keep')), outflows: num(lab('Monthly outflows')), target: num(lab('Emergency fund target')), have: num(lab('Cash & deposits today')), coverage: num(lab('Coverage')), monthsCovered: num(lab('Months of outflows cover')) };
  Object.assign(out.fire, { fireAge: num(lab('Target FIRE age')), fireDate: iso(lab('FIRE date')), yearsToGo: num(lab('Years to go')), corpusNeeded: num(lab('Corpus needed')), corpusToday: num(lab('FIRE corpus today')), progress: num(lab('Progress')) });
  out.goals = tbl(wb, 'tblGoals').filter(r => r['Goal']).map(r => ({
    name: str(r['Goal']), owner: str(r['Owner']), cost: num(r["Today's cost (₹)"]), year: num(r['Target year']), saved: num(r['Set aside so far (₹)']), monthly: num(r['Monthly contribution (₹)']),
    future: num(r['Future cost (₹)']), yearsLeft: num(r['Years left']), neededPerMonth: num(r['Needed per month (₹)']), progress: num(r['Progress']), status: str(r['Status']), notes: str(r['Notes']),
    ret: num(r['Return on set-aside %']), forecast: str(r['Forecast?']) === 'Yes', projected: num(r['Projected by target year (₹)']), cover: num(r['Projected cover']), row: r._row,
  }));

  // ---- health check
  out.health = tbl(wb, 'tblHealth').filter(r => r['Check']).map(r => ({ n: num(r['#']), area: str(r['Area']), check: str(r['Check']), status: str(r['Status']), detail: str(r['Detail']).replace(/(as (?:of|on) )?(30-Dec-1899|00-Jan-1900)/g, (m, a) => (a ? a.trim() + ': ' : '') + 'not set'), fix: str(r['Where to fix']) }));

  // ---- holdings
  out.holdings = tbl(wb, 'tblHoldings').filter(r => r['Symbol / Fund']).map(r => ({ owner: str(r['Owner']), account: str(r['Account']), name: str(r['Symbol / Fund']), type: str(r['Asset type']), cls: str(r['Class']), qty: num(r['Qty']), invested: num(r['Invested (₹)']), current: num(r['Current value (₹)']), pnl: num(r['P&L (₹)']), ret: num(r['Return %']), weight: num(r['Weight %']) }));
  // Tracker v25+: Kite rows are typed values (one per stock per account), so holdings are worked out from them directly and
  // are right straight after a sync; asset type and class still come from Excel's last calculation (blank for a new symbol).
  { const pg = sheetGrid(wb, 'Paste Holdings');
    if (pg && /^account code/i.test(str(at(pg, 12, 1)).trim())) {
      const own = {}; for (let r = 6; r <= 11; r++) { const c = at(pg, r, 1); if (c) own[str(c)] = str(at(pg, r, 2)); }
      const kind = {}; for (const x of out.holdings) if (x.name && x.type && !kind[x.name]) kind[x.name] = { type: x.type, cls: x.cls };
      const rows = [];
      for (let r = 13; r <= 1012; r++) {
        const code = at(pg, r, 1), sym = at(pg, r, 2), qty = num(at(pg, r, 3)); if (!code || !sym || qty === null) continue;
        const avg = num(at(pg, r, 4)) || 0, price = num(at(pg, r, 5)) ?? avg; const invested = qty * avg, current = qty * price;
        const k = kind[str(sym).trim()] || {};
        rows.push({ owner: own[str(code)] || '', account: str(code), name: str(sym).trim(), type: k.type || '', cls: k.cls || '', qty, invested, current, pnl: current - invested, ret: invested ? (current - invested) / invested : 0, weight: 0 });
      }
      const tot = rows.reduce((t, x) => t + x.current, 0); for (const x of rows) x.weight = tot ? x.current / tot : 0;
      out.holdings = rows; out.kiteTidy = true;
    } }
  out.otherHoldings = tbl(wb, 'tblOtherHoldings').filter(r => r['Holding name'] && (num(r['Current (₹)']) || num(r['Value ₹ (if no units)']))).map(r => ({ owner: str(r['Owner']), platform: str(r['Platform']), name: str(r['Holding name']), type: str(r['Asset type']), cls: str(r['Class (auto)']), invested: num(r['Invested (₹)']), current: num(r['Current (₹)']) ?? num(r['Value ₹ (if no units)']), pnl: num(r['P&L (₹)']), ret: num(r['Return']), linked: /^Linked/i.test(str(r['Notes'])) || undefined }));
  { const ig = sheetGrid(wb, 'Intl Holdings'); out.intlPlatform = str(at(ig, 4, 3)) || 'INDmoney'; out.intlOwner = str(at(ig, 5, 3)) || ''; }
  out.intl = tbl(wb, 'tblIntl').filter(r => r['Stock symbol']).map(r => ({ type: 'US stocks', platform: out.intlPlatform, owner: str(r['Owner (blank = default)']) || out.intlOwner, name: str(r['Stock symbol']), invested: num(r['Invested (₹)']), current: num(r['Current (₹)']), pnl: num(r['P&L (₹)']), ret: num(r['Return']) }));
  out.otherAssets = tbl(wb, 'tblOther').filter(r => r['Item'] && num(r['Family (₹)'])).map(r => ({ name: str(r['Item']), where: str(r['Bank / institution']), type: str(r['Type']), aravind: num(r['Aravind (₹)']), madhu: num(r['Madhu (₹)']), family: num(r['Family (₹)']), cls: str(r['Class (auto)']) }));
  out.loans = tbl(wb, 'tblLoans').filter(r => r['Loan'] && num(r['Total (₹)'])).map(r => ({ name: str(r['Loan']), lender: str(r['Lender']), aravind: num(r['Aravind outstanding (₹)']), madhu: num(r['Madhu outstanding (₹)']), total: num(r['Total (₹)']), rate: num(r['Interest %']), emi: num(r['EMI (₹)']), closes: iso(r['Closes (month)']), nextEmi: iso(r['Next EMI month']), emisLeft: num(r['EMIs left (auto)']), lastEmi: iso(r['Last EMI (auto)']), interestLeft: num(r['Interest still to pay (₹, auto)']) }));

  // ---- insurance, documents, nominees, contacts (no full numbers are kept in the tracker)
  out.insurance = tbl(wb, 'tblInsurance').filter(r => r['Policy']).map(r => ({ name: str(r['Policy']), type: str(r['Type']), covers: str(r['Covers']), insurer: str(r['Insurer']), sum: num(r['Sum assured (₹)']), premium: num(r['Annual premium (₹)']), renewal: iso(r['Renewal date']), nominee: str(r['Nominee']), days: num(r['Days to renewal (auto)']), status: str(r['Renewal status (auto)']), notes: str(r['Notes']) }));
  out.documents = tbl(wb, 'tblDocuments').filter(r => r['Document']).map(r => ({ name: str(r['Document']), owner: str(r['Owner']), where: str(r['Where kept (folder link or place)']), expiry: iso(r['Expiry date']), days: num(r['Days to expiry (auto)']), status: str(r['Status (auto)']) }));
  out.nominees = tbl(wb, 'tblNominees').filter(r => r['Account / policy']).map(r => ({ name: str(r['Account / policy']), institution: str(r['Institution']), owner: str(r['Owner']), nominee: str(r['Nominee']), updated: iso(r['Nominee updated on']), status: str(r['Status (auto)']) }));
  out.contacts = tbl(wb, 'tblContacts').filter(r => r['Name']).map(r => ({ name: str(r['Name']), role: str(r['Relation / role']), phone: str(r['Phone']), email: str(r['Email']), notes: str(r['Notes']) }));

  // ---- what the monthly update can edit: input cells only, with their current values (the "base" for conflict checks)
  const cellIn = (sheet, ref) => { try { return wb.isFormula(sheet, ref) ? undefined : wb.get(sheet, ref); } catch (e) { return undefined; } };
  const inputs = { monthly: [], otherAssets: [], loans: [], otherHoldings: [], dates: {} };
  try {
    const t = wb.table('tblMonthly'); const MCOL = { C: 'takeA', D: 'takeM', E: 'otherIncome', H: 'bank', I: 'epf', J: 'nps', K: 'equity', L: 'intl', M: 'gold', N: 'debt', O: 'reits', P: 'spare1', Q: 'spare2', V: 'nwA', W: 'nwM' };
    const g = wb.grid(t.sheet); const head = wb.grid(t.sheet).get(t.r1); inputs.monthlySheet = t.sheet;
    inputs.monthlyLabels = {}; for (const c of Object.keys(MCOL)) { const hv = head && head.get(C(c)); if (hv) inputs.monthlyLabels[MCOL[c]] = String(hv).replace(/ \(₹\)$/, ''); }
    inputs.monthlyFormula = {}; for (const c of Object.keys(MCOL)) inputs.monthlyFormula[MCOL[c]] = wb.isFormula(t.sheet, c + (t.r1 + 1));
    for (let r = t.r1 + 1; r <= t.r2; r++) {
      const m = g.get(r); const mon = m && m.get(1); if (!mon) continue;
      const row = { row: r, month: iso(mon), cols: {} }; for (const [c, k] of Object.entries(MCOL)) row.cols[k] = { ref: c + r, v: m.get(C(c)) ?? null }; inputs.monthly.push(row);
    }
  } catch (e) { /* table missing: the wizard explains */ }
  const rowsOf = (name, map) => { try { const t = wb.table(name); return wb.tableObjects(name).map(o => ({ row: o._row, ...Object.fromEntries(Object.entries(map).map(([k, col]) => [k, { ref: col + o._row, v: o[t.cols[C(col) - t.c1]] ?? null, f: wb.isFormula(t.sheet, col + o._row) || undefined }])) })); } catch (e) { return []; } };
  inputs.otherAssets = rowsOf('tblOther', { name: 'A', where: 'B', type: 'C', aravind: 'D', madhu: 'E' }).filter(r => r.name.v);
  inputs.loans = rowsOf('tblLoans', { name: 'A', lender: 'B', aravind: 'C', madhu: 'D', emi: 'G', nextEmi: 'J' }).filter(r => r.name.v);
  inputs.otherHoldings = rowsOf('tblOtherHoldings', { owner: 'A', platform: 'B', name: 'C', type: 'D', currency: 'F', units: 'G', avg: 'H', price: 'I', invested: 'J', value: 'K' });
  try { const t = wb.table('tblOtherHoldings'); inputs.otherHoldingsRange = { first: t.r1 + 1, last: t.r2 }; inputs.otherHoldingsUsed = inputs.otherHoldings.filter(r => r.name.v || r.owner.v || r.platform.v).map(r => r.row); } catch (e) { /* none */ }
  for (const [k, sheet, ref] of [['otherAssets', 'Other Assets', 'B3'], ['loans', 'Loans', 'B3'], ['otherHoldings', 'Other Holdings', 'B9'], ['kite', 'Paste Holdings', 'B3']]) {
    const v = cellIn(sheet, ref); if (v !== undefined) inputs.dates[k] = { sheet, ref, v };
  }
  out.inputs = inputs;
  out.assetTypes = tbl(wb, 'tblTypes').map(r => str(r['Type'])).filter(Boolean);

  // ---- v21: the app's own tables (events, money lent, budgets, chart notes); missing tables come back empty
  out.v21 = !!(wb.tables && wb.tables.tblEvents);
  out.events = tbl(wb, 'tblEvents').filter(r => r['Event']).map(r => ({ id: str(r['Event ID']), name: str(r['Event']), start: iso(r['Start date']), end: iso(r['End date']), budget: num(r['Budget (₹)']), status: str(r['Status']) || 'Active', notes: str(r['Notes']) }));
  out.lent = tbl(wb, 'tblLent').filter(r => r['Loan ID'] && str(r['Status']) !== 'Deleted').map(r => ({ id: str(r['Loan ID']), by: str(r['Lent by']), borrower: str(r['Borrower']), date: iso(r['Date lent']), amount: num(r['Amount (₹)']) || 0, followUp: iso(r['Follow up on']), notes: str(r['Notes']), status: str(r['Status']) || 'Active' }));
  out.repaid = tbl(wb, 'tblRepaid').filter(r => r['Repayment ID'] && str(r['Status']) !== 'Deleted').map(r => ({ id: str(r['Repayment ID']), loan: str(r['Loan ID']), date: iso(r['Date']), amount: num(r['Amount (₹)']) || 0, notes: str(r['Notes']), by: str(r['Logged by']) }));
  out.budgetHistory = tbl(wb, 'tblBudget').filter(r => r['Category'] && num(r['Effective from'])).map(r => ({ from: iso(r['Effective from']).slice(0, 7), category: str(r['Category']), amount: num(r['Monthly budget']) || 0, by: str(r['Set by']) }));
  out.chartNotes = tbl(wb, 'tblChartNotes').filter(r => r['Note'] && str(r['Status']) !== 'Deleted').map(r => ({ id: str(r['Note ID']), chart: str(r['Chart']), month: iso(r['Month']) ? iso(r['Month']).slice(0, 7) : '', note: str(r['Note']), by: str(r['Added by']), at: str(r['Added at']) }));
  // ---- v22: income entries (one row per amount received, like daily expenses), categories and received accounts
  out.v22 = !!(wb.tables && wb.tables.tblIncome);
  // v27: invested amount (buy cost) per bucket, saved by the Month-end update; this month minus last = invested this month
  out.v27 = !!(wb.tables && wb.tables.tblInvestedHist);
  out.investedHist = tbl(wb, 'tblInvestedHist').filter(r => str(r['Month'])).map(r => ({ month: str(r['Month']).slice(0, 7), ind: num(r['Indian equity (₹)']) || 0, eqf: num(r['Equity funds (₹)']) || 0, debt: num(r['Debt & arbitrage funds (₹)']) || 0, intl: num(r['International (₹)']) || 0, at: str(r['Saved on']), by: str(r['Saved by']) }));
  out.income = tbl(wb, 'tblIncome').filter(r => r['Entry ID'] && num(r['Date'])).map(r => ({ id: str(r['Entry ID']), date: iso(r['Date']), month: iso(r['Date']).slice(0, 7), person: str(r['Person']), category: str(r['Category']), sub: str(r['Sub-category']), amount: num(r['Amount (₹)']) || 0, account: str(r['Received account']), notes: str(r['Notes']), by: str(r['Entered by']), at: str(r['Entered at']), status: str(r['Status']) || 'Active' }));
  { const ig = sheetGrid(wb, 'Income Entries'); out.incomeCats = []; out.incomeAccounts = [];
    if (ig) { for (let r = 6; r <= 30; r++) { const c = str(at(ig, r, C('M'))); if (!c) break; out.incomeCats.push({ name: c, goes: str(at(ig, r, C('N'))), subs: ['O', 'P', 'Q', 'R'].map(x => str(at(ig, r, C(x)))).filter(Boolean) }); }
      for (let r = 6; r <= 45; r++) { const a = str(at(ig, r, C('T'))); if (a) out.incomeAccounts.push(a); } } }
  { const yrs = str(at(d, 7, C('B'))); const m = yrs.match(/^([\d.]+) years/); out.nwYears = m ? Number(m[1]) : null; }
  { const st = sheetGrid(wb, 'Settings'); const live = findRow(st, 2, s => /living, per month/i.test(s), 1, 120); const trips = findRow(st, 2, s => /trips, per month/i.test(s), 1, 120);
    out.retireMonthly = (live ? num(at(st, live, 3)) || 0 : 0) + (trips ? num(at(st, trips, 3)) || 0 : 0) || null; }

  // ---- drop 1: every input block the app can fill (see forms.js)
  try { out.forms = extractForms(wb); } catch (e) { out.forms = {}; }

  // ---- headline numbers kept in the old shape too
  const nw = out.totals.netWorth || {}, ta = out.totals.assets || {}, lo = out.totals.loans || {};
  out.netWorth = { family: nw.family ?? null, aravind: nw.aravind ?? null, madhu: nw.madhu ?? null };
  out.totalAssets = { family: ta.family ?? null, aravind: ta.aravind ?? null, madhu: ta.madhu ?? null };
  out.loanTotals = { family: -(lo.family || 0), aravind: -(lo.aravind || 0), madhu: -(lo.madhu || 0) };
  return out;
}
