// Source-backed island cottage YARD materials (js/waterfront-island-yard-materials.js, bead st-sb3r.29).
//
// These tests use the real generated lane data (js/waterfront-island-lanes-data.js), the real source-matched island
// building profiles (js/waterfront-island-buildings-data.js + js/waterfront-island-buildings.js) and the committed
// BINARY detail/Eglinton geodata (data/toronto-geodata.bin, decoded by js/geodata-loader.js — the actual city database,
// not a legacy script). They prove, on the PURE CPU side:
//   - the two photographed corridors bind to the correct per-way OSM ways, and only those two;
//   - the classifier claims EXACTLY the three source-validated cottage blocks (>= 3 matched, residential majority) that
//     border Oneida/Ojibway, and EXCLUDES the weak park block 2904 (1 match) and the park/wild block 2895;
//   - the effect is the narrow intersection of eligible native blocks with the bounded 12 m corridor envelope: the lane
//     centre (roadway) and the park block are 0, the far block interior is 0, and the replaced area is a bounded strip,
//     not a whole block of grass;
//   - a projection mismatch, an unsupported frame, or absent source data is a strict no-op;
//   - the exported hook is a no-op without TSL / on a non-node material, composes against the real native channels with
//     the REAL three/tsl node system, records its application, and is idempotent;
//   - the module owns no builder, no cover geometry and touches no maskNode, so mapped sidewalk/street/path materials and
//     the batched 'Yards' draw are unchanged; the bounded mask is small (reported dims/bytes);
//   - the 33 mapped residential-canopy positions give bounded garden context inside the effect region.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const ROOT = new URL('..', import.meta.url);
const readJs = (file) => fs.readFileSync(new URL(`js/${file}`, ROOT), 'utf8');
const readBin = (rel) => fs.readFileSync(new URL(rel, ROOT));

const loadBin = async (rel) => {
  let u8 = new Uint8Array(readBin(rel));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  const { decodeGeo } = await import(new URL('js/geodata-loader.js', ROOT));
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
};

const detail = await loadBin('data/toronto-geodata.bin');

function city({ geo = detail.GEO, frameDetail = null, projection = null, withLanes = true, withProfiles = true, withCanopy = false, withModule = true } = {}) {
  const frame = { ...(geo.frame || {}) };
  frame.detail = frameDetail ? { ...frameDetail } : { ...(geo.frame?.detail || {}) };
  frame.projection = projection ? { ...projection } : { ...(geo.frame?.projection || {}) };
  const G = { ...geo, frame };
  const C = { GEO: G };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, Date, Number, Array, Set, Map, Uint8Array, Float32Array, JSON, isFinite, parseFloat };
  vm.createContext(ctx);
  if (withProfiles) {
    vm.runInContext(readJs('waterfront-island-buildings-data.js'), ctx, { filename: 'waterfront-island-buildings-data.js' });
    vm.runInContext(readJs('waterfront-island-buildings.js'), ctx, { filename: 'waterfront-island-buildings.js' });
  }
  if (withLanes) vm.runInContext(readJs('waterfront-island-lanes-data.js'), ctx, { filename: 'waterfront-island-lanes-data.js' });
  if (withCanopy) vm.runInContext(readJs('waterfront-island-residential-canopy-data.js'), ctx, { filename: 'waterfront-island-residential-canopy-data.js' });
  if (withModule) vm.runInContext(readJs('waterfront-island-yard-materials.js'), ctx, { filename: 'waterfront-island-yard-materials.js' });
  return ctx.window.CITY;
}

// A block polygon centroid from the binary GEO (cross-realm safe).
const blockPoly = (GEO, id) => {
  const flat = GEO.blocks[id][0];
  const poly = [];
  for (let i = 0; i < flat.length; i += 2) poly.push({ x: flat[i], z: flat[i + 1] });
  return poly;
};
const centroid = (poly) => {
  let cx = 0, cz = 0;
  for (const p of poly) { cx += p.x; cz += p.z; }
  return { x: cx / poly.length, z: cz / poly.length };
};

