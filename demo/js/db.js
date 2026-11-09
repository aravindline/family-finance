// Thin IndexedDB wrapper. "meta" holds only what is needed before unlock (salt, lock type,
// failed-attempt counter, theme). Everything else lives in "records", encrypted.
import { CONFIG } from './config.js';
const DB_NAME = CONFIG.dbName || 'family-finance', DB_VER = 1; // the demo copy uses its own database
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode); const s = t.objectStore(store);
    let out; Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
export const meta = {
  get: k => tx('meta', 'readonly', s => s.get(k)),
  set: (k, v) => tx('meta', 'readwrite', s => { s.put(v, k); }),
  del: k => tx('meta', 'readwrite', s => { s.delete(k); }),
};
export const records = {
  all: () => tx('records', 'readonly', s => s.getAll()),
  put: rec => tx('records', 'readwrite', s => { s.put(rec); }),
  putMany: recs => tx('records', 'readwrite', s => { recs.forEach(r => s.put(r)); }),
  del: id => tx('records', 'readwrite', s => { s.delete(id); }),
  clear: () => tx('records', 'readwrite', s => { s.clear(); }),
};
export async function wipeAll() {
  await tx('records', 'readwrite', s => { s.clear(); });
  await tx('meta', 'readwrite', s => { s.clear(); });
}
