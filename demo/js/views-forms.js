// "Update tracker": every yellow (input) cell of the tracker, grouped into short forms. Saving only queues edits to
// input cells; the sync engine refuses formula cells and turns a cell changed elsewhere into a choice for you.
import { ctx, state } from './ctx.js';
import * as F from './fmt.js';
import { h, icon, toast, tag, card, empty, sheet } from './ui.js';
import { FORMS } from './forms.js';
import { isoToSerial, serialToISO } from './xlsx.js';

const byId = id => FORMS.find(f => f.id === id);
// a handover pack is edited only by its owner; the other person sees it view-only
export const viewOnly = f => !!(f && f.owner && ctx.who() && ctx.who() !== f.owner);
const backOf = f => (f && f.back) || 'tracker';
const SHORT = { hoAaccounts: 'Handover', hoAcontacts: 'Handover', hoAdigital: 'Handover', hoAsteps: 'Handover', hoAreview: 'Handover', hoMaccounts: 'Handover', hoMcontacts: 'Handover', hoMdigital: 'Handover', hoMsteps: 'Handover', hoMreview: 'Handover', assets: 'Assets', gold: 'Gold', fd: 'FD / RD', vehicles: 'Vehicles', otherhold: 'Holdings', currencies: 'Currencies', loans: 'Loans', prepay: 'Prepay', insurance: 'Insurance', wills: 'Wills', documents: 'Documents', nominees: 'Nominees', contacts: 'Contacts', goals: 'Goals', goalfy: 'Goals', settings: 'Plan', kiteaccts: 'Kite', intlset: 'Intl', intl: 'Intl', expcats: 'Lists', paymodes: 'Lists', inccats: 'Lists', incaccts: 'Lists', invmap: 'Lists', typerules: 'Lists', typeover: 'Lists', sectors: 'Sectors', sectorlist: 'Sectors', expcatnames: 'Lists' };
const shortTitle = f => SHORT[f.id] || f.title;
const data = id => { const s = ctx.snap(); return s && s.forms ? s.forms[id] : null; };
const blank = v => v === null || v === undefined || v === '';
const todaySerial = () => { const d = new Date(); return isoToSerial(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)); };
const LONG_DIGITS = /\d{5,}/;

// values typed on this device that have not reached the tracker yet win over the last synced value
function pendingMap(sheetName) {
  const m = new Map();
  for (const op of ctx.V.all('outbox').filter(o => o.kind === 'setCells' && o.sheet === sheetName).sort((a, b) => a.seq - b.seq)) for (const c of op.cells) m.set(c.ref, c.value);
  return m;
}
const valueOf = (pend, ref, v) => (pend.has(ref) ? pend.get(ref) : v);

