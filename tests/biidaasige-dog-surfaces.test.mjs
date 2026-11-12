// Biidaasige Park source-traced dog surfaces (js/biidaasige-dog-surfaces.js, bead st-bmyv.5.1). Focused CPU checks
// that load the ACTUAL module into a small CITY and prove, from the REAL built THREE geometry and the committed
// fixture:
//
//   1. The outer boundary is the exact current OSM dog-area ring, never expanded to fit the turf trace.
//   2. The turf is the Captain-traced ortho ring, clipped to the OSM outer; no turf triangle escapes the boundary.
//   3. The asphalt underlay covers the whole OSM area at .224 m; the turf finish sits .004 m above it at .228 m.
//   4. An INDEPENDENT downward raycast classifies turf above asphalt at sampled points and every triangle centroid,
//      with no coplanar overlap; C.biidaasigeDogSurfaceAt returns the actual highest height.
//   5. Published 1,200/800 m2 stay nominal; the actual turf area is smaller and reported separately.
//   6. colliders is []; missing projection/rings are graceful and clear stale answers; the generator --check is portable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PROJ = (() => {
  const ctx = { window: { CITY: {} } };
  vm.runInNewContext(read('js/toronto-geodata.js'), ctx);
  return ctx.window.CITY.GEO.frame.projection;
})();
function worldFromLatLon(lat, lon) {
  const e = (lon - PROJ.lon0) * PROJ.kx, n = (lat - PROJ.lat0) * PROJ.ky;
  const c = Math.cos(PROJ.theta), s = Math.sin(PROJ.theta);
  return { x: e * c - n * s - PROJ.ox, z: -(e * s + n * c) - PROJ.oz };
}

function city({ projection = true, park = true, module = true, mutate = null } = {}) {
  const CITY = { THREE, CITY_BOUNDS: { sidewalkHeight: 0.22 }, worldFromLatLon };
  const ctx = { window: { CITY }, console: { info() {}, warn() {}, log() {}, error() {} } };
  vm.createContext(ctx);
  if (park) vm.runInContext(read('js/biidaasige-park-data.js'), ctx, { filename: 'biidaasige-park-data.js' });
  if (!projection) delete CITY.worldFromLatLon;
  if (module) vm.runInContext(read('js/biidaasige-dog-surfaces.js'), ctx, { filename: 'biidaasige-dog-surfaces.js' });
  if (mutate) mutate(CITY);
  return CITY;
}

// Independent geometry helpers (not the module's own).
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, zi = ring[i].z, xj = ring[j].x, zj = ring[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz;
  let t = L ? ((px - ax) * vx + (pz - az) * vz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
}
function distToRing(x, z, ring) {
  let m = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    m = Math.min(m, segDist(x, z, ring[j].x, ring[j].z, ring[i].x, ring[i].z));
  }
  return m;
}
function triArea(T) {
  return Math.abs((T[3] - T[0]) * (T[8] - T[2]) - (T[6] - T[0]) * (T[5] - T[2])) / 2;
}
function sumArea(surfaces) {
  return surfaces.reduce((s, x) => s + triArea(x.triangle), 0);
}
function centroid(T) {
  return { x: (T[0] + T[3] + T[6]) / 3, z: (T[2] + T[5] + T[8]) / 3 };
}
function ringOf(site) {
  return site.outerRing.map(([x, z]) => ({ x, z }));
}

test('builds both source-traced dog areas: 2 meshes each, no colliders, bounded draw calls', () => {
  const C = city();
  const out = C.buildBiidaasigeDogSurfaces(null);
  assert.ok(out && out.group, 'builds a group');
  assert.equal(out.colliders.length, 0, 'dog areas stay traversable');
  assert.equal(out.sites.length, 2, 'both OSM dog areas');
  assert.equal(out.group.children.length, 4, '2 merged meshes per area = 4 draw calls');
  for (const site of out.sites) {
    assert.equal(site.meshCount, 2);
    assert.equal(site.materials.join(','), 'asphalt,turf');
    assert.ok(site.actualTurfAreaM2 > 0, 'turf has area');
    assert.ok(site.actualTurfAreaM2 < site.nominalWholeAreaM2, 'actual turf is smaller than the published whole area');
    assert.ok(site.actualTurfAreaM2 < site.outerAreaM2, 'actual turf is smaller than the OSM enclosure');
    assert.ok(site.spanM < 100, 'each dog area is under 100 m across');
    assert.equal(site.traceUncertaintyM, 3);
    assert.equal(site.traceToleranceM, 0.5);
  }
});

