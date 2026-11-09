// Fill clientId after registering the app with Microsoft (see the setup guide). It is not a secret.
export const CONFIG = {
  clientId: '324b5935-2610-43d4-9186-12debef4b075',
  authority: 'https://login.microsoftonline.com/consumers', // personal Microsoft accounts
  scopes: ['Files.ReadWrite.All', 'User.Read'],
  graphBase: 'https://graph.microsoft.com/v1.0',
  autoSyncMinutes: 5,
};
// Local test mode: only on this computer (localhost), never on the published site.
const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
if (local) { try { const t = JSON.parse(localStorage.getItem('ff-test-config') || 'null'); if (t) Object.assign(CONFIG, t); } catch (e) { /* ignore */ } }
