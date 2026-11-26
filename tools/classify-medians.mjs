// tools/classify-medians.mjs — what each median is made of: planted (lawn), concrete or paint (docs/road-medians.md,
// jf-4v9). It looks at the City's 2025 orthophoto inside each median of a built geodata and
// writes tools/fixtures/median-materials.json, which the geodata build (tools/geo-blocks.mjs) reads. It downloads the
// crops (cached), so it is run by hand, not by the build. Entries marked `by: "eye"` were judged by looking at the
// orthophoto and are kept as they are.
// usage: GEO_DATA=<dir> node tools/classify-medians.mjs <geodata.js> [<geodata.js> ...] [--out file] [--no-fetch]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { toLonLat } from './geo-base.mjs';
import { decodePng, cropStats, materialOf, inRing, edgeDistance } from './median-material.mjs';

const OUT_DEFAULT = fileURLToPath(new URL('fixtures/median-materials.json', import.meta.url));
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : OUT_DEFAULT;
const inputs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const CACHE = path.join(os.homedir(), '.cache/slop-toronto/median-ortho');
fs.mkdirSync(CACHE, { recursive: true });
const SERVICES = { s25: 'cot_ortho_2025_color_8cm' };
const MARGIN = 6, PX = 0.25;

const keep = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { entries: [] };
const byEye = (keep.entries || []).filter((e) => e.by === 'eye');

async function crop(svc, id, ring) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const kx = 111320 * Math.cos((y0 * Math.PI) / 180), ky = 111200;
  x0 -= MARGIN / kx; x1 += MARGIN / kx; y0 -= MARGIN / ky; y1 += MARGIN / ky;
  const wm = (x1 - x0) * kx, hm = (y1 - y0) * ky, pxm = Math.max(PX, Math.max(wm, hm) / 1200);
  const W = Math.round(wm / pxm), H = Math.round(hm / pxm);
  const file = path.join(CACHE, `${svc}_${id}_${W}x${H}.png`);
  let buf = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (!buf) {
    if (args.includes('--no-fetch')) throw new Error(`no cached crop ${file}`);
    const url = `https://gis.toronto.ca/arcgis/rest/services/basemap/${svc}/MapServer/export?bbox=${x0},${y0},${x1},${y1}&bboxSR=4326&imageSR=4326&size=${W},${H}&format=png24&f=image`;
    for (let t = 0; t < 5 && !buf; t++) {
      try { const r = await fetch(url); const b = Buffer.from(await r.arrayBuffer()); if (r.ok && b[0] === 0x89) buf = b; } catch {}
      if (!buf) await new Promise((r) => setTimeout(r, 1500 * (t + 1)));
    }
    if (!buf) throw new Error(`could not fetch ${svc} for ${id}`);
    fs.writeFileSync(file, buf);
  }
  const img = decodePng(buf);
  return { img, pts: ring.map(([x, y]) => [((x - x0) / (x1 - x0)) * img.w, ((y1 - y) / (y1 - y0)) * img.h]), pxm };
}

/** A point inside the island, far from its edge as the corners allow (the centroid when it is inside) */
function insidePoint(ring) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const c = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; a += c; cx += (ring[j][0] + ring[i][0]) * c; cy += (ring[j][1] + ring[i][1]) * c; }
  if (a && inRing(cx / (3 * a), cy / (3 * a), ring)) return [cx / (3 * a), cy / (3 * a)];
  let best = ring[0], bd = -1;
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
    const x = x0 + ((x1 - x0) * i) / 20, y = y0 + ((y1 - y0) * j) / 20;
    if (!inRing(x, y, ring)) continue;
    let d = Infinity;
    for (let k = 0; k < ring.length; k++) d = Math.min(d, Math.hypot(ring[k][0] - x, ring[k][1] - y));
    if (d > bd) { bd = d; best = [x, y]; }
  }
  return best;
}

