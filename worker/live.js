// worker/live.js: the site's Worker (wrangler.jsonc). The static site (dist/) is served as the Worker's assets
// first; only requests no asset matches reach this script:
// - /live/vehicles: the TTC's live vehicle positions in the city (BusTime GTFS-Realtime,
//   https://bustime.ttc.ca/gtfsrt/vehicles; Open Government Licence – Toronto), read from the TTC at most once every
//   15 s whatever the number of visitors (the Cache API, then a module-level copy), decoded from protobuf and cut down
//   to the vehicles within the city as compact JSON:
//   { t: feed time (s), v: [[route, direction (0/1, -1 unknown), lat, lon, bearing (deg, -1 unknown), time (s), id], ...] }
//   (the TTC's feed has no CORS header, so the browser can't read it itself)
// - everything else: the assets binding (its 404s).

const FEED = 'https://bustime.ttc.ca/gtfsrt/vehicles';
const TTL = 15; // s
// the detailed city's bounds (js/toronto-geodata.js GEO.frame.detail, as lat / lon), and a little more
const BOUNDS = { lat0: 43.590, lat1: 43.684, lon0: -79.490, lon1: -79.319 };

// --- a minimal protobuf reader for GTFS-Realtime's FeedMessage (the fields read here only)
function reader(buf, pos = 0, end = buf.length) {
  return { buf, pos, end };
}
function varint(r) {
  let x = 0, mul = 1, b;
  do {
    b = r.buf[r.pos++];
    x += (b & 0x7f) * mul;
    mul *= 128;
  } while (b & 0x80);
  return x;
}
const view = (r) => new DataView(r.buf.buffer, r.buf.byteOffset, r.buf.byteLength);
// each field of a message: fn(field number, wire type, reader positioned at its value); skips what fn leaves
function fields(r, fn) {
  while (r.pos < r.end) {
    const key = varint(r), f = Math.floor(key / 8), wt = key & 7;
    const start = r.pos;
    let len = 0;
    if (wt === 0) varint(r);
    else if (wt === 1) r.pos += 8;
    else if (wt === 5) r.pos += 4;
    else if (wt === 2) {
      len = varint(r);
      const s = r.pos;
      r.pos += len;
      fn(f, wt, reader(r.buf, s, s + len));
      continue;
    } else throw new Error('protobuf wire type ' + wt);
    const after = r.pos;
    r.pos = start;
    fn(f, wt, r);
    r.pos = after;
  }
}
const str = (r) => new TextDecoder().decode(r.buf.subarray(r.pos, r.end));
const f32 = (r) => view(r).getFloat32(r.pos, true);

function decode(buf) {
  const out = { t: 0, v: [] };
  fields(reader(buf), (f, wt, r) => {
    if (f === 1 && wt === 2) {
      fields(r, (g, w2, h) => { if (g === 3 && w2 === 0) out.t = varint(h); }); // header.timestamp
    } else if (f === 2 && wt === 2) {
      // FeedEntity.vehicle (4): VehiclePosition { trip 1, position 2, timestamp 5, vehicle 8 }
      fields(r, (g, w2, e) => {
        if (g !== 4 || w2 !== 2) return;
        let route = '', dir = -1, lat = NaN, lon = NaN, bearing = -1, ts = 0, id = '';
        fields(e, (k, w3, x) => {
          if (k === 1 && w3 === 2) fields(x, (m, w4, y) => {
            if (m === 5 && w4 === 2) route = str(y); // TripDescriptor.route_id
            else if (m === 6 && w4 === 0) dir = varint(y); // direction_id
          });
          else if (k === 2 && w3 === 2) fields(x, (m, w4, y) => {
            if (w4 !== 5) return;
            if (m === 1) lat = f32(y);
            else if (m === 2) lon = f32(y);
            else if (m === 3) bearing = f32(y);
          });
          else if (k === 5 && w3 === 0) ts = varint(x);
          else if (k === 8 && w3 === 2) fields(x, (m, w4, y) => { if (m === 1 && w4 === 2) id = str(y); });
        });
        if (!route || !(lat > BOUNDS.lat0 && lat < BOUNDS.lat1 && lon > BOUNDS.lon0 && lon < BOUNDS.lon1)) return;
        out.v.push([route, dir, Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6, bearing >= 0 ? Math.round(bearing) : -1, ts, id]);
      });
    }
  });
  return out;
}

let last = null; // { at: ms, body }
async function vehicles(ctx) {
  const now = Date.now();
  if (last && now - last.at < TTL * 1000) return last.body;
  const cache = caches.default;
  const key = new Request('https://live.cache/ttc-vehicles');
  const hit = await cache.match(key);
  if (hit) {
    const body = await hit.text();
    const at = Number(hit.headers.get('x-fetched-at')) || now;
    if (now - at < TTL * 1000) {
      last = { at, body };
      return body;
    }
  }
  const res = await fetch(FEED, { cf: { cacheTtl: 0 } });
  if (!res.ok) throw new Error('feed ' + res.status);
  const body = JSON.stringify(decode(new Uint8Array(await res.arrayBuffer())));
  last = { at: now, body };
  ctx.waitUntil(cache.put(key, new Response(body, { headers: { 'cache-control': `max-age=${TTL}`, 'x-fetched-at': String(now) } })));
  return body;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/live/vehicles') {
      try {
        return new Response(await vehicles(ctx), {
          headers: {
            'content-type': 'application/json',
            'cache-control': `public, max-age=${TTL}`,
            'x-content-type-options': 'nosniff',
            'x-data-source': 'TTC BusTime GTFS-Realtime, Open Government Licence – Toronto'
          }
        });
      } catch (e) {
        // (the client falls back to the timetable)
        return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
    }
    return env.ASSETS.fetch(request);
  }
};

export { decode };
