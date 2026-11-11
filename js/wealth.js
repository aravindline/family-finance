// Wealth worked out in the app from what was typed and pasted (tracker v29), so Home and the Month-end update are right
// straight after a sync, before Excel recalculates. Per person (Aravind, Madhu): value by asset class, buy cost by bucket,
// bank + cash + FD / RD, and the Growth / Safety / Gold mix. Parents' accounts count as Aravind's (set on the Kite accounts).
export const PEOPLE = ['Aravind', 'Madhu'];
export const CLASSES = ['Equity', 'International equity', 'Gold & silver', 'Debt', 'REITs & InvITs', 'Retirement', 'Cash & deposits', 'Other'];
export const BUCKETS = [['ind', 'Indian equity'], ['eqf', 'Equity funds'], ['debt', 'Debt & arbitrage funds'], ['bonds', 'Bonds'], ['gold', 'Gold'], ['intl', 'International']];
// Mix (Aravind, 11 Nov 2026): Growth = equity, international equity, REITs; Safety = debt, cash & deposits, EPF / PPF / NPS;
// Gold = gold & silver. Vehicles, land and other assets, money lent and anything linked to the emergency fund are left out.
export const MIX = { Equity: 'Growth', 'International equity': 'Growth', 'REITs & InvITs': 'Growth', Debt: 'Safety', 'Cash & deposits': 'Safety', Retirement: 'Safety', 'Gold & silver': 'Gold' };

const n = v => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);
const isFund = t => /\bMF\b|fund/i.test(t || '');
const isDebtFund = t => /debt|arbitrage|liquid|gilt|money market|overnight/i.test(t || '');
const isBond = t => /bond|govt securit|G-?sec|NCD|corporate bond/i.test(t || '');
const isGold = (t, c) => c === 'Gold & silver' || /gold|silver|SGB/i.test(t || '');
export function bucketOf(type, cls) {
  if (cls === 'International equity') return 'intl';
  if (isGold(type, cls)) return 'gold';
  if (isBond(type)) return 'bonds';
  if (isFund(type)) return isDebtFund(type) ? 'debt' : 'eqf';
  if (cls === 'Equity' || cls === 'REITs & InvITs') return 'ind';
  return null; // deposits, retirement and others are not "invested" buckets
}
const ymNow = () => new Date().toISOString().slice(0, 7);
const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + m2 - m1; };

// same rules as the Deposits sheet: principal until maturity; an RD counts its instalments month by month
export function depositValue(d, today = new Date().toISOString().slice(0, 10)) {
  if (!d || /^(Matured|Closed early|Deleted)$/i.test(d.status || '')) return 0;
  if (d.kind !== 'RD') return n(d.amount);
  if (!d.start || !d.maturity) return 0;
  const all = Math.max(0, monthsBetween(d.start.slice(0, 7), d.maturity.slice(0, 7)));
  const upto = (today < d.maturity ? today : d.maturity).slice(0, 7);
  return n(d.amount) * Math.min(all, Math.max(0, monthsBetween(d.start.slice(0, 7), upto) + 1));
}
export function rdInstalments(d) { return d.start && d.maturity ? Math.max(0, monthsBetween(d.start.slice(0, 7), d.maturity.slice(0, 7))) : 0; }
// suggested amount at maturity: FD = principal + the last interest payout (yearly payout); RD = simple interest on each instalment
export function maturityAmount(d) {
  const a = n(d.amount), r = n(d.rate); if (!a) return null;
  if (d.kind === 'RD') { const k = rdInstalments(d); return Math.round(a * k + a * r * k * (k + 1) / 24); }
  if (!d.start || !d.maturity) return null;
  const s = new Date(d.start + 'T00:00:00Z'), m = new Date(d.maturity + 'T00:00:00Z');
  let yrs = m.getUTCFullYear() - s.getUTCFullYear(); const anniv = y => new Date(Date.UTC(s.getUTCFullYear() + y, s.getUTCMonth(), s.getUTCDate()));
  if (anniv(yrs) > m) yrs--; const rem = Math.round((m - anniv(yrs)) / 86400000);
  return Math.round(a + (rem === 0 ? a * r : a * r * rem / 365));
}
export const yearlyInterest = d => (d.kind === 'RD' ? null : Math.round(n(d.amount) * n(d.rate)));

export function fxRates(s) {
  const out = { INR: 1, '': 1 }; const c = s.forms && s.forms.currencies && s.forms.currencies.cells;
  const usd = s.forms && s.forms.intlset && s.forms.intlset.cells && s.forms.intlset.cells.C7 ? n(s.forms.intlset.cells.C7.v) : 0; out.USD = usd;
  if (c) for (const col of 'KLMNO') { const code = c[col + '5'] && c[col + '5'].v; if (code) out[String(code).trim().toUpperCase()] = n(c[col + '6'] && c[col + '6'].v); }
  return out;
}

