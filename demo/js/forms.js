// What the app lets you fill in, block by block. A cell is editable only when the tracker marks it as an input
// (yellow fill) and it holds no formula; everything else in a block is shown read-only. Dropdown choices come from
// the tracker's own dropdown lists, so a list changed in the tracker shows up here after the next sync.
import { col2n, n2col, serialToISO } from './xlsx.js';

// t: text | money | num | pct | date | month | year | choice | phone | email
const N = x => Number(x) || 0;
export const FORMS = [
  { id: 'assets', group: 'assets', title: 'Bank, cash and other balances', sub: 'Balances split between Aravind and Madhu', sheet: 'Other Assets', rows: [7, 37], stamp: 'B3', topicCol: 'C', topicDefault: 'cash',
    label: { c: 'A' }, show: ['D', 'E'], readonly: [{ c: 'F', l: 'Family (₹)', t: 'money', calc: v => N(v('D')) + N(v('E')) }, { c: 'H', l: 'Class (auto)', t: 'text' }],
    fields: [{ c: 'A', l: 'Item', t: 'text' }, { c: 'B', l: 'Bank / institution', t: 'text' }, { c: 'C', l: 'Type', t: 'choice' },
      { c: 'D', l: 'Aravind (₹)', t: 'money' }, { c: 'E', l: 'Madhu (₹)', t: 'money' }, { c: 'G', l: 'Notes', t: 'text' }] },
  { id: 'gold', group: 'assets', title: 'Physical gold', sub: 'Grams held and the rate used', sheet: 'Other Assets', stamp: 'B3',
    cells: [{ r: 'K5', l: 'Gold rate used (₹ per gram)', t: 'money' }, { r: 'K8', l: 'Aravind (grams)', t: 'num' }, { r: 'L8', l: 'Madhu (grams)', t: 'num' }],
    readonly: [{ r: 'M9', l: 'Value (₹)', t: 'money', calc: v => (N(v('K8')) + N(v('L8'))) * N(v('K5')) }, { r: 'K9', l: 'Aravind (₹)', t: 'money', calc: v => N(v('K8')) * N(v('K5')) }, { r: 'L9', l: 'Madhu (₹)', t: 'money', calc: v => N(v('L8')) * N(v('K5')) }] },
  { id: 'vehicles', group: 'assets', title: 'Vehicles', sub: 'Value after depreciation counts in net worth', sheet: 'Other Assets', rows: [25, 26], stamp: 'B3',
    label: { c: 'J' }, show: ['K', 'L'], readonly: [{ c: 'O', l: 'Value now (₹)', t: 'money', calc: v => N(v('L')) ? Math.round(N(v('L')) * Math.pow(1 - N(v('N')), Math.max(0, new Date().getFullYear() - N(v('M'))))) : null }],
    fields: [{ c: 'J', l: 'Vehicle', t: 'text' }, { c: 'K', l: 'Owner', t: 'choice' }, { c: 'L', l: 'Price paid (₹)', t: 'money' }, { c: 'M', l: 'Year bought', t: 'year' }, { c: 'N', l: 'Depreciation % a year', t: 'pct' }] },
  { id: 'otherhold', group: 'assets', title: 'Holdings outside demat', sub: 'MF folios, bonds, digital gold or silver, chit funds, gold schemes, P2P lending', sheet: 'Other Holdings', rows: [13, 112], stamp: 'B9', topicCol: 'D', topicDefault: 'mf',
    label: { c: 'C' }, show: ['A', 'B'], readonly: [{ c: 'M', l: 'Invested (₹)', t: 'money' }, { c: 'N', l: 'Current (₹)', t: 'money' }, { c: 'P', l: 'Return', t: 'pct' }],
    fields: [{ c: 'A', l: 'Owner', t: 'choice' }, { c: 'B', l: 'Platform', t: 'text' }, { c: 'C', l: 'Holding name', t: 'text' }, { c: 'D', l: 'Asset type', t: 'choice' },
      { c: 'F', l: 'Currency', t: 'choice' }, { c: 'G', l: 'Units', t: 'num' }, { c: 'H', l: 'Avg cost / unit', t: 'num' }, { c: 'I', l: 'Price / unit', t: 'num' },
      { c: 'J', l: 'Invested ₹ (if known)', t: 'money' }, { c: 'K', l: 'Value ₹ (if no units)', t: 'money' },
      // v30: maturity and interest for bonds, NCDs, SGBs, G-secs, chit funds and lending (Aravind, 12 Nov 2026)
      { c: 'S', l: 'Maturity', t: 'date' }, { c: 'T', l: 'Interest % a year', t: 'pct' }, { c: 'Q', l: 'Notes', t: 'text' }] },
  // v26: INR, USD (rate from Intl Holdings) and five more currencies for holdings outside India
  { id: 'currencies', group: 'assets', title: 'Currencies', sub: 'For holdings outside India: code and today\'s ₹ rate', sheet: 'Other Holdings',
    cells: [{ r: 'K5', l: 'Currency 1 code (e.g. JPY)', t: 'text' }, { r: 'K6', l: 'Currency 1: ₹ per unit', t: 'num' }, { r: 'L5', l: 'Currency 2 code (e.g. JPY)', t: 'text' }, { r: 'L6', l: 'Currency 2: ₹ per unit', t: 'num' }, { r: 'M5', l: 'Currency 3 code (e.g. JPY)', t: 'text' }, { r: 'M6', l: 'Currency 3: ₹ per unit', t: 'num' }, { r: 'N5', l: 'Currency 4 code (e.g. JPY)', t: 'text' }, { r: 'N6', l: 'Currency 4: ₹ per unit', t: 'num' }, { r: 'O5', l: 'Currency 5 code (e.g. JPY)', t: 'text' }, { r: 'O6', l: 'Currency 5: ₹ per unit', t: 'num' }],
    readonly: [{ r: 'J6', l: 'USD: ₹ per unit (from International holdings settings)', t: 'num' }] },
  // CAS date: set by the CAS upload only (the extra-currency cells left the tracker in v26)
  { id: 'casdate', group: 'assets', hidden: true, title: 'CAS imported (as on)', sub: 'Set by the CAS upload', sheet: 'Other Holdings',
    cells: [{ r: 'B10', l: 'CAS imported (as on)', t: 'date' }] },

  { id: 'kiteaccts', group: 'assets', back: 'kite', title: 'Kite demat accounts', sub: 'Account code as shown in Kite, whose it is, and a short name', sheet: 'Paste Holdings', rows: [6, 11],
    label: { c: 'A' }, show: ['D', 'B'], readonly: [{ c: 'C', l: 'Holdings found', t: 'num' }],
    fields: [{ c: 'A', l: 'Account code (as in Kite)', t: 'text' }, { c: 'B', l: 'Owner', t: 'choice' }, { c: 'D', l: 'Name (e.g. Mom)', t: 'text' }] },
  { id: 'intlset', group: 'assets', back: 'formintl', title: 'International holdings: main platform', sub: 'Main platform, default owner, date and USD rate', sheet: 'Intl Holdings',
    cells: [{ r: 'C4', l: 'Platform', t: 'text' }, { r: 'C5', l: 'Default owner', t: 'choice' }, { r: 'C6', l: 'Holdings as on', t: 'date' }, { r: 'C7', l: 'USD / INR rate', t: 'num' }, { r: 'C8', l: 'Total invested in ₹ (optional)', t: 'money' }],
    readonly: [{ r: 'L7', l: 'Current (₹)', t: 'money' }, { r: 'L8', l: 'P&L (₹)', t: 'money' }] },
  { id: 'intl', group: 'assets', title: 'International holdings', sub: 'One row per stock, with its broker and currency', sheet: 'Intl Holdings', rows: [13, 112], addLabel: 'Add stock',
    label: { c: 'A' }, show: ['C', 'S'], readonly: [{ c: 'J', l: 'Invested ($)', t: 'num' }, { c: 'K', l: 'Current ($)', t: 'num' }, { c: 'N', l: 'Current (₹)', t: 'money' }, { c: 'L', l: 'Return', t: 'pct' }],
    fields: [{ c: 'A', l: 'Stock symbol', t: 'text' }, { c: 'B', l: 'Holding since', t: 'text' }, { c: 'C', l: 'Quantity', t: 'num' }, { c: 'D', l: 'Avg price ($)', t: 'num' },
      { c: 'E', l: 'Total value ($) (cost)', t: 'num' }, { c: 'F', l: 'Current price ($)', t: 'num' }, { c: 'G', l: 'Owner (blank = default)', t: 'choice' },
      { c: 'S', l: 'Broker (blank = platform above)', t: 'text' }, { c: 'U', l: 'Currency (blank = USD)', t: 'choice' }, { c: 'H', l: 'Notes', t: 'text' }] },
  // v30: each international broker other than the main platform has its own settings (Aravind, 12 Nov 2026)
  { id: 'brokers', group: 'assets', back: 'formintl', title: 'Other international brokers', sub: 'Each broker\'s own owner, holdings date, currency and ₹ rate', sheet: 'Intl Holdings', rows: [13, 22], addLabel: 'Add broker',
    label: { c: 'Y' }, show: ['Z', 'AA', 'AB'],
    fields: [{ c: 'Y', l: 'Broker (as typed on each stock)', t: 'text' }, { c: 'Z', l: 'Default owner', t: 'choice' }, { c: 'AA', l: 'Holdings as on', t: 'date' },
      { c: 'AB', l: 'Currency (blank = USD)', t: 'choice' }, { c: 'AC', l: '₹ per unit (blank = currency rate)', t: 'num' }] },
  // v29: gratuity for both (Aravind, 11 Nov 2026); the Gratuity sheet works out the amounts
  { id: 'gratuity', group: 'assets', back: 'gratuity', title: 'Gratuity details', sub: 'Company, joining date, basic + DA, for Aravind and Madhu', sheet: 'Gratuity',
    cells: [['C', 'Aravind'], ['D', 'Madhu']].flatMap(([c, p]) => [{ r: c + '6', l: p + ': company', t: 'text' }, { r: c + '7', l: p + ': joining date', t: 'date' }, { r: c + '8', l: p + ': monthly basic + DA (₹)', t: 'money' },
      { r: c + '9', l: p + ': monthly total pay, gross (₹, optional)', t: 'money' }, { r: c + '10', l: p + ': fixed-term employee?', t: 'choice' }]) },

  { id: 'loans', group: 'loans', title: 'Loans', sub: 'Outstanding, rate, EMI and dates', sheet: 'Loans', rows: [7, 15], stamp: 'B3',
    label: { c: 'A' }, show: ['C', 'D'], readonly: [{ c: 'E', l: 'Total (₹)', t: 'money', calc: v => N(v('C')) + N(v('D')) }, { c: 'K', l: 'EMIs left (auto)', t: 'num' }, { c: 'L', l: 'Last EMI (auto)', t: 'month' }, { c: 'M', l: 'Interest still to pay (₹)', t: 'money' }],
    fields: [{ c: 'A', l: 'Loan', t: 'text' }, { c: 'B', l: 'Lender', t: 'text' }, { c: 'C', l: 'Aravind outstanding (₹)', t: 'money' }, { c: 'D', l: 'Madhu outstanding (₹)', t: 'money' },
      { c: 'F', l: 'Interest %', t: 'pct' }, { c: 'G', l: 'EMI (₹)', t: 'money' }, { c: 'H', l: 'Closes (month)', t: 'month' }, { c: 'J', l: 'Next EMI month', t: 'month' }, { c: 'I', l: 'Notes', t: 'text' }] },
  { id: 'insurance', group: 'protect', title: 'Insurance policies', sub: 'Cover, premium, renewal and nominee', sheet: 'Insurance', rows: [5, 14], stamp: 'B3',
    label: { c: 'A' }, show: ['E', 'G'], readonly: [{ c: 'J', l: 'Days to renewal', t: 'num' }, { c: 'K', l: 'Renewal status', t: 'text' }],
    fields: [{ c: 'A', l: 'Policy', t: 'text' }, { c: 'B', l: 'Type', t: 'choice' }, { c: 'C', l: 'Covers', t: 'choice' }, { c: 'D', l: 'Insurer', t: 'text' },
      { c: 'E', l: 'Sum assured (₹)', t: 'money' }, { c: 'F', l: 'Annual premium (₹)', t: 'money' }, { c: 'G', l: 'Renewal date', t: 'date' }, { c: 'I', l: 'Nominee', t: 'text' }, { c: 'H', l: 'Notes', t: 'text' }] },
  { id: 'wills', group: 'protect', title: 'Wills', sub: 'Made or not, where kept, executor', sheet: 'Estate & Contacts', rows: [6, 7], noAdd: true,
    label: { c: 'A' }, show: ['B', 'E'],
    fields: [{ c: 'B', l: 'Will made?', t: 'choice' }, { c: 'C', l: 'Where it is kept', t: 'text' }, { c: 'D', l: 'Executor', t: 'text' }, { c: 'E', l: 'Last reviewed', t: 'date' }] },
  { id: 'documents', group: 'protect', title: 'Documents', sub: 'Where each document is kept, and expiry', sheet: 'Estate & Contacts', rows: [25, 44],
    label: { c: 'A' }, show: ['B', 'D'], readonly: [{ c: 'F', l: 'Status', t: 'text' }],
    fields: [{ c: 'A', l: 'Document', t: 'text' }, { c: 'B', l: 'Owner', t: 'choice' }, { c: 'C', l: 'Where kept (folder link or place)', t: 'text' }, { c: 'D', l: 'Expiry date', t: 'date' }] },
  { id: 'nominees', group: 'protect', title: 'Nominees', sub: 'Who is nominee on each account and policy', sheet: 'Estate & Contacts', rows: [49, 78],
    label: { c: 'A' }, show: ['D'], readonly: [{ c: 'F', l: 'Status', t: 'text' }],
    fields: [{ c: 'A', l: 'Account / policy', t: 'text' }, { c: 'B', l: 'Institution', t: 'text' }, { c: 'C', l: 'Owner', t: 'text' }, { c: 'D', l: 'Nominee', t: 'text' }, { c: 'E', l: 'Nominee updated on', t: 'date' }] },
  { id: 'goals', group: 'goals', title: 'Goals', sub: 'Cost, year, money set aside and monthly amount', sheet: 'Goals', rows: [40, 51],
    label: { c: 'A' }, show: ['C', 'D'], readonly: [{ c: 'J', l: 'Future cost (₹)', t: 'money' }, { c: 'L', l: 'Needed per month (₹)', t: 'money' }, { c: 'M', l: 'Progress', t: 'pct' }, { c: 'N', l: 'Status', t: 'text' }],
    fields: [{ c: 'A', l: 'Goal', t: 'text' }, { c: 'B', l: 'Owner', t: 'choice' }, { c: 'C', l: "Today's cost (₹)", t: 'money' }, { c: 'D', l: 'Target year', t: 'year' },
      { c: 'E', l: 'Inflation %', t: 'pct' }, { c: 'F', l: 'Linked assets', t: 'text' }, { c: 'G', l: 'Set aside so far (₹)', t: 'money' }, { c: 'H', l: 'Return on set-aside %', t: 'pct' },
      { c: 'I', l: 'Monthly contribution (₹)', t: 'money' }, { c: 'P', l: 'Forecast?', t: 'choice' }, { c: 'O', l: 'Notes', t: 'text' }] },
  { id: 'settings', group: 'plan', title: 'FIRE assumptions', sub: 'Every planning assumption', sheet: 'Settings', settings: [7, 120] },
  { id: 'expcatnames', group: 'lists', title: 'Extra expense categories', sub: 'Name a spare to start using it as a new category', sheet: 'Expenses', anyCell: true,
    cells: 'NOPQR'.split('').map((c, i) => ({ r: c + '26', l: 'Spare category ' + (i + 1), t: 'text', suffix: ' (₹)' })) },
  { id: 'expcats', group: 'lists', title: 'Expense sub-categories', sub: 'Up to 8 per category', sheet: 'Expense Categories', rows: [6, 21], noAdd: true, onlyFilledLabel: true,
    // the category name is a formula from the Expenses header; read the header itself if Excel has not calculated yet
    labelAlt: (wb, r) => { try { const v = wb.get('Expenses', n2col(3 + r - 6) + '26'); return v ? String(v).replace(/ \(₹\)$/, '') : null; } catch (e) { return null; } },
    label: { c: 'A' }, show: ['C', 'D', 'E'],
    fields: 'CDEFGHIJ'.split('').map((c, i) => ({ c, l: 'Sub-category ' + (i + 1), t: 'text' })) },
  { id: 'paymodes', group: 'lists', title: 'Payment modes', sub: 'Shown when you add a spend', sheet: 'Expense Categories', rows: [6, 15],
    label: { c: 'L' }, show: [], fields: [{ c: 'L', l: 'Payment mode', t: 'text' }] },
  { id: 'inccats', group: 'lists', title: 'Income categories', sub: 'Name, where it goes, and sub-categories', sheet: 'Income Entries', rows: [6, 13],
    label: { c: 'M' }, show: ['N'],
    fields: [{ c: 'M', l: 'Category', t: 'text' }, { c: 'N', l: 'Goes to', t: 'choice' }, ...'OPQR'.split('').map((c, i) => ({ c, l: 'Sub-category ' + (i + 1), t: 'text' }))] },
  { id: 'incaccts', group: 'lists', title: 'Bank accounts for income', sub: 'Accounts income arrives in', sheet: 'Income Entries', rows: [6, 45],
    label: { c: 'T' }, show: [], fields: [{ c: 'T', l: 'Account', t: 'text' }] },
  { id: 'invmap', group: 'lists', title: 'Holding types and classes', sub: 'Each type, its class and where it is recorded', sheet: 'Investment Map', rows: [18, 61],
    label: { c: 'A' }, show: ['B', 'C'], readonly: [{ c: 'E', l: 'Current (₹)', t: 'money' }, { c: 'J', l: 'Status', t: 'text' }],
    fields: [{ c: 'A', l: 'Type', t: 'text' }, { c: 'B', l: 'Class', t: 'choice' }, { c: 'C', l: 'Record it on', t: 'choice' }, { c: 'I', l: 'Notes', t: 'text' }, { c: 'K', l: 'Examples / where to buy', t: 'text' }] },
  { id: 'typerules', group: 'lists', title: 'Grouping by keyword', sub: 'A word in a holding name decides its type', sheet: 'Type Rules', rows: [5, 73],
    label: { c: 'A' }, show: ['B'], fields: [{ c: 'A', l: 'Keyword in name', t: 'text' }, { c: 'B', l: 'Asset type', t: 'choice' }, { c: 'C', l: 'Notes', t: 'text' }] },
  { id: 'typeover', group: 'lists', title: 'Grouping by exact symbol', sub: 'Override the type for one holding', sheet: 'Type Rules', rows: [5, 204],
    label: { c: 'E' }, show: ['F'], fields: [{ c: 'E', l: 'Symbol / fund (exactly as pasted)', t: 'text' }, { c: 'F', l: 'Asset type', t: 'choice' }, { c: 'G', l: 'Notes', t: 'text' }] },
  { id: 'sectors', group: 'lists', title: 'Stock sectors', sub: 'Sector for each direct stock', sheet: 'Sectors', rows: [5, 140],
    label: { c: 'A' }, show: ['B'], fields: [{ c: 'A', l: 'Symbol', t: 'text' }, { c: 'B', l: 'Sector', t: 'choice' }, { c: 'C', l: 'Notes', t: 'text' }] },
  { id: 'sectorlist', group: 'lists', title: 'Sector names', sub: 'The list the sector picker uses', sheet: 'Sectors', rows: [5, 40],
    label: { c: 'E' }, show: [], fields: [{ c: 'E', l: 'Sector', t: 'text' }] },
];

