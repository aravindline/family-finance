// Voice entry (0.11.0). One tap on the mic, speak in English, and the form is filled in. Nothing is saved until
// the person checks the form and presses Save. Uses Chrome's own speech recognition, which sends the spoken words
// to Google to turn them into text, and only after the mic is tapped (approved by Aravind on 9 Nov 2026).
// The parsing below is plain code on the phone: no other service is called.

const Rec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const voiceSupported = () => !!Rec;

let active = null;
export function stopListening() { try { if (active) active.abort(); } catch { /* already stopped */ } active = null; }

// Resolves with up to 3 guesses of what was said (best first).
export function listen() {
  return new Promise((resolve, reject) => {
    if (!Rec) return reject(Object.assign(new Error('Voice entry needs Chrome on Android.'), { code: 'nosupport' }));
    stopListening();
    const r = new Rec(); active = r;
    r.lang = 'en-IN'; r.interimResults = false; r.maxAlternatives = 3; r.continuous = false;
    let done = false;
    r.onresult = e => { done = true; resolve([...e.results[0]].map(a => a.transcript).filter(Boolean)); };
    r.onerror = e => { done = true; const c = e.error || 'voice';
      reject(Object.assign(new Error(c === 'not-allowed' || c === 'service-not-allowed' ? 'Allow the microphone for this app in Chrome to use voice entry.'
        : c === 'network' ? 'Voice entry needs the internet. Type it this time.' : c === 'no-speech' ? 'Didn\'t hear anything. Tap the mic and speak.' : 'Couldn\'t catch that. Tap the mic and try again.'), { code: c })); };
    r.onend = () => { active = null; if (!done) reject(Object.assign(new Error('Didn\'t hear anything. Tap the mic and speak.'), { code: 'no-speech' })); };
    r.start();
  });
}

// ---------------------------------------------------------------- words to numbers
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const MULT = { hundred: 100, thousand: 1000, k: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000, crore: 10000000, crores: 10000000 };
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON = w => w.length >= 3 ? MONTHS.findIndex(m => m.startsWith(w)) : -1;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// "1,200" -> "1200", "₹450" -> "450", "2k" -> "2 k", "1.5 lakh" stays, number words become digits.
export function tokenize(text) {
  let t = String(text || '').toLowerCase().replace(/₹/g, ' ').replace(/(\d),(?=\d)/g, '$1').replace(/\b(rs|inr)\.?(?=\s|\d|$)/g, ' ')
    .replace(/(\d)(k|l)\b/g, (m, d, u) => d + ' ' + (u === 'k' ? 'thousand' : 'lakh')).replace(/(\d)(st|nd|rd|th)\b/g, '$1 $2');
  t = t.replace(/[^a-z0-9.\/\- ]+/g, ' ').replace(/([a-z])-([a-z])/g, '$1 $2').replace(/(^|\s)-+|-+(\s|$)/g, ' ');
  const raw = t.split(/\s+/).filter(Boolean).map(w => w.replace(/\.$/, ''));
  // merge spoken numbers: "two thousand five hundred" -> 2500, "1.5 lakh" -> 150000, "twenty-five" -> 25
  const out = [];
  let total = null, cur = 0, any = false;
  const flush = () => { if (any) out.push({ w: String(Math.round(((total || 0) + cur) * 100) / 100), num: true }); total = null; cur = 0; any = false; };
  for (let r = 0; r < raw.length; r++) {
    const p = raw[r];
    {
      if (p === 'one' && raw[r + 1] === 'time') { flush(); out.push({ w: p }); continue; }
      if (/^\d+(\.\d+)?$/.test(p)) { const dateNext = /^(st|nd|rd|th|of)$/.test(raw[r + 1] || '') || MON(raw[r + 1] || '') >= 0 && raw[r + 1] !== 'mar';
        if (any && (cur || dateNext)) flush(); cur += Number(p); any = true; if (dateNext) flush(); continue; }
      if (ONES[p] !== undefined) { cur += ONES[p]; any = true; continue; }
      if (TENS[p] !== undefined) { cur += TENS[p]; any = true; continue; }
      if (MULT[p] && any) { const m = MULT[p]; if (m === 100) cur = (cur || 1) * 100; else { total = (total || 0) + (cur || 1) * m; cur = 0; } continue; }
      if (p === 'and' && any) continue;
      flush(); out.push({ w: p });
    }
  }
  flush();
  return out;
}

const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

