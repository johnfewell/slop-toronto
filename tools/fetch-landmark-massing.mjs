// tools/fetch-landmark-massing.mjs — writes js/toronto-landmarks.js: the City of Toronto's 3D Massing multipatch (true 3D
// faces: City Hall's curved towers & saucer, Union Station's colonnade block, Queen's Park's towers...) for the landmarks
// landmarks.js draws from it, as triangles in the world frame with street level at y = 0. The geodata build leaves the
// extruded massing boxes inside these outlines out (tools/geo-features.mjs MODELLED).
// Source: City of Toronto Open Data, "3D Massing" (3dmassingmultipatch_2025_wgs84.zip, a file geodatabase in Web
// Mercator, heights in metres above sea level), Open Government Licence – Toronto.
// usage: node tools/fetch-landmark-massing.mjs <3DMassingMultipatch_2025_WGS84.gdb>   (after tools/build-geodata.mjs)
import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import earcut from 'earcut';

const GDB = process.argv[2];
if (!GDB) throw new Error('usage: node tools/fetch-landmark-massing.mjs <multipatch .gdb>');
// landmark id -> how it reads (landmarks.js picks the material by it)
const TARGETS = {
  cityHall: 'concrete', unionStation: 'limestone', legislature: 'sandstone', scotiabankArena: 'brick', stLawrence: 'brick',
  cinesphere: 'white', royalYork: 'limestone', flatiron: 'brick', princesGates: 'limestone', rogersCentre: 'white'
};

const src = fs.readFileSync('js/toronto-geodata.js', 'utf8');
const GEO = JSON.parse(src.slice(src.indexOf('window.CITY.GEO = ') + 18, src.lastIndexOf(';\n})();')));
const P = GEO.frame.projection;
const c = Math.cos(P.theta), s = Math.sin(P.theta);
const toWorld = (lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};
const toLonLat = (x, z) => {
  const u = x + P.ox, v = z + P.oz;
  return [P.lon0 + (u * c - v * s) / P.kx, P.lat0 + (-u * s - v * c) / P.ky];
};
const R = 6378137;
const merc = ([x, y]) => [((x / R) * 180) / Math.PI, ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI];
const edgeDistance = (x, z, r) => {
  let best = Infinity;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[j], az = r[j + 1], bx = r[i], bz = r[i + 1];
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
};
const inRing = (x, z, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

// The geodatabase is ~300 tile layers (Multipatch_<tile>); a layer's extent says whether it can hold the landmark
const LAYERS = await new Promise((resolve, reject) => {
  const p = spawn('ogrinfo', ['-so', '-al', GDB], { stdio: ['ignore', 'pipe', 'ignore'] });
  let txt = '';
  p.stdout.on('data', (d) => { txt += d; });
  p.on('close', (code) => {
    if (code !== 0) return reject(new Error('ogrinfo failed'));
    const out = [];
    let name = null;
    for (const line of txt.split('\n')) {
      const n = /^Layer name: (\S+)/.exec(line);
      if (n) name = n[1];
      const e = /^Extent: \(([-\d.]+), ([-\d.]+)\) - \(([-\d.]+), ([-\d.]+)\)/.exec(line);
      if (e && name && name.startsWith('Multipatch_')) out.push({ name, box: e.slice(1).map(Number) });
    }
    resolve(out);
  });
});
// MULTIPOLYGON Z WKT -> [[[x, y, z]...ring]...polygon] (Web Mercator x, y; z metres above the ground)
function parseWKT(w) {
  const body = w.slice(w.indexOf('(((') + 3, w.lastIndexOf(')))'));
  return body.split(')),((').map((poly) => poly.split('),(').map((ring) => ring.split(',').map((pt) => pt.trim().split(/\s+/).map(Number))));
}
const layerCache = new Map();
function layerFeatures(name) {
  if (layerCache.has(name)) return layerCache.get(name);
  const job = new Promise((resolve, reject) => {
    // GDAL keeps the multipatch heights in WKT only (its GeoJSON writers drop them)
    const p = spawn('ogr2ogr', ['-f', 'CSV', '/vsistdout/', GDB, name, '-lco', 'GEOMETRY=AS_WKT', '-nlt', 'MULTIPOLYGONZ'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const out = [];
    readline.createInterface({ input: p.stdout }).on('line', (l) => {
      const m = /^"(MULTIPOLYGON Z [^"]*)"/.exec(l);
      if (m) out.push(parseWKT(m[1]));
    });
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`ogr2ogr ${name} exited ${code}`))));
  });
  layerCache.set(name, job);
  return job;
}
async function features([mx0, my0, mx1, my1]) {
  const hit = LAYERS.filter(({ box: [a, b, c, d] }) => a <= mx1 && c >= mx0 && b <= my1 && d >= my0);
  return (await Promise.all(hit.map((l) => layerFeatures(l.name)))).flat();
}

