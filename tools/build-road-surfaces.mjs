// tools/build-road-surfaces.mjs — writes the surveyed road surfaces of tools/fixtures/road-surfaces.json from its own
// stations (kerb offsets measured on the City's 2025 orthophoto, docs/road-widths.md): along each chain of OSM ways a
// ribbon per way, its edges at the stations' offsets interpolated along the chain; the measured deck width of each
// road bridge; the area of each retired City polygon (so the build can match it); and the ring of each ground strip
// (City roadway the orthophoto shows is grass, cut out of a polygon that is otherwise right).
// usage: GEO_DATA=<dir> node tools/build-road-surfaces.mjs [--check]
//   (GEO_DATA: the OSM extract and city_roadway.json, ~/.cache/slop-toronto/osm-ids)
//   --check exits 1 if the committed fixture differs from what its stations give.
import fs from 'node:fs';
import { toWorld, toLonLat, load, osmRoads } from './geo-base.mjs';
import { FIXTURE, lonLatArea, inRing } from './road-surfaces.mjs';

const STEP = 2; // m between the ribbon's points (and every vertex of the way)
const fix = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const byId = new Map(osmRoads.elements.filter((e) => e.geometry).map((e) => [e.id, e]));
const r7 = (v) => Math.round(v * 1e7) / 1e7;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A chain's ways oriented end to end: { pts, s (along), ways: [{ id, from, to, reversed, len, bridge }] } */
export function orientChain(ids, geom) {
  const lines = ids.map((id) => geom(id));
  const ways = [];
  const pts = [];
  for (let k = 0; k < lines.length; k++) {
    let g = lines[k];
    let reversed = false;
    if (k === 0) {
      const next = lines[1];
      if (next && Math.min(dist(g[0], next[0]), dist(g[0], next[next.length - 1])) < Math.min(dist(g[g.length - 1], next[0]), dist(g[g.length - 1], next[next.length - 1]))) reversed = true;
    } else {
      const last = pts[pts.length - 1];
      if (dist(g[g.length - 1], last) < dist(g[0], last)) reversed = true;
    }
    if (reversed) g = [...g].reverse();
    if (k > 0 && dist(g[0], pts[pts.length - 1]) > 1) throw new Error(`chain broken at way ${ids[k]} (${dist(g[0], pts[pts.length - 1]).toFixed(1)} m)`);
    let len = 0;
    for (let i = 0; i + 1 < g.length; i++) len += dist(g[i], g[i + 1]);
    ways.push({ id: ids[k], reversed, len, start: pts.length ? pts.length - 1 : 0, g });
    for (let i = k ? 1 : 0; i < g.length; i++) pts.push(g[i]);
  }
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]));
  let acc = 0;
  for (const w of ways) { w.from = acc; w.to = acc + w.len; acc = w.to; }
  return { pts, s, ways };
}

/** Station offsets [left, right] along the chain, flipped on a way that runs against it, sorted by chain distance */
export function chainStations(chain, stations) {
  const out = [];
  for (const st of stations) {
    const w = chain.ways.find((x) => x.id === st.way);
    if (!w) continue;
    if (st.at < 0 || st.at > w.len + 0.5) throw new Error(`station ${st.way}@${st.at} is off its way (${w.len.toFixed(1)} m)`);
    const s = w.reversed ? w.to - st.at : w.from + st.at;
    out.push({ s, left: w.reversed ? -st.right : st.left, right: w.reversed ? -st.left : st.right, id: `${st.way}@${st.at}` });
  }
  return out.sort((a, b) => a.s - b.s);
}

/** Offsets at chain distance s: linear between stations, held beyond the first and last */
export function offsetsAt(sts, s) {
  if (!sts.length) throw new Error('no stations');
  if (s <= sts[0].s) return [sts[0].left, sts[0].right];
  for (let i = 0; i + 1 < sts.length; i++) {
    if (s <= sts[i + 1].s) {
      const t = (s - sts[i].s) / (sts[i + 1].s - sts[i].s || 1);
      return [sts[i].left + (sts[i + 1].left - sts[i].left) * t, sts[i].right + (sts[i + 1].right - sts[i].right) * t];
    }
  }
  const z = sts[sts.length - 1];
  return [z.left, z.right];
}

/** Point and unit direction at chain distance s */
function at(chain, s) {
  const { pts, s: S } = chain;
  let i = 0;
  while (i + 2 < pts.length && S[i + 1] < s) i++;
  const a = pts[i], b = pts[i + 1];
  const L = S[i + 1] - S[i] || 1e-9;
  const t = Math.max(0, Math.min(1, (s - S[i]) / L));
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], i };
}

