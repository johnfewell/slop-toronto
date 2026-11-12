// The waterfront beaches' sand ground (js/waterfront-beach-ground.js): real sand surfaces on the verified OSM
// natural=beach polygons at Sugar Beach and HTO Park, the generic lawn masked beneath them, and the sand height agreed
// with the furniture's feet. Geometry/material boundaries and frame guards are asserted, not just counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function city({ geodata = 'js/toronto-geodata.js', bounds = { sidewalkHeight: 0.22 } } = {}) {
  const ctx = {
    window: { CITY: { THREE, TSL, CITY_BOUNDS: bounds } }, console: { info() {}, log() {}, warn() {} },
    performance, URLSearchParams, Buffer, atob: (s) => Buffer.from(s, 'base64').toString('binary')
  };
  if (geodata) vm.runInNewContext(read(geodata), ctx);
  // the furniture module exports the shared sand rings this module draws
  vm.runInNewContext(read('js/waterfront-details.js'), ctx);
  vm.runInNewContext(read('js/waterfront-beach-ground.js'), ctx);
  return ctx.window.CITY;
}

const inRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const centroid = (ring) => {
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p[0]; cz += p[1]; }
  return [cx / ring.length, cz / ring.length];
};

const C = city();
const LAYOUT = C.waterfrontBeachGroundLayout();
const byId = Object.fromEntries(LAYOUT.sites.map((s) => [s.id, s]));

test('sand geometry: the exact OSM sand rings, inside the detail frame, at the park level', () => {
  assert.equal(LAYOUT.sites.length, 2);
  assert.equal(LAYOUT.sites.map((s) => s.id).sort().join(','), 'htoPark,sugarBeach');
  const shared = C.WATERFRONT_SAND_RINGS;
  for (const site of LAYOUT.sites) {
    // the ring is the shared OSM ring the furniture uses, not a new/invented polygon
    assert.equal(JSON.stringify(site.sandRing), JSON.stringify(shared[site.id]), `${site.id} uses the shared sand ring`);
    assert.ok(site.sandRing.length >= 3);
    // sand sits at the park lawn level (sidewalkHeight + 0.004); the mesh is 2 mm above it to avoid z-fighting
    assert.ok(Math.abs(site.sandY - (C.CITY_BOUNDS.sidewalkHeight + 0.004)) < 1e-9, `${site.id} sand level`);
    assert.ok(Math.abs(site.sandMeshY - (site.sandY + 0.002)) < 1e-9, `${site.id} mesh lifted 2 mm`);
    // the OSM area is recorded (a few percent of the official figures)
    assert.ok(site.area > 1000 && site.area < 3500, `${site.id} sand area ${site.area} m²`);
  }
  assert.equal(byId.sugarBeach.osm, 'way/172728993');
  assert.equal(byId.htoPark.osm, 'way/189306980');
});

test('sand is not the whole park: the ring is a strict part of the mapped park area', () => {
  // A point just outside the sand, off its narrow side, must NOT be sand — the whole park is never filled.
  for (const site of LAYOUT.sites) {
    const b = site.sandBox;
    // a point well inside the bounding box but outside the ring (a convex-hull corner of the bbox)
    const corner = [b.minX + 0.5, b.minZ + 0.5];
    if (!inRing(site.sandRing, corner[0], corner[1])) {
      assert.equal(C.waterfrontSandHeightAt(corner[0], corner[1]), null, `${site.id}: the bbox corner is not sand`);
    }
    // outside the box entirely is never sand
    assert.equal(C.waterfrontSandHeightAt(b.maxX + 50, b.maxZ + 50), null, `${site.id}: far outside is not sand`);
  }
});