// ---- value <-> text in a field
function toText(t, v) {
  if (blank(v)) return '';
  if (t === 'pct') return typeof v === 'number' ? String(Math.round(v * 1e6) / 1e4) : String(v);
  if (t === 'date') return typeof v === 'number' ? serialToISO(v) : String(v).slice(0, 10);
  if (t === 'month') return typeof v === 'number' ? serialToISO(v).slice(0, 7) : String(v).slice(0, 7);
  return String(v);
}
// returns [value, error]
function fromText(fl, txt) {
  const t = fl.t; const s = String(txt ?? '').trim();
  if (s === '') return ['', null];
  if (t === 'money' || t === 'num' || t === 'pct') { const c = s.replace(/[,₹%\s]/g, ''); if (!/^[-−]?(\d+(\.\d+)?|\.\d+)$/.test(c)) return [null, 'Type a number, like 1,250.50']; const n = Number(c.replace('−', '-')); return [t === 'pct' ? Math.round(n * 1e8) / 1e10 : t === 'money' ? Math.round(n * 100) / 100 : n, null]; }
  if (t === 'year') { const n = Number(s); if (!Number.isInteger(n) || n < 1900 || n > 2200) return [null, 'Type a year like 2030']; return [n, null]; }
  if (t === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return [null, 'Pick a date']; return [isoToSerial(s), null]; }
  if (t === 'month') { if (!/^\d{4}-\d{2}$/.test(s)) return [null, 'Pick a month']; return [isoToSerial(s + '-01'), null]; }
  if (t === 'email' && !/^[^\s@]+@[^\s@]+$/.test(s)) return [null, 'Check the email'];
  if (fl.last4 && !/^\d{1,4}$/.test(s)) return [null, 'Type only the last 4 digits'];
  if (fl.guard && LONG_DIGITS.test(s)) return [null, 'Only the last 4 digits of any account, card or ID number, please'];
  return [s, null];
}
function show(t, v) {
  if (blank(v)) return '–';
  if (t === 'money') return typeof v === 'number' ? F.inr(v) : String(v);
  if (t === 'pct') return typeof v === 'number' ? F.pct(v, 2).replace(/\.00%$/, '%') : String(v);
  if (t === 'date') return typeof v === 'number' ? F.date(serialToISO(v)) : String(v);
  if (t === 'month') return typeof v === 'number' ? F.monthLabel(serialToISO(v), true) : String(v);
  return String(v);
}
const same = (a, b) => (blank(a) ? blank(b) : typeof a === 'number' || typeof b === 'number' ? Math.abs(Number(a) - Number(b)) < 1e-9 : String(a) === String(b ?? ''));

// a list's choices: the tracker's dropdown plus anything already typed in that column ("+ Add new" entries)
const usedOpts = (d, c) => { const o = ((d.opts || {})[c] || []).slice(); for (const r of d.rows || []) { const v = r.cells[c] && r.cells[c].v; if (!blank(v) && !o.includes(String(v))) o.push(String(v)); } return o; };
// ---- one input for one field
function input(fl, id, text, opts, onChange) {
  const t = fl.t;
  if (t === 'choice') {
    // every preset list can take a new entry ("+ Add new"): typed once, it is saved like any other choice and offered again
    const list = (opts || []).slice(); if (text && !list.includes(text)) list.push(text);
    const wrap = h('div', { class: 'choicewrap' });
    const addNew = () => { const inp = h('input', { class: 'field', id: id + '-new', maxlength: 60, 'aria-label': 'New ' + fl.l, placeholder: 'Type the new ' + fl.l.toLowerCase(),
      oninput: e => onChange(e.target.value.trim()), onchange: e => onChange(e.target.value.trim()) });
      wrap.replaceChildren(inp, h('button', { type: 'button', class: 'link', onclick: () => { onChange(text || ''); draw(text); } }, 'Back to the list')); setTimeout(() => inp.focus(), 30); };
    const draw = cur => {
      if (list.length && list.length <= 5) {
        const box = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': fl.l, id });
        const paint = c => box.replaceChildren(...list.map(o => h('button', { type: 'button', role: 'radio', 'aria-checked': String(o === c), class: 'chip' + (o === c ? ' on' : ''), onclick: () => { const nv = o === c ? '' : o; onChange(nv); paint(nv); } }, o)),
          h('button', { type: 'button', class: 'chip add', id: id + '-add', onclick: addNew }, '+ Add new'));
        paint(cur); wrap.replaceChildren(box); return;
      }
      wrap.replaceChildren(h('select', { class: 'field', id, 'aria-label': fl.l, onchange: e => { if (e.target.value === '__new') return addNew(); onChange(e.target.value); } },
        h('option', { value: '' }, '–'), ...list.map(o => h('option', { value: o, selected: o === cur }, o)), h('option', { value: '__new' }, '+ Add new…')));
    };
    draw(text); return wrap;
  }
  const a = { class: 'field' + (['money', 'num', 'pct', 'year'].includes(t) ? ' num' : ''), id, 'aria-label': fl.l, value: text, oninput: e => onChange(e.target.value), onchange: e => onChange(e.target.value) };
  if (t === 'money' || t === 'num') Object.assign(a, { inputmode: 'decimal', placeholder: '0' });
  if (t === 'pct') Object.assign(a, { inputmode: 'decimal', placeholder: 'e.g. 7.5' });
  if (t === 'year') Object.assign(a, { inputmode: 'numeric', placeholder: 'e.g. 2030', maxlength: 4 });
  if (t === 'date') a.type = 'date'; if (t === 'month') a.type = 'month';
  if (t === 'phone') Object.assign(a, { type: 'tel', inputmode: 'tel', maxlength: 20 });
  if (t === 'email') Object.assign(a, { type: 'email', maxlength: 80 });
  if (t === 'text') Object.assign(a, { maxlength: fl.last4 ? 4 : fl.wide ? 300 : 120 });
  if (fl.last4) Object.assign(a, { inputmode: 'numeric', placeholder: 'e.g. 1234' });
  if (t === 'money') {
    const fmt = h('span', { class: 'fsub', 'aria-live': 'polite' }); const upd = v => { const n = Number(String(v).replace(/[,₹\s]/g, '')); fmt.textContent = String(v).trim() && isFinite(n) ? '= ' + F.inr(n) : ''; };
    a.oninput = e => { onChange(e.target.value); upd(e.target.value); }; const el = h('input', a); upd(text);
    return h('span', { class: 'moneywrap' }, el, fmt);
  }
  const el = h('input', a);
  return t === 'pct' ? h('span', { class: 'fieldwrap' }, el, h('span', { class: 'unit' }, '%')) : el;
}
const fieldBlock = (label, sub, el) => h('label', { class: 'fblock' }, h('span', { class: 'flabel' }, label, sub ? h('span', { class: 'fsub' }, ' · ' + sub) : null), el);

