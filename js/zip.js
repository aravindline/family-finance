// Minimal ZIP reader/writer for .xlsx files, using the browser's built-in deflate (no libraries).
const td = new TextDecoder(), te = new TextEncoder();
let CRC_T = null;
function crc32(b) {
  if (!CRC_T) { CRC_T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
async function pipe(bytes, stream) { const r = new Blob([bytes]).stream().pipeThrough(stream); return new Uint8Array(await new Response(r).arrayBuffer()); }
const inflate = b => pipe(b, new DecompressionStream('deflate-raw'));
const deflate = b => pipe(b, new CompressionStream('deflate-raw'));

// Returns { order: [names], files: Map(name -> Uint8Array) }
export async function readZip(buf) {
  const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let eocd = -1; for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not an Excel file (zip end record missing).');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const order = [], files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged Excel file (central directory).');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = td.decode(u.subarray(p + 46, p + 46 + nlen));
    const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true);
    const data = u.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
    files.set(name, method === 0 ? data.slice() : method === 8 ? await inflate(data) : (() => { throw new Error('Unsupported zip compression ' + method); })());
    order.push(name); p += 46 + nlen + xlen + clen;
  }
  return { order, files };
}

export async function writeZip(order, files) {
  const parts = [], central = []; let off = 0;
  const now = new Date(), dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)), dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate());
  for (const name of order) {
    const raw = files.get(name); if (!raw) continue;
    const nb = te.encode(name), comp = await deflate(raw), crc = crc32(raw);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 8, true); lh.setUint16(10, dt, true); lh.setUint16(12, dd, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, comp.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nb, comp);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 8, true); ch.setUint16(12, dt, true); ch.setUint16(14, dd, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, comp.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + comp.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, order.length, true); e.setUint16(10, order.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  const blob = new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return new Uint8Array(await blob.arrayBuffer());
}
export const text = b => td.decode(b);
export const bytes = s => te.encode(s);