test('outer boundary is the exact current OSM ring, never expanded', () => {
  const C = city();
  const out = C.buildBiidaasigeDogSurfaces(null);
  for (const site of out.sites) {
    const osm = C.biidaasigeParkRingWorld(site.id);
    assert.ok(osm && osm.length >= 3, `${site.id} OSM ring exists`);
    // The module drops only a duplicated closing vertex; every distinct OSM vertex is kept verbatim.
    const distinct = osm.filter((p, i) => i === 0 || Math.hypot(p.x - osm[i - 1].x, p.z - osm[i - 1].z) > 1e-9);
    if (distinct.length > 1) {
      const f = distinct[0], l = distinct[distinct.length - 1];
      if (Math.hypot(f.x - l.x, f.z - l.z) < 1e-9) distinct.pop();
    }
    assert.equal(site.outerRing.length, distinct.length, `${site.id} keeps every distinct OSM vertex`);
    for (let i = 0; i < distinct.length; i++) {
      assert.ok(Math.hypot(site.outerRing[i][0] - distinct[i].x, site.outerRing[i][1] - distinct[i].z) < 1e-6, `${site.id} vertex ${i} is the OSM vertex`);
    }
  }
});

test('turf is clipped to the OSM outer; no triangle or centroid escapes the boundary', () => {
  const C = city();
  const out = C.buildBiidaasigeDogSurfaces(null);
  for (const site of out.sites) {
    const outer = ringOf(site);
    const own = out.surfaces.filter((s) => s.siteId === site.id);
    assert.ok(own.length > 0);
    for (const s of own) {
      const T = s.triangle;
      for (let i = 0; i < 9; i += 3) {
        const x = T[i], z = T[i + 2];
        assert.ok(pointInRing(outer, x, z) || distToRing(x, z, outer) < 0.01, `${site.id} ${s.kind} vertex outside the OSM outer`);
      }
      const c = centroid(T);
      assert.ok(pointInRing(outer, c.x, c.z), `${site.id} ${s.kind} centroid outside the OSM outer`);
    }
  }
});

test('source turf vertices outside the OSM ring are reported and trimmed, not expanded', () => {
  const C = city();
  const out = C.buildBiidaasigeDogSurfaces(null);
  const east = out.sites.find((s) => s.id === 'dogs-east-1200');
  assert.ok(east.turfVerticesOutside > 0, 'the east trace has vertices outside the OSM ring');
  assert.ok(east.maxTurfVertexOutsideM <= east.traceUncertaintyM, 'outside distance stays within the 3 m uncertainty');
  assert.ok(east.actualTurfAreaM2 < east.rawTurfAreaM2, 'clipping removes the outside sliver');
  const west = out.sites.find((s) => s.id === 'dogs-west-800');
  assert.ok(west.actualTurfAreaM2 <= west.rawTurfAreaM2 + 1e-6, 'west is not expanded either');
});

test('asphalt underlay covers the whole OSM area at .224; turf finish is .004 above at .228', () => {
  const C = city();
  const out = C.buildBiidaasigeDogSurfaces(null);
  for (const site of out.sites) {
    const asphalt = out.surfaces.filter((s) => s.siteId === site.id && s.kind === 'asphalt');
    const turf = out.surfaces.filter((s) => s.siteId === site.id && s.kind === 'turf');
    assert.ok(asphalt.length > 0 && turf.length > 0);
    for (const s of asphalt) for (let i = 1; i < 9; i += 3) assert.ok(Math.abs(s.triangle[i] - 0.224) < 1e-6);
    for (const s of turf) for (let i = 1; i < 9; i += 3) assert.ok(Math.abs(s.triangle[i] - 0.228) < 1e-6);
    assert.ok(Math.abs(sumArea(asphalt) - site.outerAreaM2) < 1.0, 'asphalt covers the OSM enclosure');
    assert.ok(Math.abs(sumArea(turf) - site.actualTurfAreaM2) < 1.0, 'turf area matches the clipped triangles');
  }
});