// ---- queue the changes of one form; adds the sheet's "Last updated" date when the form has one
async function queueCells(f, cells, title) {
  const d = data(f.id);
  if (f.stamp && d && d.stamp && d.stamp.in) { const pend = pendingMap(f.sheet); const base = d.stamp.v; const today = todaySerial(); if (!same(valueOf(pend, f.stamp, base), today)) cells.push({ ref: f.stamp, base, value: today, label: 'Last updated' }); }
  await ctx.queue({ kind: 'setCells', sheet: f.sheet, cells, title });
}

// ---------------------------------------------------------------- hub
export function formStatus(f) { return status(f); }
function status(f) {
  const d = data(f.id); if (!d) return { text: 'Not in your tracker yet. Sync first.', n: 0 };
  const pend = pendingMap(f.sheet); let text = '';
  if (f.rows) {
    const filled = d.rows.filter(r => (f.show || []).some(c => !blank(valueOf(pend, c + r.r, (r.cells[c] || {}).v)))).length;
    text = f.noAdd ? filled + ' of ' + d.rows.length + ' filled' : filled ? filled + ' added' : 'Nothing added yet';
  } else if (f.cells) { const ins = f.cells.filter(c => d.cells[c.r] && d.cells[c.r].in); const filled = ins.filter(c => !blank(valueOf(pend, c.r, d.cells[c.r].v))).length; text = filled + ' of ' + ins.length + ' filled'; }
  else if (f.settings) { const ins = d.rows.filter(r => r.in); text = ins.filter(r => !blank(valueOf(pend, r.ref, r.v))).length + ' of ' + ins.length + ' set'; }
  if (d.stamp) { const sv = valueOf(pend, f.stamp, d.stamp.v); text += typeof sv === 'number' && sv > 0 ? ' · updated ' + F.date(serialToISO(sv)) : ' · never updated'; }
  return { text };
}
// ---------------------------------------------------------------- one form
export function viewForm() {
  const f = byId(state.formId); const d = f && data(f.id);
  if (!f || !d) return { title: 'Update tracker', back: backOf(f), body: [card(null, null, empty(f ? 'This screen has nothing to show yet. Pull down to sync, then open it again.' : 'Pick what to update from the list.'))] };
  const ro = viewOnly(f);
  if (f.cells) return cellsForm(f, d);
  if (f.settings) return settingsGroups(f, d);
  const pend = pendingMap(f.sheet);
  const v = (r, c) => valueOf(pend, c + r.r, (r.cells[c] || {}).v);
  const fl = c => f.fields.find(x => x.c === c) || (f.readonly || []).find(x => x.c === c) || { t: 'text' };
  // a row is listed when it has a name (typed or preset) or anything typed; an empty row whose name you type is a free slot for Add
  const used = d.rows.filter(r => f.noAdd || !blank(v(r, f.label.c)) || f.fields.some(x => r.cells[x.c] && r.cells[x.c].in && !blank(v(r, x.c))));
  let rows = f.noAdd ? d.rows : used;
  if (ro) rows = rows.filter(r => f.fields.some(x => !blank(v(r, x.c))));
  const title = r => { const lv = v(r, f.label.c); return blank(lv) ? 'Row ' + r.r : f.stepLabel ? 'Step ' + lv : f.label.t === 'month' || f.label.t === 'date' ? show(f.label.t, lv) : String(lv); };
  const sub = r => (f.show || []).map(c => { const x = v(r, c); return blank(x) ? null : (fl(c).t === 'money' ? fl(c).l.replace(/ \(₹\)$/, '') + ' ' + F.inrShort(x) : show(fl(c).t, x)); }).filter(Boolean).join(' · ') || ((f.show || []).length ? 'Empty' : '');
  const free = d.rows.filter(r => !used.includes(r) && (r.cells[f.label.c] || {}).in);
  const add = f.noAdd || ro ? null : h('div', { class: 'btns', style: { margin: '0 0 12px' } }, h('button', { class: 'btn primary', id: 'formadd', onclick: () => {
    if (!free.length) return toast('All ' + d.rows.length + ' rows are used. Clear one you no longer need first.', 'bad');
    state.formRow = free[0].r; state.formNew = true; ctx.go('formedit');
  } }, icon('plus', 16), f.addLabel || 'Add'));
  return { title: shortTitle(f), back: backOf(f), body: [
    h('h2', { class: 'formhead' }, f.title + (f.owner ? ' · ' + f.owner : '')),
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, f.sub + (d.stamp ? '. ' + status(f).text.split(' · ').pop().replace(/^./, c => c.toUpperCase()) + '.' : '.') + (ro ? ' View only: ' + f.owner + ' edits this.' : '')),
    add,
    f.id === 'intl' ? h('div', { class: 'btns', style: { margin: '0 0 12px' } }, h('button', { class: 'btn', id: 'intlsetbtn', onclick: () => { state.formId = 'intlset'; ctx.go('form'); } }, icon('gear', 16), 'Platform, date and USD rate')) : null,
    card(null, null, rows.length ? h('ul', { class: 'list', id: 'formlist' }, rows.map(r => h('li', { class: 'li tap', 'data-row': r.r, onclick: () => { state.formRow = r.r; state.formNew = false; ctx.go('formedit'); } },
      h('div', { class: 'body' }, h('div', { class: 'ttl' }, title(r)), h('div', { class: 'sub' }, sub(r))), pend.size && f.fields.some(x => pend.has(x.c + r.r)) ? tag('NOT SYNCED', 'plain') : null, icon('right', 16)))) : empty(ro ? 'Nothing added yet.' : 'Nothing added yet. Tap Add.'))] };
}

