// CDSL CAS upload. The PDF is read on this phone with pdf.js; the password is used once to open it and is never stored
// or sent. Only mutual fund folios (units, NAV, amount invested, last 4 digits of the folio) go to the tracker.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, seg, tag, card, empty } from './ui.js';
import { parseCAS, guessType, itemsToLines } from './cas.js';
import { slotsOf, slotLabel } from './views-kite.js';
import { isoToSerial, serialToISO } from './xlsx.js';

const C = { owner: null, result: null, types: {}, skip: {}, busy: false };
const isoToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

async function readPdf(file, password) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, password, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) { const page = await doc.getPage(p); const tc = await page.getTextContent(); lines.push(...itemsToLines(tc.items)); }
  await doc.destroy();
  return lines;
}

export function viewCas() {
  const s = ctx.snap() || {};
  if (!C.owner) C.owner = ctx.who() || 'Aravind';
  const file = h('input', { type: 'file', id: 'casfile', accept: 'application/pdf,.pdf', class: 'field', style: { padding: '8px' }, 'aria-label': 'CAS PDF' });
  const pw = h('input', { type: 'password', id: 'caspw', class: 'field', autocomplete: 'off', 'aria-label': 'PDF password', placeholder: 'PDF password (used once, never saved)' });
  const read = async () => {
    const f = file.files && file.files[0]; if (!f) return toast('Choose the CAS PDF first', 'bad');
    const pass = pw.value; pw.value = ''; // the password leaves the screen straight away
    C.busy = true; const btn = document.getElementById('casread'); if (btn) { btn.disabled = true; btn.textContent = 'Reading…'; }
    try { const lines = await readPdf(f, pass); C.result = parseCAS(lines); C.types = {}; C.skip = {}; }
    catch (e) { C.result = null; toast(e && e.name === 'PasswordException' ? 'That password did not open the PDF. Try again.' : 'Could not read this PDF: ' + (e && e.message ? e.message : e), 'bad'); }
    finally { C.busy = false; file.value = ''; ctx.render(); }
  };
  const body = [h('h2', { class: 'formhead' }, 'CDSL CAS statement'),
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, 'Use the PDF CDSL emails you each month (not a printed copy). It is read on this phone. Mutual fund folios outside demat go to Other Holdings; demat accounts are compared with your Kite paste.'),
    card(null, null, h('div', { class: 'fstack' },
      h('div', { class: 'fblock' }, h('span', { class: 'flabel' }, 'Whose statement is this?'), seg(['Aravind', 'Madhu'], C.owner, v => { C.owner = v; ctx.render(); }, 'Whose CAS'), h('span', { class: 'fsub' }, "Parents' accounts count as Aravind's.")),
      h('div', { class: 'fblock' }, h('span', { class: 'flabel' }, 'CAS PDF'), file),
      h('div', { class: 'fblock' }, h('span', { class: 'flabel' }, 'Password'), pw),
      h('div', { class: 'btns' }, h('button', { class: 'btn', id: 'casread', onclick: read }, 'Read the statement'))))];
  if (C.result) body.push(...resultCards(s));
  return { title: 'CAS', back: 'tracker', body };
}

function resultCards(s) {
  const r = C.result; const out = [];
  const slots = slotsOf(s); const map = (ctx.settings().casMap || {});
  const kiteValue = code => (s.holdings || []).filter(x => x.account === code).reduce((t, x) => t + (x.current || 0), 0);
  const kiteCount = code => (s.holdings || []).filter(x => x.account === code).length;
  if (r.warnings.length) out.push(card('Notes', null, h('ul', { class: 'list' }, r.warnings.map(w => h('li', { class: 'li' }, h('div', { class: 'body' }, h('div', { class: 'sub' }, w)))))));
  if (r.accounts.length) out.push(card('Demat accounts (as on ' + (r.asOn ? F.date(r.asOn) : '–') + ')', null, h('div', { id: 'casdemat' }, r.accounts.map(a => {
    const code = map[a.bo4]; const kv = code ? kiteValue(code) : null; const casV = a.value ?? a.holdings.reduce((t, x) => t + (x.value || 0), 0);
    const diff = kv !== null ? casV - kv : null;
    return h('div', { class: 'casacct', style: { padding: '10px 0', borderTop: '1px solid var(--line)' } },
      h('div', { class: 'row-between' }, h('strong', {}, (a.dp || 'Demat') + ' ••' + a.bo4), h('span', { class: 'num' }, F.inr(casV))),
      h('div', { class: 'sub hint' }, a.holdings.length + ' holdings in the CAS' + (code ? ' · Kite ' + code + ': ' + kiteCount(code) + ' holdings, ' + F.inr(kv) + (diff !== null ? ' (difference ' + F.signed(diff, F.inr) + ')' : '') : '')),
      h('div', { class: 'fblock', style: { marginTop: '6px' } }, h('span', { class: 'fsub' }, 'Same account in Kite:'),
        h('div', { class: 'chips', 'aria-label': 'Kite account for ••' + a.bo4 }, slots.filter(x => !/^APP/i.test(x.code)).map(x => h('button', { type: 'button', class: 'chip' + (code === x.code ? ' on' : ''), onclick: async () => { await ctx.saveSettings({ casMap: Object.assign({}, map, { [a.bo4]: x.code }) }); ctx.render(); } }, slotLabel(x))))),
      code && kiteCount(code) !== a.holdings.length ? h('p', { class: 'hint', style: { color: 'var(--warn, inherit)' } }, 'The number of holdings differs. Check for a sold, bought or transferred share.') : null);
  })), h('p', { class: 'hint', style: { marginTop: '8px' } }, 'CAS prices are month-end prices, so small value differences are normal. Kite does not show ISIN codes, so holdings are compared by count and value, not one by one.')));
  const types = (s.forms && s.forms.otherhold && s.forms.otherhold.opts && s.forms.otherhold.opts.D) || [];
  if (r.folios.length) {
    out.push(card('Mutual fund folios (' + r.folios.length + ')', null, h('ul', { class: 'list', id: 'casfolios' }, r.folios.map((f, i) => {
      if (!C.types[i]) C.types[i] = guessType(f.name, types);
      return h('li', { class: 'li wrap' }, h('div', { class: 'body' },
        h('div', { class: 'row-between' }, h('div', { class: 'ttl' }, f.name), h('label', { class: 'hint' }, h('input', { type: 'checkbox', checked: !C.skip[i], onchange: e => { C.skip[i] = !e.target.checked; } }), ' add')),
        h('div', { class: 'sub' }, 'Folio ••' + f.folio4 + ' · ' + f.units + ' units · NAV ' + f.nav + (f.invested ? ' · invested ' + F.inr(f.invested) : '') + ' · ' + F.inr(f.value)),
        h('select', { class: 'field', 'aria-label': 'Asset type for ' + f.name, style: { marginTop: '6px', width: 'auto' }, onchange: e => { C.types[i] = e.target.value; } }, types.map(t => h('option', { value: t, selected: t === C.types[i] }, t)))));
    })),
    h('div', { class: 'sticky-save' }, h('button', { class: 'btn primary', style: { flex: 1 }, id: 'cassave', onclick: () => saveFolios(s) }, 'Save folios to Other Holdings'))));
  }
  return out;
}

