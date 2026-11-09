// Indian formats: ₹ with lakh/crore grouping, DD-MMM-YYYY dates, April-March financial year.
const grp = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
// Privacy mode: every rupee amount shows as dots. Percentages and dates stay visible.
let HIDE = false; const DOTS = '₹ ••••';
export function setHidden(b) { HIDE = !!b; }
export function isHidden() { return HIDE; }
export function maskText(s) { return HIDE && s ? String(s).replace(/[−-]?₹\s?[\d,]+(\.\d+)?(\s?(L|Cr|lakh|crore|k)\b)?/gi, DOTS) : s; }
export function inr(n) { if (HIDE && !(n === null || n === undefined || n === '' || isNaN(n))) return DOTS; if (n === null || n === undefined || n === '' || isNaN(n)) return '–'; const v = Math.round(Number(n)); return (v < 0 ? '−₹' : '₹') + grp.format(Math.abs(v)); }
export function inrShort(n) {
  if (n === null || n === undefined || isNaN(n)) return '–';
  if (HIDE) return DOTS;
  const a = Math.abs(n), s = n < 0 ? '−₹' : '₹';
  if (a >= 1e7) return s + (a / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return s + (a / 1e5).toFixed(2) + ' L';
  return s + grp.format(Math.round(a));
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function date(d) { if (!d) return '–'; const x = d instanceof Date ? d : new Date(d); if (isNaN(x)) return '–'; return String(x.getDate()).padStart(2, '0') + '-' + MON[x.getMonth()] + '-' + x.getFullYear(); }
export function dateTime(d) { if (!d) return 'never'; const x = new Date(d); return date(x) + ' ' + String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); }
export function fy(d) { const x = d instanceof Date ? d : new Date(d); const y = x.getMonth() < 3 ? x.getFullYear() - 1 : x.getFullYear(); return 'FY ' + y + '-' + String(y + 1).slice(2); }
export function pct(n, dp = 1) { return isNaN(n) ? '–' : (n * 100).toFixed(dp) + '%'; }
export function ago(d) {
  if (!d) return 'never'; const ms = Date.now() - new Date(d).getTime(); if (isNaN(ms)) return '–';
  if (ms < 60000) return 'just now'; if (ms < 3600000) return Math.floor(ms / 60000) + ' min ago';
  if (ms < 86400000) return Math.floor(ms / 3600000) + ' h ago'; return date(d);
}
export const MONTHS = MON;
export function monthLabel(iso, long = false) { if (!iso) return '–'; const [y, m] = String(iso).split('-').map(Number); return MON[m - 1] + (long ? ' ' + y : '-' + String(y).slice(2)); }
export function signed(n, f = inrShort) { if (n === null || n === undefined || isNaN(n)) return '–'; return (n > 0 ? '+' : '') + f(n).replace('−', '−'); }
export function pp(n) { return n === null || n === undefined || isNaN(n) ? '–' : (n > 0 ? '+' : '') + (n * 100).toFixed(1) + ' pp'; }
export function years(n) { if (n === null || n === undefined || isNaN(n)) return '–'; const y = Math.floor(n), m = Math.round((n - y) * 12); return y + ' y' + (m ? ' ' + m + ' m' : ''); }