// drafts survive re-renders (a sync finishing while you type)
const drafts = new Map();
export function viewFormEdit() {
  const f = byId(state.formId); const d = f && data(f.id);
  if (!f || !d) return viewForm();
  if (f.settings) return settingsEdit(f, d);
  const r = d.rows.find(x => x.r === state.formRow); if (!r) return viewForm();
  const pend = pendingMap(f.sheet); const key = f.id + ':' + r.r;
  const draft = drafts.get(key) || {}; drafts.set(key, draft);
  const base = c => (r.cells[c] || {}).v; const cur = c => valueOf(pend, c + r.r, base(c));
  const lv = cur(f.label.c); const ro = viewOnly(f);
  const heading = state.formNew ? 'New: ' + f.title.replace(/s$/, '').toLowerCase() : (blank(lv) ? 'Row ' + r.r : f.stepLabel ? 'Step ' + lv : f.label.t === 'month' || f.label.t === 'date' ? show(f.label.t, lv) : String(lv));
  if (ro) return { title: shortTitle(f), back: 'form', body: [h('h2', { class: 'formhead', id: 'formhead' }, heading),
    card(null, null, h('div', { class: 'kv', id: 'formfields' }, f.fields.flatMap(fl => [h('span', {}, fl.l), h('span', {}, show(fl.t, cur(fl.c)))]))),
    h('p', { class: 'hint', style: { margin: '8px 4px' } }, 'View only: ' + f.owner + ' edits this.')] };
  const els = [];
  for (const fl of f.fields) {
    const c = r.cells[fl.c] || {}; const id = 'f-' + fl.c;
    if (!c.in) { if (!blank(cur(fl.c)) && fl.c !== f.label.c) els.push(fieldBlock(fl.l, 'set in the tracker', h('div', { class: 'roval' }, show(fl.t, cur(fl.c))))); continue; }
    const text = fl.c in draft ? draft[fl.c] : toText(fl.t, cur(fl.c));
    els.push(fieldBlock(fl.l, null, input(fl, id, text, fl.t === 'choice' ? usedOpts(d, fl.c) : null, nv => { draft[fl.c] = nv; })));
  }
  // simple sums the app can work out itself are shown at once (marked) when what you typed differs from the tracker's last figures
  const liveRow = c => { if (c in draft) { const fl = f.fields.find(x => x.c === c); const [nv] = fromText(fl || { t: 'num' }, draft[c]); return nv; } return cur(c); };
  let provisional = false;
  const auto = (f.readonly || []).map(x => { const saved = r.cells[x.c] ? r.cells[x.c].v : null; if (!x.calc) return [x, saved]; const nv = x.calc(liveRow); if (nv !== null && !same(nv, saved)) { provisional = true; return [{ ...x, l: x.l + ' ≈' }, nv]; } return [x, saved]; }).filter(([, x]) => !blank(x));
  const save = async () => {
    const cells = [];
    for (const fl of f.fields) {
      if (!(fl.c in draft) || !(r.cells[fl.c] || {}).in) continue;
      const [nv, err] = fromText(fl, draft[fl.c]); if (err) { toast(fl.l + ': ' + err, 'bad'); const el = document.getElementById('f-' + fl.c); if (el) el.focus(); return; }
      if (!same(nv, cur(fl.c))) cells.push({ ref: fl.c + r.r, base: base(fl.c), value: nv, label: fl.l });
    }
    if (!cells.length) { drafts.delete(key); toast('No changes'); return history.back(); }
    await queueCells(f, cells, f.title + ' · ' + heading);
    drafts.delete(key); toast('Saved. Reaches the tracker on the next sync.', 'good'); history.back();
  };
  const clear = () => {
    const close = sheet('Clear this row?', h('p', {}, 'Empties the typed cells of "' + heading + '". Formulas and labels stay. You can type it again later.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn danger', id: 'clearyes', onclick: async () => {
        const cells = f.fields.filter(fl => (r.cells[fl.c] || {}).in && !blank(cur(fl.c))).map(fl => ({ ref: fl.c + r.r, base: base(fl.c), value: '', label: fl.l }));
        close(); if (!cells.length) return history.back();
        await queueCells(f, cells, f.title + ' · cleared ' + heading); drafts.delete(key); toast('Cleared. Reaches the tracker on the next sync.', 'good'); history.back();
      } }, 'Clear'), h('button', { class: 'btn', onclick: () => close() }, 'Keep')));
  };
  const canClear = !f.noAdd && !state.formNew && f.fields.some(fl => (r.cells[fl.c] || {}).in && !blank(cur(fl.c)));
  return { title: shortTitle(f), back: 'form', body: [
    h('h2', { class: 'formhead', id: 'formhead' }, heading),
    card(null, null, h('div', { class: 'fstack', id: 'formfields' }, els)),
    auto.length ? card('Worked out by the tracker', null, h('div', { class: 'kv' }, auto.flatMap(([x, val]) => [h('span', {}, x.l), h('span', {}, show(x.t, val))])), h('p', { class: 'hint', style: { marginTop: '8px' } }, provisional ? '≈ worked out by the app from what you typed; the tracker confirms it after Excel recalculates. Other figures are as Excel last calculated them.' : 'As Excel last calculated it. Changes show after the tracker is opened in Excel.')) : null,
    h('div', { class: 'sticky-save' }, h('button', { class: 'btn primary', style: { flex: 2 }, id: 'formsave', onclick: save }, 'Save'),
      canClear ? h('button', { class: 'btn', style: { flex: 1 }, id: 'formclear', onclick: clear }, 'Clear row') : null)] };
}

