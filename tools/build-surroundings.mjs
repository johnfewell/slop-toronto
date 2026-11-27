// tools/build-surroundings.mjs — builds js/toronto-surroundings-data.js from the cached Geofabrik Ontario OSM extract
// (~/.cache/slop-toronto/raw/ontario-latest.osm.pbf): real GTA land use over [-26000..26000] (52 km x 52 km, matching
// GEO.terrain) and real OSM tall/major buildings outside the Eglinton frame (Mississauga, Etobicoke, North York,
// York Region, Scarborough) so the frame edges and outer horizon reflect what stands there (st-bz1o.10).
//
// Source: Geofabrik Ontario OSM extract (© OpenStreetMap contributors, ODbL 1.0).
// usage: node tools/build-surroundings.mjs [ontario-latest.osm.pbf] [--out js/toronto-surroundings-data.js]
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONF = fileURLToPath(new URL('osmconf.ini', import.meta.url));

// Exact world projection shared by detail and Eglinton frames (tools/geo-base.mjs)
export const PROJ = {
  lat0: 43.6532,
  lon0: -79.3832,
  kx: 80682.47,
  ky: 111105.32,
  theta: 0.2897,
  ox: -466,
  oz: 1008
};
export const EGLINTON = { x0: -7900, x1: 9600, z0: -7300, z1: 3600 };
export const LU_BOUNDS = { minX: -26000, maxX: 26000, minZ: -26000, maxZ: 26000, size: 256 };
const SUB = 2; // rasterise at 512x512 then box-filter to 256x256 for smooth ravines
const BLD_LIMIT = 25000;
const COLLAR_DIST = 4500; // m outside Eglinton frame where mid-rise & large commercial/industrial footprints are also kept
const MAX_COLLAR_EXTRA = 2400;

const C = Math.cos(PROJ.theta), S = Math.sin(PROJ.theta);
export function toWorld(lon, lat) {
  const e = (lon - PROJ.lon0) * PROJ.kx, n = (lat - PROJ.lat0) * PROJ.ky;
  return [e * C - n * S - PROJ.ox, -(e * S + n * C) - PROJ.oz];
}
export function toLonLat(x, z) {
  const u = x + PROJ.ox, v = z + PROJ.oz;
  return [PROJ.lon0 + (u * C - v * S) / PROJ.kx, PROJ.lat0 + (-u * S - v * C) / PROJ.ky];
}

export function edgeDistBox(x, z, box = EGLINTON) {
  const dx = Math.max(box.x0 - x, 0, x - box.x1);
  const dz = Math.max(box.z0 - z, 0, z - box.z1);
  return Math.hypot(dx, dz);
}

export function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const v of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], v) <= 0) lo.pop(); lo.push(v); }
  for (let i = p.length - 1; i >= 0; i--) { const v = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], v) <= 0) hi.pop(); hi.push(v); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

export function minRect(ring) {
  const H = hull(ring);
  if (H.length < 3) return null;
  let best = null;
  for (let i = 0; i < H.length; i++) {
    const [x0, z0] = H[i], [x1, z1] = H[(i + 1) % H.length];
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 1e-6) continue;
    const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of H) {
      const a = x * ux + z * uz, b = -x * uz + z * ux;
      if (a < a0) a0 = a; if (a > a1) a1 = a;
      if (b < b0) b0 = b; if (b > b1) b1 = b;
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) {
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      best = { area, cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, w: a1 - a0, d: b1 - b0, ux, uz };
    }
  }
  if (!best) return null;
  let { ux, uz, w, d } = best;
  if (d > w) { [w, d] = [d, w]; [ux, uz] = [-uz, ux]; }
  if (ux < 0) { ux = -ux; uz = -uz; }
  return { cx: best.cx, cz: best.cz, w, d, ang: Math.atan2(-uz, ux), area: w * d };
}

const PARK_LEISURE = /^(park|nature_reserve|golf_course|recreation_ground|garden|pitch|common|dog_park)$/;
const PARK_NATURAL = /^(wood|forest|scrub|grassland|heath|wetland|meadow)$/;
const PARK_LANDUSE = /^(forest|meadow|grass|recreation_ground|cemetery|village_green|orchard|farmland|greenfield|conservation)$/;
const IND_LANDUSE = /^(industrial|commercial|retail|railway|port|quarry|landfill|brownfield|construction)$/;
const IND_AERO = /^(aerodrome|apron|terminal|runway|taxiway|hangar)$/;