test('sand height agrees with the furniture feet and covers the ring interior', () => {
  for (const site of LAYOUT.sites) {
    const [cx, cz] = centroid(site.sandRing);
    // the centroid of a simple beach ring is on the sand
    assert.equal(C.waterfrontSandHeightAt(cx, cz), site.sandY, `${site.id} centroid is sand at the park level`);
    // sample the interior: every sampled on-sand point returns exactly the sand level
    let on = 0;
    const b = site.sandBox;
    for (let x = b.minX + 1; x < b.maxX; x += 2) for (let z = b.minZ + 1; z < b.maxZ; z += 2) {
      if (!inRing(site.sandRing, x, z)) continue;
      assert.equal(C.waterfrontSandHeightAt(x, z), site.sandY, `${site.id}: ${x.toFixed(1)},${z.toFixed(1)} on sand`);
      on++;
    }
    assert.ok(on > 40, `${site.id}: ${on} interior samples are sand`);
  }
  // the furniture grounding the details module uses must equal the sand level (no hover, no sink)
  assert.equal(C.CITY_BOUNDS.sidewalkHeight + 0.004, byId.sugarBeach.sandY, 'furniture feet sit on the sand');
});

test('keepout and exclusion polygons match the sand rings exactly', () => {
  const polys = C.waterfrontBeachExclusionPolygons();
  assert.equal(polys.length, 2);
  for (const p of polys) {
    const site = byId[p.id];
    assert.equal(JSON.stringify(p.plan), JSON.stringify(site.sandRing), `${p.id} exclusion is its sand ring`);
    assert.ok(Array.isArray(p.paths), `${p.id} exclusion carries its path corridors`);
    // open sand: find an interior point that is not on a mapped path corridor
    const [cx, cz] = centroid(site.sandRing);
    const openPoint = C.waterfrontBeachKeepoutAt(cx, cz) ? [cx, cz] : (() => {
      const b = site.sandBox;
      for (let x = b.minX + 2; x < b.maxX; x += 2) for (let z = b.minZ + 2; z < b.maxZ; z += 2) {
        if (inRing(site.sandRing, x, z) && !C.waterfrontBeachPathAt(x, z)) return [x, z];
      }
      return null;
    })();
    assert.ok(openPoint, `${p.id} has open sand`);
    assert.equal(C.waterfrontBeachKeepoutAt(openPoint[0], openPoint[1]), true, `${p.id} open sand is keep-out`);
    assert.equal(C.waterfrontBeachKeepoutAt(site.sandBox.maxX + 40, site.sandBox.maxZ + 40), false, `${p.id} far away is free`);
  }
});

test('the built sand mesh is real upward-facing geometry on the ring at the sand level', () => {
  const scene = { added: [], add(o) { this.added.push(o); } };
  const r = C.createWaterfrontBeachGround(THREE, scene);
  assert.ok(r, 'builds in the detail frame');
  assert.equal(r.group.name, 'WaterfrontBeachGround');
  assert.equal(scene.added.length, 1, 'one culling root added');
  assert.equal(r.colliders.length, 0, 'sand adds no colliders');
  assert.equal(r.stats.meshes, 2);
  for (const site of LAYOUT.sites) {
    const mesh = r.group.getObjectByName(`WaterfrontBeachGround_${site.id}_Sand`);
    assert.ok(mesh && mesh.isMesh, `${site.id} sand mesh exists`);
    const pos = mesh.geometry.attributes.position, nor = mesh.geometry.attributes.normal;
    assert.ok(pos.count > 3, `${site.id} has triangles`);
    let minY = Infinity, maxY = -Infinity, downY = 0, badWinding = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), ny = nor.getY(i);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (ny < 0.9) downY++;
    }
    // the triangle winding must also face up (a downward-wound top is back-face culled and the sand vanishes)
    for (let t = 0; t + 2 < pos.count; t += 3) {
      const ax = pos.getX(t), az = pos.getZ(t), bx = pos.getX(t + 1), bz = pos.getZ(t + 1), cx = pos.getX(t + 2), cz = pos.getZ(t + 2);
      const upY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if (upY <= 0) badWinding++;
    }
    assert.ok(Math.abs(minY - site.sandMeshY) < 1e-6 && Math.abs(maxY - site.sandMeshY) < 1e-6,
      `${site.id} sand is flat at ${site.sandMeshY} m`);
    assert.equal(downY, 0, `${site.id} sand normals point up`);
    assert.equal(badWinding, 0, `${site.id} sand triangles are wound to face up`);
    // every triangle vertex is on the ring (inside or on its edge) — no geometry leaks outside the sand
    for (let i = 0; i < pos.count; i += 3) {
      const x = pos.getX(i), z = pos.getZ(i);
      const inside = inRing(site.sandRing, x, z) || onRing(site.sandRing, x, z, 1e-3);
      assert.ok(inside, `${site.id} sand vertex ${x.toFixed(1)},${z.toFixed(1)} is on the ring`);
    }
    assert.ok(mesh.userData.cullDistance > 0 && mesh.userData.cullCell > 0, `${site.id} has culling metadata`);
    assert.equal(mesh.userData.role, 'beach-sand');
  }
});