test('the two source corridors bind to real per-way Oneida/Ojibway OSM ways, and only those', () => {
  const C = city();
  const L = C.islandYardMaterialLayout();
  assert.equal(L.supported, true, L.reason);
  assert.equal(L.corridors.length, 2);
  const byKey = Object.fromEntries(L.corridors.map((c) => [c.key, c]));
  assert.equal(byKey.oneida.osmWay, 13541126);
  assert.equal(byKey.ojibway.osmWay, 13541122);
  assert.equal(byKey.oneida.name, 'Oneida Avenue');
  assert.equal(byKey.ojibway.name, 'Ojibway Avenue');
  for (const c of L.corridors) {
    assert.deepEqual(Array.from(c.ways), [c.osmWay], `${c.key} is one way`);
    assert.equal(c.cls, 'living_street');
  }
  assert.equal(C.ISLAND_YARD_MATERIALS_SOURCES.length, 2);
  for (const spec of Array.from(C.ISLAND_YARD_MATERIALS_SOURCES)) {
    assert.ok(['Oneida Avenue', 'Ojibway Avenue'].includes(spec.name), spec.name);
    assert.match(spec.url, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  }
});

test('the classifier claims exactly the three source-validated cottage blocks bordering Oneida/Ojibway', () => {
  const C = city();
  const elig = C.islandYardEligibleBlocks();
  assert.ok(Array.isArray(elig), 'eligibility resolves');
  assert.deepEqual(Array.from(elig, (e) => e.id), [2901, 2903, 2905]);
  for (const e of elig) {
    // source-validated residential/cottage majority (aligns with js/city-grid.js .24 classification)
    assert.ok(e.matchedN >= 3, `block ${e.id} has >= 3 matched profiles (${e.matchedN})`);
    assert.ok(e.residentialN >= e.matchedN * 0.6, `block ${e.id} residential majority (${e.residentialN}/${e.matchedN})`);
    assert.ok(e.matchedTop < 14, `block ${e.id} is cottage height, not a paved tower block (${e.matchedTop})`);
    assert.ok(['oneida', 'ojibway'].includes(e.nearest), `block ${e.id} borders a photographed corridor`);
    assert.ok(e.distanceM <= 12, `block ${e.id} is inside the envelope (${e.distanceM.toFixed(2)} m)`);
  }
  const ids = Array.from(elig, (e) => e.id);
  assert.ok(!ids.includes(2904), 'the weak park block 2904 (1 match, 41% park) is excluded');
  assert.ok(!ids.includes(2895), 'the park/wild block 2895 (0 residential) is excluded');
});

test('with CITY.BLOCKS present (the browser city-config path) the same three blocks are eligible', () => {
  const C = city();
  const GEO = C.GEO;
  // Mirror the js/city-config.js BLOCKS mapping (the committed CITY.BLOCKS shape) and hand it to a fresh context.
  const BLOCKS = GEO.blocks.map((row, id) => {
    const flat = row[0];
    const poly = [];
    for (let i = 0; i < flat.length; i += 2) poly.push({ x: flat[i], z: flat[i + 1] });
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    let a = 0, cx = 0, cz = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const p = poly[i], q = poly[j], c = q.x * p.z - p.x * q.z;
      a += c; cx += (q.x + p.x) * c; cz += (q.z + p.z) * c;
    }
    a *= 0.5;
    return { id, poly, rects: row[1], park: row[2], wild: row[6], rect: !!row[4], median: !!row[5], area: Math.abs(a), minX, maxX, minZ, maxZ, cx: a ? cx / (6 * a) : (minX + maxX) / 2, cz: a ? cz / (6 * a) : (minZ + maxZ) / 2 };
  });
  const C2 = city();
  C2.BLOCKS = BLOCKS;
  assert.deepEqual(Array.from(C2.islandYardEligibleBlocks(), (e) => e.id), [2901, 2903, 2905]);
  assert.equal(C2.islandYardMaterialLayout().counts.replacedAreaM2, C.islandYardMaterialLayout().counts.replacedAreaM2);
});