/** The ribbon of one way of a chain between chain distances s0..s1: its ring in world metres, and its width range */
export function ribbon(chain, sts, s0, s1) {
  const ss = [s0];
  for (let s = Math.ceil(s0 / STEP) * STEP; s < s1; s += STEP) if (s > s0 + 0.2 && s < s1 - 0.2) ss.push(s);
  for (const v of chain.s) if (v > s0 + 0.2 && v < s1 - 0.2) ss.push(v);
  ss.push(s1);
  ss.sort((a, b) => a - b);
  const L = [], R = [];
  let wmin = Infinity, wmax = -Infinity;
  for (const s of ss) {
    // the direction at a vertex is the mean of its two segments'
    const a = at(chain, s - 0.01), b = at(chain, s + 0.01);
    let dx = a.d[0] + b.d[0], dz = a.d[1] + b.d[1];
    const n = Math.hypot(dx, dz) || 1;
    dx /= n; dz /= n;
    const p = at(chain, s).p;
    const [l, r] = offsetsAt(sts, s);
    // right of travel in world x (east), z (south): (-dz, dx)
    const rx = -dz, rz = dx;
    L.push([p[0] + rx * l, p[1] + rz * l]);
    R.push([p[0] + rx * r, p[1] + rz * r]);
    wmin = Math.min(wmin, r - l);
    wmax = Math.max(wmax, r - l);
  }
  return { ring: [...L, ...R.reverse()], width: [Math.round(wmin * 10) / 10, Math.round(wmax * 10) / 10] };
}

export function buildSurfaces(f, geom, tags) {
  const surfaces = [];
  for (const c of f.chains) {
    const chain = orientChain(c.ways, geom);
    const sts = chainStations(chain, f.stations);
    const from = c.from ?? 0, to = c.to ?? Infinity;
    for (const w of chain.ways) {
      const s0 = Math.max(w.from, from), s1 = Math.min(w.to, to);
      if (s1 - s0 < 1) continue;
      const { ring, width } = ribbon(chain, sts, s0, s1);
      const t = tags(w.id);
      surfaces.push({
        id: `${c.id}/${w.id}`, street: c.street, kind: t.bridge && t.bridge !== 'no' ? 'bridge deck' : 'carriageway', way: w.id,
        source: 'city-ortho-2025', date: '2025', width, parking: c.parking ?? null,
        stations: sts.filter((x) => x.s >= s0 - 60 && x.s <= s1 + 60).map((x) => x.id),
        ring: ring.map(([x, z]) => toLonLat(x, z).map(r7))
      });
    }
  }
  return surfaces;
}

/** The ground strips: City roadway the 2025 orthophoto shows is not road, beside a surveyed lane. Each runs along one OSM
 *  way between `from` and `to` (m from its first node), from the measured kerb (`edge`: [at, offset] pairs, offsets to
 *  the right of the way, held beyond the first and last) out `depth` metres. Rings in lon/lat. */
export function buildGround(f, geom) {
  return (f.ground || []).map((g) => {
    if (g.side !== 'right') throw new Error(`ground ${g.id}: only side "right" is supported`);
    const chain = orientChain([g.way], geom);
    const sts = g.edge.map(([s, off]) => ({ s, left: off, right: off + g.depth })).sort((a, b) => a.s - b.s);
    const { ring } = ribbon(chain, sts, g.from, Math.min(g.to, chain.ways[0].len));
    return { ...g, ring: ring.map(([x, z]) => toLonLat(x, z).map(r7)) };
  });
}

export function bridgeWidthsFromStations(f) {
  return f.bridges.map((b) => {
    const sts = f.stations.filter((s) => b.ways.includes(s.way));
    if (!sts.length) throw new Error(`bridge ${b.id} has no station`);
    const width = Math.round((sts.reduce((a, s) => a + (s.right - s.left), 0) / sts.length) * 10) / 10;
    return { ...b, width, stations: sts.map((s) => `${s.way}@${s.at}`) };
  });
}

export function retireAreas(f, city) {
  return f.retire.map((r) => {
    const hits = city.filter(([kind, ring]) => kind === r.kind && inRing(r.point, ring));
    if (hits.length !== 1) throw new Error(`retired City polygon ${r.objectId}: ${hits.length} polygons hold its point`);
    return { ...r, area: Math.round(lonLatArea(hits[0][1])) };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const geom = (id) => {
    const e = byId.get(id);
    if (!e) throw new Error(`OSM way ${id} is not in the extract`);
    return e.geometry.map((g) => toWorld(g.lon, g.lat));
  };
  const out = {
    ...fix,
    bridges: bridgeWidthsFromStations(fix),
    retire: retireAreas(fix, load('city_roadway.json').polygons),
    surfaces: buildSurfaces(fix, geom, (id) => byId.get(id).tags || {}),
    ground: buildGround(fix, geom)
  };
  // (one line per coordinate pair)
  const text = JSON.stringify(out, null, 1).replace(/\[\n\s*(-?[\d.]+),\n\s*(-?[\d.]+)\n\s*\]/g, '[$1, $2]') + '\n';
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(FIXTURE, 'utf8') !== text) { console.error('tools/fixtures/road-surfaces.json is stale: run node tools/build-road-surfaces.mjs'); process.exit(1); }
    console.log('road-surfaces.json is up to date');
  } else {
    fs.writeFileSync(FIXTURE, text);
    console.log(`wrote ${FIXTURE}: ${out.surfaces.length} surfaces, ${out.bridges.length} bridges (${out.bridges.map((b) => `${b.id} ${b.width} m`).join(', ')}), ${out.retire.length} City polygons retired, ${out.ground.length} ground strips`);
  }
}
