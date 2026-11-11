// Fingerprint / face unlock with a passkey on this device (WebAuthn).
// Best way (most phones): the passkey's PRF extension gives back a secret only after the device's own biometric
// check. That secret wraps the key the PIN would produce, so the PIN is never stored.
// Laptops with Windows Hello often have no PRF. There the app can use a second way, only if you agree to it:
// a device key that cannot be exported is kept in this browser and wraps the PIN's key; it is used only after
// Windows Hello confirms it is you (the passkey answer must say "user verified"). This is weaker than PRF:
// someone who can run code in this browser profile could use the stored key without your fingerprint.
// Either way, if it fails the PIN keeps working.
import { meta } from './db.js';
import { randomBytes, b64, unb64, hkdfAesKey, encryptBytes, decryptBytes } from './crypto.js';

const INFO = 'family-finance-bio-v1';
export class NoPrfError extends Error { constructor(id) { super('This device can only unlock with fingerprint using a key kept in this browser.'); this.code = 'NOPRF'; this.credId = id; } }

export async function supported() {
  try { return !!(window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch (e) { return false; }
}
export async function enrolled() { return !!(await meta.get('bio')); }
export async function mode() { const m = await meta.get('bio'); return m ? (m.mode || 'prf') : null; }
export async function disable() { await meta.del('bio'); }

// the authenticator data's flags byte (offset 32): bit 2 = user verified (fingerprint, face or Windows Hello PIN)
const userVerified = a => { try { const d = new Uint8Array(a.response.authenticatorData); return (d[32] & 0x04) !== 0; } catch (e) { return false; } };
async function assertion(id, ext) {
  return navigator.credentials.get({ publicKey: { challenge: randomBytes(32), allowCredentials: [{ type: 'public-key', id }], userVerification: 'required', timeout: 60000, ...(ext ? { extensions: ext } : {}) } });
}
async function prfOutput(id, salt) {
  const a = await assertion(id, { prf: { eval: { first: salt } } });
  const r = a.getClientExtensionResults();
  if (!r.prf || !r.prf.results || !r.prf.results.first) throw new Error('This device or browser cannot unlock with fingerprint here. Use your PIN.');
  return new Uint8Array(r.prf.results.first);
}

// Step 1. Makes the passkey. Throws NoPrfError when only the device-key way is possible; the screen then explains it
// and calls enrollDeviceKey() if you agree.
export async function enroll(rawKey, label) {
  if (!(await supported())) throw new Error('No fingerprint or face unlock is set up on this device.');
  const salt = randomBytes(32);
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      challenge: randomBytes(32), rp: { name: 'Family Finance' },
      user: { id: randomBytes(16), name: 'Family Finance (' + label + ')', displayName: 'Family Finance unlock' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000, extensions: { prf: { eval: { first: salt } } } } });
  } catch (e) { throw new Error(e && e.name === 'NotAllowedError' ? 'Fingerprint set-up was cancelled.' : 'Could not set up fingerprint unlock: ' + (e.message || e)); }
  const ext = cred.getClientExtensionResults(); const id = new Uint8Array(cred.rawId);
  let out = ext.prf && ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : null;
  if (!out && ext.prf && ext.prf.enabled !== false) { try { out = await prfOutput(id, salt); } catch (e) { out = null; } }
  if (!out) throw new NoPrfError(id);
  const kek = await hkdfAesKey(out, INFO);
  const box = await encryptBytes(kek, rawKey, INFO);
  await meta.set('bio', { mode: 'prf', id: b64(id), salt: b64(salt), ...box, at: new Date().toISOString() });
}

// Step 2 (only after you agree): the device-key way, for Windows Hello without PRF.
export async function enrollDeviceKey(rawKey, credId) {
  const a = await assertion(credId).catch(e => { throw new Error(e && e.name === 'NotAllowedError' ? 'Fingerprint set-up was cancelled.' : 'Fingerprint check failed: ' + (e.message || e)); });
  if (!userVerified(a)) throw new Error('Windows Hello did not confirm it was you. Fingerprint unlock is still off.');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); // cannot be exported
  const box = await encryptBytes(key, rawKey, INFO);
  await meta.set('bio', { mode: 'device', id: b64(credId), key, ...box, at: new Date().toISOString() });
}

export async function unlockKey() {
  const m = await meta.get('bio'); if (!m) throw new Error('Fingerprint unlock is not set up.');
  const cancelled = e => new Error(e && e.name === 'NotAllowedError' ? 'Fingerprint cancelled. Use your PIN.' : (e.message || 'Fingerprint did not work. Use your PIN.'));
  if (m.mode === 'device') {
    let a; try { a = await assertion(unb64(m.id)); } catch (e) { throw cancelled(e); }
    if (!userVerified(a)) throw new Error('Fingerprint not confirmed. Use your PIN.');
    try { return await decryptBytes(m.key, m, INFO); } catch (e) { throw new Error('Fingerprint unlock needs to be set up again. Use your PIN.'); }
  }
  let out;
  try { out = await prfOutput(unb64(m.id), unb64(m.salt)); } catch (e) { throw cancelled(e); }
  const kek = await hkdfAesKey(out, INFO);
  try { return await decryptBytes(kek, m, INFO); } catch (e) { throw new Error('Fingerprint unlock needs to be set up again. Use your PIN.'); }
}
