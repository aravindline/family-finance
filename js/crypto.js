// Web Crypto helpers. The PIN/passphrase is never stored: it only derives the key.
export const KDF_ITERATIONS = 600000; // PBKDF2-SHA256 (OWASP 2023 guidance)
const enc = new TextEncoder(), dec = new TextDecoder();

export function randomBytes(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
export function b64(bytes) { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
export function unb64(str) { const s = atob(str); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }

export async function deriveKey(secret, salt, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Same 256 bits as deriveKey, as raw bytes: used only to wrap the key for fingerprint unlock.
export async function deriveRaw(secret, salt, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}
export const importAesKey = raw => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
export async function hkdfAesKey(ikm, info) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptBytes(key, data, aad = '') { const iv = randomBytes(12); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, data); return { iv: b64(iv), ct: b64(ct) }; }
export async function decryptBytes(key, box, aad = '') { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: enc.encode(aad) }, key, unb64(box.ct))); }

export async function encryptJSON(key, obj, aad = '') {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function decryptJSON(key, box, aad = '') {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: enc.encode(aad) }, key, unb64(box.ct));
  return JSON.parse(dec.decode(pt));
}

export function uuid() { return crypto.randomUUID ? crypto.randomUUID() : b64(randomBytes(16)).replace(/[^a-z0-9]/gi, '').slice(0, 22); }