// ---- forms that are a few single cells (gold box, prepayment what-if, exchange rates, year to compare)
function cellsForm(f, d) {
  const pend = pendingMap(f.sheet); const key = f.id; const draft = drafts.get(key) || {}; drafts.set(key, draft);
  const cur = ref => valueOf(pend, ref, (d.cells[ref] || {}).v);
  const els = f.cells.map(c => {
    const x = d.cells[c.r] || {};
    if (!x.in) return blank(cur(c.r)) ? null : fieldBlock(c.l, 'set in the tracker', h('div', { class: 'roval' }, show(c.t, cur(c.r))));
    let text = c.r in draft ? draft[c.r] : toText(c.t, cur(c.r)); if (c.suffix && !(c.r in draft) && text.endsWith(c.suffix)) text = text.slice(0, -c.suffix.length);
    return fieldBlock(c.l, null, input(c, 'f-' + c.r, text, (d.opts || {})[c.r], nv => { draft[c.r] = nv; }));
  });
  const liveCell = ref => { const c = f.cells.find(x => x.r === ref); if (c && ref in draft) { const [nv] = fromText(c, draft[ref]); return nv; } return cur(ref); };
  let provisional = false;
  const auto = (f.readonly || []).map(x => { const saved = (d.cells[x.r] || {}).v; if (!x.calc) return [x, saved]; const nv = x.calc(liveCell); if (nv !== null && !same(nv, saved)) { provisional = true; return [{ ...x, l: x.l + ' ≈' }, nv]; } return [x, saved]; }).filter(([, v]) => !blank(v));
  const save = async () => {
    const cells = [];
    for (const c of f.cells) {
      if (!(c.r in draft) || !(d.cells[c.r] || {}).in) continue;
      let [nv, err] = fromText(c, draft[c.r]); if (err) return toast(c.l + ': ' + err, 'bad');
      if (c.suffix && nv !== '') nv = String(nv).replace(/\s*\(₹\)$/, '') + c.suffix;
      if (c.suffix && nv === '') return toast(c.l + ': a category name cannot be empty. Type Spare ' + c.l.slice(-1) + ' to put it back.', 'bad');
      if (!same(nv, cur(c.r))) cells.push({ ref: c.r, base: (d.cells[c.r] || {}).v, value: nv, label: c.l });
    }
    if (!cells.length) { drafts.delete(key); toast('No changes'); return history.back(); }
    await queueCells(f, cells, f.title); drafts.delete(key); toast('Saved. Reaches the tracker on the next sync.', 'good'); history.back();
  };
  return { title: shortTitle(f), back: 'tracker', body: [
    h('h2', { class: 'formhead' }, f.title),
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, f.sub + '.'),
    card(null, null, h('div', { class: 'fstack', id: 'formfields' }, els)),
    auto.length ? card('Worked out by the tracker', null, h('div', { class: 'kv' }, auto.flatMap(([x, v]) => [h('span', {}, x.l), h('span', {}, show(x.t, v))])), h('p', { class: 'hint', style: { marginTop: '8px' } }, provisional ? '≈ worked out by the app from what you typed; the tracker confirms it after Excel recalculates.' : 'As Excel last calculated it.')) : null,
    h('div', { class: 'sticky-save' }, h('button', { class: 'btn primary', style: { flex: 1 }, id: 'formsave', onclick: save }, 'Save'))] };
}