export function classifyLandUse(t) {
  if (!t) return -1;
  if (PARK_LEISURE.test(t.leisure || '') || PARK_NATURAL.test(t.natural || '') || PARK_LANDUSE.test(t.landuse || '')) return 0; // park/woods (R)
  if (IND_LANDUSE.test(t.landuse || '') || IND_AERO.test(t.aeroway || '')) return 1; // industry/commercial/airport (G)
  if (t.landuse === 'residential') return 2; // residential/leafy (B)
  return -1;
}

const IND_BLD = /^(industrial|warehouse|retail|supermarket|hangar|manufacture|factory|commercial)$/;
const LIGHT_BLD = /^(school|university|college|hospital|civic|public|government|train_station|transportation)$/;

export function classifyBuildingStyle(t, h, area) {
  const b = t.building || 'yes';
  if (h >= 40 || ((b === 'office' || b === 'commercial') && h >= 22)) return 1; // glass
  if (IND_BLD.test(b) || (area >= 2200 && h < 18)) return 2; // industrial
  if (LIGHT_BLD.test(b)) return 4; // light
  if (h >= 24 || b === 'apartments') return 3; // modern
  return 0; // brick
}

export function parseOsmHeight(t) {
  if (!t) return null;
  const hm = /^(\d+(?:\.\d+)?)/.exec(String(t.height || '').trim());
  if (hm) {
    const v = parseFloat(hm[1]);
    if (v >= 3 && v <= 400) return v;
  }
  const lm = /^(\d+(?:\.\d+)?)/.exec(String(t['building:levels'] || '').trim());
  if (lm) {
    const v = parseFloat(lm[1]) * 3.3;
    if (v >= 3 && v <= 400) return v;
  }
  return null;
}

function rasterizeRing(grid, N, minX, maxX, minZ, maxZ, ring) {
  const invX = N / (maxX - minX), invZ = N / (maxZ - minZ);
  let z0 = Infinity, z1 = -Infinity;
  for (const [, z] of ring) { if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const j0 = Math.max(0, Math.floor((z0 - minZ) * invZ));
  const j1 = Math.min(N - 1, Math.floor((z1 - minZ) * invZ));
  if (j0 > j1) return;
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = minZ + (j + 0.5) / invZ;
    xs.length = 0;
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const [xa, za] = ring[k], [xb, zb] = ring[i];
      if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = j * N;
    for (let n = 0; n + 1 < xs.length; n += 2) {
      const i0 = Math.max(0, Math.ceil((xs[n] - minX) * invX - 0.5));
      const i1 = Math.min(N - 1, Math.floor((xs[n + 1] - minX) * invX - 0.5));
      for (let i = i0; i <= i1; i++) grid[row + i] = 1;
    }
  }
}

export function packLandUse(parkHi, indHi, leafHi, size = LU_BOUNDS.size, sub = SUB) {
  const N = size * sub;
  const out = new Uint8Array(size * size);
  const inv = 1 / (sub * sub);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let rp = 0, ri = 0, rl = 0;
      for (let dj = 0; dj < sub; dj++) {
        const row = (j * sub + dj) * N + i * sub;
        for (let di = 0; di < sub; di++) {
          const k = row + di;
          rp += parkHi[k];
          ri += indHi[k];
          rl += leafHi[k];
        }
      }
      const r3 = Math.min(7, Math.round(rp * inv * 7));
      const g3 = Math.min(7, Math.round(ri * inv * 7));
      const b2 = Math.min(3, Math.round(rl * inv * 3));
      out[j * size + i] = (r3 << 5) | (g3 << 2) | b2;
    }
  }
  return out;
}

