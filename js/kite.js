// Kite holdings: read what you copy from Kite (phone app or the web holdings table) and write it to the tracker's
// Paste Holdings sheet in the same 3-line layout Kite web gives, so the tracker's own formulas split it by demat account:
//   line 1: "SYMBOL qty"     line 2: "CODE1qty1CODE2qty2..."     line 3: qty | avg | invested | LTP | current | P&L | change
// Pure functions only (no screen code), so they are easy to test.

const num = s => { const t = String(s ?? '').replace(/[,₹\s]/g, '').replace(/^\+/, ''); if (t === '') return null; const n = Number(t); return isFinite(n) ? n : null; };
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

// Kite phone app (any view): blocks that start with "Qty. <q> • Buy avg. <a>", then %, name, P&L, "Invested x", "LTP y"
export function parseMobile(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = []; const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^Qty\.?\s*([\d,.]+)\s*[•·]\s*(?:Buy\s*)?avg\.?\s*([\d,.]+)/i.exec(lines[i]); if (!m) continue;
    const qty = num(m[1]), avg = num(m[2]); let sym = null, invested = null, ltp = null;
    for (let k = i + 1; k < Math.min(lines.length, i + 7); k++) {
      const l = lines[k]; if (/^Qty\.?\s/i.test(l)) break;
      let x;
      if ((x = /^Invested\s+([\d,.]+)/i.exec(l))) invested = num(x[1]);
      else if ((x = /^LTP\s+([\d,.]+)/i.exec(l))) ltp = num(x[1]);
      else if (!sym && !/^[+\-−]?[\d,.]+%?$/.test(l.replace(/[+\-−]/, '')) && !/^[+\-−][\d,.]+%?$/.test(l)) sym = l;
    }
    if (!sym || qty === null || avg === null || ltp === null) { bad.push(lines[i]); continue; }
    const inv = invested !== null ? invested : qty * avg;
    out.push({ sym, qty, avg, invested: inv, ltp, check: Math.abs(inv - qty * avg) <= Math.max(1, inv * 0.005) });
  }
  return { holdings: out, bad };
}

// Kite web holdings table, copied as it is: 3 lines per holding (works with tabs or several spaces between values)
export function parseWeb(text, codes) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  const out = []; const bad = []; const unknown = [];
  const isVals = l => { const p = l.trim().split(/\t|\s{2,}|\s/).filter(Boolean); return p.length >= 6 && p.slice(0, 6).every(x => num(x.replace(/%$/, '')) !== null) ? p : null; };
  for (let i = 0; i + 2 < lines.length; i++) {
    const v = isVals(lines[i + 2]); const c = lines[i + 1].trim();
    if (!v || !/^[A-Z0-9]/i.test(c) || isVals(lines[i]) || isVals(lines[i + 1])) continue;
    const head = lines[i].trim(); const sym = head.replace(/\s+[\d,.]+$/, '');
    const split = splitCodes(c, codes);
    if (!split) { if (/^[A-Z]{2,}[A-Z0-9]*\d/i.test(c)) { unknown.push(sym); i += 2; } continue; }
    const tq = num(v[0]), got = Object.values(split).reduce((t, q) => t + (q || 0), 0);
    if (tq !== null && Math.abs(got - tq) > 1e-6) unknown.push(sym); // part of it sits in an account not in your list
    out.push({ sym, codes: split, qty: tq, avg: num(v[1]), invested: num(v[2]), ltp: num(v[3]) });
    i += 2;
  }
  return { holdings: out, bad, unknown };
}
// "AB123420CD56785" -> {AB1234: 20, CD5678: 5}, using the known account codes (example codes)
export function splitCodes(line, codes) {
  const res = {}; let found = false;
  for (const code of codes || []) {
    if (!code) continue; const at = line.toUpperCase().indexOf(String(code).toUpperCase()); if (at < 0) continue;
    const m = /^([\d.,]+)/.exec(line.slice(at + code.length)); if (!m) continue;
    res[code] = num(m[1]); found = true;
  }
  return found ? res : null;
}