test('the block-edge support margin removes the raster halo, and beyond it the gap stays native', () => {
  // Regression for the thin white/stippled native-concrete seam beside the lane: the hard binary block-edge gate,
  // bilinearly sampled, left a ~1 texel partial-coverage halo at the yard/curb boundary. The support margin (~1.5 m)
  // fills it so the yard beside the lane is fully covered, while the roadway gap beyond the margin stays native.
  const C = city();
  const support = C.ISLAND_YARD_SUPPORT_M;
  assert.ok(support >= 1 && support <= 2, `support margin ~one texel (${support})`);
  const GEO = C.GEO;
  const runs = C.ISLAND_LANES_DATA.runs;
  const inPoly = (poly, x, z) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  };
  let checked = 0;
  for (const e of C.islandYardEligibleBlocks()) {
    const poly = blockPoly(GEO, e.id);
    const c = centroid(poly);
    const run = runs.find((r) => (r.names || []).includes(e.nearest === 'oneida' ? 'Oneida Avenue' : 'Ojibway Avenue'));
    const pi = Math.floor(run.points.length / 2);
    const a = run.points[pi], b = run.points[pi + 1];
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const dx = c.x - mx, dz = c.z - mz, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    // walk the ray from the lane midpoint toward the block centroid; find the boundary entry distance
    let d0 = null;
    for (let t = 0; t <= 16; t += 0.1) {
      if (inPoly(poly, mx + ux * t, mz + uz * t)) { d0 = t; break; }
    }
    assert.ok(d0 != null, `block ${e.id} is reached from its lane`);
    const at = (t) => C.islandYardCoverageAt(mx + ux * t, mz + uz * t);
    // the lane centre is native (the roadway is a different material)
    assert.equal(at(0), 0, `block ${e.id} lane centre native`);
    // the boundary itself and a point just OUTSIDE it (within the support margin) are fully covered: the halo is gone
    assert.ok(at(d0) > 0.9, `block ${e.id} boundary covered (${at(d0)})`);
    const outside = Math.max(0, d0 - 0.6);
    if (outside < d0) {
      assert.equal(inPoly(poly, mx + ux * outside, mz + uz * outside), false, `block ${e.id} probe is outside the block`);
      assert.ok(at(outside) > 0.9, `block ${e.id} just outside the boundary is covered by the support margin (${at(outside)})`);
    }
    // beyond the support margin on the gap side, the yard/roadway is native again
    const far = d0 - (support + 1.5);
    if (far > 0) assert.equal(at(far), 0, `block ${e.id} beyond the support margin is native (${far.toFixed(1)} m)`);
    // a point inside the block but beyond the 12 m corridor envelope is native (off-corridor)
    const dCorr = (x, z) => {
      let best = Infinity;
      for (const r of runs) {
        for (let i = 0; i + 1 < r.points.length; i++) {
          const p = r.points[i], q = r.points[i + 1];
          const ex = q[0] - p[0], ez = q[1] - p[1], l2 = ex * ex + ez * ez || 1e-9;
          let t = ((x - p[0]) * ex + (z - p[1]) * ez) / l2;
          t = Math.max(0, Math.min(1, t));
          best = Math.min(best, Math.hypot(p[0] + ex * t - x, p[1] + ez * t - z));
        }
      }
      return best;
    };
    for (let t = 0; t <= 16; t += 0.5) {
      const x = mx + ux * t, z = mz + uz * t;
      if (inPoly(poly, x, z) && dCorr(x, z) > 13) {
        assert.equal(C.islandYardCoverageAt(x, z), 0, `block ${e.id} off-corridor interior is native`);
        break;
      }
    }
    checked++;
  }
  assert.equal(checked, 3);
});

