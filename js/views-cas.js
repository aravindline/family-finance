// CDSL CAS upload. The PDF is read on this phone with pdf.js; the password is used once to open it and is never stored
// or sent. App 0.14.0 (Aravind, 12 Nov 2026): every investment in the CAS is accounted for, except what the Kite (or
// Upstox) holdings paste already holds. Funds in folios, and every demat holding (bonds, NCDs, G-secs, T-bills, SDLs,
// SGBs, ETFs, REITs, InvITs, preference shares, rights, funds in demat, and anything not recognised) are listed by where
// they go in the app; shares in an account that is in the holdings paste are only compared with it, never added twice.
import { ctx } from './ctx.js';
import * as F from './fmt.js';
import { h, toast, seg, card } from './ui.js';
import { parseCAS, guessType, itemsToLines, KINDS, couponOf } from './cas.js';
import { slotsOf, slotLabel } from './views-kite.js';
import { isoToSerial } from './xlsx.js';
import { topicOfType, TOPIC_NAMES } from './wealth.js';

const C = { owner: null, result: null, types: {}, skip: {}, cost: {}, busy: false, file: null, error: '', saved: null };
const NOT_PASTED = '-'; // casMap value: this demat account is not in the holdings paste, so everything in it is added
const isoToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

async function readPdf(file, password) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs'); // loaded only when a statement is read
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
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, 'Use the PDF CDSL emails you each month. It is read on this phone. Every investment in it is listed and saved where it belongs; what your Kite or Upstox holdings already have is only compared, never added twice.'),
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

const norm = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// is this CAS holding already a row of that account's holdings paste? By symbol inside the name, or same quantity and a close value
function inPaste(s, code, x) {
  const rows = (s.holdings || []).filter(y => y.account === code); const nm = norm(x.name);
  const hit = rows.find(y => { const sym = norm(y.name); return (sym.length >= 3 && nm.includes(sym)) || (Number(y.qty) === Number(x.qty) && y.current && Math.abs(y.current - x.value) <= 0.1 * Math.max(y.current, x.value)); });
  return hit ? hit.name : null;
}
// every holding the CAS shows that the app can add: folios, and demat holdings not already in the holdings paste
function items(s) {
  const r = C.result; const map = ctx.settings().casMap || {}; const types = typeList(s); const list = [];
  const typeFor = (kind, name) => { const t = KINDS[kind].type || guessType(name, types); return types.includes(t) ? t : (types.includes('Other') ? 'Other' : types[0]); };
  r.folios.forEach((f, k) => list.push({ key: 'f' + k, src: 'folio', kind: 'mf', name: f.name, where: 'Folio ••' + f.folio4, tag: 'Folio ••' + f.folio4, units: f.units, price: f.nav, invested: f.invested, value: f.value, add: true, type: typeFor('mf', f.name) }));
  r.accounts.forEach((a, ai) => {
    const code = map[a.bo4]; if (!code) return; // not placed yet: the account card asks first
    a.holdings.forEach((x, k) => {
      const pasted = code !== NOT_PASTED;
      if (pasted && x.kind === 'share') return; // compared by count and value on the account card
      const hit = pasted ? inPaste(s, code, x) : null;
      list.push({ key: 'd' + ai + '-' + k, src: 'demat', kind: x.kind, name: x.name, where: 'Demat ••' + a.bo4, tag: 'Demat ••' + a.bo4, units: x.qty, price: x.price, invested: null, value: x.value, add: !hit,
        coupon: couponOf(x.name), note: hit ? 'Already in your holdings paste as ' + hit + ', so it is not ticked.' : null, type: typeFor(x.kind, x.name) });
    });
  });
  return list;
}
const typeList = s => (s.forms && s.forms.otherhold && s.forms.otherhold.opts && s.forms.otherhold.opts.D) || [];
function classOf(s, type) {
  const d = s.forms && s.forms.invmap; const row = d && d.rows.find(x => String((x.cells.A || {}).v || '') === type);
  return row && row.cells.B && row.cells.B.v ? String(row.cells.B.v) : '';
}
const placeOf = (s, type) => TOPIC_NAMES[topicOfType(type, classOf(s, type))];
// where each saved holding shows in More (the topic page and its list)
const LIST_OF = { mf: 'Mutual fund folios', cash: 'Bonds, NCDs and G-secs', gold: 'Gold, silver and other holdings', equity: 'Other equity outside Kite' };
const whereOf = (s, type) => { const t = topicOfType(type, classOf(s, type)); return 'More › ' + TOPIC_NAMES[t] + ' › ' + LIST_OF[t]; };