// unit text on the Settings sheet -> field type
// Handover packs (tracker v25+): one sheet per person. The owner edits; the other person sees them view-only.
export const HANDOVER = { review: [168, 207] };
for (const [owner, tag] of [['Aravind', 'A'], ['Madhu', 'M']]) {
  const sheet = 'Handover ' + owner, g = 'ho' + tag, o = { group: g, owner, sheet, back: 'handover' };
  FORMS.push(
    { ...o, id: g + 'accounts', title: 'Accounts & policies', sub: 'Bank accounts, deposits, demat, folios, cards, loans, retirement and insurance', rows: [6, 65],
      label: { c: 'A' }, show: ['B', 'C'],
      fields: [{ c: 'A', l: 'Institution', t: 'text' }, { c: 'B', l: 'Type', t: 'choice' }, { c: 'C', l: 'Account number', t: 'text' }, { c: 'D', l: 'Nominee', t: 'text' },
        { c: 'E', l: 'Branch / contact', t: 'text' }, { c: 'F', l: 'Where documents are kept', t: 'text' }, { c: 'G', l: 'What to do', t: 'text', wide: true }, { c: 'H', l: 'Notes', t: 'text' }] },
    { ...o, id: g + 'contacts', title: 'Contacts', sub: 'CA, insurance advisor, HR, bank manager, lawyer, close family', rows: [69, 108],
      label: { c: 'A' }, show: ['B', 'C'],
      fields: [{ c: 'A', l: 'Name', t: 'text' }, { c: 'B', l: 'Role', t: 'text' }, { c: 'C', l: 'Phone', t: 'phone' }, { c: 'D', l: 'Email', t: 'email' }, { c: 'E', l: 'When to call', t: 'text' }, { c: 'F', l: 'Notes', t: 'text' }] },
    { ...o, id: g + 'digital', title: 'Digital access', sub: 'Apps and logins: how to get access, never the password', rows: [112, 141],
      label: { c: 'A' }, show: ['B'],
      fields: [{ c: 'A', l: 'Service / app', t: 'text' }, { c: 'B', l: 'Used for', t: 'text' }, { c: 'C', l: 'How to get access (never the password)', t: 'text', wide: true }, { c: 'D', l: 'Notes', t: 'text' }] },
    { ...o, id: g + 'steps', title: 'Instructions', sub: 'What to do first, second, third', rows: [145, 164], noAdd: true,
      label: { c: 'A' }, show: ['B'], stepLabel: true,
      fields: [{ c: 'B', l: 'What to do', t: 'text', wide: true }, { c: 'C', l: 'Who to contact', t: 'text' }, { c: 'D', l: 'Documents needed', t: 'text' }] },
    { ...o, id: g + 'review', title: 'Review log', sub: 'Each time the pack was checked', rows: HANDOVER.review, hidden: true,
      label: { c: 'A', t: 'date' }, show: ['C'],
      fields: [{ c: 'A', l: 'Date reviewed', t: 'date' }, { c: 'B', l: 'Reviewed by', t: 'choice' }, { c: 'C', l: 'What changed', t: 'text', wide: true }] });
}