export function unpackLandUse(bytes) {
  const rgba = new Uint8Array(bytes.length * 4);
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    const r3 = (v >> 5) & 7, g3 = (v >> 2) & 7, b2 = v & 3;
    rgba[i * 4] = Math.round((r3 / 7) * 255);
    rgba[i * 4 + 1] = Math.round((g3 / 7) * 255);
    rgba[i * 4 + 2] = Math.round((b2 / 3) * 180);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export async function buildSurroundingsData(pbfPath) {
  const corners = [
    toLonLat(LU_BOUNDS.minX, LU_BOUNDS.minZ),
    toLonLat(LU_BOUNDS.maxX, LU_BOUNDS.minZ),
    toLonLat(LU_BOUNDS.maxX, LU_BOUNDS.maxZ),
    toLonLat(LU_BOUNDS.minX, LU_BOUNDS.maxZ)
  ];
  const lons = corners.map((c) => c[0]), lats = corners.map((c) => c[1]);
  const spat = [Math.min(...lons) - 0.01, Math.min(...lats) - 0.01, Math.max(...lons) + 0.01, Math.max(...lats) + 0.01].map((v) => v.toFixed(4));

  const N = LU_BOUNDS.size * SUB;
  const parkHi = new Uint8Array(N * N);
  const indHi = new Uint8Array(N * N);
  const leafHi = new Uint8Array(N * N);
  const hiGrids = [parkHi, indHi, leafHi];

  const tallBuildings = [];
  const collarExtra = [];
  const landCounts = { park: 0, industry: 0, residential: 0 };
  const regionCounts = { mississauga: 0, etobicoke: 0, northYork: 0, yorkRegion: 0, scarborough: 0 };

  const proc = spawn('ogr2ogr', [
    '-f', 'GeoJSONSeq', '/vsistdout/', pbfPath, 'multipolygons',
    '-spat', ...spat, '-oo', `CONFIG_FILE=${CONF}`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });

  for await (const line of readline.createInterface({ input: proc.stdout })) {
    if (!line.trim()) continue;
    const f = JSON.parse(line.replace(/^\x1e/, ''));
    if (!f.geometry) continue;
    const t = typeof f.properties.all_tags === 'string' ? JSON.parse(f.properties.all_tags) : (f.properties.all_tags || {});
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    if (!polys.length) continue;

    const luCls = classifyLandUse(t);
    if (luCls >= 0) {
      for (const poly of polys) {
        const outer = poly[0];
        if (!outer || outer.length < 4) continue;
        const ring = outer.slice(0, -1).map(([lon, lat]) => toWorld(lon, lat));
        if (Math.abs(ringArea(ring)) < 400) continue;
        rasterizeRing(hiGrids[luCls], N, LU_BOUNDS.minX, LU_BOUNDS.maxX, LU_BOUNDS.minZ, LU_BOUNDS.maxZ, ring);
      }
      if (luCls === 0) landCounts.park++;
      else if (luCls === 1) landCounts.industry++;
      else landCounts.residential++;
    }

    if (!t.building || t.building === 'no' || t.building === 'roof' || t.building === 'shed') continue;
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer || outer.length < 4) continue;
      // Fast pre-check on first vertex before projecting whole ring
      const [x0, z0] = toWorld(outer[0][0], outer[0][1]);
      if (Math.abs(x0) > BLD_LIMIT + 500 || Math.abs(z0) > BLD_LIMIT + 500) continue;
      if (x0 > EGLINTON.x0 + 200 && x0 < EGLINTON.x1 - 200 && z0 > EGLINTON.z0 + 200 && z0 < EGLINTON.z1 - 200) continue;

      const parsedH = parseOsmHeight(t);
      const edApprox = edgeDistBox(x0, z0, EGLINTON);
      if (parsedH === null && edApprox > COLLAR_DIST + 300) continue;
      if (parsedH !== null && parsedH < 18 && edApprox > COLLAR_DIST + 300) continue;

      const ring = outer.slice(0, -1).map(([lon, lat]) => toWorld(lon, lat));
      const area = Math.abs(ringArea(ring));
      if (area < 120) continue;
      const r = minRect(ring);
      if (!r || Math.abs(r.cx) > BLD_LIMIT || Math.abs(r.cz) > BLD_LIMIT) continue;
      const ed = edgeDistBox(r.cx, r.cz, EGLINTON);
      if (ed < 25) continue; // stay cleanly outside Eglinton frame edge

      const w = Math.max(8, Math.min(260, r.w));
      const d = Math.max(8, Math.min(260, r.d));
      const isTall = parsedH !== null && parsedH >= 18;
      if (isTall) {
        const h = Math.round(parsedH);
        const style = classifyBuildingStyle(t, h, area);
        const [lon, lat] = toLonLat(r.cx, r.cz);
        if (lon < -79.55) regionCounts.mississauga++;
        else if (r.cx < EGLINTON.x0 && r.cz > -15000) regionCounts.etobicoke++;
        else if (lat > 43.78) regionCounts.yorkRegion++;
        else if (r.cx > EGLINTON.x1) regionCounts.scarborough++;
        else regionCounts.northYork++;
        tallBuildings.push([Math.round(r.cx), Math.round(r.cz), Math.round(w), Math.round(d), h, Math.round(r.ang * 10), style]);
      } else if (ed <= COLLAR_DIST && ((parsedH !== null && parsedH >= 10) || area >= 1600)) {
        const h = parsedH !== null ? Math.round(parsedH) : (t.building === 'apartments' ? 14 : 9);
        const style = classifyBuildingStyle(t, h, area);
        collarExtra.push({ score: h * 80 + area, row: [Math.round(r.cx), Math.round(r.cz), Math.round(w), Math.round(d), h, Math.round(r.ang * 10), style] });
      }
    }
  }
  const code = await new Promise((res) => proc.on('close', res));
  if (code !== 0) throw new Error(`ogr2ogr exited ${code}: ${stderr.slice(0, 500)}`);

  // Deterministic ordering (spatial sort, then cap collar extras to the largest/tallest)
  collarExtra.sort((a, b) => b.score - a.score || a.row[0] - b.row[0] || a.row[1] - b.row[1]);
  const buildings = [...tallBuildings, ...collarExtra.slice(0, MAX_COLLAR_EXTRA).map((e) => e.row)];
  buildings.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[4] - b[4] || a[2] - b[2]);
  const flatBuildings = [];
  for (const row of buildings) flatBuildings.push(...row);

  const packed = packLandUse(parkHi, indHi, leafHi, LU_BOUNDS.size, SUB);
  return {
    version: 1,
    source: {
      dataset: 'OpenStreetMap Ontario extract (Geofabrik)',
      licence: 'ODbL 1.0 (© OpenStreetMap contributors)',
      pbfFile: path.basename(pbfPath),
      sha256: crypto.createHash('sha256').update(fs.readFileSync(pbfPath).subarray(0, 65536)).digest('hex').slice(0, 16)
    },
    frame: EGLINTON,
    landUse: {
      minX: LU_BOUNDS.minX,
      maxX: LU_BOUNDS.maxX,
      minZ: LU_BOUNDS.minZ,
      maxZ: LU_BOUNDS.maxZ,
      size: LU_BOUNDS.size,
      format: 'r3g3b2',
      data: Buffer.from(packed).toString('base64')
    },
    stats: {
      landPolygons: landCounts,
      tallBuildings: tallBuildings.length,
      collarBuildings: Math.min(collarExtra.length, MAX_COLLAR_EXTRA),
      totalBuildings: buildings.length,
      tallByRegion: regionCounts
    },
    // flat 7-tuples: [x, z, w, d, h, rotDeciRad, style]
    buildings: flatBuildings
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIdx = process.argv.indexOf('--out');
  const OUT = outIdx >= 0 && process.argv[outIdx + 1] ? path.resolve(process.argv[outIdx + 1]) : path.join(ROOT, 'js/toronto-surroundings-data.js');
  const pos = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && (i === 0 || !arr[i - 1].startsWith('--')));
  const pbf = pos[0] || path.join(os.homedir(), '.cache/slop-toronto/raw/ontario-latest.osm.pbf');
  if (!fs.existsSync(pbf)) throw new Error(`missing OSM extract: ${pbf}`);
  const t0 = Date.now();
  const data = await buildSurroundingsData(pbf);
  const src = `// js/toronto-surroundings-data.js — GENERATED by tools/build-surroundings.mjs, do not edit by hand.
// Real OpenStreetMap GTA land use (52 km x 52 km) and tall/major buildings outside the Eglinton frame
// (Mississauga, Etobicoke, North York, York Region, Scarborough). Source: © OpenStreetMap contributors (ODbL 1.0).
(function () {
window.CITY = window.CITY || {};
window.CITY.SURROUNDINGS_DATA = ${JSON.stringify(data)};
})();
`;
  fs.writeFileSync(OUT, src);
  console.log(`[surroundings-data] wrote ${OUT} (${(Buffer.byteLength(src) / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`[surroundings-data] stats: ${JSON.stringify(data.stats)}`);
}