function resultCards(s) {
  const r = C.result; const out = [];
  const slots = slotsOf(s).filter(x => !/^APP/i.test(x.code)); const map = ctx.settings().casMap || {};
  const pasteValue = code => (s.holdings || []).filter(x => x.account === code).reduce((t, x) => t + (x.current || 0), 0);
  const pasteShares = code => (s.holdings || []).filter(x => x.account === code && (x.cls === 'Equity' || /stock/i.test(x.type || ''))).length;
  const place = async (bo4, code) => { await ctx.saveSettings({ casMap: Object.assign({}, map, { [bo4]: code }) }); ctx.render(); };
  if (r.warnings.length) out.push(card('Notes', null, h('ul', { class: 'list' }, r.warnings.map(w => h('li', { class: 'li' }, h('div', { class: 'body' }, h('div', { class: 'sub' }, w)))))));
  if (r.accounts.length) out.push(card('Demat accounts (as on ' + (r.asOn ? F.date(r.asOn) : '–') + ')', null, h('div', { id: 'casdemat' }, r.accounts.map(a => {
    const code = map[a.bo4]; const pasted = code && code !== NOT_PASTED;
    const casV = a.value ?? a.holdings.reduce((t, x) => t + (x.value || 0), 0); const shares = a.holdings.filter(x => x.kind === 'share');
    const kv = pasted ? pasteValue(code) : null; const kinds = {}; a.holdings.forEach(x => { kinds[KINDS[x.kind].label] = (kinds[KINDS[x.kind].label] || 0) + 1; });
    return h('div', { class: 'casacct', 'data-bo': a.bo4, style: { padding: '10px 0', borderTop: '1px solid var(--line)' } },
      h('div', { class: 'row-between' }, h('strong', {}, (a.dp || 'Demat') + ' ••' + a.bo4), h('span', { class: 'num' }, F.inr(casV))),
      h('div', { class: 'sub hint' }, Object.entries(kinds).map(([k, n]) => n + ' ' + k.toLowerCase() + (n === 1 ? '' : 's')).join(' · ') || 'No holdings'),
      h('div', { class: 'fblock', style: { marginTop: '6px' } }, h('span', { class: 'fsub' }, 'This account in your holdings paste:'),
        h('div', { class: 'chips', 'aria-label': 'Holdings paste account for ••' + a.bo4 }, slots.map(x => h('button', { type: 'button', class: 'chip' + (code === x.code ? ' on' : ''), onclick: () => place(a.bo4, x.code) }, slotLabel(x))),
          h('button', { type: 'button', class: 'chip' + (code === NOT_PASTED ? ' on' : ''), 'data-notpasted': a.bo4, onclick: () => place(a.bo4, NOT_PASTED) }, 'Not in Kite or Upstox: add everything'))),
      !code ? h('p', { class: 'hint', style: { color: 'var(--alert)', fontWeight: 600 } }, 'Pick one above so its holdings can be listed.') : null,
      pasted ? h('p', { class: 'hint' }, shares.length + ' share' + (shares.length === 1 ? '' : 's') + ' in the CAS, ' + pasteShares(code) + ' in your paste for ' + code + '. Paste value ' + F.inr(kv) + ' (difference ' + F.signed(casV - kv, F.inr) + ').') : null,
      pasted && pasteShares(code) !== shares.length ? h('p', { class: 'hint', style: { color: 'var(--alert)' } }, 'The number of shares differs. Check for a sold, bought or transferred share, then paste Kite again.') : null);
  })), h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Shares in an account that is in your holdings paste are compared by count and value (CAS prices are month-end prices). Everything else is listed below.')));
  const list = items(s);
  if (list.length) {
    const groups = {}; for (const it of list) { if (!C.types[it.key]) C.types[it.key] = it.type; if (C.skip[it.key] === undefined) C.skip[it.key] = !it.add; const g = placeOf(s, C.types[it.key]); (groups[g] = groups[g] || []).push(it); }
    const types = typeList(s);
    const order = [TOPIC_NAMES.mf, TOPIC_NAMES.cash, TOPIC_NAMES.gold, TOPIC_NAMES.equity];
    out.push(card('To save (' + list.length + ')', null, h('div', { id: 'casitems' }, Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(g => h('div', { class: 'casgroup', 'data-group': g },
      h('h3', { class: 'flabel', style: { margin: '12px 0 4px' } }, g),
      h('ul', { class: 'list' }, groups[g].map(it => { const i = it.key;
        return h('li', { class: 'li wrap', 'data-item': it.name }, h('div', { class: 'body' },
          h('div', { class: 'row-between' }, h('div', { class: 'ttl' }, it.name), h('label', { class: 'hint' }, h('input', { type: 'checkbox', checked: !C.skip[i], onchange: e => { C.skip[i] = !e.target.checked; } }), ' add')),
          h('div', { class: 'sub' }, [KINDS[it.kind].label, it.where, it.units + ' units', 'price ' + it.price, it.invested ? 'invested ' + F.inr(it.invested) : null, F.inr(it.value)].filter(Boolean).join(' · ')),
          it.note ? h('div', { class: 'sub hint' }, it.note) : null,
          h('div', { class: 'row-between', style: { gap: '8px', marginTop: '6px', flexWrap: 'wrap' } },
            h('select', { class: 'field', 'aria-label': 'Asset type for ' + it.name, style: { width: 'auto' }, onchange: e => { C.types[i] = e.target.value; ctx.render(); } }, types.map(t => h('option', { value: t, selected: t === C.types[i] }, t))),
            it.src === 'demat' ? h('input', { class: 'field', inputmode: 'decimal', style: { width: '9em' }, 'aria-label': 'Buy cost for ' + it.name, placeholder: 'Buy cost ₹ (optional)', value: C.cost[i] ?? '', oninput: e => { C.cost[i] = e.target.value; } }) : null)));
      }))))),
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Holdings in demat have no buy cost in the CAS: type it if you want returns to show. Anything already in your holdings paste is left unticked so it is not counted twice.'),
    h('div', { class: 'sticky-save' }, h('button', { class: 'btn primary', style: { flex: 1 }, id: 'cassave', onclick: () => saveAll(s) }, 'Save to the tracker'))));
  } else if (r.accounts.some(a => !map[a.bo4])) out.push(card(null, null, h('p', { class: 'hint' }, 'Pick, for each demat account above, whether it is in your holdings paste. Its holdings are then listed here.')));
  return out;
}
function savedCard() {
  const x = C.saved;
  return card('Saved: ' + x.items.length + ' holding' + (x.items.length === 1 ? '' : 's') + ' for ' + x.owner, null,
    h('ul', { class: 'list', id: 'cassaved' }, x.items.map(f => h('li', { class: 'li' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, f.name), h('div', { class: 'sub' }, (f.isNew ? 'Added' : 'Updated') + ' · ' + f.where + ' · ' + F.inr(f.value) + ' · ' + f.place + ' · ' + f.type))))),
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'One row per holding on the Other Holdings sheet. They reach the tracker on the next sync and show in Wealth after that.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { C.saved = null; ctx.render(); } }, 'Done')));
}

async function saveAll(s) {
  const r = C.result; const d = s.forms && s.forms.otherhold; if (!d) return toast('Your tracker has no Other Holdings sheet', 'bad');
  const pend = new Map(); for (const op of ctx.V.all('outbox').filter(o => o.kind === 'setCells' && o.sheet === 'Other Holdings')) for (const c of op.cells) pend.set(c.ref, c.value);
  const val = (row, c) => (pend.has(c + row.r) ? pend.get(c + row.r) : (row.cells[c] || {}).v);
  const blank = v => v === null || v === undefined || v === '';
  const used = new Set(); const cells = []; const saved = [];
  const asOn = r.asOn || isoToday(); const asOnS = isoToSerial(asOn);
  const put = (row, c, value, label) => { if (!(row.cells[c] || {}).in) return; const cur = val(row, c); if (String(cur ?? '') === String(value ?? '')) return; cells.push({ ref: c + row.r, base: (row.cells[c] || {}).v, value, label }); };
  for (const it of items(s)) {
    const i = it.key; if (C.skip[i]) continue; const type = C.types[i] || it.type;
    const cost = it.src === 'demat' ? Number(String(C.cost[i] || '').replace(/[,₹\s]/g, '')) || null : it.invested;
    let row = d.rows.find(x => !used.has(x.r) && val(x, 'B') === 'CDSL CAS' && val(x, 'A') === C.owner && val(x, 'C') === it.name); const isNew = !row;
    if (!row) { row = d.rows.find(x => !used.has(x.r) && (x.cells.C || {}).in && ['A', 'B', 'C', 'G', 'K'].every(c => blank(val(x, c)))); if (!row) return toast('Other Holdings is full. Clear a row you no longer need first.', 'bad'); }
    used.add(row.r);
    put(row, 'A', C.owner, 'Owner'); put(row, 'B', 'CDSL CAS', 'Platform'); put(row, 'C', it.name, 'Holding name'); put(row, 'D', type, 'Asset type'); put(row, 'F', 'INR', 'Currency');
    put(row, 'G', it.units, 'Units'); put(row, 'I', it.price, 'Price / unit'); put(row, 'K', '', 'Value ₹'); put(row, 'Q', it.tag + ' · CAS ' + F.date(asOn), 'Notes');
    if (cost) { put(row, 'H', it.units ? Math.round(cost / it.units * 10000) / 10000 : '', 'Avg cost / unit'); put(row, 'J', cost, 'Invested ₹'); }
    else if (isNew) { put(row, 'H', '', 'Avg cost / unit'); put(row, 'J', '', 'Invested ₹'); } // a buy cost typed earlier stays
    if (it.coupon && row.cells.T && row.cells.T.in && blank(val(row, 'T'))) put(row, 'T', it.coupon, 'Interest % a year');
    saved.push({ name: it.name, where: it.where, value: it.value, isNew, type, place: whereOf(s, type) });
  }
  const cd = s.forms.casdate; if (cd && cd.cells && cd.cells.B10 && cd.cells.B10.in) cells.push({ ref: 'B10', base: cd.cells.B10.v, value: asOnS, label: 'CAS imported (as on)' });
  if (d.stamp && d.stamp.in) cells.push({ ref: 'B9', base: d.stamp.v, value: isoToSerial(isoToday()), label: 'Last updated' });
  if (!saved.length) return toast('Nothing ticked to save');
  await ctx.queue({ kind: 'setCells', sheet: 'Other Holdings', cells, title: 'CAS · ' + C.owner + ' · ' + saved.filter(x => x.isNew).length + ' new, ' + saved.filter(x => !x.isNew).length + ' updated' });
  C.saved = { owner: C.owner, items: saved }; C.result = null; C.file = null; ctx.render(); window.scrollTo(0, 0);
}
