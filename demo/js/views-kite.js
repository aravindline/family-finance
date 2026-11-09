// Kite holdings paste (per demat account) and INDmoney paste. What you paste is read on the phone and only the
// holdings (name, quantity, average price, last price) are queued for the tracker. The pasted text itself is not kept.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, seg, tag, card, empty } from './ui.js';
import { parseMobile, parseWeb, replaces } from './kite.js';
import { isoToSerial, serialToISO } from './xlsx.js';

const isoToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const KD = { mode: 'app', slot: null, text: '', date: null, preview: null };

export function slotsOf(s) {
  const d = s && s.forms && s.forms.kiteaccts; if (!d) return [];
  return d.rows.map(r => ({ code: String(r.cells.A.v || ''), owner: String(r.cells.B.v || ''), name: String((r.cells.D || {}).v || ''), found: r.cells.C ? r.cells.C.v : null })).filter(x => x.code);
}
export const slotLabel = x => /^APPFAMILY$/i.test(x.code) ? x.owner + ': all accounts (Family view)' : /^APP/i.test(x.code) ? x.owner + ': all accounts' : x.code + ' · ' + (x.name || x.owner);

export function viewKite() {
  const s = ctx.snap(); const slots = slotsOf(s).filter(x => !/^APP/i.test(x.code)); // every paste belongs to a real Kite account
  if (!slots.length) return { title: 'Kite', back: 'tracker', body: [card(null, null, empty('Your tracker has no Kite accounts listed yet. Add them with the button below, then sync.'), h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { state.formId = 'kiteaccts'; ctx.go('form'); } }, 'Add Kite accounts')))] };
  const asOf = s.forms.kiteaccts && s.inputs && s.inputs.dates && s.inputs.dates.kite ? s.inputs.dates.kite.v : null;
  const pending = ctx.V.all('outbox').filter(o => o.kind === 'kitePaste');
  const doneNow = new Set(pending.flatMap(o => Object.keys(o.accounts || {})));
  if (!KD.date) KD.date = isoToday();
  const accList = card('Your demat accounts', null, h('ul', { class: 'list', id: 'kiteaccts' }, slots.map(x => h('li', { class: 'li' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, slotLabel(x)), h('div', { class: 'sub' }, (typeof x.found === 'number' ? x.found + ' holdings in the tracker' : 'Not pasted yet'))),
    doneNow.has(x.code) ? tag('PASTED · NOT SYNCED', 'plain') : null))),
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Prices in the tracker are as of ' + (typeof asOf === 'number' ? F.date(serialToISO(asOf)) : 'never') + '. Each paste is saved against its own Kite account: one account from the Kite app, or all accounts at once from Kite web (it shows the account codes). Accounts you do not paste keep last time\'s holdings.'),
    h('div', { class: 'btns', style: { marginTop: '8px' } }, h('button', { class: 'btn', id: 'kiteeditaccts', onclick: () => { state.formId = 'kiteaccts'; ctx.go('form'); } }, 'Edit accounts and names')));

  const modeSeg = seg([['app', 'Kite app: one account'], ['web', 'Kite web: all accounts']], KD.mode, v => { KD.mode = v; KD.preview = null; ctx.render(); }, 'Copied from');
  const slotBox = KD.mode === 'app' ? h('div', { class: 'fblock' }, h('span', { class: 'flabel' }, 'Which account did you copy?'),
    h('div', { class: 'chips', id: 'kiteslot', role: 'radiogroup', 'aria-label': 'Account' }, slots.map(x => h('button', { type: 'button', role: 'radio', 'aria-checked': String(KD.slot === x.code), class: 'chip' + (KD.slot === x.code ? ' on' : ''), onclick: () => { KD.slot = x.code; KD.preview = null; ctx.render(); } }, slotLabel(x))))) : null;
  const ta = h('textarea', { class: 'field', id: 'kitetext', rows: 6, 'aria-label': 'Pasted holdings', placeholder: KD.mode === 'app' ? 'In the Kite app: Portfolio › Holdings, pick the account, select all, copy, paste here.' : 'In Kite web: Holdings, select the whole table, copy, paste here.', style: { minHeight: '120px', padding: '10px 12px' }, oninput: e => { KD.text = e.target.value; } });
  ta.value = KD.text;
  const date = h('input', { class: 'field', type: 'date', id: 'kitedate', value: KD.date, max: isoToday(), 'aria-label': 'Prices as of', style: { width: 'auto' }, onchange: e => { KD.date = e.target.value; } });
  const read = () => {
    if (KD.mode === 'app' && !KD.slot) return toast('Pick the account you copied first', 'bad');
    const codes = slots.map(x => x.code);
    const r = KD.mode === 'app' ? parseMobile(KD.text) : parseWeb(KD.text, codes);
    if (!r.holdings.length) return toast(KD.mode === 'app' ? 'No holdings found. Copy the Holdings screen including the "Qty." lines.' : 'No holdings found. Copy the whole holdings table from Kite web.', 'bad');
    KD.preview = r; ctx.render();
  };
  const body = [h('h2', { class: 'formhead' }, 'Kite holdings'), accList,
    card('Paste', null, h('div', { class: 'fstack' }, modeSeg, slotBox, ta, h('div', { class: 'fblock' }, h('span', { class: 'flabel' }, 'Prices as of'), date),
      h('div', { class: 'btns' }, h('button', { class: 'btn', id: 'kiteread', onclick: read }, 'Read the paste'))))];
  if (KD.preview) body.push(previewCard(slots));
  return { title: 'Kite', back: 'tracker', body };
}