// Finds a date in the words and marks those words as used. Never returns a future date.
function findDate(T, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ago = n => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
  const use = (...ix) => ix.forEach(i => { if (T[i]) T[i].used = true; });
  const w = i => (T[i] && !T[i].used ? T[i].w : '');
  const dayNum = i => { const x = w(i); if (/^\d{1,2}$/.test(x) && +x >= 1 && +x <= 31) return +x; if (ORD[x]) return ORD[x]; return 0; };
  const valid = (y, m, d) => { const x = new Date(y, m, d); return x.getMonth() === m ? x : null; };
  const past = (m, d, y) => { if (y) return valid(y, m, d); let x = valid(today.getFullYear(), m, d); if (x && x > today) x = valid(today.getFullYear() - 1, m, d); return x; };
  for (let i = 0; i < T.length; i++) {
    const a = w(i);
    if (a === 'day' && w(i + 1) === 'before' && w(i + 2) === 'yesterday') { use(i, i + 1, i + 2); return ago(2); }
    if (a === 'yesterday') { use(i); return ago(1); }
    if (a === 'today' || a === 'tonight') { use(i); return today; }
  }
  for (let i = 0; i < T.length; i++) {
    const a = w(i);
    // 5/11 or 5/11/2026 (day first, Indian style)
    const m = a.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
    if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0; const x = past(+m[2] - 1, +m[1], y); if (x && x <= today) { use(i); return x; } }
    // weekday: "monday" = the latest Monday (today counts), "last monday" = the one before today
    const di = DAYS.indexOf(a);
    if (di >= 0) { const last = w(i - 1) === 'last'; let back = (today.getDay() - di + 7) % 7; if (last && back === 0) back = 7; use(i); if (last) use(i - 1); if (w(i - 1) === 'on') use(i - 1); return ago(back); }
    // "5th november", "5 of november", "november 5th"
    const mi = a.length >= 3 ? MON(a) : -1;
    if (mi >= 0 && !(a === 'may' && !dayNum(i - 1) && !dayNum(i + 1))) {
      let d = 0, ix = [];
      if (dayNum(i - 1)) { d = dayNum(i - 1); ix = [i - 1]; if (/^(st|nd|rd|th)$/.test(w(i - 1))) { /* handled by token order */ } }
      else if (w(i - 1) === 'of' && dayNum(i - 2)) { d = dayNum(i - 2); ix = [i - 2, i - 1]; }
      else if (/^(st|nd|rd|th)$/.test(w(i - 1)) && dayNum(i - 2)) { d = dayNum(i - 2); ix = [i - 2, i - 1]; }
      else if (dayNum(i + 1)) { d = dayNum(i + 1); ix = [i + 1]; if (/^(st|nd|rd|th)$/.test(w(i + 2))) ix.push(i + 2); }
      if (d) { const yi = Math.max(i, ...ix) + 1; const y = /^20\d\d$/.test(w(yi)) ? +w(yi) : 0; const x = past(mi, d, y);
        if (x && x <= today) { use(i, ...ix); if (y) use(yi); if (w(Math.min(i, ...ix) - 1) === 'on') use(Math.min(i, ...ix) - 1); return x; } }
    }
  }
  // "on the 5th" / "5th": a day in this month (or last month if it hasn't come yet)
  for (let i = 0; i < T.length; i++) {
    if (/^\d{1,2}$/.test(w(i)) && /^(st|nd|rd|th)$/.test(w(i + 1)) || (ORD[w(i)] && (w(i - 1) === 'the' || w(i - 1) === 'on'))) {
      const d = dayNum(i); let x = valid(today.getFullYear(), today.getMonth(), d);
      if (!x || x > today) { const p = new Date(today.getFullYear(), today.getMonth() - 1, 1); x = valid(p.getFullYear(), p.getMonth(), d); }
      if (x) { use(i); if (/^(st|nd|rd|th)$/.test(w(i + 1))) use(i + 1); if (w(i - 1) === 'the') use(i - 1); if (w(i - 2) === 'on') use(i - 2); if (w(i - 1) === 'on') use(i - 1); return x; }
    }
  }
  return null;
}

// ---------------------------------------------------------------- matching names
const STOP = new Set(['a', 'an', 'the', 'and', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'via', 'with', 'from', 'using', 'through', 'my', 'our', 'is', 'was', 'it', 'a/c', 'ac', 'account', 'acc']);
const FILLER = new Set([...STOP, 'rupees', 'rupee', 'rs', 'spent', 'spend', 'paid', 'pay', 'paying', 'bought', 'buy', 'got', 'received', 'credited', 'added', 'add', 'expense', 'income', 'amount', 'st', 'nd', 'rd', 'th', 'only', 'today', 'please', 'entry', 'towards']);
const stem = w => w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
const keysOf = name => String(name || '').toLowerCase().replace(/[•]+/g, ' ').split(/[^a-z0-9]+/).filter(x => x && !STOP.has(x)).map(stem);

