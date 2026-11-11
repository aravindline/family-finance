// CDSL CAS upload. The PDF is read on this phone with pdf.js; the password is used once to open it and is never stored
// or sent. Only mutual fund folios (units, NAV, amount invested, last 4 digits of the folio) go to the tracker.
import { ctx } from './ctx.js';
import * as F from './fmt.js';
import { h, toast, seg, tag, card } from './ui.js';
import { parseCAS, guessType, itemsToLines } from './cas.js';
import { slotsOf, slotLabel } from './views-kite.js';
import { isoToSerial } from './xlsx.js';

const C = { owner: null, result: null, types: {}, skip: {}, cost: {}, busy: false, file: null, error: '', saved: null };
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
  const file = h('input', { type: 'file', id: 'casfile', accept: 'application/pdf,.pdf', class: 'field', style: { padding: '8px' }, 'aria-label': 'CAS PDF', onchange: e => { C.file = (e.target.files && e.target.files[0]) || C.file; C.error = ''; ctx.render(); } });
  const pw = h('input', { type: 'password', id: 'caspw', class: 'field', autocomplete: 'off', 'aria-label': 'PDF password', placeholder: 'PDF password (used once, never saved)' });
  const read = async () => {
    const f = (file.files && file.files[0]) || C.file; if (!f) { C.error = 'Choose the CAS PDF first.'; return ctx.render(); }
    C.file = f; const pass = pw.value; pw.value = ''; // the password leaves the screen straight away
    C.busy = true; C.error = ''; C.saved = null; const btn = document.getElementById('casread'); if (btn) { btn.disabled = true; btn.textContent = 'Reading…'; }
    try { const lines = await readPdf(f, pass); C.result = parseCAS(lines); C.types = {}; C.skip = {}; C.cost = {}; if (!C.result.accounts.length && !C.result.folios.length) C.error = C.result.warnings[0] || 'No holdings found in this PDF.'; }
    catch (e) { C.result = null; C.error = e && e.name === 'PasswordException' ? 'That password did not open the PDF. Type it again (the file is still chosen).' : 'Could not read this PDF: ' + (e && e.message ? e.message : e); }
    finally { C.busy = false; ctx.render(); }
  };
  const body = [h('h2', { class: 'formhead' }, 'CDSL CAS statement'),
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, 'Use the PDF CDSL emails you each month (not a printed copy). It is read on this phone. Mutual funds (in folios and in demat) go to Mutual funds; shares in demat are only compared with your Kite paste, never added twice.'),
    card(null, null, h('div', { class: 'fstack' },
      h('div', { class: 'fblock' }, h('span', { class: 'flabel' }, 'Whose statement is this?'), seg(['Aravind', 'Madhu'], C.owner, v => { C.owner = v; ctx.render(); }, 'Whose CAS'), h('span', { class: 'fsub' }, "Parents' accounts count as Aravind's.")),
      h('div', { class: 'fblock' }, h('span', { class: 'flabel' }, 'CAS PDF'), file, C.file ? h('span', { class: 'fsub', id: 'casfilename' }, 'Chosen: ' + C.file.name) : null),
      h('div', { class: 'fblock' }, h('span', { class: 'flabel' }, 'Password'), pw),
      C.error ? h('p', { id: 'caserror', role: 'alert', style: { color: 'var(--critical)', fontWeight: 600 } }, C.error) : null,
      h('div', { class: 'btns' }, h('button', { class: 'btn', id: 'casread', onclick: read }, 'Read the statement'))))];
  if (C.saved) body.push(savedCard());
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
  const list = funds(s);
  if (list.length) {
    out.push(card('Mutual funds (' + list.length + ')', null, h('ul', { class: 'list', id: 'casfolios' }, list.map(f => {
      const i = f.key; if (!C.types[i]) C.types[i] = guessType(f.name, types); if (C.skip[i] === undefined) C.skip[i] = !f.addByDefault;
      return h('li', { class: 'li wrap' }, h('div', { class: 'body' },
        h('div', { class: 'row-between' }, h('div', { class: 'ttl' }, f.name), h('label', { class: 'hint' }, h('input', { type: 'checkbox', checked: !C.skip[i], onchange: e => { C.skip[i] = !e.target.checked; } }), ' add')),
        h('div', { class: 'sub' }, f.where + ' · ' + f.units + ' units · NAV ' + f.nav + (f.invested ? ' · invested ' + F.inr(f.invested) : '') + ' · ' + F.inr(f.value)),
        f.note ? h('div', { class: 'sub hint' }, f.note) : null,
        h('div', { class: 'row-between', style: { gap: '8px', marginTop: '6px', flexWrap: 'wrap' } },
          h('select', { class: 'field', 'aria-label': 'Asset type for ' + f.name, style: { width: 'auto' }, onchange: e => { C.types[i] = e.target.value; ctx.render(); } }, types.map(t => h('option', { value: t, selected: t === C.types[i] }, t))),
          f.kind === 'demat' ? h('input', { class: 'field', inputmode: 'decimal', style: { width: '9em' }, 'aria-label': 'Buy cost for ' + f.name, placeholder: 'Buy cost ₹ (optional)', value: C.cost[i] ?? '', oninput: e => { C.cost[i] = e.target.value; } }) : null),
        h('div', { class: 'sub hint' }, 'Goes to Mutual funds · counts as ' + classOf(s, C.types[i]))));
    })),
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Funds held in demat have no buy cost in the CAS: type it if you want returns to show. A fund already in your Kite paste is left unticked so it is not counted twice.'),
    h('div', { class: 'sticky-save' }, h('button', { class: 'btn primary', style: { flex: 1 }, id: 'cassave', onclick: () => saveFunds(s) }, 'Save to the tracker'))));
  }
  return out;
}