export function unitType(unit, label) {
  const u = String(unit || '').toLowerCase();
  if (u === 'date') return 'date'; if (u === 'month') return 'month'; if (u === 'year') return 'year';
  if (u.startsWith('%') || u === 'pp') return 'pct'; if (u.startsWith('₹')) return 'money';
  if (/yes \/ no/i.test(label || '')) return 'choice';
  return 'num';
}

// Reads every block from the workbook into plain data for the screens (and the snapshot).
export function extractForms(wb) {
  const out = {};
  for (const f of FORMS) {
    if (!wb.hasSheet(f.sheet)) continue;
    let g, inp, fx; try { g = wb.grid(f.sheet); inp = wb.inputRefs(f.sheet); fx = wb.formulaRefs(f.sheet); } catch (e) { continue; }
    const val = ref => { const m = /^([A-Z]+)(\d+)$/.exec(ref); const row = g.get(Number(m[2])); const v = row ? row.get(col2n(m[1])) : undefined; return v === undefined ? null : v; };
    const cell = ref => ({ v: val(ref), in: (f.anyCell ? !fx.has(ref) : inp.has(ref)) || undefined });
    const opts = ref => { try { return wb.dropdownAt(f.sheet, ref); } catch (e) { return null; } };
    const d = { sheet: f.sheet };
    if (f.stamp) d.stamp = { ref: f.stamp, ...cell(f.stamp) };
    if (f.cells) {
      d.cells = {}; d.opts = {};
      for (const c of [...f.cells, ...(f.readonly || [])]) { d.cells[c.r] = cell(c.r); if (c.t === 'choice') d.opts[c.r] = opts(c.r) || []; }
    } else if (f.rows) {
      d.rows = []; d.opts = {};
      const cols = [...f.fields.map(x => x.c), ...(f.readonly || []).map(x => x.c), f.label.c].filter((x, i, a) => a.indexOf(x) === i);
      for (let r = f.rows[0]; r <= f.rows[1]; r++) {
        const row = { r, cells: {} }; let anyInput = false;
        for (const c of cols) { const x = cell(c + r); row.cells[c] = x; if (x.in) anyInput = true; }
        if (!anyInput) continue; // a row with nothing to type is not offered
        if (f.labelAlt && (row.cells[f.label.c].v === null || row.cells[f.label.c].v === '')) row.cells[f.label.c] = { ...row.cells[f.label.c], v: f.labelAlt(wb, r) };
        if (f.onlyFilledLabel && (row.cells[f.label.c].v === null || row.cells[f.label.c].v === '')) continue;
        d.rows.push(row);
      }
      for (const fl of f.fields) if (fl.t === 'choice') { const r0 = d.rows.find(x => x.cells[fl.c] && x.cells[fl.c].in); d.opts[fl.c] = (r0 && opts(fl.c + r0.r)) || []; }
    } else if (f.settings) {
      d.rows = [];
      for (let r = f.settings[0]; r <= f.settings[1]; r++) {
        const lab = val('B' + r); if (!lab) continue;
        const ref = 'C' + r; const x = cell(ref); const isF = fx.has(ref);
        if (!x.in && !isF) continue;
        const unit = val('D' + r) || ''; const t = unitType(unit, lab);
        d.rows.push({ r, group: String(val('A' + r) || 'Other'), label: String(lab), unit: String(unit), t, ref, v: x.v, in: x.in, formula: isF || undefined, opts: t === 'choice' ? (opts(ref) || ['Yes', 'No']) : undefined });
      }
    }
    out[f.id] = d;
  }
  return out;
}

// every cell ref the app can edit, per sheet (used by tests and the coverage check)
export function editableRefs(forms) {
  const by = {};
  const add = (sheet, ref) => { (by[sheet] = by[sheet] || new Set()).add(ref); };
  for (const f of FORMS) {
    const d = forms[f.id]; if (!d || f.anyCell) continue; // anyCell blocks (spare category names) are on purpose outside the yellow cells
    if (d.stamp && d.stamp.in) add(f.sheet, d.stamp.ref);
    if (f.cells) for (const c of f.cells) { if (d.cells[c.r] && d.cells[c.r].in) add(f.sheet, c.r); }
    else if (f.rows) for (const row of d.rows) for (const fl of f.fields) { if (row.cells[fl.c] && row.cells[fl.c].in) add(f.sheet, fl.c + row.r); }
    else if (f.settings) for (const row of d.rows) if (row.in) add(f.sheet, row.ref);
  }
  return by;
}

export const isoOf = v => (typeof v === 'number' ? serialToISO(v) : v ? String(v).slice(0, 10) : '');
export { n2col };