// Extra words people say for common names (only used when that name is in their own lists).
const ALIAS = {
  // expense categories and sub-categories
  food: ['lunch', 'dinner', 'breakfast', 'snack', 'snacks', 'coffee', 'tea', 'meal', 'eating'],
  'dine-out': ['restaurant', 'dining', 'dine', 'cafe', 'eat out', 'eating out'], online: ['swiggy', 'zomato', 'food delivery', 'delivery'],
  household: ['house', 'home'], 'grocery/essentials': ['grocery', 'groceries', 'vegetables', 'vegetable', 'veggies', 'fruits', 'fruit', 'milk', 'provisions', 'bigbasket', 'big basket', 'blinkit', 'zepto', 'instamart', 'dmart', 'essentials'],
  pets: ['pet', 'dog', 'cat'], maintenance: ['repair', 'repairs', 'plumber', 'electrician', 'maintenance'],
  'rent & bills': ['bill', 'bills'], rent: ['rent', 'house rent'], electricity: ['electricity', 'current bill', 'power bill', 'bescom', 'eb bill'], 'water/gas': ['water', 'gas', 'cylinder', 'lpg'],
  'mobile/internet/dth': ['mobile bill', 'recharge', 'internet', 'broadband', 'wifi', 'dth', 'jio', 'airtel', 'postpaid', 'prepaid'],
  travel: ['travel', 'trip'], 'bus/rail/flight': ['bus', 'train', 'rail', 'flight', 'metro', 'irctc'], 'auto/cab': ['auto', 'cab', 'uber', 'ola', 'rapido', 'taxi'],
  car: ['fuel', 'petrol', 'diesel', 'toll', 'fastag', 'parking', 'car wash', 'car service'], hotel: ['hotel', 'stay', 'airbnb', 'resort'],
  health: ['medical', 'health'], doctor: ['doctor', 'consultation', 'clinic', 'hospital'], medicines: ['medicine', 'medicines', 'pharmacy', 'tablets', 'pharmeasy', 'apollo'], tests: ['lab test', 'blood test', 'scan', 'x-ray', 'checkup'], fitness: ['gym', 'yoga', 'fitness'],
  shopping: ['shopping', 'amazon', 'flipkart', 'myntra'], clothing: ['clothes', 'clothing', 'dress', 'shirt', 'saree', 'shoes', 'jeans'], electronics: ['electronics', 'laptop', 'headphones', 'charger', 'gadget'],
  'home items': ['furniture', 'kitchen', 'utensils', 'home items'], 'personal care': ['cosmetics', 'skincare', 'shampoo', 'soap', 'toiletries'],
  entertainment: ['entertainment', 'fun'], 'movies/events': ['movie', 'movies', 'cinema', 'concert', 'show'], 'ott/subscriptions': ['netflix', 'prime', 'hotstar', 'spotify', 'youtube premium', 'subscription', 'ott'], hobbies: ['hobby', 'hobbies'],
  'family & social': ['family', 'social'], parents: ['parents', 'amma', 'appa', 'mom', 'dad', 'mother', 'father'], gifts: ['gift', 'gifts', 'present'], 'functions/festivals': ['function', 'festival', 'wedding', 'pooja', 'puja', 'diwali', 'pongal'], donations: ['donation', 'temple', 'charity'],
  personal: ['personal'], 'salon/grooming': ['salon', 'haircut', 'hair cut', 'grooming', 'parlour', 'parlor', 'barber'], 'courses/books': ['course', 'books', 'book', 'udemy', 'kindle'],
  children: ['kids', 'kid', 'baby', 'children', 'child', 'school'], 'one-time': ['one time', 'onetime'], 'big purchase': ['big purchase'],
  // payment modes
  upi: ['upi', 'gpay', 'g pay', 'google pay', 'phonepe', 'phone pe', 'paytm', 'bhim'], cash: ['cash'], 'credit card': ['credit card', 'credit'], 'debit card': ['debit card', 'debit'],
  'net banking': ['net banking', 'netbanking', 'neft', 'imps', 'bank transfer', 'rtgs'], wallet: ['wallet', 'amazon pay'],
  // income
  salary: ['salary', 'pay slip', 'payslip'], 'monthly payout': ['monthly salary', 'monthly payout', 'monthly'], 'variable pay': ['variable pay', 'variable', 'vp', 'performance pay'], bonus: ['bonus'],
  'investment / savings income': ['investment income', 'savings income'], dividends: ['dividend', 'dividends'], interest: ['interest', 'fd interest', 'savings interest'],
  rewards: ['reward', 'rewards', 'cashback', 'cash back', 'points'],
};

