import { key } from './search-text.js';

export const IDLE = 400;
export const NEAR_NUM = 40;
const SNAP_METRES = 300;
export const AREAS = ['Old Toronto', 'East York', 'Etobicoke', 'North York', 'Scarborough', 'York'];

export const askable = (q) => q.length >= 3 && q.length <= 80 && /[a-z0-9]/i.test(q);

/** FNV-1a over the street key, shared with the address shard generator. */
export function shardOf(k) {
  let h = 0x811c9dc5;
  for (let i = 0; i < k.length; i++) {
    h ^= k.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h & 255;
}

export function parseAddress(label) {
  const m = /^\s*(\d+[a-z]?(?:\s+1\/2)?)(?:\s*[-–]\s*\d+[a-z]?)?\s+([^,]+?)\s*(?:,\s*([^,]+))?(?:,|$)/i.exec(label);
  if (!m) return null;
  const area = m[3]?.trim() || '';
  const areaIndex = AREAS.findIndex((name) => key(name) === key(area));
  const inToronto = !area || /^(toronto|on|ontario|canada)(\s+[a-z]\d[a-z]\s?\d[a-z]\d)?$/i.test(area);
  return { num: m[1].toLowerCase().replace(/\s+/g, '~'), street: m[2], area: areaIndex < 0 ? null : areaIndex, outsideCity: areaIndex < 0 && !inToronto };
}

/** Prefer exact numbers across municipalities. For a missing number, find a nearby number in each area. */
export function cityAddressesFor(shard, num, streetKey, area = null, { exactOnly = false } = {}) {
  const street = shard?.s?.[streetKey];
  if (!street?.points) return [];
  const best = new Map();
  const n = parseInt(num, 10);
  for (const point of street.points.split(',')) {
    const [number, lat, lon, municipality] = point.split(' ');
    const m = Number(municipality);
    if (area !== null && m !== area) continue;
    const exact = number === num;
    if (exactOnly && !exact) continue;
    const delta = Math.abs(parseInt(number, 10) - n);
    const sameSide = delta % 2 === 0;
    if (delta > (sameSide ? NEAR_NUM : NEAR_NUM / 2)) continue;
    const rank = exact ? -1 : delta + (sameSide ? 0 : NEAR_NUM + 1);
    if (rank >= (best.get(m)?.rank ?? Infinity)) continue;
    best.set(m, { num: number.replace('~', ' '), lat: +lat / 1e6, lon: +lon / 1e6, area: m, exact, rank });
  }
  const rows = [...best.values()];
  return rows.some((r) => r.exact) ? rows.filter((r) => r.exact) : rows;
}

async function addressShard(address, signal, doFetch) {
  const streetKey = key(address.street);
  const shard = shardOf(streetKey).toString(16).padStart(2, '0');
  const response = await doFetch(`/assets/geocoder/addresses/${shard}.json`, { signal });
  if (!response.ok) throw new Error('Address lookup failed');
  return { json: await response.json(), streetKey };
}

export async function lookup(q, { signal, project, onMap, near, local, doFetch = fetch }) {
  const address = parseAddress(q);
  if (address) {
    if (address.outsideCity) return [];
    const { json, streetKey } = await addressShard(address, signal, doFetch);
    return cityAddressesFor(json, address.num, streetKey, address.area).map((r) => {
      const point = project(r.lat, r.lon);
      const distance = near ? Math.hypot(point.x - near.x, point.z - near.z) : null;
      return {
        ...point, distance, id: `address:${streetKey}:${r.num}:${r.area}`, kind: 'address',
        name: `${r.num} ${json.s[streetKey].name}`, outside: !onMap(point.x, point.z),
        sub: ['City address', AREAS[r.area], !r.exact && `Nearest to ${address.num.replace('~', ' ')}`].filter(Boolean).join(' · ')
      };
    }).sort((a, b) => Number(a.outside) - Number(b.outside) || a.distance - b.distance);
  }

  const response = await doFetch(`/live/geocode?q=${encodeURIComponent(q)}`, {
    signal, cache: 'no-store', headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error('Place lookup failed');
  const { results } = await response.json();
  return Promise.all(results.map(async (r) => {
    let point = project(r.lat, r.lon);
    if (r.kind === 'Address') {
      const a = parseAddress(r.name);
      if (a && !a.outsideCity) {
        try {
          const { json, streetKey } = await addressShard(a, signal, doFetch);
          const closest = cityAddressesFor(json, a.num, streetKey, a.area, { exactOnly: true })
            .map((c) => project(c.lat, c.lon))
            .map((p) => ({ ...p, d: Math.hypot(p.x - point.x, p.z - point.z) }))
            .sort((p, other) => p.d - other.d)[0];
          if (closest?.d < SNAP_METRES) point = closest;
        } catch {
          signal.throwIfAborted();
        }
      }
    } else if (r.kind === 'Place') {
      const named = local(r.name).find((p) => p.kind !== 'street' && key(p.name) === key(r.name) &&
        Math.hypot(p.x - point.x, p.z - point.z) < SNAP_METRES);
      if (named) point = { x: named.x, z: named.z };
    }
    return {
      x: point.x, z: point.z, id: `geocode:${r.name}`, kind: r.kind === 'Address' ? 'address' : 'geocode',
      name: r.name, sub: r.kind, postal: r.kind === 'Postal code', provider: true,
      outside: !onMap(point.x, point.z)
    };
  }));
}

/** Debounce the lookup, run it immediately on Enter, and discard superseded queries. */
export function createLookup(run, { idle = IDLE, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null, controller = null, queued = null;
  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    queued = null;
    controller?.abort();
    controller = null;
  }
  function start(q, done, immediate = false) {
    cancel();
    const request = controller = new AbortController();
    const ask = async () => {
      timer = null;
      queued = null;
      let rows;
      try {
        rows = await run(q, request.signal);
      } catch {
        rows = [];
      }
      if (request.signal.aborted) return;
      controller = null;
      done(rows);
    };
    if (immediate) void ask();
    else {
      queued = ask;
      timer = setTimer(ask, idle);
    }
  }
  function flush() {
    if (timer === null) return;
    clearTimer(timer);
    void queued();
  }
  return { start, cancel, flush };
}