const found = new Map(); // "lon,lat" -> entry, over every input geodata
for (const file of inputs) {
  const w = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: w });
  const medians = [];
  // (a thin block with a building on it or beside it, within the footprint's reach, is a lot on a lane, not a road median:
  // it keeps the lawn, and no building is left standing on road when a gore goes back to it)
  // A building's parts are rectangles [u0, u1, v0, v1] in its own frame (centre, angle): sampled every 2.5 m, in the frame's
  // turn either way (a rotation that is the wrong way round only makes this more careful)
  const roofs = w.CITY.GEO.buildings.map((b) => ({ x: b[0], z: b[1], a: b[2], parts: b[3],
    r: Math.max(...b[3].map(([u0, u1, v0, v1]) => Math.hypot(Math.max(Math.abs(u0), Math.abs(u1)), Math.max(Math.abs(v0), Math.abs(v1))))) }));
  const hasRoof = (flat) => {
    const ring = []; for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
    for (const b of roofs) {
      if (!inRing(b.x, b.z, ring) && edgeDistance(b.x, b.z, ring) >= b.r) continue;
      for (const sign of [1, -1]) {
        const c = Math.cos(sign * b.a), sn = Math.sin(sign * b.a);
        for (const [u0, u1, v0, v1] of b.parts) {
          for (let u = u0; u <= u1 + 1e-6; u += Math.max(0.5, (u1 - u0) / Math.max(1, Math.round((u1 - u0) / 2.5)))) {
            for (let v = v0; v <= v1 + 1e-6; v += Math.max(0.5, (v1 - v0) / Math.max(1, Math.round((v1 - v0) / 2.5)))) {
              if (inRing(b.x + u * c - v * sn, b.z + u * sn + v * c, ring)) return true;
            }
          }
        }
      }
    }
    return false;
  };
  // (the streetcars' own medians are paved, never paint: the renderer lays them as paving whatever this says)
  const tramPts = [];
  for (const [kind, , , flags, flat] of w.CITY.GEO.rails || []) {
    if (kind !== 0 || flags & 2) continue;
    for (let i = 2; i < flat.length; i += 2) {
      const L = Math.hypot(flat[i] - flat[i - 2], flat[i + 1] - flat[i - 1]), n = Math.max(1, Math.ceil(L / 4));
      for (let k = 0; k <= n; k++) tramPts.push([flat[i - 2] + ((flat[i] - flat[i - 2]) * k) / n, flat[i - 1] + ((flat[i + 1] - flat[i - 1]) * k) / n]);
    }
  }
  const hasTram = (flat) => {
    const ring = []; for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
    return tramPts.some(([x, z]) => inRing(x, z, ring));
  };
  w.CITY.GEO.blocks.forEach((b, id) => { if (b[5] && !hasRoof(b[0])) medians.push({ id, flat: b[0], tram: hasTram(b[0]) }); });
  console.log(`${file}: ${medians.length} medians`);
  let done = 0;
  const queue = medians.slice();
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const ring = []; for (let i = 0; i < m.flat.length; i += 2) ring.push(toLonLat(m.flat[i], m.flat[i + 1]));
      const pt = insidePoint(ring);
      const key = pt.map((v) => v.toFixed(6)).join(',');
      if (found.has(key)) continue;
      const area = Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2 * 111320 * Math.cos((ring[0][1] * Math.PI) / 180) * 111200;
      const per = ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + Math.hypot((q[0] - p[0]) * 111320 * Math.cos((p[1] * Math.PI) / 180), (q[1] - p[1]) * 111200); }, 0);
      const erode = Math.min(0.9, Math.max(0.25, 0.3 * ((2 * area) / per)));
      const st = {};
      for (const [k, svc] of Object.entries(SERVICES)) {
        const c = await crop(svc, `${m.id}-${key.replace(/[,.-]/g, '')}`, ring);
        st[k] = cropStats(c.img, c.pts, c.pxm, erode);
      }
      found.set(key, { pt: pt.map((v) => +v.toFixed(6)), area: Math.round(area), kind: (k => (k === 'paint' && m.tram ? 'concrete' : k))(materialOf(st.s25, (2 * area) / per)), vf: +st.s25.vf.toFixed(2), greener: +st.s25.greener.toFixed(2), dL: +(st.s25.L - st.s25.ringL).toFixed(0) });
      if (++done % 100 === 0) console.log(`  ${done}/${medians.length}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

// the eye's judgements stand, where a median's point lies in the same place
const entries = [...found.values()].filter((e) => e.kind !== 'lawn' && !byEye.some((b) => Math.hypot((b.pt[0] - e.pt[0]) * 80000, (b.pt[1] - e.pt[1]) * 111200) < 3));
const result = { what: 'What the medians are made of where it is not planted lawn (docs/road-medians.md). `pt` is a point inside the median (lon/lat, the City frame); `kind` is concrete (raised, paved) or paint (a gore on the road, no kerb). `by: "eye"` entries were judged on the orthophoto by hand and are never overwritten.',
  entries: [...byEye, ...entries.sort((a, b) => a.pt[0] - b.pt[0] || a.pt[1] - b.pt[1])] };
fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
const count = {};
for (const e of found.values()) count[e.kind] = (count[e.kind] || 0) + 1;
console.log('classified', found.size, count, '->', OUT);