// One planar face (outer + holes, 3D) into triangles: earcut in the face's dominant plane
function triangulate(rings, pos, idx) {
  const flat = [], holes = [], verts = [];
  for (const r of rings) {
    if (flat.length) holes.push(verts.length);
    for (const v of r.slice(0, -1)) verts.push(v);
  }
  if (verts.length < 3) return;
  // Newell normal picks the projection plane
  let nx = 0, ny = 0, nz = 0;
  const outerN = rings[0].length - 1;
  for (let i = 0; i < outerN; i++) {
    const a = verts[i], b = verts[(i + 1) % outerN];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const [i0, i1] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [0, 2] : [0, 1];
  for (const v of verts) flat.push(v[i0], v[i1]);
  const tri = earcut(flat, holes.length ? holes : null, 2);
  const base = pos.length / 3;
  for (const v of verts) pos.push(v[0], v[1], v[2]);
  for (const t of tri) idx.push(base + t);
}

const out = {};
for (const [id, look] of Object.entries(TARGETS)) {
  const site = GEO.landmarks[id];
  if (!site || !site.ring) { console.log(`[landmarks] ${id}: no outline in the geodata`); continue; }
  const ring = site.ring;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
  const corners = [[x0 - 10, z0 - 10], [x1 + 10, z0 - 10], [x1 + 10, z1 + 10], [x0 - 10, z1 + 10]].map(([x, z]) => toLonLat(x, z));
  const lons = corners.map((p) => p[0]), lats = corners.map((p) => p[1]);
  const toMerc = (lon, lat) => [(lon * Math.PI / 180) * R, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R];
  const [mx0, my0] = toMerc(Math.min(...lons), Math.min(...lats)), [mx1, my1] = toMerc(Math.max(...lons), Math.max(...lats));
  const feats = await features([mx0, my0, mx1, my1]);
  const faces = [];
  let ground = Infinity;
  // Face by face: the City merges neighbouring buildings into one feature (City Hall shares one with its square & the
  // towers round it), so a face belongs to the landmark when its plan centre lies inside the outline or within 2 m of it
  for (const polys of feats) {
    for (const poly of polys) {
      const world = poly.map((r) => r.map((p) => {
        const [lon, lat] = merc(p);
        const [x, z] = toWorld(lon, lat);
        return [x, p[2], z];
      }));
      const outer = world[0];
      let sx = 0, sz = 0;
      for (const v of outer) { sx += v[0]; sz += v[2]; }
      const cx = sx / outer.length, cz = sz / outer.length;
      if (!inRing(cx, cz, ring) && edgeDistance(cx, cz, ring) > 2) continue;
      for (const r of world) for (const v of r) ground = Math.min(ground, v[1]);
      faces.push(world);
    }
  }
  if (!faces.length) { console.log(`[landmarks] ${id}: no multipatch faces inside its outline`); continue; }
  const pos = [], idx = [];
  for (const poly of faces) triangulate(poly, pos, idx);
  // heights stay the City's (0 = street level; the Rogers Centre's field sits below it)
  let top = 0;
  for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
  const q = (v) => Math.round(v * 100) / 100;
  out[id] = { look, ground: q(ground), positions: Buffer.from(new Float32Array(pos.map(q)).buffer).toString('base64'), indices: Buffer.from(new Uint32Array(idx).buffer).toString('base64') };
  console.log(`[landmarks] ${id}: ${faces.length} faces, ${idx.length / 3} triangles, ${top.toFixed(1)} m tall (ground ${ground.toFixed(1)} m a.s.l.)`);
}
const header = `// js/toronto-landmarks.js — GENERATED by tools/fetch-landmark-massing.mjs, do not edit by hand.
// Toronto's landmarks from the City of Toronto's 3D Massing multipatch (Open Government Licence – Toronto), as triangles in
// the world frame (js/toronto-geodata.js), ground at y = 0: positions Float32 x, y, z and indices Uint32, base64.
`;
fs.writeFileSync('js/toronto-landmarks.js', `${header}(function () {\nwindow.CITY = window.CITY || {};\nwindow.CITY.LANDMARK_MESHES = ${JSON.stringify(out)};\n})();\n`);
console.log(`[landmarks] wrote js/toronto-landmarks.js (${(fs.statSync('js/toronto-landmarks.js').size / 1024).toFixed(0)} KB)`);
