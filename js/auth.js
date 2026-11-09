// Microsoft sign-in. Uses the MSAL library bundled in /vendor (no CDN). MSAL keeps its sign-in tokens in this
// browser's local storage so closing the app does not sign you out; Sign out clears them. The app never sees
// or stores your Microsoft password.
import { CONFIG } from './config.js';
let pca = null, account = null;

function testMode() { return !!CONFIG.testToken; }

// init runs once; later calls get the same promise, so the lock screen can show before sign-in is ready
let ready = null;
export function init() { return ready || (ready = initOnce()); }
async function initOnce() {
  if (testMode()) { account = { username: CONFIG.testUser || 'test@example.com', name: CONFIG.testName || 'Test' }; return account; }
  if (!CONFIG.clientId) return null;
  if (!window.msal) throw new Error('Sign-in library missing.');
  pca = new window.msal.PublicClientApplication({ auth: { clientId: CONFIG.clientId, authority: CONFIG.authority, redirectUri: location.origin + location.pathname }, cache: { cacheLocation: 'localStorage' } });
  await pca.initialize();
  const r = await pca.handleRedirectPromise();
  account = (r && r.account) || pca.getAllAccounts()[0] || null;
  return account;
}
export const configured = () => testMode() || !!CONFIG.clientId;
export const currentAccount = () => account;
export async function signIn() {
  if (testMode()) return account;
  await pca.loginRedirect({ scopes: CONFIG.scopes, prompt: 'select_account' });
}
export async function signOut() { if (testMode()) { account = null; return; } if (pca && account) await pca.logoutRedirect({ account }); }
// Background syncs never leave the app to sign in (leaving the page locks the app). They set needsSignIn instead,
// and only a sync you start yourself goes to the Microsoft sign-in page (you unlock again when you come back).
let needs = false;
export const needsSignIn = () => needs;
export async function getToken(interactive = false) {
  if (testMode()) { if (CONFIG.testExpired && !interactive) { needs = true; throw new Error('Microsoft sign-in expired. Tap Sync to sign in again.'); } needs = false; return CONFIG.testToken; }
  if (!account) throw new Error('Not signed in to Microsoft.');
  try { const t = (await pca.acquireTokenSilent({ scopes: CONFIG.scopes, account })).accessToken; needs = false; return t; }
  catch (e) {
    needs = true;
    if (!interactive) throw new Error('Microsoft sign-in expired. Tap Sync to sign in again.');
    await pca.acquireTokenRedirect({ scopes: CONFIG.scopes, account }); throw new Error('Signing in again…');
  }
}