// every mutual fund the CAS shows: folios outside demat, and funds held in a demat account (ISIN starting INF, not ETFs)
function funds(s) {
  const r = C.result; const map = ctx.settings().casMap || {};
  const list = r.folios.map((f, k) => ({ key: 'f' + k, kind: 'folio', name: f.name, where: 'Folio ••' + f.folio4, tag: 'Folio ••' + f.folio4, units: f.units, nav: f.nav, invested: f.invested, value: f.value, addByDefault: true }));
  r.accounts.forEach((a, ai) => a.holdings.forEach((x, k) => {
    if (x.kind !== 'MF in demat' || /\bETF\b|BEES/i.test(x.name)) return;
    const code = map[a.bo4]; const kite = code ? (s.holdings || []).filter(y => y.account === code) : [];
    const words = x.name.toUpperCase().split(/[^A-Z]+/).filter(w => w.length > 3 && !/FUND|PLAN|GROWTH|DIRECT|OPTION|REGULAR/.test(w)).slice(0, 2);
    const inKite = words.length && kite.some(y => words.every(w => String(y.name).toUpperCase().includes(w)));
    list.push({ key: 'd' + ai + '-' + k, kind: 'demat', name: x.name, where: 'In demat ••' + a.bo4, tag: 'Demat ••' + a.bo4, units: x.qty, nav: x.price, invested: null, value: x.value, addByDefault: !inKite,
      note: inKite ? 'Looks already in your Kite paste for ' + code + ', so it is not ticked.' : null });
  }));
  return list;
}
function classOf(s, type) {
  const d = s.forms && s.forms.invmap; const row = d && d.rows.find(x => String((x.cells.A || {}).v || '') === type);
  return row && row.cells.B && row.cells.B.v ? String(row.cells.B.v) : 'its class from Holding types';
}
function savedCard() {
  const x = C.saved;
  return card('Saved: ' + x.items.length + ' fund' + (x.items.length === 1 ? '' : 's') + ' for ' + x.owner, null,
    h('ul', { class: 'list', id: 'cassaved' }, x.items.map(f => h('li', { class: 'li' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, f.name), h('div', { class: 'sub' }, (f.isNew ? 'Added' : 'Updated') + ' · ' + f.where + ' · ' + F.inr(f.value) + ' · Mutual funds, counts as ' + f.cls))))),
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Where: More › Mutual funds › Holdings outside demat (the Other Holdings sheet), one row per fund. They reach the tracker on the next sync and show in Wealth after that. Shares in demat were only compared with Kite, not added.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { C.saved = null; ctx.render(); } }, 'Done')));
}

