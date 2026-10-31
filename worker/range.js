// worker/range.js: byte-range (206) responses for the landing page's clips (assets/site/clips/*.mp4 / .webm).
// Workers static assets answer a Range request with the whole file as 200 and no Accept-Ranges (checked on
// sloptoronto.ca and in wrangler dev, 2026-10-31), and Safari / iOS will not play a <video> whose server does not
// honour ranges. wrangler.jsonc sends these paths to the Worker first (run_worker_first); serveClip() asks the assets
// binding for the file and cuts the range out of it. The clips are a few MB at most, so reading one whole is cheap.
// One range per request (RFC 9110 lets a server ignore a multi-range request and send 200); an asset response that
// is already partial (206 / 416) passes through untouched, in case the assets binding learns ranges itself.

export const CLIPS = '/assets/site/clips/';
export const isClip = (pathname) => pathname.startsWith(CLIPS);

// The single byte range a Range header asks for in a body of `size` bytes:
// { start, end } (inclusive), 'unsatisfiable' (416), or null to ignore the header and send the whole file
export function parseRange(header, size) {
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header || '');
  if (!m || (m[1] === '' && m[2] === '')) return null; // not a single byte range (or several): ignored
  if (m[1] === '') { // bytes=-N: the last N bytes
    const n = Number(m[2]);
    if (n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  if (m[2] !== '' && Number(m[2]) < start) return null; // invalid (last byte before first): ignored
  if (start >= size) return 'unsatisfiable';
  const end = m[2] === '' ? size - 1 : Number(m[2]);
  return { start, end: Math.min(end, size - 1) };
}

// If-Range: the range applies only while the validator still matches the file (a strong ETag or the Last-Modified date)
function ifRangeHolds(request, res) {
  const v = request.headers.get('if-range');
  if (!v) return true;
  const etag = res.headers.get('etag');
  if (v.startsWith('"') || v.startsWith('W/')) return !!etag && v === etag && !etag.startsWith('W/');
  return v === res.headers.get('last-modified');
}

export async function serveClip(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 200) return res; // 206/416 from the binding itself, 304, 404 ...
  const headers = new Headers(res.headers); // keeps the _headers Cache-Control, nosniff, ETag and Content-Type
  headers.set('accept-ranges', 'bytes');
  const range = request.headers.get('range');
  const method = request.method;
  if (!range || (method !== 'GET' && method !== 'HEAD') || headers.has('content-encoding') || !ifRangeHolds(request, res)) {
    return new Response(res.body, { status: 200, headers });
  }
  // (a HEAD has no body to measure: its Content-Length gives the size)
  const head = method === 'HEAD', declared = Number(res.headers.get('content-length'));
  if (head && !(declared >= 0)) return new Response(null, { status: 200, headers });
  const body = head ? null : new Uint8Array(await res.arrayBuffer());
  const size = head ? declared : body.byteLength;
  const r = parseRange(range, size);
  if (r === null) return new Response(body, { status: 200, headers });
  if (r === 'unsatisfiable') {
    const h = new Headers(headers);
    h.delete('content-type');
    h.set('content-range', `bytes */${size}`);
    h.set('content-length', '0');
    return new Response(null, { status: 416, headers: h });
  }
  headers.set('content-range', `bytes ${r.start}-${r.end}/${size}`);
  headers.set('content-length', String(r.end - r.start + 1));
  return new Response(head ? null : body.subarray(r.start, r.end + 1), { status: 206, headers });
}