test('independent downward raycast: turf above asphalt, never coplanar, at centroids and sampled points', () => {
  const C = city();
  const out = C.buildBiidaasigeDogSurfaces(null);
  const meshes = out.group.children.filter((m) => m.isMesh);
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const classify = (x, z) => {
    raycaster.set(new THREE.Vector3(x, 10, z), down);
    return raycaster.intersectObjects(meshes, false);
  };
  const checkHits = (hits, label) => {
    assert.ok(hits.length > 0, `${label}: ray hits a surface`);
    for (const h of hits) {
      assert.ok(Math.abs(h.point.y - 0.224) < 1e-6 || Math.abs(h.point.y - 0.228) < 1e-6, `${label}: hit is a known layer`);
    }
    for (let i = 1; i < hits.length; i++) {
      assert.ok(Math.abs(hits[i].point.y - hits[i - 1].point.y) > 1e-6, `${label}: no coplanar overlap`);
    }
  };
  for (const s of out.surfaces) {
    const c = centroid(s.triangle);
    const hits = classify(c.x, c.z);
    checkHits(hits, `${s.siteId} ${s.kind} centroid`);
    if (s.kind === 'turf') {
      assert.ok(Math.abs(hits[0].point.y - 0.228) < 1e-6, 'turf is the top surface');
      assert.ok(hits.some((h) => Math.abs(h.point.y - 0.224) < 1e-6), 'asphalt underlay is below the turf');
    } else if (Math.abs(hits[0].point.y - 0.228) < 1e-6) {
      assert.ok(hits.some((h) => Math.abs(h.point.y - 0.224) < 1e-6), 'asphalt underlay is below the turf');
    }
  }
  // A coarse grid over each area: every hit is a known layer, and turf always has asphalt beneath it.
  for (const site of out.sites) {
    const outer = ringOf(site);
    const xs = outer.map((p) => p.x), zs = outer.map((p) => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    for (let i = 1; i < 8; i++) {
      for (let j = 1; j < 8; j++) {
        const x = minX + ((maxX - minX) * i) / 8, z = minZ + ((maxZ - minZ) * j) / 8;
        if (!pointInRing(outer, x, z)) continue;
        const hits = classify(x, z);
        checkHits(hits, `${site.id} sample ${i},${j}`);
        if (Math.abs(hits[0].point.y - 0.228) < 1e-6) {
          assert.ok(hits.some((h) => Math.abs(h.point.y - 0.224) < 1e-6), 'turf sample has asphalt beneath');
        }
      }
    }
  }
});

test('exact footing returns the actual highest surface height; off-area is null', () => {
  const C = city();
  const out = C.buildBiidaasigeDogSurfaces(null);
  for (const site of out.sites) {
    const turf = out.surfaces.find((s) => s.siteId === site.id && s.kind === 'turf');
    const c = centroid(turf.triangle);
    const q = C.biidaasigeDogSurfaceAt(c.x, c.z);
    assert.ok(q, 'turf point answers');
    assert.equal(q.kind, 'turf');
    assert.ok(Math.abs(q.surfaceY - 0.228) < 1e-6, 'turf top is .228');
    const a = C.biidaasigeDogSurfaceAt(c.x, c.z, { kind: 'asphalt' });
    assert.ok(a && Math.abs(a.surfaceY - 0.224) < 1e-6, 'asphalt underlay is .224');
  }
  assert.equal(C.biidaasigeDogSurfaceAt(0, 0), null, 'off-area is null');
});

test('finite bounds and no extra boundary fill', () => {
  const C = city();
  const out = C.buildBiidaasigeDogSurfaces(null);
  for (const site of out.sites) {
    const outer = ringOf(site);
    const xs = outer.map((p) => p.x), zs = outer.map((p) => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    for (const m of out.group.children.filter((x) => x.name.includes(site.id))) {
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), 'finite vertex');
      }
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      assert.ok(bb.min.x >= minX - 0.01 && bb.max.x <= maxX + 0.01, 'no fill beyond the OSM x bounds');
      assert.ok(bb.min.z >= minZ - 0.01 && bb.max.z <= maxZ + 0.01, 'no fill beyond the OSM z bounds');
    }
  }
});

