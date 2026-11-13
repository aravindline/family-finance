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

// One account copied as a table (Aravind, 11 Nov 2026):
//  Kite web › Holdings: header "Instrument | Qty. | Avg. cost | LTP | Invested | Cur. val | P&L | Net chg. | Day chg.", one line per holding
//  Console › Portfolio › Holdings: header "Symbol | Qty. | Buy avg. | Buy value | LTP | Present value | P&L | P&L chg.", then per holding a
//  "SYMBOL n" line and a line of values that starts with the quantity. The quantity is always taken from the Qty. column.
// Values may be split by tabs or spaces. Symbols may hold "&" or "-".
const NUMTOK = x => num(String(x).replace(/%$/, '')) !== null;
const COLS = { qty: /^qty/i, avg: /avg/i, ltp: /^ltp/i, invested: /^(invested|buy value)/i, current: /^(cur\.? ?val|present value)/i };
function headerMap(line) {
  const cells = line.split(/\t|\s{2,}|\s*\|\s*/).map(x => x.trim()).filter(Boolean);
  if (!cells.some(c => COLS.qty.test(c)) || !cells.some(c => COLS.avg.test(c))) return null;
  const at = {}; cells.forEach((c, i) => { for (const [k, re] of Object.entries(COLS)) if (at[k] === undefined && re.test(c)) at[k] = i; });
  return { at, first: cells[0] };
}
export function parseTable(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  const out = []; const bad = []; let hdr = null; let prevName = null;
  for (const raw of lines) {
    const l = raw.trim();
    const hm = headerMap(l); if (hm) { hdr = hm; prevName = null; continue; }
    const toks = l.split(/\t|\s+/).filter(Boolean);
    const firstNum = toks.findIndex(NUMTOK);
    if (firstNum < 0 || toks.slice(firstNum).filter(NUMTOK).length < 5) { prevName = l; continue; }
    let sym, vals;
    if (firstNum === 0) { // Console: values line, the symbol is on the line above ("SYMBOL n": the number there is ignored)
      if (!prevName) { bad.push(l); continue; }
      sym = prevName.replace(/\s+[\d,.]+$/, '').trim(); vals = toks.map(x => num(String(x).replace(/%$/, '')));
      const at = hdr && !/^instrument/i.test(hdr.first) ? Object.fromEntries(Object.entries(hdr.at).map(([k, i]) => [k, i - 1])) : { qty: 0, avg: 1, invested: 2, ltp: 3, current: 4 };
      const x = mk(sym, vals, at); x ? out.push(x) : bad.push(l);
    } else { // Kite web: one line per holding, the symbol first
      const parts = l.includes('\t') ? l.split('\t').map(x => x.trim()) : null;
      sym = parts ? parts[0] : toks.slice(0, firstNum).join(' ');
      vals = parts ? parts.slice(1).map(x => num(String(x).replace(/%$/, ''))) : toks.slice(firstNum).map(x => num(String(x).replace(/%$/, '')));
      const at = hdr && /^instrument/i.test(hdr.first) ? Object.fromEntries(Object.entries(hdr.at).map(([k, i]) => [k, i - 1])) : { qty: 0, avg: 1, ltp: 2, invested: 3, current: 4 };
      const x = mk(sym, vals, at); x ? out.push(x) : bad.push(l);
    }
    prevName = null;
  }
  return { holdings: out, bad };
}
function mk(sym, v, at) {
  const qty = v[at.qty], avg = v[at.avg], ltp = v[at.ltp]; if (!sym || !(qty > 0) || avg === null || avg === undefined || ltp === null || ltp === undefined) return null;
  const inv = v[at.invested] ?? qty * avg;
  return { sym: sym.replace(/\s*[·•*]\s*$/, ''), qty, avg, invested: inv, ltp, check: Math.abs(inv - qty * avg) <= Math.max(1, inv * 0.005) };
}
// One account, whatever it was copied from: the Kite phone app, Kite web or Console
export function parseOneAccount(text) { const m = parseMobile(text); if (m.holdings.length) return m; const t = parseTable(text); return t.holdings.length ? t : { holdings: [], bad: m.bad.concat(t.bad) }; }

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