test('ground-mask hook: composes with an existing mask, is idempotent, and no-ops off-frame / non-node', () => {
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x556b2f });
  assert.equal(mat.isNodeMaterial, true);
  const ret = C.applyWaterfrontBeachGroundMask(mat);
  assert.equal(ret, mat);
  assert.ok(mat.maskNode, 'a mask node was composed');
  assert.equal(mat.userData.waterfrontBeachMask, true);
  const first = mat.maskNode;
  C.applyWaterfrontBeachGroundMask(mat);
  assert.equal(mat.maskNode, first, 'idempotent');

  const mat2 = new THREE.MeshStandardNodeMaterial();
  const existing = TSL.float(0.5).greaterThan(0.25);
  mat2.maskNode = existing;
  C.applyWaterfrontBeachGroundMask(mat2);
  assert.notEqual(mat2.maskNode, existing, 'and-composed with the existing mask');

  assert.equal(C.applyWaterfrontBeachGroundMask({ isNodeMaterial: false }).isNodeMaterial, false);
  assert.equal(C.applyWaterfrontBeachGroundMask(null), null);

  // off-frame: a SYNTHETIC frame box that does not cover the beaches (not Eglinton, which does cover them). The builder
  // skips and the mask is a no-op when the active frame does not cover a sand ring.
  const e = city({ geodata: null });
  e.GEO = { frame: { detail: { x0: 9990, x1: 10010, z0: 9990, z1: 10010 } } };
  const el = e.waterfrontBeachGroundLayout();
  assert.equal(el.sites.length, 0, 'no sites in a frame that does not cover the sand');
  assert.ok(el.skipped.length === 2, 'both beaches skipped');
  const fake = { added: [], add(o) { this.added.push(o); } };
  assert.equal(e.createWaterfrontBeachGround(THREE, fake), null);
  assert.equal(fake.added.length, 0, 'nothing added off-frame');
  assert.equal(e.waterfrontBeachGroundEnabled, false);
  const m3 = new THREE.MeshStandardNodeMaterial();
  e.applyWaterfrontBeachGroundMask(m3);
  assert.ok(!m3.maskNode, 'no mask off-frame');
});

test('frame guard is shared-world: BOTH the real detail and the real Eglinton frames build the beaches', async () => {
  const { unpackGeo } = await import('../js/geodata-loader.js');
  const decode = async (rel) => {
    const buf = await fs.promises.readFile(new URL(`../${rel}`, import.meta.url));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return unpackGeo(ab);
  };
  // The real committed frames: data/toronto-geodata.bin (detail) and data/frames/eglinton/toronto-geodata.bin.
  for (const rel of ['data/toronto-geodata.bin', 'data/frames/eglinton/toronto-geodata.bin']) {
    const { GEO } = await decode(rel);
    // build a city against the REAL decoded geodata (real city-config + details module + this module)
    const ctx = {
      window: { CITY: { THREE, TSL, CITY_BOUNDS: { sidewalkHeight: 0.22 }, GEO } }, console: { info() {}, log() {}, warn() {} },
      performance, URLSearchParams, Buffer, atob: (s) => Buffer.from(s, 'base64').toString('binary')
    };
    vm.runInNewContext(read('js/city-config.js'), ctx);
    vm.runInNewContext(read('js/waterfront-details.js'), ctx);
    vm.runInNewContext(read('js/waterfront-beach-ground.js'), ctx);
    const CC = ctx.window.CITY;
    const lay = CC.waterfrontBeachGroundLayout();
    // The Eglinton frame (x -7900..9600, z -7300..3600) contains the beaches; so does the detail frame. Both build both.
    assert.equal(lay.sites.length, 2, `${rel}: both beaches build`);
    const built = CC.createWaterfrontBeachGround(THREE, { add() {} });
    assert.ok(built && built.stats.meshes === 2, `${rel}: two sand meshes built`);
    for (const s of lay.sites) {
      assert.ok(s.sandRing.length >= 3, `${rel}: ${s.id} has its OSM ring from the shared export`);
      // the ring is the shared export from the details module in this same real city
      assert.equal(JSON.stringify(s.sandRing), JSON.stringify(CC.WATERFRONT_SAND_RINGS[s.id]), `${rel}: ${s.id} shared ring`);
    }
  }
  // a synthetic box that does NOT cover the beaches still skips (guard works), but it is NOT Eglinton
  const e = city({ geodata: null });
  e.GEO = { frame: { detail: { x0: -9000, x1: -8000, z0: -9000, z1: -8000 } } };
  assert.equal(e.waterfrontBeachGroundLayout().sites.length, 0);
});