// every holding with owner, class, value and buy cost, from the snapshot (Kite rows are already worked out in the app)
export function items(s, opts = {}) {
  const out = []; const cls = s.typeClass || {}; const fx = fxRates(s);
  const add = (src, owner, name, type, c, value, cost, extra) => { if (!PEOPLE.includes(owner)) return; out.push({ src, owner, name, type, cls: c || cls[type] || 'Other', value: n(value), cost: n(cost), ...extra }); };
  for (const x of s.holdings || []) add('kite', x.owner, x.name, x.type, x.cls, x.current, x.invested);
  for (const x of s.otherHoldings || []) { if (x.linked) continue; add('other', x.owner, x.name, x.type, x.cls, x.current, x.invested, { platform: x.platform }); }
  for (const x of s.intl || []) { const rate = fx[String(x.currency || 'USD').toUpperCase()] ?? fx.USD; const live = x.qty && x.price && rate ? x.qty * x.price * rate : x.current; add('intl', x.owner, x.name, 'US stocks', 'International equity', live, x.invested, { broker: x.broker }); }
  const deps = s.deposits || [];
  for (const d of deps) add('deposit', d.whose, d.name, d.kind === 'RD' ? 'Recurring deposit' : d.kind === 'Corporate FD' ? 'Corporate FD' : 'Fixed deposit', d.kind === 'Corporate FD' ? (cls['Corporate FD'] || 'Debt') : 'Cash & deposits', depositValue(d), 0, { id: d.id });
  const fromRegister = /\(from the FD \/ RD list\)/i;
  // Other Assets: typed balances as typed (fresh), worked-out rows (EPF, gold, vehicles, money lent) as Excel last saved them
  const oa = (s.inputs && s.inputs.otherAssets) || [];
  for (const r of oa) {
    const name = String(r.name.v || ''), type = String(r.type.v || ''); if (s.v29 && fromRegister.test(name)) continue; // the register rows above stand for these
    const c = cls[type] || (/savings|current account|cash at home|bank/i.test(type || name) ? 'Cash & deposits' : 'Other'); // a row with no Type is placed by its name
    for (const [p, cell] of [['Aravind', r.aravind], ['Madhu', r.madhu]]) {
      const v = /^EPF/i.test(type) && opts.epf ? opts.epf(p) : n(cell.v); if (v) add('assets', p, name, type, c, v, 0);
    }
  }
  return out;
}
export function byClass(list, person) { const o = Object.fromEntries(CLASSES.map(c => [c, 0])); for (const x of list) if (!person || person === 'Family' || x.owner === person) o[x.cls] = (o[x.cls] || 0) + x.value; return o; }
export function costs(list, person) { const o = Object.fromEntries(BUCKETS.map(([k]) => [k, 0])); for (const x of list) { if (person && person !== 'Family' && x.owner !== person) continue; const b = bucketOf(x.type, x.cls); if (b) o[b] += x.cost || 0; } for (const k of Object.keys(o)) o[k] = Math.round(o[k]); return o; }
export function loansOf(s, person) { return (s.loans || []).reduce((t, l) => t + (person === 'Aravind' ? n(l.aravind) : person === 'Madhu' ? n(l.madhu) : n(l.total)), 0); }
// bank balances + cash at home (typed on Other Assets), and FD / RD from the register
export function bankCash(s, person, override = {}) {
  let t = 0; const rows = (s.inputs && s.inputs.otherAssets) || [];
  for (const r of rows) { const ty = String(r.type.v || r.name.v || ''); if (!/savings|current account|cash at home/i.test(ty)) continue; const c = person === 'Madhu' ? r.madhu : r.aravind; if (c.f) continue; t += n(override[c.ref] !== undefined ? override[c.ref] : c.v); }
  return Math.round(t);
}
export function fdrd(s, person) { return Math.round((s.deposits || []).filter(d => d.whose === person).reduce((t, d) => t + depositValue(d), 0)); }

// emergency fund: holdings linked to the goal "Emergency fund", by owner and name
export const EMERGENCY = 'Emergency fund';
export function emergencyKeys(links) { return new Set((links || []).filter(l => l.goal === EMERGENCY).map(l => l.owner + '|' + l.holding)); }
export function mixOf(list, person, links) {
  const skip = emergencyKeys(links); const o = { Growth: 0, Safety: 0, Gold: 0 }; let left = 0;
  for (const x of list) { if (x.owner !== person) continue; if (skip.has(x.owner + '|' + x.name) || /money lent/i.test(x.type)) continue; const m = MIX[x.cls]; if (m) o[m] += x.value; else left += x.value; }
  const tot = o.Growth + o.Safety + o.Gold; return { ...o, total: tot, leftOut: left, pct: tot ? { Growth: o.Growth / tot, Safety: o.Safety / tot, Gold: o.Gold / tot } : null };
}
export const ym = ymNow;