test('missing projection or OSM rings is graceful and clears stale answers', () => {
  const C = city();
  const first = C.buildBiidaasigeDogSurfaces(null);
  assert.equal(first.sites.length, 2);
  const turf = first.surfaces.find((s) => s.kind === 'turf');
  const c = centroid(turf.triangle);
  assert.ok(C.biidaasigeDogSurfaceAt(c.x, c.z), 'a stale answer exists before the invalid rebuild');

  delete C.worldFromLatLon;
  const out = C.buildBiidaasigeDogSurfaces(null);
  assert.ok(out && out.group, 'still returns a group');
  assert.match(out.stats.reason, /projection unavailable/);
  assert.equal(out.sites.length, 0);
  assert.equal(C.biidaasigeDogSurfaceAt(c.x, c.z), null, 'stale answer is cleared');

  const C2 = city({ mutate: (x) => { x.biidaasigeParkRingWorld = () => null; } });
  const out2 = C2.buildBiidaasigeDogSurfaces(null);
  assert.match(out2.stats.reason, /OSM dog-area rings unavailable/);
  assert.equal(out2.sites.length, 0);
  assert.equal(C2.biidaasigeDogSurfaceAt(0, 0), null);
});

test('works in both real frames (detail and the default eglinton frame)', () => {
  const detail = city();
  const dOut = detail.buildBiidaasigeDogSurfaces(null);
  const egl = city({ mutate: (C) => { C.GEO = { frame: { x0: -7900, x1: 9600, z0: -7300, z1: 3600 } }; } });
  const eOut = egl.buildBiidaasigeDogSurfaces(null);
  assert.equal(eOut.sites.length, dOut.sites.length, 'both frames build both areas');
  for (let i = 0; i < dOut.sites.length; i++) {
    assert.equal(eOut.sites[i].id, dOut.sites[i].id);
    assert.equal(eOut.sites[i].outerAreaM2, dOut.sites[i].outerAreaM2, 'same projection => same OSM area');
    assert.equal(eOut.sites[i].actualTurfAreaM2, dOut.sites[i].actualTurfAreaM2, 'same projection => same turf area');
  }
});

test('generator --check is portable and the committed data block is current', () => {
  const out = execFileSync(process.execPath, ['tools/build-biidaasige-dog-surfaces.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /up to date/);
});

test('turf geometry preserves the current City asset polygons and source identities',()=>{
 const C=city(),r=C.buildBiidaasigeDogSurfaces();
 const raw=JSON.parse(read('tools/fixtures/biidaasige-dog-turf-city.json'));
 for(const f of raw.response.features){
  const id=f.attributes.ASSET_NAME.includes('(West)')?'dogs-west-800':'dogs-east-1200';
  const data=C.BIIDAASIGE_DOG_SURFACES.features.find(d=>d.id===id);
  assert.deepEqual(JSON.parse(JSON.stringify(data.turfRingLatLon)),f.geometry.rings[0].map(([lon,lat])=>[lat,lon]),'all source vertices survive generator conversion');
  const built=r.sites.find(s=>s.id===id);
  assert.equal(built.geometrySource.assetId,f.attributes.ASSET_ID);
  assert.ok(Math.abs(built.actualAsphaltAreaM2+built.actualTurfAreaM2-built.outerAreaM2)<.2,'visible apron and turf areas account for the whole source area');
 }
});