// The tracker's paste area (rows of cells A..G) back into per-account holdings, so accounts you do not paste again keep theirs.
export function readArea(rows, codes) {
  const acc = {}; for (const c of codes) acc[c] = [];
  for (let i = 0; i + 2 < rows.length; i++) {
    const [a1] = rows[i], [a2] = rows[i + 1], v = rows[i + 2];
    if (typeof a1 !== 'string' || a2 === null || a2 === undefined || typeof v[0] !== 'number' || typeof v[1] !== 'number') continue;
    const split = splitCodes(String(a2), codes); if (!split) continue;
    const sym = a1.trim().replace(/\s+[\d,.]+$/, '');
    for (const [code, q] of Object.entries(split)) if (q) acc[code].push({ sym, qty: q, avg: v[1], ltp: typeof v[3] === 'number' ? v[3] : v[1] });
    i += 2;
  }
  return acc;
}

// Per-account holdings -> 3-line rows in Kite web's layout (one block per symbol, all accounts on the code line)
export function toRows(byAccount) {
  const sym = new Map();
  for (const [code, list] of Object.entries(byAccount)) for (const x of list || []) {
    if (!x || !x.sym || !(x.qty > 0)) continue;
    const g = sym.get(x.sym) || { sym: x.sym, parts: [], qty: 0, cost: 0, ltp: x.ltp }; sym.set(x.sym, g);
    g.parts.push([code, x.qty]); g.qty += x.qty; g.cost += x.qty * x.avg; if (x.ltp) g.ltp = x.ltp;
  }
  const rows = [];
  for (const g of [...sym.values()].sort((a, b) => a.sym.localeCompare(b.sym))) {
    const q = round(g.qty, 4), avg = round(g.cost / g.qty, 4), inv = round(g.cost, 2), cur = round(g.qty * g.ltp, 2);
    rows.push([g.sym + ' ' + q, null, null, null, null, null, null]);
    rows.push([g.parts.map(([c, n]) => c + round(n, 4)).join(''), null, null, null, null, null, null]);
    rows.push([q, avg, inv, g.ltp, cur, round(cur - inv, 2), inv ? round((cur - inv) / inv, 4) : 0]);
  }
  return rows;
}

// Which existing accounts a new paste replaces: the phone app's family view stands for all of that person's accounts.
export function replaces(slot, slots) {
  const me = slots.find(s => s.code === slot); if (!me) return [slot];
  const isApp = /^APP/i.test(slot);
  return slots.filter(s => s.owner === me.owner && (s.code === slot || (isApp ? !/^APP/i.test(s.code) : /^APP/i.test(s.code)))).map(s => s.code);
}

// ---- Tracker v25+: Paste Holdings keeps one tidy row per stock per demat account (A13:E): code, symbol, qty, avg, price
export const TIDY = { start: 13, rows: 1000, cols: 'ABCDE' };
export function isTidy(headerA12) { return /^account code/i.test(String(headerA12 || '').trim()); }
export function readTidy(rows, codes) {
  const acc = {}; for (const c of codes) acc[c] = [];
  for (const r of rows) {
    const [code, sym, qty, avg, price] = r || []; if (!code || !sym || typeof qty !== 'number') continue;
    (acc[String(code)] = acc[String(code)] || []).push({ sym: String(sym).trim(), qty, avg: typeof avg === 'number' ? avg : 0, ltp: typeof price === 'number' ? price : (typeof avg === 'number' ? avg : 0) });
  }
  return acc;
}
// Per-account holdings -> tidy rows, accounts in the order of the slots, symbols A to Z inside an account
export function toTidy(byAccount, codes) {
  const order = new Map((codes || []).map((c, i) => [c, i])); const rows = [];
  const accts = Object.keys(byAccount).sort((a, b) => (order.has(a) ? order.get(a) : 99) - (order.has(b) ? order.get(b) : 99) || a.localeCompare(b));
  for (const code of accts) for (const x of [...(byAccount[code] || [])].filter(x => x && x.sym && x.qty > 0).sort((a, b) => a.sym.localeCompare(b.sym)))
    rows.push([code, x.sym, round(x.qty, 4), round(x.avg || 0, 4), round(x.ltp || x.avg || 0, 4)]);
  return rows;
}
