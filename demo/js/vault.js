// The vault: encrypted local store. The key exists only in memory while unlocked.
import { deriveKey, deriveRaw, importAesKey, encryptJSON, decryptJSON, randomBytes, b64, unb64, KDF_ITERATIONS, uuid } from './crypto.js';
import { meta, records, wipeAll } from './db.js';

let key = null;
let cache = null; // Map id -> {coll, data}; cleared on lock
const CHECK = 'family-finance-check-v1';
export const FAIL_FREE = 5;           // wrong tries before a waiting time starts
export const WAIT_START_MS = 30000;   // 30 s, doubling, capped at 15 min

export const isUnlocked = () => key !== null;
export async function isSetUp() { return !!(await meta.get('check')); }
export async function lockType() { return (await meta.get('lockType')) || 'pin'; }

export function validateSecret(type, s) {
  if (type === 'pin') return /^\d{4}$/.test(s) ? null : 'PIN must be exactly 4 digits.';
  if (s.length < 10) return 'Passphrase must be at least 10 characters.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s) || !/[^A-Za-z0-9]/.test(s)) return 'Use letters, numbers and at least one special character.';
  return null;
}

export async function setup(type, secret) {
  const err = validateSecret(type, secret); if (err) throw new Error(err);
  const salt = randomBytes(16);
  key = await deriveKey(secret, salt, KDF_ITERATIONS);
  await meta.set('salt', b64(salt)); await meta.set('iter', KDF_ITERATIONS); await meta.set('lockType', type);
  await meta.set('check', await encryptJSON(key, { v: CHECK }, 'check'));
  await meta.set('fails', 0); await meta.set('waitUntil', 0);
  cache = new Map();
}

export async function waitRemaining() { return Math.max(0, ((await meta.get('waitUntil')) || 0) - Date.now()); }

export async function unlock(secret) {
  const wait = await waitRemaining(); if (wait > 0) return { ok: false, wait };
  const salt = unb64(await meta.get('salt')); const iter = await meta.get('iter');
  const k = await deriveKey(secret, salt, iter);
  try {
    const c = await decryptJSON(k, await meta.get('check'), 'check');
    if (c.v !== CHECK) throw new Error('bad');
  } catch (e) {
    const fails = ((await meta.get('fails')) || 0) + 1; await meta.set('fails', fails);
    let w = 0;
    if (fails >= FAIL_FREE) { w = Math.min(WAIT_START_MS * 2 ** (fails - FAIL_FREE), 15 * 60000); await meta.set('waitUntil', Date.now() + w); }
    return { ok: false, fails, wait: w };
  }
  key = k; await meta.set('fails', 0); await meta.set('waitUntil', 0);
  await loadCache();
  return { ok: true };
}

export function lock() { key = null; cache = null; }

// Fingerprint unlock: the PIN-derived key bytes, checked against the stored check value.
export async function rawKeyFor(secret) {
  const salt = unb64(await meta.get('salt')); const raw = await deriveRaw(secret, salt, await meta.get('iter'));
  const k = await importAesKey(raw);
  try { await decryptJSON(k, await meta.get('check'), 'check'); } catch (e) { throw new Error('PIN or passphrase is wrong.'); }
  return raw;
}
export async function unlockWithRaw(raw) {
  const k = await importAesKey(raw);
  const c = await decryptJSON(k, await meta.get('check'), 'check'); if (c.v !== CHECK) throw new Error('bad key');
  key = k; await meta.set('fails', 0); await meta.set('waitUntil', 0); await loadCache(); return { ok: true };
}

async function loadCache() {
  cache = new Map();
  for (const r of await records.all()) {
    const d = await decryptJSON(key, r.box, r.id);
    cache.set(r.id, d);
  }
}