// How well a list of names fits the spoken words: returns { name, score, ix } for the single best, or null when
// nothing fits or two names fit equally well (then the field is left for the person to pick).
function best(T, names, opts = {}) {
  const free = T.map((t, i) => ({ ...t, i })).filter(t => !t.used && !t.num);
  const words = free.map(t => stem(t.w));
  const phraseAt = ph => { const p = ph.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem); if (!p.length) return null;
    for (let s = 0; s + p.length <= words.length; s++) if (p.every((x, k) => words[s + k] === x)) return p.map((_, k) => free[s + k].i); return null; };
  const scored = [];
  for (const name of names) {
    const key = String(name).toLowerCase(); const ks = keysOf(name).filter(k => !/^\d+$/.test(k) && !(opts.ignore || []).includes(k));
    let score = 0, ix = [], viaAlias = false;
    if (ks.length) { const hit = ks.filter(k => words.includes(k)); if (hit.length === ks.length || (opts.partial && hit.length && hit.length * 2 >= ks.length)) { score = hit.length * 2 + (hit.length === ks.length ? 1 : 0); ix = hit.map(k => free[words.indexOf(k)].i); } }
    // each part of a "Bus/Rail/Flight" style name works on its own ("bus", "train" via the extra words)
    const parts = key.includes('/') ? key.split('/').map(x => x.trim()).filter(x => x.length >= 2) : [];
    for (const a of parts) { const at = phraseAt(a); if (at) { const sc = at.length * 2 + 1; if (sc > score) { score = sc; ix = at; viaAlias = false; } } }
    for (const a of ALIAS[key] || []) { const at = phraseAt(a); if (at) { const sc = at.length * 2; if (sc > score) { score = sc; ix = at; viaAlias = true; } } }
    // joined or split words: "dineout" for "Dine-out", "net banking" said as "netbanking", "grocery essentials" as one word
    for (const sq of [key, ...(ALIAS[key] || [])].map(x => x.replace(/[^a-z0-9]+/g, '')).filter(x => x.length >= 4)) {
      for (let s0 = 0; s0 < free.length; s0++) { let joined = ''; for (let k = s0; k < Math.min(free.length, s0 + 3); k++) { joined += free[k].w.replace(/[^a-z0-9]/g, '');
        if (joined === sq || stem(joined) === stem(sq)) { const at = free.slice(s0, k + 1).map(t => t.i); const sc = Math.max(ks.length, 1) * 2 + 1; if (sc > score) { score = sc; ix = at; viaAlias = key !== sq; } } } }
    }
    for (const d of opts.digits ? (String(name).match(/\d{4}/g) || []) : []) { const at = T.findIndex(t => !t.used && t.num && t.w === d); if (at >= 0) { score += 3; ix = [...ix, at]; } }
    if (score) scored.push({ name, score, ix, viaAlias });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return null;
  return scored[0];
}
// marks the words used; words that are only a brand or a hint ("swiggy") stay for the note
const take = (T, m, keepAlias) => { if (m) for (const i of m.ix) if (!(keepAlias && m.viaAlias && !T[i].num)) T[i].used = true; else T[i].hint = true; };

function findPerson(T) {
  const MA = ['madhu', 'madu', 'mathu', 'madhoo', 'madhuri'], AR = ['aravind', 'arvind', 'aravindh', 'arvindh', 'arwind', 'aravin'];
  for (let i = 0; i < T.length; i++) { if (T[i].used) continue; const p = MA.includes(T[i].w) ? 'Madhu' : AR.includes(T[i].w) ? 'Aravind' : '';
    if (p) { T[i].used = true; if (T[i - 1] && T[i - 1].w === 'for') T[i - 1].used = true; return p; } }
  return '';
}

// Picks the amount: a number next to "rupees"/"rs" first, else the first number left. Returns null if none.
function findAmount(T) {
  const nums = T.map((t, i) => ({ t, i })).filter(x => x.t.num && !x.t.used);
  if (!nums.length) return null;
  const near = nums.find(x => /^(rupees?|rs)$/.test((T[x.i + 1] || {}).w || '') || /^(rupees?|rs)$/.test((T[x.i - 1] || {}).w || ''));
  const pick = near || nums[0]; pick.t.used = true;
  const n = Number(pick.t.w); return n > 0 ? Math.round(n * 100) / 100 : null;
}