test('mapped paths crossing the sand are preserved: corridors are exempt from the mask and cut from the mesh', () => {
  // From the committed detail geodata: HTO Park's sand is crossed by mapped park paths; Sugar Beach's is not.
  const sugar = byId.sugarBeach, hto = byId.htoPark;
  assert.ok(Array.isArray(hto.paths), 'HTO carries its path corridors');
  assert.ok(hto.paths.length >= 1, `HTO has mapped paths crossing the sand (${hto.paths.length})`);
  // find a point on a path centre line that is inside the HTO sand (a crossing segment may only clip a corner)
  let onPath = null;
  for (const seg of hto.paths) {
    for (let t = 0; t <= 1; t += 0.05) {
      const x = seg.ax + (seg.bx - seg.ax) * t, z = seg.az + (seg.bz - seg.az) * t;
      if (inRing(hto.sandRing, x, z)) { onPath = { x, z, seg }; break; }
    }
    if (onPath) break;
  }
  assert.ok(onPath, 'a mapped path runs across the HTO sand interior');
  const { x: mx, z: mz } = onPath;
  const p = onPath.seg;
  assert.equal(C.waterfrontBeachKeepoutAt(mx, mz), false, 'the path centre line is not sand keep-out');
  assert.equal(C.waterfrontBeachPathAt(mx, mz), true, 'the path centre line is recognised as a path');
  // the exclusion polygon carries the corridor for a CPU caller
  const ex = C.waterfrontBeachExclusionPolygons().find((e) => e.id === 'htoPark');
  assert.ok(ex.paths.length >= 1, 'the exclusion exposes the path corridor');
  // built mesh: no triangle lies wholly under a path corridor (the boardwalk is not buried)
  const built = C.createWaterfrontBeachGround(THREE, { add() {} });
  const mesh = built.group.getObjectByName('WaterfrontBeachGround_htoPark_Sand');
  const pos = mesh.geometry.attributes.position;
  for (let t = 0; t + 2 < pos.count; t += 3) {
    const under = hto.paths.some((s) => {
      const inC = (x, z) => {
        const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-9;
        const tt = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
        return Math.hypot(s.ax + dx * tt - x, s.az + dz * tt - z) <= s.half + 0.05;
      };
      return inC(pos.getX(t), pos.getZ(t)) && inC(pos.getX(t + 1), pos.getZ(t + 1)) && inC(pos.getX(t + 2), pos.getZ(t + 2));
    });
    assert.ok(!under, `no sand triangle is wholly under the mapped path (tri ${t / 3})`);
  }
});

test('sources are recorded and placement is deterministic (no randomness in siting)', () => {
  const src = read('js/waterfront-beach-ground.js');
  for (const needle of ['way/172728993', 'way/189306980', 'waterfrontoronto.ca/our-projects/canadas-sugar-beach',
    'landscapeperformance.org/case-study-briefs/hto-park']) {
    assert.ok(src.includes(needle), `records ${needle}`);
  }
  assert.equal(/Math\.random\s*\(/.test(src), false, 'no random siting');
  assert.equal(typeof C.createWaterfrontBeachGround, 'function');
  assert.equal(C.buildWaterfrontBeachGround, C.createWaterfrontBeachGround);
});

// A point within `tol` of the ring's edge (used to accept triangulation vertices that lie exactly on an edge).
function onRing(ring, x, z, tol) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
    if (Math.hypot(ax + dx * t - x, az + dz * t - z) <= tol) return true;
  }
  return false;
}
