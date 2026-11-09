// Microsoft Graph transport for one tracker file. getToken() is supplied by the sign-in module.
import { PreconditionFailed } from './sync.js';

export function encodeShareUrl(url) {
  const b = btoa(unescape(encodeURIComponent(url.trim())));
  return 'u!' + b.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

// A blocked or failed network call shows up in the browser as a bare "Failed to fetch". Say where it failed.
async function netFetch(url, opts, what) {
  try { return await fetch(url, opts); }
  catch (e) { let host = ''; try { host = new URL(url).host; } catch (x) { /* ignore */ } throw new Error('Could not reach ' + what + ' (' + host + '). Check the internet connection and try again.'); }
}

export class GraphFile {
  constructor({ base = 'https://graph.microsoft.com/v1.0', getToken, driveId, itemId }) { Object.assign(this, { base, getToken, driveId, itemId }); }
  async _fetch(path, opts = {}) {
    const token = await this.getToken();
    const r = await netFetch(this.base + path, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } }, 'OneDrive');
    if (r.status === 412) throw new PreconditionFailed('The file changed in OneDrive while syncing.');
    if (r.status === 401) throw new Error('Microsoft sign-in has expired. Sign in again.');
    if (r.status === 404) throw new Error('The tracker file was not found in OneDrive. Check the link in Settings › Sync.');
    if (r.status === 423) { const e = new Error('The tracker is open in Excel, which locks the file. Close it in Excel; the app tries again every 2 minutes.'); e.locked = true; throw e; }
    if (r.status === 429 || r.status === 503) throw new Error('OneDrive is busy. The app will try again shortly.');
    if (!r.ok) throw new Error('OneDrive error ' + r.status);
    return r;
  }
  // Resolve a OneDrive share link (works for the owner and for Madhu) to drive + item ids.
  static async fromShareLink({ base = 'https://graph.microsoft.com/v1.0', getToken, link }) {
    const token = await getToken();
    const r = await netFetch(base + '/shares/' + encodeShareUrl(link) + '/driveItem?$select=id,name,eTag,parentReference,file', { headers: { Authorization: 'Bearer ' + token, Prefer: 'redeemSharingLink' } }, 'OneDrive');
    if (!r.ok) throw new Error(r.status === 403 || r.status === 404 ? 'This link does not open the tracker for this Microsoft account. Ask for an edit link.' : 'OneDrive error ' + r.status);
    const it = await r.json();
    if (!/\.xlsx$/i.test(it.name || '')) throw new Error('That link is not an Excel (.xlsx) file.');
    return { driveId: it.parentReference.driveId, itemId: it.id, name: it.name };
  }
  async meta() { const r = await this._fetch('/drives/' + this.driveId + '/items/' + this.itemId + '?$select=id,name,eTag,lastModifiedDateTime,lastModifiedBy,size'); return r.json(); }
  // Personal OneDrive serves file bytes from a separate host (my.microsoftpersonalcontent.com) through a
  // short-lived, pre-signed download link. Fetch that link directly, without the sign-in token.
  async download() {
    const m = await (await this._fetch('/drives/' + this.driveId + '/items/' + this.itemId)).json();
    const url = m['@microsoft.graph.downloadUrl'];
    let r;
    if (url) {
      r = await netFetch(url, {}, 'the OneDrive file download');
      if (!r.ok) throw new Error('OneDrive download error ' + r.status);
    } else r = await this._fetch('/drives/' + this.driveId + '/items/' + this.itemId + '/content');
    return { bytes: new Uint8Array(await r.arrayBuffer()), etag: m.eTag, meta: m };
  }
  async upload(bytes, etag) {
    const r = await this._fetch('/drives/' + this.driveId + '/items/' + this.itemId + '/content', { method: 'PUT', body: bytes, headers: { 'If-Match': etag, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
    const j = await r.json(); return { etag: j.eTag };
  }
}
