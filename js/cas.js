// CDSL CAS (Consolidated Account Statement) reader. Input: the PDF's text as lines (built by views-cas.js with pdf.js).
// Output: demat holdings per account and mutual fund folios. Account and folio numbers are cut to their LAST 4 digits
// here, before anything else sees them; the full numbers are never kept.
const n = s => { const t = String(s ?? '').replace(/,/g, ''); if (!/^-?\d+(\.\d+)?$/.test(t)) return null; return Number(t); };
const last4 = s => { const d = String(s || '').replace(/\D/g, ''); return d ? d.slice(-4) : ''; };
const ISIN = /\b(IN[A-Z0-9]{9}\d)\b/;
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const isoOf = s => { let m = /(\d{2})-(\d{2})-(\d{4})/.exec(s); if (m) return m[3] + '-' + m[2] + '-' + m[1]; m = /(\d{2})-([A-Za-z]{3})-(\d{4})/.exec(s); if (m && MON[m[2].toUpperCase()]) return m[3] + '-' + String(MON[m[2].toUpperCase()]).padStart(2, '0') + '-' + m[1]; return null; };

export function parseCAS(lines) {
  const out = { asOn: null, accounts: [], folios: [], warnings: [] };
  let acct = null, section = null, pendingName = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i].replace(/\s+/g, ' ').trim(); if (!L) continue;
    let m;
    if (!out.asOn && (m = /(?:statement for the period|period)\s.*?to\s+(\d{2}-\d{2}-\d{4}|\d{2}-[A-Za-z]{3}-\d{4})/i.exec(L))) out.asOn = isoOf(m[1]);
    if ((m = /BO\s*ID\s*:?\s*(\d[\d\s]{7,20}\d)/i.exec(L))) {
      const dp = (/DP\s*Name\s*:?\s*(.+?)\s+BO\s*ID/i.exec(L) || [])[1] || '';
      acct = { bo4: last4(m[1]), dp: dp.trim(), holdings: [], value: null }; out.accounts.push(acct); section = 'demat'; pendingName = []; continue;
    }
    if (/MUTUAL FUND UNITS HELD AS ON/i.test(L)) { section = 'mf'; pendingName = []; const d = isoOf(L); if (d) out.asOn = out.asOn || d; continue; }
    if ((m = /Portfolio Value\s*(?:Rs\.?|₹)?\s*([\d,]+\.\d{2})/i.exec(L)) && acct) { acct.value = n(m[1]); continue; }
    if (/^Grand Total/i.test(L)) { section = null; continue; }
    if (section === 'demat' && acct) {
      const im = ISIN.exec(L);
      if (im && L.indexOf(im[1]) === 0) {
        // ISIN | Security ... | Current Bal | Frozen | Pledge | Pledge setup | Free | Price | Value
        const rest = L.slice(im[1].length).trim(); const toks = rest.split(' ');
        const nums = []; while (toks.length && (n(toks[toks.length - 1]) !== null || toks[toks.length - 1] === '--')) nums.unshift(toks.pop());
        if (nums.length >= 3) {
          let name = toks.join(' '); let k = i + 1;
          while (k < lines.length && !ISIN.test(lines[k]) && !/Portfolio Value|^\s*$|Transactions|Holdings|ISIN/i.test(lines[k]) && !/\d/.test(lines[k].trim().slice(-1)) && lines[k].trim().length < 60) { name += ' ' + lines[k].trim(); k++; }
          const value = n(nums[nums.length - 1]), price = n(nums[nums.length - 2]), qty = n(nums[0]);
          if (qty !== null && value !== null) acct.holdings.push({ isin: im[1], name: name.trim(), qty, price, value, kind: im[1].startsWith('INF') ? 'MF in demat' : im[1].startsWith('IN00') ? 'Govt security' : 'Share' });
        }
      }
      continue;
    }
    if (section === 'mf') {
      const im = ISIN.exec(L);
      if (!im) { if (!/^Scheme|^Folio|^ISIN|^Page|^\d+$/i.test(L) && L.length < 90) pendingName.push(L); if (pendingName.length > 3) pendingName.shift(); continue; }
      const before = L.slice(0, L.indexOf(im[1])).trim(); const after = L.slice(L.indexOf(im[1]) + im[1].length).trim().split(' ');
      const folio = after.shift() || ''; if (after[0] && !/^[\d,.]+$/.test(after[0])) after.shift(); // ARN code or "--"
      const nums = after.map(n);
      const units = nums[0], nav = nums[1], invested = nums[2], value = nums[3];
      const name = (before || pendingName.join(' ')).trim(); pendingName = [];
      if (units !== null && units !== undefined && nav !== null && nav !== undefined) out.folios.push({ isin: im[1], name, folio4: last4(folio), units, nav, invested: invested ?? null, value: value ?? (units * nav) });
      else out.warnings.push('Could not read a folio line for ' + im[1]);
    }
  }
  if (!out.accounts.length && !out.folios.length) out.warnings.push('No holdings found. Is this a CDSL CAS (not a printed copy)?');
  return out;
}

// a guess of the asset type from the scheme name; you confirm it before saving
export function guessType(name, types) {
  const s = String(name).toUpperCase(); const has = t => (types || []).includes(t) ? t : null;
  if (/GOLD|SILVER/.test(s)) return has('Gold MF') || has('Gold ETF') || (types || [])[0];
  if (/LIQUID|DEBT|GILT|BOND|CORPORATE|BANKING AND PSU|BANKING & PSU|OVERNIGHT|MONEY MARKET|DURATION|CREDIT|FLOATER|TREASURY/.test(s)) return has('Debt MF') || (types || [])[0];
  if (/ARBITRAGE/.test(s)) return has('Arbitrage MF') || has('Debt MF') || has('Equity MF');
  if (/US |NASDAQ|INTERNATIONAL|GLOBAL|WORLD|S&P 500/.test(s)) return has('International MF') || has('Equity MF');
  return has('Equity MF') || (types || [])[0];
}

// pdf.js text items -> lines (same baseline = same line, left to right)
export function itemsToLines(items) {
  const rows = [];
  for (const it of items) { if (!it.str || !it.str.trim()) continue; const y = Math.round(it.transform[5] / 2) * 2; let r = rows.find(x => Math.abs(x.y - y) <= 2); if (!r) rows.push(r = { y, parts: [] }); r.parts.push([it.transform[4], it.str]); }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => r.parts.sort((a, b) => a[0] - b[0]).map(p => p[1].trim()).join(' '));
}