test('the effect is the narrow block x corridor-envelope intersection, not whole blocks', () => {
  const C = city();
  const GEO = C.GEO;
  const runs = C.ISLAND_LANES_DATA.runs;
  // the lane centre is roadway: NOT covered (street paving stays native)
  for (const id of [41, 42]) {
    const run = runs.find((r) => r.id === id);
    const pi = Math.floor(run.points.length / 2);
    const mx = (run.points[pi][0] + run.points[pi + 1][0]) / 2;
    const mz = (run.points[pi][1] + run.points[pi + 1][1]) / 2;
    assert.equal(C.islandYardCoverageAt(mx, mz), 0, `run ${id} centre is not painted`);
  }
  // the eligible yard beside a photographed lane IS covered, and the far interior / other block is not
  for (const [id, key] of [[42, 'oneida'], [41, 'ojibway']]) {
    const run = runs.find((r) => r.id === id);
    const pi = Math.floor(run.points.length / 2);
    const a = run.points[pi], b = run.points[pi + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    const nx = -dz / L, nz = dx / L;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    let best = 0;
    for (let off = -11; off <= 11; off += 0.5) best = Math.max(best, C.islandYardCoverageAt(mx + nx * off, mz + nz * off));
    assert.ok(best > 0.9, `${key} has eligible yard beside the lane (${best})`);
  }
  for (const e of C.islandYardEligibleBlocks()) {
    const c = centroid(blockPoly(GEO, e.id));
    assert.equal(C.islandYardCoverageAt(c.x, c.z), 0, `block ${e.id} centre is off-corridor`);
  }
  // the park block near the lane and the mainland are never covered
  assert.equal(C.islandYardCoverageAt(centroid(blockPoly(GEO, 2895)).x, centroid(blockPoly(GEO, 2895)).z), 0);
  assert.equal(C.islandYardCoverageAt(-2000, 0), 0);
  assert.equal(C.islandYardCoverageAt(0, 0), 0);
});

test('the replaced area is a bounded strip, far smaller than the eligible blocks', () => {
  const C = city();
  const L = C.islandYardMaterialLayout();
  const GEO = C.GEO;
  let blockArea = 0;
  const polyArea = (poly) => {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].z - poly[i].x * poly[j].z;
    return Math.abs(a) / 2;
  };
  for (const e of C.islandYardEligibleBlocks()) blockArea += polyArea(blockPoly(GEO, e.id));
  assert.ok(L.counts.replacedAreaM2 > 1000, `some yard is replaced (${L.counts.replacedAreaM2} m2)`);
  assert.ok(L.counts.replacedAreaM2 < blockArea * 0.25, `bounded well under a quarter of the blocks (${L.counts.replacedAreaM2} vs ${blockArea.toFixed(0)})`);
  assert.ok(L.counts.replacedAreaM2 < 20000, `bounded strip, not all of Algonquin (${L.counts.replacedAreaM2} m2)`);
  assert.equal(L.counts.eligibleBlocks, 3);
  assert.ok(L.counts.matchedResidentialBlocks >= 3);
});

test('the bounded mask is small and its dims/bytes are reported', () => {
  const C = city();
  const L = C.islandYardMaterialLayout();
  assert.ok(L.texture.width > 2 && L.texture.height > 2);
  assert.equal(L.texture.width, L.w);
  assert.equal(L.texture.height, L.h);
  assert.equal(L.texture.bytes, L.w * L.h * 16);
  assert.ok(L.texture.bytes < 2 * 1024 * 1024, `bounded mask (${L.texture.bytes} bytes)`);
  assert.ok(L.inside > 0 && L.inside < L.w * L.h);
  // outside the mask box the sampler is null (the border texels are 0)
  const b = L.box;
  assert.equal(C.islandYardMaskSample(b.x0 - 5, b.z0 - 5), null);
  assert.equal(C.islandYardMaskSample(b.x1 + 5, b.z1 + 5), null);
  // inside the effect region the CPU sampler interpolates the same positive coverage
  const run = C.ISLAND_LANES_DATA.runs.find((r) => r.id === 41);
  const pi = Math.floor(run.points.length / 2);
  const a = run.points[pi], c = run.points[pi + 1];
  const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
  const nx = -dz / len, nz = dx / len, mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  let hit = null;
  for (let off = 4; off <= 11 && !hit; off += 0.5) hit = C.islandYardMaskSample(mx + nx * off, mz + nz * off);
  assert.ok(hit && hit.coverage > 0.9, `CPU sampler hits the yard coverage (${hit && hit.coverage})`);
});