async function saveFunds(s) {
  const r = C.result; const d = s.forms && s.forms.otherhold; if (!d) return toast('Your tracker has no Other Holdings sheet', 'bad');
  const pend = new Map(); for (const op of ctx.V.all('outbox').filter(o => o.kind === 'setCells' && o.sheet === 'Other Holdings')) for (const c of op.cells) pend.set(c.ref, c.value);
  const val = (row, c) => (pend.has(c + row.r) ? pend.get(c + row.r) : (row.cells[c] || {}).v);
  const blank = v => v === null || v === undefined || v === '';
  const used = new Set(); const cells = []; const items = [];
  const asOn = r.asOn || isoToday(); const asOnS = isoToSerial(asOn);
  const put = (row, c, value, label) => { if (!(row.cells[c] || {}).in) return; const cur = val(row, c); if (String(cur ?? '') === String(value ?? '')) return; cells.push({ ref: c + row.r, base: (row.cells[c] || {}).v, value, label }); };
  for (const f of funds(s)) {
    const i = f.key; if (C.skip[i]) continue;
    const note = f.tag + ' · CAS ' + F.date(asOn);
    const cost = f.kind === 'demat' ? Number(String(C.cost[i] || '').replace(/[,₹\s]/g, '')) || null : f.invested;
    let row = d.rows.find(x => !used.has(x.r) && val(x, 'B') === 'CDSL CAS' && val(x, 'A') === C.owner && val(x, 'C') === f.name); const isNew = !row;
    if (!row) { row = d.rows.find(x => !used.has(x.r) && (x.cells.C || {}).in && ['A', 'B', 'C', 'G', 'K'].every(c => blank(val(x, c)))); if (!row) return toast('Other Holdings is full. Clear a row you no longer need first.', 'bad'); }
    used.add(row.r);
    put(row, 'A', C.owner, 'Owner'); put(row, 'B', 'CDSL CAS', 'Platform'); put(row, 'C', f.name, 'Holding name'); put(row, 'D', C.types[i] || '', 'Asset type'); put(row, 'F', 'INR', 'Currency');
    put(row, 'G', f.units, 'Units'); put(row, 'H', cost && f.units ? Math.round(cost / f.units * 10000) / 10000 : '', 'Avg cost / unit'); put(row, 'I', f.nav, 'Price / unit'); put(row, 'J', cost || '', 'Invested ₹'); put(row, 'K', '', 'Value ₹'); put(row, 'Q', note, 'Notes');
    items.push({ name: f.name, where: f.where, value: f.value, isNew, cls: classOf(s, C.types[i]) });
  }
  const cd = s.forms.casdate; if (cd && cd.cells && cd.cells.B10 && cd.cells.B10.in) cells.push({ ref: 'B10', base: cd.cells.B10.v, value: asOnS, label: 'CAS imported (as on)' });
  if (d.stamp && d.stamp.in) cells.push({ ref: 'B9', base: d.stamp.v, value: isoToSerial(isoToday()), label: 'Last updated' });
  if (!items.length) return toast('Nothing ticked to save');
  await ctx.queue({ kind: 'setCells', sheet: 'Other Holdings', cells, title: 'CAS · ' + C.owner + ' · ' + items.filter(x => x.isNew).length + ' new, ' + items.filter(x => !x.isNew).length + ' updated funds' });
  C.saved = { owner: C.owner, items }; C.result = null; C.file = null; ctx.render(); window.scrollTo(0, 0);
}