function need() { if (!key) throw new Error('Locked'); }
export function all(coll) { need(); return [...cache.values()].filter(x => x.coll === coll).map(x => x.data); }
export function get(coll, id) { need(); const x = cache.get(coll + ':' + id); return x ? x.data : undefined; }
// Writes update the in-memory copy at once (so the next read sees them) and reach the encrypted
// store one at a time, in the order they were made.
let writeChain = Promise.resolve();
export async function put(coll, id, data) {
  need(); const rid = coll + ':' + (id || uuid());
  const val = { coll, data }; cache.set(rid, val); const k = key;
  const job = writeChain.then(async () => { await records.put({ id: rid, box: await encryptJSON(k, val, rid) }); });
  writeChain = job.catch(() => {}); await job; return rid;
}
export async function putMany(coll, items) { // items: [{id, data}]
  need(); const out = [];
  const k = key; const vals = items.map(it => { const rid = coll + ':' + (it.id || uuid()); const val = { coll, data: it.data }; cache.set(rid, val); return [rid, val]; });
  const job = writeChain.then(async () => { for (const [rid, val] of vals) out.push({ id: rid, box: await encryptJSON(k, val, rid) }); await records.putMany(out); });
  writeChain = job.catch(() => {}); await job;
}
export async function remove(coll, id) { need(); const rid = coll + ':' + id; cache.delete(rid); const job = writeChain.then(() => records.del(rid)); writeChain = job.catch(() => {}); await job; }

export async function changeSecret(oldSecret, newType, newSecret) {
  need();
  const err = validateSecret(newType, newSecret); if (err) throw new Error(err);
  const salt = unb64(await meta.get('salt'));
  const k = await deriveKey(oldSecret, salt, await meta.get('iter'));
  try { await decryptJSON(k, await meta.get('check'), 'check'); } catch (e) { throw new Error('Current PIN or passphrase is wrong.'); }
  const nsalt = randomBytes(16); const nk = await deriveKey(newSecret, nsalt, KDF_ITERATIONS);
  const out = [];
  for (const [rid, val] of cache) out.push({ id: rid, box: await encryptJSON(nk, val, rid) });
  await records.clear(); await records.putMany(out);
  await meta.set('salt', b64(nsalt)); await meta.set('iter', KDF_ITERATIONS); await meta.set('lockType', newType);
  await meta.set('check', await encryptJSON(nk, { v: CHECK }, 'check'));
  await meta.del('bio'); // fingerprint unlock wrapped the old key; it must be turned on again
  key = nk;
}

// Encrypted backup: a JSON file whose contents only the PIN/passphrase can open.
export async function exportBackup(secret) {
  need();
  const salt = unb64(await meta.get('salt'));
  const k = await deriveKey(secret, salt, await meta.get('iter'));
  try { await decryptJSON(k, await meta.get('check'), 'check'); } catch (e) { throw new Error('PIN or passphrase is wrong.'); }
  const bsalt = randomBytes(16); const bk = await deriveKey(secret, bsalt, KDF_ITERATIONS);
  const payload = { made: new Date().toISOString(), records: [...cache.entries()] };
  const box = await encryptJSON(bk, payload, 'backup');
  return JSON.stringify({ format: 'family-finance-backup-1', kdf: 'PBKDF2-SHA256', iter: KDF_ITERATIONS, salt: b64(bsalt), lockType: await lockType(), ...box });
}

export async function readBackup(text, secret) {
  let f; try { f = JSON.parse(text); } catch (e) { throw new Error('This is not a backup file.'); }
  if (f.format !== 'family-finance-backup-1') throw new Error('This is not a backup file from this app.');
  const bk = await deriveKey(secret, unb64(f.salt), f.iter);
  try { return await decryptJSON(bk, f, 'backup'); } catch (e) { throw new Error('PIN or passphrase does not open this backup.'); }
}

export async function restoreBackup(payload) {
  need();
  const out = [];
  for (const [rid, val] of payload.records) out.push({ id: rid, box: await encryptJSON(key, val, rid) });
  await records.clear(); await records.putMany(out);
  cache = new Map(payload.records);
}

export async function resetDevice() { lock(); await wipeAll(); }