async function saveFolios(s) {
  const r = C.result; const d = s.forms && s.forms.otherhold; if (!d) return toast('Your tracker has no Other Holdings sheet', 'bad');
  const pend = new Map(); for (const op of ctx.V.all('outbox').filter(o => o.kind === 'setCells' && o.sheet === 'Other Holdings')) for (const c of op.cells) pend.set(c.ref, c.value);
  const val = (row, c) => (pend.has(c + row.r) ? pend.get(c + row.r) : (row.cells[c] || {}).v);
  const blank = v => v === null || v === undefined || v === '';
  const used = new Set(); const cells = [];
  const asOn = r.asOn || isoToday(); const asOnS = isoToSerial(asOn);
  const put = (row, c, value, label) => { if (!(row.cells[c] || {}).in) return; const cur = val(row, c); if (String(cur ?? '') === String(value ?? '')) return; cells.push({ ref: c + row.r, base: (row.cells[c] || {}).v, value, label }); };
  let added = 0, updated = 0;
  for (const [i, f] of r.folios.entries()) {
    if (C.skip[i]) continue;
    const note = 'Folio ••' + f.folio4 + ' · CAS ' + F.date(asOn);
    let row = d.rows.find(x => !used.has(x.r) && val(x, 'B') === 'CDSL CAS' && val(x, 'A') === C.owner && val(x, 'C') === f.name);
    if (row) updated++; else { row = d.rows.find(x => !used.has(x.r) && (x.cells.C || {}).in && ['A', 'B', 'C', 'G', 'K'].every(c => blank(val(x, c)))); if (!row) return toast('Other Holdings is full. Clear a row you no longer need first.', 'bad'); added++; }
    used.add(row.r);
    put(row, 'A', C.owner, 'Owner'); put(row, 'B', 'CDSL CAS', 'Platform'); put(row, 'C', f.name, 'Holding name'); put(row, 'D', C.types[i] || '', 'Asset type'); put(row, 'F', 'INR', 'Currency');
    put(row, 'G', f.units, 'Units'); put(row, 'H', f.invested && f.units ? Math.round(f.invested / f.units * 10000) / 10000 : '', 'Avg cost / unit'); put(row, 'I', f.nav, 'Price / unit'); put(row, 'J', f.invested || '', 'Invested ₹'); put(row, 'K', '', 'Value ₹'); put(row, 'Q', note, 'Notes');
  }
  const cd = s.forms.casdate || s.forms.fx; if (cd && cd.cells && cd.cells.B10 && cd.cells.B10.in) cells.push({ ref: 'B10', base: cd.cells.B10.v, value: asOnS, label: 'CAS imported (as on)' });
  if (d.stamp && d.stamp.in) cells.push({ ref: 'B9', base: d.stamp.v, value: isoToSerial(isoToday()), label: 'Last updated' });
  if (!cells.length) return toast('Nothing new to save');
  await ctx.queue({ kind: 'setCells', sheet: 'Other Holdings', cells, title: 'CAS · ' + C.owner + ' · ' + added + ' new, ' + updated + ' updated folios' });
  C.result = null; toast('Saved ' + (added + updated) + ' folios. They reach the tracker on the next sync.', 'good'); ctx.render();
}