test('a projection mismatch, unsupported frame, or absent source data is a strict no-op', () => {
  // absent lanes data
  const noLanes = city({ withLanes: false });
  assert.equal(noLanes.islandYardMaterialLayout().supported, false);
  assert.equal(noLanes.islandYardEligibleBlocks(), null);

  // lanes present but no source-matched profiles: no eligible block
  const noProfiles = city({ withProfiles: false });
  assert.equal(noProfiles.islandYardMaterialLayout().supported, false);
  assert.match(noProfiles.islandYardMaterialLayout().reason, /no eligible/);

  // wrong projection (a different frame reusing the same numbers)
  const proj = { ...detail.GEO.frame.projection, kx: detail.GEO.frame.projection.kx * 1.01 };
  const wrong = city({ projection: proj });
  const Lw = wrong.islandYardMaterialLayout();
  assert.equal(Lw.supported, false);
  assert.match(Lw.reason, /projection/);
  assert.equal(wrong.islandYardEligibleBlocks(), null);

  // unsupported frame (detail box excludes the island): islandBuildingProfile rejects every row
  const away = city({ frameDetail: { x0: 0, x1: 100, z0: 0, z1: 100 } });
  assert.equal(away.islandYardMaterialLayout().supported, false);
  assert.deepEqual(Array.from(away.islandYardEligibleBlocks()), []);
});

const hookNoop = (C) => {
  const mat = { isNodeMaterial: true, colorNode: 'native' };
  assert.equal(C.applyIslandYardMaterial(mat), mat);
  assert.equal(mat.colorNode, 'native');
  assert.equal(C.applyIslandYardMaterial(null), null);
};

test('applyIslandYardMaterial is a no-op without TSL, on a non-node material, and without the source data', () => {
  hookNoop(city());
  const C2 = city();
  C2.TSL = new Proxy({}, { get: () => () => { throw new Error('TSL must not be reached for a non-node material'); } });
  const legacy = { isNodeMaterial: false };
  assert.equal(C2.applyIslandYardMaterial(legacy), legacy);
  hookNoop(city({ withLanes: false }));
  hookNoop(city({ withProfiles: false }));
});

// Build with the REAL three/tsl and three/webgpu, exactly as the browser imports them.
function cityWithThree({ withLanes = true, withProfiles = true } = {}) {
  const frame = { ...detail.GEO.frame, detail: { ...detail.GEO.frame.detail }, projection: { ...detail.GEO.frame.projection } };
  const C = { GEO: { ...detail.GEO, frame }, THREE, TSL };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, Date, Number, Array, Set, Map, Uint8Array, Float32Array };
  vm.createContext(ctx);
  if (withProfiles) {
    vm.runInContext(readJs('waterfront-island-buildings-data.js'), ctx, { filename: 'waterfront-island-buildings-data.js' });
    vm.runInContext(readJs('waterfront-island-buildings.js'), ctx, { filename: 'waterfront-island-buildings.js' });
  }
  if (withLanes) vm.runInContext(readJs('waterfront-island-lanes-data.js'), ctx, { filename: 'waterfront-island-lanes-data.js' });
  vm.runInContext(readJs('waterfront-island-yard-materials.js'), ctx, { filename: 'waterfront-island-yard-materials.js' });
  return C;
}