function previewCard(slots) {
  const r = KD.preview; const list = r.holdings;
  const inv = list.reduce((t, x) => t + (x.invested ?? x.qty * x.avg), 0), cur = list.reduce((t, x) => t + x.qty * x.ltp, 0);
  const off = list.filter(x => x.check === false);
  let accounts, repl, what;
  if (KD.mode === 'app') { accounts = { [KD.slot]: list.map(x => ({ sym: x.sym, qty: x.qty, avg: x.avg, ltp: x.ltp })) }; repl = replaces(KD.slot, slots); what = slotLabel(slots.find(x => x.code === KD.slot)); }
  else { accounts = {}; for (const c of slots.map(x => x.code).filter(c => !/^APP/i.test(c))) accounts[c] = []; for (const x of list) for (const [c, q] of Object.entries(x.codes)) accounts[c].push({ sym: x.sym, qty: q, avg: x.avg, ltp: x.ltp }); repl = slots.map(x => x.code); what = 'all accounts'; }
  const per = Object.entries(accounts).filter(([, l]) => l.length).map(([c, l]) => c + ': ' + l.length);
  const save = async () => {
    await ctx.queue({ kind: 'kitePaste', accounts, replace: repl, asOf: isoToSerial(KD.date || isoToday()), title: 'Kite holdings · ' + what });
    KD.text = ''; KD.preview = null; KD.slot = null; toast('Saved. Reaches the tracker on the next sync.', 'good'); ctx.render();
  };
  return card('Found ' + list.length + ' holdings', null,
    h('div', { class: 'kv', id: 'kiteprev' }, h('span', {}, 'For'), h('span', {}, what), KD.mode === 'web' ? [h('span', {}, 'By account'), h('span', {}, per.join(' · '))] : null,
      h('span', {}, 'Invested'), h('span', {}, F.inr(inv)), h('span', {}, 'Current value'), h('span', {}, F.inr(cur)), h('span', {}, 'Gain / loss'), h('span', { class: cur - inv >= 0 ? 'gain' : 'loss' }, F.signed(cur - inv, F.inr))),
    off.length ? h('p', { class: 'hint', style: { marginTop: '8px' } }, off.length + ' holding' + (off.length === 1 ? '' : 's') + ' where invested ≠ quantity × average: ' + off.slice(0, 3).map(x => x.sym).join(', ') + '. Check them in Kite.') : null,
    (r.unknown || []).length ? h('p', { id: 'kiteunknown', style: { color: 'var(--critical)', fontWeight: 600, marginTop: '8px' } }, r.unknown.length + ' holding' + (r.unknown.length === 1 ? ' is' : 's are') + ' in a Kite account that is not in your list (' + r.unknown.slice(0, 4).join(', ') + (r.unknown.length > 4 ? '…' : '') + '). Add that account code with Edit accounts and names (above), sync, then paste again.') : null,
    r.bad.length ? h('p', { class: 'hint' }, r.bad.length + ' block' + (r.bad.length === 1 ? '' : 's') + ' could not be read and were skipped.') : null,
    h('ul', { class: 'list', style: { marginTop: '8px' } }, list.slice(0, 5).map(x => h('li', { class: 'li' }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, x.sym), h('div', { class: 'sub' }, 'Qty ' + x.qty + ' · avg ' + x.avg + ' · LTP ' + x.ltp))))),
    list.length > 5 ? h('p', { class: 'hint' }, '… and ' + (list.length - 5) + ' more') : null,
    h('div', { class: 'sticky-save' }, h('button', { class: 'btn primary', style: { flex: 1 }, id: 'kitesave', disabled: !!(r.unknown || []).length, onclick: save }, 'Save to tracker')));
}

// ---------------------------------------------------------------- INDmoney app paste (Intl Holdings column T)
const ID = { text: '' };
export function viewIntlPaste() {
  const s = ctx.snap(); const d = s && s.forms && s.forms.intlset;
  if (!d) return { title: 'Intl', back: 'tracker', body: [card(null, null, empty('Your tracker has no Intl Holdings sheet yet.'))] };
  const ta = h('textarea', { class: 'field', id: 'indtext', rows: 6, 'aria-label': 'Pasted INDmoney holdings', placeholder: "In the INDmoney app: US stocks › Current Holdings, select all, copy, paste here.", style: { minHeight: '120px', padding: '10px 12px' }, oninput: e => { ID.text = e.target.value; } });
  ta.value = ID.text;
  const save = async () => {
    const lines = ID.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) return toast('Paste the Current Holdings screen first', 'bad');
    if (lines.length > 300) return toast('That is more than 300 lines. Paste only the Current Holdings screen.', 'bad');
    if (lines.some(l => /\d{9,}/.test(l.replace(/[,.$]/g, '')) && !/^[$\d,.\s+\-−%]+$/.test(l))) return toast('The paste seems to hold an account number. Remove it and paste again.', 'bad');
    await ctx.queue({ kind: 'fillColumn', sheet: 'Intl Holdings', col: 'T', from: 13, to: 312, lines, date: { ref: 'C6', value: isoToSerial(isoToday()) }, title: 'INDmoney holdings paste' });
    ID.text = ''; toast('Saved. Reaches the tracker on the next sync.', 'good'); history.back();
  };
  return { title: 'Intl', back: 'tracker', body: [h('h2', { class: 'formhead' }, 'INDmoney prices paste'),
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, 'Fills the latest US prices for your international holdings. The holdings themselves are in More › Equity › International holdings.'),
    card(null, null, h('div', { class: 'fstack' }, ta)),
    h('div', { class: 'sticky-save' }, h('button', { class: 'btn primary', style: { flex: 1 }, id: 'indsave', onclick: save }, 'Save to tracker'))] };
}
