// Reads cached values from the tracker and writes ONLY to input cells. Any cell holding a
// formula is refused, so the app can never overwrite one.
import { readZip, writeZip, text, bytes } from './zip.js';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EPOCH = Date.UTC(1899, 11, 30);

export const col2n = c => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export const n2col = n => { let s = ''; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
export const splitRef = ref => { const m = /^([A-Z]+)(\d+)$/.exec(ref); return [m[1], Number(m[2])]; };
export const serialToISO = s => new Date(EPOCH + Math.round(Number(s) * 86400000)).toISOString().slice(0, 10);
export const isoToSerial = iso => Math.round((Date.parse(iso + 'T00:00:00Z') - EPOCH) / 86400000);

export class FormulaCellError extends Error {}

export class Workbook {
  static async open(buf) { const wb = new Workbook(); await wb._load(buf); return wb; }
  async _load(buf) {
    const z = await readZip(buf); this.order = z.order; this.files = z.files; this.dom = new Map(); this.dirty = new Set();
    const wbx = this.xml('xl/workbook.xml'), rels = this.xml('xl/_rels/workbook.xml.rels');
    const target = {}; for (const r of rels.getElementsByTagName('Relationship')) target[r.getAttribute('Id')] = r.getAttribute('Target');
    this.sheetPath = {};
    for (const s of wbx.getElementsByTagNameNS(NS, 'sheet')) {
      let t = target[s.getAttributeNS(RNS, 'id')]; t = t.startsWith('/') ? t.slice(1) : 'xl/' + t; this.sheetPath[s.getAttribute('name')] = t;
    }
    this.shared = [];
    if (this.files.has('xl/sharedStrings.xml')) for (const si of this.xml('xl/sharedStrings.xml').getElementsByTagNameNS(NS, 'si')) this.shared.push([...si.getElementsByTagNameNS(NS, 't')].map(t => t.textContent).join(''));
    this.tables = {};
    for (const [sheet, path] of Object.entries(this.sheetPath)) {
      const rp = path.replace(/worksheets\/(sheet\d+\.xml)$/, 'worksheets/_rels/$1.rels'); if (!this.files.has(rp)) continue;
      for (const r of this.xml(rp).getElementsByTagName('Relationship')) {
        if (!/\/table$/.test(r.getAttribute('Type'))) continue;
        let t = r.getAttribute('Target'); t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\.\//, '');
        const tx = this.xml(t).documentElement; this.tables[tx.getAttribute('displayName')] = { sheet, path: t };
      }
    }
  }
  xml(name) {
    if (!this.dom.has(name)) { const f = this.files.get(name); if (!f) throw new Error('Missing part ' + name); this.dom.set(name, new DOMParser().parseFromString(text(f), 'application/xml')); }
    return this.dom.get(name);
  }
  hasSheet(name) { return !!this.sheetPath[name]; }
  _sheet(name) { const p = this.sheetPath[name]; if (!p) throw new Error('Sheet not found: ' + name); return { p, doc: this.xml(p) }; }
  // rows of a sheet by number, indexed once per sheet (a sheet has thousands of rows; scanning them on every cell read was slow)
  _row(doc, r, create) {
    this._ri = this._ri || new Map(); let idx = this._ri.get(doc); const sd = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
    if (!idx) { idx = new Map(); for (const el of sd.children) idx.set(Number(el.getAttribute('r')), el); this._ri.set(doc, idx); }
    const hit = idx.get(r); if (hit || !create) return hit || null;
    const nr = doc.createElementNS(NS, 'row'); nr.setAttribute('r', r);
    let after = null; for (const el of sd.children) if (Number(el.getAttribute('r')) > r) { after = el; break; }
    sd.insertBefore(nr, after); idx.set(r, nr); return nr;
  }
  _cell(doc, ref, create) {
    const [c, r] = splitRef(ref); const row = this._row(doc, r, create); if (!row) return null; const ci = col2n(c);
    for (const el of row.children) { const [cc] = splitRef(el.getAttribute('r')); if (cc === c) return el; if (col2n(cc) > ci) { if (!create) return null; const n = doc.createElementNS(NS, 'c'); n.setAttribute('r', ref); row.insertBefore(n, el); return n; } }
    if (!create) return null; const n = doc.createElementNS(NS, 'c'); n.setAttribute('r', ref); row.appendChild(n); return n;
  }
  // Cached value as Excel last saved it (formula results included).
  get(sheet, ref) {
    const { doc } = this._sheet(sheet); const c = this._cell(doc, ref, false); if (!c) return null;
    const t = c.getAttribute('t'), v = c.getElementsByTagNameNS(NS, 'v')[0];
    if (t === 'inlineStr') return [...c.getElementsByTagNameNS(NS, 't')].map(x => x.textContent).join('');
    if (!v) return null;
    if (t === 's') return this.shared[Number(v.textContent)];
    if (t === 'str' || t === 'e') return v.textContent;
    if (t === 'b') return v.textContent === '1';
    return Number(v.textContent);
  }
  // Every cached value on a sheet in one pass: Map(row -> Map(colNumber -> value)). Fast for reading blocks.
  grid(sheet) {
    this._grids = this._grids || new Map();
    if (this._grids.has(sheet)) return this._grids.get(sheet);
    const { doc } = this._sheet(sheet); const g = new Map();
    const sd = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
    for (const row of sd.children) {
      const r = Number(row.getAttribute('r')); const m = new Map();
      for (const c of row.children) {
        const ref = c.getAttribute('r'); if (!ref) continue; const t = c.getAttribute('t');
        let val = null;
        if (t === 'inlineStr') val = [...c.getElementsByTagNameNS(NS, 't')].map(x => x.textContent).join('');
        else { const v = c.getElementsByTagNameNS(NS, 'v')[0]; if (v) val = t === 's' ? this.shared[Number(v.textContent)] : (t === 'str' || t === 'e') ? v.textContent : t === 'b' ? v.textContent === '1' : Number(v.textContent); }
        if (val !== null && val !== '') m.set(col2n(splitRef(ref)[0]), val);
      }
      if (m.size) g.set(r, m);
    }
    this._grids.set(sheet, g); return g;
  }
  // Rows of an Excel table as plain objects keyed by column header (cached values), from the grid.
  tableObjects(name) {
    const t = this.table(name); const g = this.grid(t.sheet); const out = [];
    for (let r = t.r1 + 1; r <= t.r2; r++) { const m = g.get(r); if (!m) continue; const o = { _row: r }; let any = false; t.cols.forEach((h, i) => { const v = m.get(t.c1 + i); o[h] = v === undefined ? null : v; if (v !== undefined) any = true; }); if (any) out.push(o); }
    return out;
  }
  // Every formula cell on a sheet (refs), read once.
  formulaRefs(sheet) {
    this._fx = this._fx || new Map(); if (this._fx.has(sheet)) return this._fx.get(sheet);
    const { doc } = this._sheet(sheet); const set = new Set();
    for (const f of doc.getElementsByTagNameNS(NS, 'f')) { const c = f.parentNode; if (c && c.getAttribute('r')) set.add(c.getAttribute('r')); }
    this._fx.set(sheet, set); return set;
  }
  // Input cells = cells with the tracker's yellow fill and no formula. This is what the app may edit.
  yellowStyles() {
    if (this._yx) return this._yx; const set = new Set(); this._yx = set;
    if (!this.files.has('xl/styles.xml')) return set;
    const st = this.xml('xl/styles.xml'); const fillsEl = st.getElementsByTagNameNS(NS, 'fills')[0]; const xfsEl = st.getElementsByTagNameNS(NS, 'cellXfs')[0];
    if (!fillsEl || !xfsEl) return set;
    const yfill = [...fillsEl.children].map(f => { const fg = f.getElementsByTagNameNS(NS, 'fgColor')[0]; const rgb = fg ? (fg.getAttribute('rgb') || '').toUpperCase() : ''; return /F{0,2}FFF2CC$|F{0,2}FFE699$/.test(rgb) && rgb.length >= 6; });
    [...xfsEl.children].forEach((x, i) => { if (yfill[Number(x.getAttribute('fillId') || 0)]) set.add(String(i)); });
    return set;
  }
  inputRefs(sheet) {
    this._inp = this._inp || new Map(); if (this._inp.has(sheet)) return this._inp.get(sheet);
    const ys = this.yellowStyles(); const { doc } = this._sheet(sheet); const out = new Set();
    for (const c of doc.getElementsByTagNameNS(NS, 'c')) { const s = c.getAttribute('s'); if (s && ys.has(s) && !c.getElementsByTagNameNS(NS, 'f').length) out.add(c.getAttribute('r')); }
    this._inp.set(sheet, out); return out;
  }
  // Dropdown lists (data validation) on a sheet: [{ranges:[[c1,r1,c2,r2]], options:[...]}]. Lists that point at
  // cells are read from those cells' saved values.
  dropdowns(sheet) {
    this._dv = this._dv || new Map(); if (this._dv.has(sheet)) return this._dv.get(sheet);
    const { doc } = this._sheet(sheet); const out = [];
    for (const dv of doc.getElementsByTagNameNS(NS, 'dataValidation')) {
      if (dv.getAttribute('type') !== 'list') continue;
      const f1 = dv.getElementsByTagNameNS(NS, 'formula1')[0]; if (!f1) continue;
      let f = f1.textContent.trim().replace(/^=/, ''); let options = [];
      if (/^".*"$/.test(f)) options = f.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean);
      else {
        const m = /^(?:'?([^'!]+)'?!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(f);
        if (m) { const sh = m[1] ? m[1].replace(/''/g, "'") : sheet; try { const g = this.grid(sh); const c1 = col2n(m[2]), r1 = +m[3], c2 = col2n(m[4] || m[2]), r2 = +(m[5] || m[3]);
          for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const v = g.get(r) && g.get(r).get(c); if (v !== undefined && v !== null && v !== '' && !options.includes(String(v))) options.push(String(v)); } } catch (e) { /* sheet missing */ } }
      }
      const ranges = (dv.getAttribute('sqref') || '').split(/\s+/).filter(Boolean).map(a => { const [x, y] = a.split(':'); const [c1, r1] = splitRef(x), [c2, r2] = splitRef(y || x); return [col2n(c1), r1, col2n(c2), r2]; });
      out.push({ ranges, options });
    }
    this._dv.set(sheet, out); return out;
  }
  dropdownAt(sheet, ref) { const [c, r] = splitRef(ref); const n = col2n(c); const d = this.dropdowns(sheet).find(x => x.ranges.some(([c1, r1, c2, r2]) => n >= c1 && n <= c2 && r >= r1 && r <= r2)); return d ? d.options : null; }
  isFormula(sheet, ref) { const { doc } = this._sheet(sheet); const c = this._cell(doc, ref, false); return !!(c && c.getElementsByTagNameNS(NS, 'f').length); }
  style(sheet, ref) { const { doc } = this._sheet(sheet); const c = this._cell(doc, ref, false); return c ? c.getAttribute('s') : null; }
  set(sheet, ref, value, style) {
    const { p, doc } = this._sheet(sheet);
    const c = this._cell(doc, ref, true);
    if (c.getElementsByTagNameNS(NS, 'f').length) throw new FormulaCellError(sheet + '!' + ref + ' holds a formula; the app never writes formula cells.');
    // caches stay valid: this cell's value goes into the grid, its style into the input set; dropdown lists are read again
    const g = this._grids && this._grids.get(sheet); if (g) { const [cc, rr] = splitRef(ref); let m = g.get(rr); if (value === null || value === undefined || value === '') { if (m) m.delete(col2n(cc)); } else { if (!m) { m = new Map(); g.set(rr, m); } m.set(col2n(cc), value); } }
    if (this._dv) this._dv.clear();
    const inp = this._inp && this._inp.get(sheet); if (inp && style !== undefined && style !== null) { if (this.yellowStyles().has(String(style))) inp.add(ref); else inp.delete(ref); }
    while (c.firstChild) c.removeChild(c.firstChild); c.removeAttribute('t');
    if (style !== undefined && style !== null) c.setAttribute('s', style);
    if (value === null || value === undefined || value === '') { this.dirty.add(p); return; }
    if (typeof value === 'number') { const v = doc.createElementNS(NS, 'v'); v.textContent = String(value); c.appendChild(v); }
    else { c.setAttribute('t', 'inlineStr'); const is = doc.createElementNS(NS, 'is'), t = doc.createElementNS(NS, 't'); t.textContent = String(value); if (/^\s|\s$/.test(t.textContent)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); is.appendChild(t); c.appendChild(is); }
    this.dirty.add(p);
  }
  // ---- Excel tables
  table(name) {
    const t = this.tables[name]; if (!t) throw new Error('Table not found: ' + name);
    const el = this.xml(t.path).documentElement; const ref = el.getAttribute('ref'); const [a, b] = ref.split(':'); const [c1, r1] = splitRef(a), [c2, r2] = splitRef(b);
    const cols = [...el.getElementsByTagNameNS(NS, 'tableColumn')].map(x => x.getAttribute('name'));
    return { ...t, el, c1: col2n(c1), r1, c2: col2n(c2), r2, cols };
  }
  tableRows(name) {
    const t = this.table(name); const g = this.grid(t.sheet); const out = [];
    for (let r = t.r1 + 1; r <= t.r2; r++) { const m = g.get(r); const o = { _row: r }; t.cols.forEach((h, i) => { const v = m && m.get(t.c1 + i); o[h] = v === undefined ? null : v; }); out.push(o); }
    return out;
  }
  // Writes into the first fully empty row of the table, or grows the table by one row.
  appendTableRow(name, values) {
    const t = this.table(name); const g = this.grid(t.sheet); const fx = this.formulaRefs(t.sheet);
    const skip = (h, ref) => !(h in values) && fx.has(ref); // worked out by the tracker (e.g. EPF counted so far): left alone
    let r = null;
    for (let rr = t.r1 + 1; rr <= t.r2 && r === null; rr++) { const m = g.get(rr); if (t.cols.every((h, i) => skip(h, n2col(t.c1 + i) + rr) || !m || m.get(t.c1 + i) === undefined)) r = rr; }
    if (r === null) {
      r = t.r2 + 1; const ref = n2col(t.c1) + t.r1 + ':' + n2col(t.c2) + r;
      t.el.setAttribute('ref', ref); const af = t.el.getElementsByTagNameNS(NS, 'autoFilter')[0]; if (af) af.setAttribute('ref', ref);
      this.dirty.add(t.path);
    }
    t.cols.forEach((h, i) => { const ref = n2col(t.c1 + i) + r; if (skip(h, ref)) return;
      const above = r > t.r1 + 1 ? this.style(t.sheet, n2col(t.c1 + i) + (r - 1)) : this.style(t.sheet, ref); this.set(t.sheet, ref, h in values ? values[h] : null, above); });
    return r;
  }
  setTableCell(name, row, col, value) { const t = this.table(name); const i = t.cols.indexOf(col); if (i < 0) throw new Error('No column ' + col + ' in ' + name); this.set(t.sheet, n2col(t.c1 + i) + row, value); }
  async save() {
    const ser = new XMLSerializer();
    for (const p of this.dirty) this.files.set(p, bytes(ser.serializeToString(this.xml(p))));
    // ask Excel to recalculate everything when the file is next opened
    const wbx = this.xml('xl/workbook.xml'); let cp = wbx.getElementsByTagNameNS(NS, 'calcPr')[0];
    if (!cp) { cp = wbx.createElementNS(NS, 'calcPr'); wbx.documentElement.appendChild(cp); }
    if (cp.getAttribute('fullCalcOnLoad') !== '1') { cp.setAttribute('fullCalcOnLoad', '1'); this.files.set('xl/workbook.xml', bytes(ser.serializeToString(wbx))); }
    this.dirty.clear();
    return writeZip(this.order, this.files);
  }
  modified() { // when Excel (or anyone) last saved the file
    if (!this.files.has('docProps/core.xml')) return null;
    const d = this.xml('docProps/core.xml').getElementsByTagNameNS('http://purl.org/dc/terms/', 'modified')[0]; return d ? d.textContent : null;
  }
}