test('applyIslandYardMaterial composes with the real TSL, records its application, and is idempotent', () => {
  const C = cityWithThree();
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = TSL.color(0x6f8a38);
  mat.roughnessNode = TSL.float(0.9);
  mat.normalNode = TSL.normalWorld;
  const out = C.applyIslandYardMaterial(mat);
  assert.equal(out, mat);
  assert.ok(mat.userData && mat.userData.islandYardMaterial, 'hook recorded its application');
  assert.equal(mat.userData.islandYardMaterial.source, C.ISLAND_YARD_MATERIALS_STATUS);
  assert.deepEqual(Array.from(mat.userData.islandYardMaterial.blocks), [2901, 2903, 2905]);
  assert.ok(mat.userData.islandYardMaterialInfo.supported);
  assert.ok(mat.colorNode && typeof mat.colorNode === 'object');
  assert.ok(mat.roughnessNode && typeof mat.roughnessNode === 'object');
  assert.ok(mat.normalNode && typeof mat.normalNode === 'object');
  // mapped paths/sidewalks are a different material, and the batched yard draw is untouched: no maskNode, no new geometry
  assert.ok(mat.maskNode == null, 'the yard recolour never discards fragments via maskNode');
  // idempotent
  const col = mat.colorNode, rough = mat.roughnessNode, normal = mat.normalNode;
  C.applyIslandYardMaterial(mat);
  assert.equal(mat.colorNode, col);
  assert.equal(mat.roughnessNode, rough);
  assert.equal(mat.normalNode, normal);
});

test('a node material with no original channels stays native OFF-mask (falls back to the engine defaults)', () => {
  const C = cityWithThree();
  const bare = new THREE.MeshStandardNodeMaterial();
  const out = C.applyIslandYardMaterial(bare);
  assert.equal(out, bare);
  assert.ok(bare.userData && bare.userData.islandYardMaterial);
  assert.ok(bare.colorNode && typeof bare.colorNode === 'object');
  assert.ok(bare.roughnessNode && typeof bare.roughnessNode === 'object');
  assert.ok(bare.normalNode && typeof bare.normalNode === 'object');
  const src = readJs('waterfront-island-yard-materials.js');
  assert.match(src, /mat\.colorNode \|\| T\.materialColor/);
  assert.match(src, /mat\.roughnessNode \|\| T\.materialRoughness/);
  assert.match(src, /mat\.normalNode \|\| T\.materialNormal/);
});

test('the material graph builds with the REAL three/tsl node system (mask texture + manual bilinear)', () => {
  const C = cityWithThree();
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = TSL.color(0x6f8a38);
  mat.roughnessNode = TSL.float(0.9);
  mat.normalNode = TSL.normalWorld;
  C.applyIslandYardMaterial(mat);
  const info = mat.userData.islandYardMaterialInfo;
  assert.ok(info.texture.width > 2 && info.texture.height > 2);
  assert.ok(mat.colorNode && typeof mat.colorNode === 'object');
  assert.ok(mat.normalNode && typeof mat.normalNode === 'object');
});

test('the module owns no builder, cover geometry or route/paint change (text-only, material-only)', () => {
  const C = city();
  for (const gone of ['createWaterfrontIslandYards', 'islandYardGeometry', 'createIslandYardMaterials', 'buildIslandYardMaterials']) {
    assert.equal(typeof C[gone], 'undefined', gone);
  }
  assert.equal(typeof C.applyIslandYardMaterial, 'function');
  assert.equal(typeof C.islandYardMaskSample, 'function');
  const src = readJs('waterfront-island-yard-materials.js');
  assert.doesNotMatch(src, /maskNode/, 'the module never sets maskNode');
  assert.doesNotMatch(src, /new THREE\.(Mesh|BufferGeometry|ShapeGeometry|ExtrudeGeometry)/, 'no geometry is authored');
  assert.match(src, /NOT a survey|APPROXIMATIONS/, 'honest limits are stated');
});

test('the mapped residential canopy gives bounded garden context inside the effect region', () => {
  const C = city({ withCanopy: true });
  const D = C.ISLAND_RESIDENTIAL_CANOPY_DATA;
  assert.ok(D && Array.isArray(D.rows) && D.rows.length === 33, 'the 33 mapped canopy points load');
  let covered = 0;
  for (const r of D.rows) {
    const x = r[1] / 10, z = r[2] / 10;
    if (C.islandYardCoverageAt(x, z) > 0) covered++;
  }
  assert.ok(covered >= 25, `most mapped canopy points sit in the replaced yard (${covered}/33)`);
  assert.ok(covered <= 33);
});
