// Fingerprint / face unlock with a passkey on this device (WebAuthn PRF extension).
// The passkey gives back a secret only after the phone's own biometric check. That secret wraps the
// key that the PIN would produce, so the PIN is still never stored. If the phone or browser cannot do
// this, the option stays off and the PIN keeps working as before.
import { meta } from './db.js';
import { randomBytes, b64, unb64, hkdfAesKey, encryptBytes, decryptBytes } from './crypto.js';

const INFO = 'family-finance-bio-v1';
export async function supported() {
  try { return !!(window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch (e) { return false; }
}
export async function enrolled() { return !!(await meta.get('bio')); }
export async function disable() { await meta.del('bio'); }

async function prfOutput(id, salt) {
  const a = await navigator.credentials.get({ publicKey: { challenge: randomBytes(32), allowCredentials: [{ type: 'public-key', id }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: salt } } } } });
  const r = a.getClientExtensionResults();
  if (!r.prf || !r.prf.results || !r.prf.results.first) throw new Error('This phone or browser cannot unlock with fingerprint here. Use your PIN.');
  return new Uint8Array(r.prf.results.first);
}

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
  const ext = cred.getClientExtensionResults();
  if (!ext.prf || ext.prf.enabled === false) throw new Error('This phone or browser does not support fingerprint unlock for web apps yet. Your PIN keeps working.');
  const id = new Uint8Array(cred.rawId);
  const out = ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : await prfOutput(id, salt);
  const kek = await hkdfAesKey(out, INFO);
  const box = await encryptBytes(kek, rawKey, INFO);
  await meta.set('bio', { id: b64(id), salt: b64(salt), ...box, at: new Date().toISOString() });
}

export async function unlockKey() {
  const m = await meta.get('bio'); if (!m) throw new Error('Fingerprint unlock is not set up.');
  let out;
  try { out = await prfOutput(unb64(m.id), unb64(m.salt)); }
  catch (e) { throw new Error(e && e.name === 'NotAllowedError' ? 'Fingerprint cancelled. Use your PIN.' : (e.message || 'Fingerprint did not work. Use your PIN.')); }
  const kek = await hkdfAesKey(out, INFO);
  try { return await decryptBytes(kek, m, INFO); } catch (e) { throw new Error('Fingerprint unlock needs to be set up again. Use your PIN.'); }
}