// ---- Plan settings: groups, then the settings of one group
function settingsGroups(f, d) {
  const pend = pendingMap(f.sheet); const groups = [];
  for (const r of d.rows) { let g = groups.find(x => x.name === r.group); if (!g) groups.push(g = { name: r.group, rows: [] }); g.rows.push(r); }
  return { title: 'Plan', back: 'tracker', body: [
    h('h2', { class: 'formhead' }, 'Plan settings'),
    h('p', { class: 'hint', style: { margin: '0 4px 12px' } }, 'Every planning assumption the tracker uses. Change one, and the plan follows after Excel recalculates.'),
    card(null, null, h('ul', { class: 'list', id: 'setgroups' }, groups.map(g => { const empties = g.rows.filter(r => r.in && blank(valueOf(pend, r.ref, r.v))).length;
      return h('li', { class: 'li tap', onclick: () => { state.formGroup = g.name; ctx.go('formedit'); } }, h('div', { class: 'body' }, h('div', { class: 'ttl' }, g.name), h('div', { class: 'sub' }, g.rows.length + ' setting' + (g.rows.length === 1 ? '' : 's') + (empties ? ' · ' + empties + ' not set' : ''))), icon('right', 16)); })))] };
}
function settingsEdit(f, d) {
  const rows = d.rows.filter(r => r.group === state.formGroup); if (!rows.length) return settingsGroups(f, d);
  const pend = pendingMap(f.sheet); const key = 'settings:' + state.formGroup; const draft = drafts.get(key) || {}; drafts.set(key, draft);
  const cur = r => valueOf(pend, r.ref, r.v);
  const els = rows.map(r => {
    const fl = { l: r.label, t: r.t };
    if (!r.in) return fieldBlock(r.label, r.formula ? 'a formula in the tracker' : 'set in the tracker', h('div', { class: 'roval' }, show(r.t, cur(r))));
    const text = r.ref in draft ? draft[r.ref] : toText(r.t, cur(r));
    return fieldBlock(r.label, r.unit && r.t !== 'date' && r.t !== 'choice' ? r.unit : null, input(fl, 'f-' + r.ref, text, r.opts, nv => { draft[r.ref] = nv; }));
  });
  const save = async () => {
    const cells = [];
    for (const r of rows) {
      if (!(r.ref in draft) || !r.in) continue;
      const [nv, err] = fromText({ l: r.label, t: r.t }, draft[r.ref]); if (err) return toast(r.label + ': ' + err, 'bad');
      if (!same(nv, cur(r))) cells.push({ ref: r.ref, base: r.v, value: nv, label: r.label });
    }
    if (!cells.length) { drafts.delete(key); toast('No changes'); return history.back(); }
    await queueCells(f, cells, 'Settings · ' + state.formGroup); drafts.delete(key); toast('Saved. Reaches the tracker on the next sync.', 'good'); history.back();
  };
  return { title: 'Plan', back: 'form', body: [
    h('h2', { class: 'formhead', id: 'formhead' }, state.formGroup),
    card(null, null, h('div', { class: 'fstack', id: 'formfields' }, els)),
    h('p', { class: 'hint', style: { margin: '8px 4px' } }, 'Percentages are typed as numbers: 7.5 means 7.5%.'),
    h('div', { class: 'sticky-save' }, h('button', { class: 'btn primary', style: { flex: 1 }, id: 'formsave', onclick: save }, 'Save'))] };
}