function noteFrom(T) {
  const words = T.filter(t => !t.used && !t.num && !FILLER.has(t.w) && t.w.length > 1 || (t.hint && !t.num)).map(t => t.w);
  const s = words.filter((w, i) => words.indexOf(w) === i).join(' ').slice(0, 120);
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

// Category and sub-category. A category that was said narrows the sub-categories to its own; a sub-category alone
// brings its category ("dine-out" -> Food). "Other(s)" only counts when said, and a generic "Others" category loses to a named one.
function pickCategory(T, heard, cats, out, keepAlias) {
  const saidOther = /\bothers?\b/i.test(heard);
  const okSub = x => !/^others?$/i.test(x) || saidOther;
  const named = cats.filter(c => !/^others?$/i.test(c.name));
  const cm = best(T, named.map(c => c.name)) || best(T, cats.map(c => c.name));
  if (cm) {
    const T2 = T.map(t => ({ ...t })); for (const i of cm.ix) T2[i].used = true;
    const own = (cats.find(c => c.name === cm.name) || {}).subs || [];
    const sm1 = best(T2, own.filter(okSub));
    if (sm1) { out.category = cm.name; out.sub = sm1.name; take(T, sm1, keepAlias); take(T, cm, keepAlias); return; }
  }
  const pairs = cats.flatMap(c => c.subs.filter(okSub).map(s => ({ s, c: c.name })));
  const sm = best(T, pairs.map(x => x.s).filter((x, i, a) => a.indexOf(x) === i));
  if (sm) { const owners = pairs.filter(x => x.s === sm.name).map(x => x.c); const cat = cm && owners.includes(cm.name) ? cm.name : owners.length === 1 ? owners[0] : '';
    if (cat && !(cm && cm.name !== cat && cm.score >= sm.score)) { out.category = cat; out.sub = sm.name; take(T, sm, keepAlias); if (cm && cm.name === cat) take(T, cm, keepAlias); return; } }
  if (cm) { out.category = cm.name; take(T, cm, keepAlias); }
}

/**
 * Turns what was said into form fields.
 * kind 'expense': lists { cats, subs:{cat:[...]}, modes, events:[names] } → { amount, date, category, sub, mode, event, by, notes, heard }
 * kind 'income':  lists { cats:[{name,subs}], accounts } → { amount, date, category, sub, account, person, notes, heard }
 * Any field it is unsure about is left out, so the form keeps its usual value.
 */
export function parseVoice(alts, kind, lists, now = new Date()) {
  alts = (Array.isArray(alts) ? alts : [alts]).filter(Boolean);
  const heard = alts[0] || '';
  const T = tokenize(heard);
  const out = { heard };
  const d = findDate(T, now); if (d) out.date = iso(d);
  const who = findPerson(T); if (who) out[kind === 'income' ? 'person' : 'by'] = who;
  if (kind === 'income') {
    const acc = best(T, lists.accounts || [], { digits: true, partial: true, ignore: ['sample', 'salary', 'saving'] }); if (acc) { out.account = acc.name; take(T, acc); }
    pickCategory(T, heard, (lists.cats || []).map(c => ({ name: c.name, subs: c.subs || [] })), out, false);
  } else {
    const ev = best(T, lists.events || [], { partial: true }); if (ev) { out.event = ev.name; take(T, ev); }
    const mode = best(T, (lists.modes || []).filter(m => !/^others?$/i.test(m))); if (mode) { out.mode = mode.name; take(T, mode); }
    const subs = lists.subs || {};
    pickCategory(T, heard, (lists.cats || []).map(c => ({ name: c, subs: subs[c] || [] })), out, true);
  }
  let amt = findAmount(T);
  for (let k = 1; amt == null && k < alts.length; k++) { const T2 = tokenize(alts[k]); findDate(T2, now); findPerson(T2); amt = findAmount(T2); }
  if (amt != null) out.amount = amt;
  const note = noteFrom(T); if (note) out.notes = note;
  return out;
}

// One line saying what was filled, for the toast after speaking.
export function summary(v, fmt) {
  const bits = [v.amount != null ? fmt(v.amount) : '', v.sub ? v.category + ' › ' + v.sub : v.category || '', v.date ? Number(v.date.slice(8)) + ' ' + MONTHS[Number(v.date.slice(5, 7)) - 1].slice(0, 3).replace(/^./, c => c.toUpperCase()) : '', v.mode || v.account || '', v.event ? 'Event: ' + v.event : '', v.by || v.person ? 'For ' + (v.by || v.person) : ''].filter(Boolean);
  return bits.length ? 'Filled: ' + bits.join(' · ') + '. Check and press Save.' : 'Heard "' + v.heard + '" but couldn\'t fill anything. Try "450 food lunch UPI".';
}
