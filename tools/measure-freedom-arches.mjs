// tools/measure-freedom-arches.mjs — re-derives the numbers in js/freedom-arches.js SPEC from the City of Toronto's 3D Massing
// 2025 multipatch (Open Government Licence – Toronto): the three Freedom Arches at Nathan Phillips Square are one feature
// there. It prints each arch's x extent, the shared z span, the crown and underside heights and the width; nothing is written.
// usage: node tools/measure-freedom-arches.mjs <3DMassingMultipatch_2025_WGS84.gdb>   (needs GDAL's ogrinfo and ogr2ogr)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const GDB = process.argv[2];
if (!GDB) throw new Error('usage: node tools/measure-freedom-arches.mjs <multipatch .gdb>');
const src = fs.readFileSync('js/toronto-geodata.js', 'utf8');
const GEO = JSON.parse(src.slice(src.indexOf('window.CITY.GEO = ') + 18, src.lastIndexOf(';\n})();')));
const P = GEO.frame.projection, c = Math.cos(P.theta), s = Math.sin(P.theta);
const toWorld = (lon, lat) => { const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky; return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz]; };
const toLonLat = (x, z) => { const u = x + P.ox, v = z + P.oz; return [P.lon0 + (u * c - v * s) / P.kx, P.lat0 + (-u * s - v * c) / P.ky]; };
const R = 6378137;
const merc = ([x, y]) => [((x / R) * 180) / Math.PI, ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI];
const toMerc = (lon, lat) => [(lon * Math.PI / 180) * R, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R];
// the pool's neighbourhood in world metres (the rink polygon is x -19..35, z -819..-789)
const box = [-60, -860, 60, -770];
const corners = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]].map(([x, z]) => toLonLat(x, z));
const [mx0, my0] = toMerc(Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])));
const [mx1, my1] = toMerc(Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1])));
const info = execFileSync('ogrinfo', ['-so', '-al', GDB], { maxBuffer: 1 << 28 }).toString();
const layers = [];
let name = null;
for (const line of info.split('\n')) {
  const n = /^Layer name: (\S+)/.exec(line); if (n) name = n[1];
  const e = /^Extent: \(([-\d.]+), ([-\d.]+)\) - \(([-\d.]+), ([-\d.]+)\)/.exec(line);
  if (e && name?.startsWith('Multipatch_')) layers.push({ name, b: e.slice(1).map(Number) });
}
const parseWKT = (w) => w.slice(w.indexOf('(((') + 3, w.lastIndexOf(')))')).split(')),((').map((poly) => poly.split('),(').map((ring) => ring.split(',').map((pt) => pt.trim().split(/\s+/).map(Number))));
for (const l of layers.filter(({ b: [a, b, cc, d] }) => a <= mx1 && cc >= mx0 && b <= my1 && d >= my0)) {
  const txt = execFileSync('ogr2ogr', ['-f', 'CSV', '/vsistdout/', GDB, l.name, '-lco', 'GEOMETRY=AS_WKT', '-nlt', 'MULTIPOLYGONZ'], { maxBuffer: 1 << 30 }).toString();
  for (const line of txt.split('\n')) {
    const m = /^"(MULTIPOLYGON Z [^"]*)"/.exec(line); if (!m) continue;
    const polys = parseWKT(m[1]), V = [];
    for (const poly of polys) for (const r of poly) for (const p of r) { const [lon, lat] = merc(p); const [x, z] = toWorld(lon, lat); V.push([x, p[2], z]); }
    const ext = (i, f = V) => f.reduce((r, v) => [Math.min(r[0], v[i]), Math.max(r[1], v[i])], [Infinity, -Infinity]);
    const [x0, x1] = ext(0), [z0, z1] = ext(2);
    // the arches' feature: small, low, 18 x 39 m in plan, over the pool
    if (x1 < box[0] || x0 > box[2] || z1 < box[1] || z0 > box[3]) continue;
    if (polys.length < 1000 || polys.length > 2000 || x1 - x0 > 25 || z1 - z0 > 45) continue;
    console.log(`feature: ${polys.length} faces, x ${x0.toFixed(2)}..${x1.toFixed(2)}, z ${z0.toFixed(2)}..${z1.toFixed(2)} (span ${(z1 - z0).toFixed(2)} m, centre ${((z0 + z1) / 2).toFixed(2)}), crown ${ext(1)[1].toFixed(2)} m`);
    for (const [lo, hi] of [[x0 - 1, x0 + 4], [x0 + 6, x0 + 12], [x1 - 4, x1 + 1]]) {
      const A = V.filter((v) => v[0] >= lo && v[0] < hi), [ax0, ax1] = ext(0, A);
      const mid = A.filter((v) => Math.abs(v[2] - (z0 + z1) / 2) < 0.5);
      console.log(`  arch x ${ax0.toFixed(2)}..${ax1.toFixed(2)} (width ${(ax1 - ax0).toFixed(2)}, centre ${((ax0 + ax1) / 2).toFixed(2)}), crown top ${ext(1, mid)[1].toFixed(2)}, underside ${ext(1, mid)[0].toFixed(2)}`);
    }
  }
}
