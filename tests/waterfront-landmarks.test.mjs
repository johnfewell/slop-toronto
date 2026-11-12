// The two Waterfront BIA landmarks' source-backed massing (js/waterfront-landmarks.js): Queen's Quay Terminal (the 1926
// Toronto Terminal Warehouse block, its 1983 +4-level addition as two stepped perimeter blocks around an open courtyard,
// the green-patina cornice, the Art Deco entrances and the genuine QQT clock tower) and the Redpath Sugar Refinery (the
// mapped halls, the ship unloader anchored to the Jarvis Slip quay edge, and the whale mural / red sign on the Raw Sugar
// Shed). Every solid must be a committed geodata footprint part: the QQT masses on rows 33202-33212, the Redpath masses
// inside the mapped "zone:industrial Redpath Sugar Refinery" zone and clear of the beach. The barrel silos and chimney
// have no mapped footprint and are reported unresolved, not invented. Model evidence is source text, not images.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function city({ withGeo = true } = {}) {
  const ctx = {
    window: { CITY: { THREE, Addons: { mergeGeometries }, CITY_BOUNDS: { sidewalkHeight: 0.22, waterLevel: -0.7 } } },
    console: { info() {}, warn() {}, error() {} }, performance
  };
  if (withGeo) vm.runInNewContext(read('js/toronto-geodata.js'), ctx);
  vm.runInNewContext(read('js/waterfront-landmarks.js'), ctx);
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
const inBox = (b, x, z, pad = 0) => {
  const cs = Math.cos(b.ang), sn = Math.sin(b.ang);
  const dx = x - b.cx, dz = z - b.cz;
  const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
  return Math.abs(u) <= b.halfW + pad && Math.abs(v) <= b.halfD + pad;
};

test('nothing is built on load; the landmark records and exclusion hook are exported', () => {
  const C = city();
  assert.equal(typeof C.createWaterfrontLandmarks, 'function');
  assert.equal(C.waterfrontLandmarks, undefined);
  assert.ok(Array.isArray(C.WATERFRONT_LANDMARKS) && C.WATERFRONT_LANDMARKS.length === 2);
  assert.equal(C.WATERFRONT_LANDMARKS.map((l) => l.id).join(','), 'queensQuayTerminal,redpathSugar');
  for (const l of C.WATERFRONT_LANDMARKS) {
    assert.ok(l.name && l.source && Array.isArray(l.sourceUrls) && l.sourceUrls[0].startsWith('https://'));
  }
  // the committed components are keyed by name+centre+height (not row index), so the same keys resolve in any frame
  assert.equal(C.QQT_LANDMARK.keys.warehouse.name, "Queen's Quay Terminal");
  assert.ok(Math.abs(C.QQT_LANDMARK.keys.warehouse.cx + 206.4) < 0.01);
  assert.ok(/420 x 200/.test(C.QQT_LANDMARK.source));
  assert.ok(C.QQT_LANDMARK.sourceUrls.some((u) => u.includes('NH17-253')), 'the CMHC addition case study is cited');
  assert.equal(C.REDPATH_LANDMARK.zoneName, 'Redpath Sugar Refinery');
  assert.equal(typeof C.waterfrontLandmarkExcludesBuilding, 'function');
});

test('the QQT warehouse shell is the mapped row 33202 footprint (simplified rectangle of the 420 x 200 ft block)', () => {
  const C = city();
  const qqt = C.waterfrontLandmarksLayout().qqt;
  assert.ok(qqt, 'QQT layout present');
  const b = C.GEO.buildings[33202];
  assert.equal(b[9], "Queen's Quay Terminal");
  assert.ok(Math.abs(qqt.box.cx - b[0]) < 1e-6 && Math.abs(qqt.box.cz - b[1]) < 1e-6);
  assert.ok(Math.abs(qqt.box.halfW - 70) < 0.2 && Math.abs(qqt.box.halfD - 30.66) < 0.2, `mapped 140 x 61.3 m`);
  assert.equal(qqt.warehouseH, b[4], 'warehouse uses the mapped 31 m height');
  assert.ok(qqt.warehouseH >= 31 && qqt.warehouseH <= 32);
});

test('the QQT addition is the mapped perimeter bands + end band at 43 m around an OPEN courtyard, not one box', () => {
  const C = city();
  const qqt = C.waterfrontLandmarksLayout().qqt;
  // row 33204 splits into three mapped parts: two long bands (~120/112 x 10 m) and a short end band (~11.5 x 24 m)
  assert.equal(qqt.additionParts.length, 3, 'three mapped addition parts');
  const bands = qqt.additionParts.filter((p) => p.halfD < 6);
  assert.equal(bands.length, 2, 'two long perimeter bands');
  for (const p of bands) assert.ok(p.halfW > 40, `a perimeter band ${(p.halfW * 2).toFixed(1)} m long`);
  for (const p of qqt.additionParts) assert.ok(p.h >= 43 && p.h <= 43.5, `addition reaches mapped ~43 m, got ${p.h}`);
  // the courtyard: the warehouse-centre point is NOT covered by any addition band (the middle stays open)
  const cx = qqt.box.cx, cz = qqt.box.cz;
  assert.ok(!qqt.additionParts.some((p) => inBox(p, cx, cz)), 'the courtyard centre is open (no solid addition box there)');
  // the addition parts come from the mapped row, not a synthesised inset box
  assert.ok(qqt.additionParts.every((p) => p.row === 33204));
});

// The clock is the NORTH-front shaft (row 33203 per the captain's photo/map inference), NOT the east mid-roof 33212.
// The warehouse yaw is ~-pi/2, so the warehouse's SHORT north face is at z = cz - halfW (the north edge). This test
// asserts ACTUAL world geometry: the clock centre lands within a few metres of that north edge (not mid-roof), and the
// built dial is a genuinely BLACK rendered mesh with white hands (the old draft merged it into the cream shell).
test('the QQT clock tower is the NORTH-front shaft (row 33203), black dial mesh at the warehouse north edge', () => {
  const C = city();
  const qqt = C.waterfrontLandmarksLayout().qqt;
  const clock = qqt.clockTower;
  assert.ok(clock, 'clock tower present');
  // resolved to the north-front row 33203 (name+centre+height key), NOT 33212
  assert.equal(clock.cx, C.GEO.buildings[33203][0], 'centred on the mapped north-front row 33203');
  assert.ok(Math.abs(clock.cz - C.GEO.buildings[33203][1]) < 1e-6);
  // real geography: the warehouse north/short edge is at z = box.cz - box.halfW (yaw ~-pi/2). The clock must hug it.
  const b = qqt.box;
  const northZ = b.cz - b.halfW;          // the north (Queens Quay) short face
  const southZ = b.cz + b.halfW;          // the harbour short face
  const dNorth = Math.hypot(clock.cx - b.cx, clock.cz - northZ);
  const dSouth = Math.hypot(clock.cx - b.cx, clock.cz - southZ);
  assert.ok(dNorth < 8, `clock centre is at the NORTH edge, not mid-roof (north dist ${dNorth.toFixed(1)} m)`);
  assert.ok(dNorth < dSouth, `clock is nearer the north face than the south (${dNorth.toFixed(1)} < ${dSouth.toFixed(1)})`);
  // mapped 43.4 m height kept (not forced higher)
  assert.ok(Math.abs(clock.topH - 43.4) < 0.6, `clock top is the mapped ~43.4 m (${clock.topH})`);
  assert.ok(clock.topH > clock.baseH, 'rises above the mapped parapet');
  assert.ok(clock.ribs >= 5, 'narrow Art Deco vertical ribs');
  // REAL rendered meshes: a black dial and white hands, separate from the cream shell
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const by = (n) => out.group.children.find((m) => m.name === n);
  const dial = by('WaterfrontLandmarks_QQT_ClockDial');
  const hands = by('WaterfrontLandmarks_QQT_ClockHands');
  assert.ok(dial, 'the clock dial is its own mesh (not merged into the cream shell)');
  assert.ok(hands, 'the clock hands/ticks are their own mesh');
  // the dial is genuinely BLACK (all channels low), unlike the cream shell
  const dc = dial.material.color;
  assert.ok(dc.r < 0.1 && dc.g < 0.1 && dc.b < 0.1, `dial is black (#${dc.getHexString()})`);
  const shell = by('WaterfrontLandmarks_QQT_Shell');
  assert.ok(dial !== shell && hands !== shell, 'dial/hands are not the shell');
  // both dial faces (north + west) exist: at least two discs' worth of geometry, and the dial hugs the north edge
  dial.geometry.computeBoundingBox();
  const db = dial.geometry.boundingBox;
  assert.ok(db.max.y < clock.baseH + (clock.topH - clock.baseH) * 0.82 + 0.23,
    'dial fits below the shaft parapet instead of protruding through its cap');
  const pos = dial.geometry.attributes.position;
  const northFaceZ = [];
  for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < clock.cz - clock.halfD) northFaceZ.push(pos.getZ(i));
  assert.ok(northFaceZ.length && Math.max(...northFaceZ) < clock.cz - clock.halfD - 0.2,
    'the north dial clears the raised ribs rather than appearing striped');
  assert.ok(db.min.z <= northZ + 1 && db.max.z >= northZ - 8, `dial geometry sits at the north edge (z ${db.min.z.toFixed(1)}..${db.max.z.toFixed(1)} vs north ${northZ.toFixed(1)})`);
  assert.equal(clock.faces.length, 2, 'two photo-visible dial faces (north + west), not four invented ones');
});

// ---- Green frame + glass typology (captain's historical Zeidler photograph reading). Source: TSA page, credits
// ZeidlerArchitecture; the visual form; the measured fit numbers are labelled estimates in the spec / refinement doc.
// The real building is a GREEN-frame-and-glass building on a CREAM structural frame with PALE-GREEN projecting
// glazed/balcony banks at the four upper levels under a FLAT GREEN roof edge — NOT a plain cream box, NOT a green solid.
test('the warehouse facade is GREEN frame + DARK multi-pane glazing over cream piers (not the bland white window grid)', () => {
  const C = city();
  const qqt = C.waterfrontLandmarksLayout().qqt;
  assert.ok(qqt.frame, 'the green-frame palette is on the layout');
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const by = (n) => out.group.children.find((m) => m.name === n);
  const frame = by('WaterfrontLandmarks_QQT_GreenFrame');
  const glass = by('WaterfrontLandmarks_QQT_Glazing');
  assert.ok(frame && glass, 'green frame and dark glass meshes exist');
  // both are real merged geometries with volume, not empty instanced stubs
  for (const m of [frame, glass]) {
    assert.ok(m.geometry && m.geometry.attributes.position.count > 0, `${m.name} carries real geometry`);
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    assert.ok(bb.max.x - bb.min.x > 50 && bb.max.z - bb.min.z > 40, `${m.name} wraps the whole warehouse`);
    assert.ok(bb.max.y <= 31.5 && bb.min.y < 1, `${m.name} stays within the mapped 31 m warehouse (no green solid above it)`);
  }
  // the frame is green-dominant; the glass is dark and green-tinted (g > r and g > b); neither is a bright blanket
  const fc = frame.material.color, gc = glass.material.color;
  assert.ok(fc.g > fc.r && fc.g > fc.b, `frame is green (${fc.r.toFixed(2)},${fc.g.toFixed(2)},${fc.b.toFixed(2)})`);
  assert.ok(gc.g > gc.r && gc.g >= gc.b, `glass is green-tinted dark (${gc.r.toFixed(2)},${gc.g.toFixed(2)},${gc.b.toFixed(2)})`);
  assert.ok(gc.r + gc.g + gc.b < 0.6, `glass is genuinely dark, not a pale wash (${(gc.r + gc.g + gc.b).toFixed(2)})`);
  // the mullion grid actually subdivides the face into many cells (a real frame grid, not two bars)
  assert.ok(out.stats.qqq.greenFrameBays >= 12, `green bays across all faces (${out.stats.qqq.greenFrameBays})`);
  assert.ok(out.stats.qqq.greenFrameCells >= out.stats.qqq.greenFrameBays * 4, 'each bay is split into storey cells');
});

test('the 1983 addition reads as framed DARK glazing + pale-green rails in four levels (not a solid mint billboard)', () => {
  const C = city();
  const qqt = C.waterfrontLandmarksLayout().qqt;
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const by = (n) => out.group.children.find((m) => m.name === n);
  const glaze = by('WaterfrontLandmarks_QQT_ResGlazing');
  const frame = by('WaterfrontLandmarks_QQT_ResFrame');
  const rail = by('WaterfrontLandmarks_QQT_ResRail');
  assert.ok(glaze && frame && rail, 'the residential glazing, pale-green frame and rail meshes all exist');
  assert.equal(out.stats.qqq.resLevels, 4, 'four added residential levels (source text)');
  assert.ok(out.stats.qqq.resBanks >= 4 * qqt.additionParts.length, `a bank per band per face-level (${out.stats.qqq.resBanks})`);
  // the WINDOW panels are DARK glazing (not a solid pale-green panel); the pale-green is the frame/rail
  const gc = glaze.material.color;
  const gHex = gc.getHexString();
  const fr = frame.material.color;
  const fHex = fr.getHexString();
  const rH = parseInt(fHex.slice(0, 2), 16), gH = parseInt(fHex.slice(2, 4), 16), bH = parseInt(fHex.slice(4, 6), 16);
  assert.ok(gc.r + gc.g + gc.b < 0.5, `residential window panels are dark glazing, not a mint billboard (#${gHex})`);
  assert.ok(gH > rH && gH > bH && Math.min(rH, gH, bH) > 80, `the frame/rail is a PALE green (#${fHex})`);
  // sits ABOVE the warehouse roof (31 m), no higher than the mapped 43 m addition
  frame.geometry.computeBoundingBox();
  const bb = frame.geometry.boundingBox;
  assert.ok(bb.min.y >= 30.5, `banks begin at the warehouse roof (${bb.min.y.toFixed(1)})`);
  assert.ok(bb.max.y <= 43.6, `banks stay within the mapped 43 m addition (${bb.max.y.toFixed(1)})`);
  // hug the mapped perimeter bands (long along z, spanning band-to-band in x); they do not fill the courtyard
  assert.ok(bb.max.z - bb.min.z > 100, `banks run the long bands (${(bb.max.z - bb.min.z).toFixed(0)} m)`);
  assert.ok(bb.max.x - bb.min.x > 35, `banks span the band separation (${(bb.max.x - bb.min.x).toFixed(0)} m)`);
  assert.equal(qqt.additionParts.length, 3, 'the three mapped addition parts are untouched');
  const cx = qqt.box.cx, cz = qqt.box.cz;
  const cs = Math.cos(qqt.box.ang), sn = Math.sin(qqt.box.ang);
  const inBand = (p) => { const dx = cx - p.cx, dz = cz - p.cz, u = dx * cs - dz * sn, v = dx * sn + dz * cs; return Math.abs(u) <= p.halfW && Math.abs(v) <= p.halfD; };
  assert.ok(!qqt.additionParts.some(inBand), 'the courtyard/lightwell centre stays open (no geometry fills it)');
});

// The captain's draft bug: panels built with box.ang on EVERY face read as perpendicular "fins" on the short (±u) faces.
// This projects every panel vertex into the warehouse's local (u,v) frame and asserts each thin panel lies FLUSH to a wall
// (its thin axis is perpendicular to the wall, its wide axis along it) — i.e. no panel stands perpendicular like a fin.
test('no QQT facade panel crosses a wall as a perpendicular fin (per-face yaw, not box.ang for all faces)', () => {
  const C = city();
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const b = out.layout.qqt.box;
  const cs = Math.cos(b.ang), sn = Math.sin(b.ang);
  const toLocal = (x, z) => { const dx = x - b.cx, dz = z - b.cz; return [dx * cs - dz * sn, dx * sn + dz * cs]; }; // (u, v)
  const meshes = ['WaterfrontLandmarks_QQT_Glazing', 'WaterfrontLandmarks_QQT_GreenFrame', 'WaterfrontLandmarks_QQT_Cream']
    .map((n) => out.group.children.find((m) => m.name === n)).filter(Boolean);
  assert.ok(meshes.length === 3, 'the three warehouse facade meshes exist');
  let checked = 0;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    // walk each triangle; for each, measure its (u,v) extent. A wall-parallel thin panel has a large extent along one
    // planar axis and a tiny (≤ ~0.25 m) extent OUT of the wall plane (|u|≈halfW or |v|≈halfD), never a long span
    // reaching far off every wall (the fin signature: a long edge running perpendicular off the wall into open air).
    for (let i = 0; i < pos.count; i += 3) {
      const p0 = toLocal(pos.getX(i), pos.getZ(i));
      const p1 = toLocal(pos.getX(i + 1), pos.getZ(i + 1));
      const p2 = toLocal(pos.getX(i + 2), pos.getZ(i + 2));
      const us = [p0[0], p1[0], p2[0]], vs = [p0[1], p1[1], p2[1]];
      const uMin = Math.min(...us), uMax = Math.max(...us), vMin = Math.min(...vs), vMax = Math.max(...vs);
      // the panel must be sitting near ONE of the four walls: within ~1.2 m of a wall plane in u or v
      const nearU = Math.abs(uMax - b.halfW) < 1.4 || Math.abs(uMin + b.halfW) < 1.4;
      const nearV = Math.abs(vMax - b.halfD) < 1.4 || Math.abs(vMin + b.halfD) < 1.4;
      assert.ok(nearU || nearV, `triangle ${i / 3} of ${m.name} sits off every warehouse wall (u ${uMin.toFixed(1)}..${uMax.toFixed(1)}, v ${vMin.toFixed(1)}..${vMax.toFixed(1)}) — a fin`);
      checked++;
    }
  }
  assert.ok(checked > 50, `projected ${checked} facade triangles into the local frame`);
});

test('the flat green ROOF EDGE is its own green material, not merged into the cream shell (the old lost-green bug)', () => {
  const C = city();
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const cornice = out.group.children.find((m) => m.name === 'WaterfrontLandmarks_QQT_Cornice');
  assert.ok(cornice, 'the green roof edge is a separate mesh');
  const cc = cornice.material.color;
  assert.ok(cc.g > cc.r && cc.g > cc.b, `roof edge is green (${cc.r.toFixed(2)},${cc.g.toFixed(2)},${cc.b.toFixed(2)})`);
  cornice.geometry.computeBoundingBox();
  const bb = cornice.geometry.boundingBox;
  assert.ok(bb.max.y <= 31.2 && bb.min.y >= 29.5, `sits at the ~31 m warehouse eaves (${bb.min.y.toFixed(1)}..${bb.max.y.toFixed(1)})`);
  // the cream shell is still cream (the green was NOT folded into it)
  const shell = out.group.children.find((m) => m.name === 'WaterfrontLandmarks_QQT_Shell');
  const sc = shell.material.color;
  assert.ok(sc.r > sc.g && sc.g > sc.b, `shell stays cream/warm (${sc.r.toFixed(2)},${sc.g.toFixed(2)},${sc.b.toFixed(2)})`);
});

test('the QQT green-frame typology is bounded culling geometry under the one root (no per-window objects)', () => {
  const C = city();
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const qqtMeshes = out.group.children.filter((m) => /WaterfrontLandmarks_QQT_/.test(m.name));
  assert.ok(qqtMeshes.length >= 6, `the QQT reads as several merged meshes (${qqtMeshes.length})`);
  for (const m of qqtMeshes) {
    assert.ok(m.isMesh, `${m.name} is a merged Mesh, not a per-window object`);
    assert.ok(m.userData.cullDistance > 0 && m.userData.cullCell > 0, `${m.name} carries culling metadata`);
    assert.ok(m.geometry.boundingSphere && Number.isFinite(m.geometry.boundingSphere.radius), `${m.name} has a bounding sphere`);
  }
  // bounded triangle budget: the whole QQT typology stays cheap (merged, not thousands of objects).
  // The explicit green-frame typology is genuinely larger than the old shared shader: the warehouse carries 86 bays x
  // 8 storeys of dark glass cells, green mullions/transoms and cream spandrels/piers, and the 1983 addition carries 4
  // residential levels of glass + mullions + rails on all four faces of each mapped band. At the mapped dimensions that
  // is ~44.5k triangles, every one a flat panel on a mapped face merged into ten meshes — real architecture, not a
  // runaway per-window blow-up. The budget is set just above that measured count (45k) so a regression that adds
  // duplicate interior interfaces or per-window objects still trips it.
  const tris = qqtMeshes.reduce((s, m) => s + m.geometry.attributes.position.count / 3, 0);
  assert.equal(out.stats.qqq.greenFrameCells, out.stats.qqq.greenFrameBays * 8,
    'all eight warehouse levels fit within the mapped envelope');
  assert.ok(tris < 45000, `QQT typology triangle budget bounded (${tris.toFixed(0)} < 45000)`);
  // no runaway object count: the typology stays ten merged meshes regardless of triangle count
  assert.ok(qqtMeshes.length <= 12, `QQT stays a handful of merged meshes (${qqtMeshes.length})`);
});

test('every Redpath mass is inside the mapped industrial zone; the unloader is anchored to the Jarvis Slip quay edge', () => {
  const C = city();
  const rp = C.waterfrontLandmarksLayout().redpath;
  assert.ok(rp, 'Redpath layout present');
  assert.ok(rp.halls.length >= 3, 'the mapped halls inside the zone');
  for (const h of rp.halls) assert.ok(inRing(rp.zone, h.cx, h.cz), `hall part inside the zone`);
  assert.ok(rp.plant.h >= 24, `plant height ${rp.plant.h}`);
  // the unloader sits on the zone edge that fronts the real Jarvis Slip water polygon, boom heading out over it
  assert.ok(rp.unloader, 'unloader present');
  assert.ok(rp.wharf && rp.wharf.slip, 'anchored to the mapped Jarvis Slip frontage');
  const slip = C.GEO.areas.find((a) => a[0] === 'water' && a[1] === 'Jarvis Slip');
  const slipRing = [];
  for (let i = 0; i < slip[2].length; i += 2) slipRing.push([slip[2][i], slip[2][i + 1]]);
  // the unloader base is on the slip frontage (a few metres from the slip edge) and the boom points out over the water
  const segDist = (ax, az, bx, bz, px, pz) => {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
    return Math.hypot(ax + dx * t - px, az + dz * t - pz);
  };
  let nearest = Infinity;
  for (let i = 0, j = slipRing.length - 1; i < slipRing.length; j = i++) nearest = Math.min(nearest, segDist(slipRing[j][0], slipRing[j][1], slipRing[i][0], slipRing[i][1], rp.unloader.x, rp.unloader.z));
  assert.ok(nearest < 6, `unloader base ${nearest.toFixed(1)} m from the Jarvis Slip edge`);
  // no invented silos or chimney: the module reports them unresolved instead of scattering them
  assert.equal(rp.unresolved.slice().sort().join('|'), ['barrel-silo battery (no mapped footprint)', 'chimney stack (no mapped footprint)'].sort().join('|'));
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  assert.ok(!out.group.children.some((m) => /Silos|Chimney/.test(m.name)), 'no silo/chimney meshes are drawn');
});

test('the Redpath halls and the QQT footprint lie clear of Sugar Beach\'s sand (no overlap)', () => {
  const C = city();
  const layout = C.waterfrontLandmarksLayout();
  // the verified OSM sand polygon (way 172728993, ~3,190 m²) in world metres (docs/waterfront-realism.md §4)
  const sand = [
    [921.9, 524.8], [910.1, 454.5], [915.4, 461.5], [925.6, 478.3], [936.8, 501.1], [933.4, 500.8],
    [931.7, 500.7], [930.1, 501.4], [929.8, 502.9], [929, 504.2], [929.3, 505.8], [931.3, 506.8],
    [932.7, 506.4], [933.9, 506.7], [935.1, 508.6], [935.7, 510.5], [942.2, 513.4], [944.4, 515.8],
    [950, 523.6], [940.5, 529], [942.5, 531.9], [952.3, 526.6], [954.5, 528.8], [955.4, 533.7],
    [956.2, 539.6], [956.4, 544.1], [957.2, 548.5], [959, 554.3], [964.4, 558.8], [977.5, 570.5],
    [982.7, 578.2], [931.4, 588.7]
  ];
  const rp = layout.redpath, qqt = layout.qqt;
  for (const p of [...rp.halls, qqt.box]) assert.ok(!inRing(sand, p.cx, p.cz), `mass centre (${p.cx.toFixed(0)}, ${p.cz.toFixed(0)}) not on the beach sand`);
});

test('the exclusion hook names the exact generic rows replaced, and only the supported frame builds', () => {
  const C = city();
  const layout = C.waterfrontLandmarksLayout();
  assert.equal(layout.supported, true);
  const rows = new Set(layout.excludedRows);
  // in the detail frame the resolved rows are the documented detail rows; everything excluded must be a named QQT row
  // or a mapped building inside the Redpath zone — never an unrelated building
  const R = C.waterfrontLandmarkResolveComponents();
  assert.equal(R.warehouse, 33202, 'detail frame: warehouse resolves to row 33202');
  assert.equal(R.clock, 33203, 'detail frame: clock resolves to the north-front row 33203 (photo/map inference)');
  // 33212 is retained as a penthouse row (an east mid-roof core), NOT dropped
  assert.ok(R.penthouses.includes(33212), 'the former clock row 33212 is kept as a penthouse core');
  for (const r of [R.warehouse, R.addition, R.clock, R.longHall, R.shed, ...R.plants, ...R.penthouses]) assert.ok(rows.has(r), `row ${r} excluded`);
  const zone = C.GEO.areas.find((a) => a[0] === 'zone:industrial' && a[1] === 'Redpath Sugar Refinery');
  const zoneRing = [];
  for (let i = 0; i < zone[2].length; i += 2) zoneRing.push([zone[2][i], zone[2][i + 1]]);
  for (const r of rows) {
    const b = C.GEO.buildings[r];
    const isQQT = b[9] === "Queen's Quay Terminal";
    assert.ok(isQQT || inRing(zoneRing, b[0], b[1]), `excluded row ${r} (${b[9] || 'unnamed'}) is a QQT row or inside the Redpath zone`);
  }
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  assert.equal([...C.waterfrontLandmarkExcludedRows].sort((a, b) => a - b).join(','), [...rows].sort((a, b) => a - b).join(','));
  for (const r of rows) assert.equal(C.waterfrontLandmarkExcludesBuilding(r), true);
  assert.equal(C.waterfrontLandmarkExcludesBuilding(999999), false);
  assert.ok(out.colliders.length > 0);
});

test('an unsupported frame yields an empty group and no exclusion claims', () => {
  const C = city();
  const bad = C.waterfrontLandmarksLayout({ geo: { ...C.GEO, frame: { detail: { x0: 0, x1: 10, z0: 0, z1: 10 } } } });
  assert.equal(bad.supported, false);
  assert.equal(bad.landmarks.length, 0);
  assert.equal(bad.excludedRows, undefined);
  assert.equal(C.waterfrontLandmarksSupported(), true);
  const C2 = city();
  C2.GEO.buildings = [];
  C2.GEO.areas = [];
  C2.waterfrontLandmarkExcludedRows = undefined;
  const out = C2.createWaterfrontLandmarks(THREE, new THREE.Scene());
  assert.equal(out.group.children.length, 0);
  assert.equal(out.colliders.length, 0);
  assert.equal(out.stats.supported, false);
});

test('the built scene is shared geometry under one culling root, with culling metadata and solid colliders', () => {
  const C = city();
  const scene = new THREE.Scene();
  const out = C.createWaterfrontLandmarks(THREE, scene);
  assert.equal(scene.children.filter((o) => o === out.group).length, 1);
  assert.equal(out.group.name, 'WaterfrontLandmarks');
  const names = out.group.children.map((m) => m.name);
  for (const n of ['WaterfrontLandmarks_QQT_Shell', 'WaterfrontLandmarks_Redpath_Halls', 'WaterfrontLandmarks_Redpath_Roof',
    'WaterfrontLandmarks_Redpath_WhaleMural', 'WaterfrontLandmarks_Redpath_Sign',
    'WaterfrontLandmarks_Redpath_Unloader_Gantry', 'WaterfrontLandmarks_Redpath_Unloader_Body',
    'WaterfrontLandmarks_Redpath_Unloader_Counterweight', 'WaterfrontLandmarks_Redpath_Unloader_Cab', 'WaterfrontLandmarks_Redpath_Unloader_Boom']) {
    assert.ok(names.includes(n), `has ${n}`);
  }
  for (const m of out.group.children) {
    assert.ok(m.userData.cullDistance > 0 && m.userData.cullCell > 0, `${m.name} carries culling metadata`);
    assert.ok(m.geometry.boundingSphere && Number.isFinite(m.geometry.boundingSphere.radius), `${m.name} has a bounding sphere`);
  }
  // colliders are solid, and the two landmarks both contribute; the tallest reaches the addition (43 m) or the clock tower
  assert.ok(out.colliders.length >= 10);
  assert.ok(out.colliders.every((c) => c.maxY > c.minY));
  const tall = out.colliders.map((c) => c.maxY).reduce((a, b) => Math.max(a, b), 0);
  assert.ok(tall >= 45, `tallest collider ${tall} reaches the 46 m clock tower (captain-corrected height)`);
  assert.ok(tall <= 48, `clock tower stays at the corrected ~46 m, not the old 56 m (${tall})`);
});

// ---- Integration: the DEFAULT desktop frame is eglinton, with a different building table (QQT at rows 131069.., not
// 33202..). The module must resolve its components by name+centre+height in that frame too, build the same geometry, and
// exclude only QQT-named / Redpath-zone buildings. This loads the REAL unpacked eglinton geodata and the REAL
// city-grid.js extruded helper (which returns a Mesh) to cover the integrated-runtime bug (Mesh pushed into a geometry
// merge) that a fallback-only test would miss.
import { unpackGeo } from '../js/geodata-loader.js';

const readBin = (p) => { const b = fs.readFileSync(new URL(`../${p}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

// The real city-grid export, loaded just to take createExtrudedPolygonMesh (a Mesh-returning helper). It destructures a
// set of globals at load; provide the minimal ones (Addons + the material factories it only calls later) so the REAL
// helper is exercised, not a stub.
function realExtrudeHelper() {
  const noop = () => {};
  const city = {
    THREE, Addons: { mergeGeometries },
    CITY_BOUNDS: { x0: -1e6, x1: 1e6, z0: -1e6, z1: 1e6, sidewalkHeight: 0.22, waterLevel: -0.7 },
    createRoadSurfaceMaterial: noop, createSidewalkMaterial: noop, createCurbMaterial: noop, createWaterMaterial: noop,
    createParkLawnMaterial: noop, createTerrainMaterial: noop, createPlotGroundMaterial: noop, createForecourtMaterial: noop,
    createRenderedWallMaterial: noop
  };
  const ctx = { window: { CITY: city }, console: { info() {}, warn() {}, error() {} }, performance, THREE };
  try { vm.runInNewContext(read('js/city-grid.js'), ctx); } catch { /* fall back to the faithful stub below */ }
  return ctx.window.CITY.createExtrudedPolygonMesh || null;
}

test('eglinton frame (the default desktop map): components resolve by key, build, and exclude only named/zone rows', async () => {
  const { GEO } = await unpackGeo(readBin('data/frames/eglinton/toronto-geodata.bin'));
  assert.ok(GEO.buildings.length > 100000, 'the eglinton building table is the big one');

  // A context whose CITY has the real extruded helper (Mesh-returning) if city-grid loads, else a faithful stub with the
  // SAME contract (returns a THREE.Mesh) — the bug was the Mesh-vs-geometry shape, so a Mesh-returning stub still covers
  // it; we prefer the real helper.
  const realHelper = realExtrudeHelper();
  const makeHelper = (T) => (pts, bottomY, height) => {
    const shape = new T.Shape();
    pts.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
    shape.closePath();
    const geo = new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, bottomY, 0);
    return new T.Mesh(geo, null); // <-- the real city-grid contract: a MESH
  };
  const helper = realHelper || makeHelper(THREE);

  const ctx = { window: { CITY: { THREE, Addons: { mergeGeometries }, CITY_BOUNDS: { sidewalkHeight: 0.22, waterLevel: -0.7 }, createExtrudedPolygonMesh: helper } }, console: { info() {}, warn() {}, error() {} }, performance };
  ctx.window.CITY.GEO = GEO;
  vm.runInNewContext(read('js/waterfront-landmarks.js'), ctx);
  const C = ctx.window.CITY;

  assert.equal(C.waterfrontLandmarksSupported(), true, 'eglinton frame is supported');
  const R = C.waterfrontLandmarkResolveComponents();
  assert.ok(R.warehouse !== null, 'QQT warehouse resolves in eglinton');
  assert.notEqual(R.warehouse, 33202, 'the eglinton row index differs from the detail index (proves it is not hardcoded)');
  const wb = GEO.buildings[R.warehouse];
  assert.equal(wb[9], "Queen's Quay Terminal");
  assert.ok(Math.abs(wb[0] + 206.4) < 1 && Math.abs(wb[1] - 692.4) < 1, 'the resolved warehouse is the real QQT block');

  const layout = C.waterfrontLandmarksLayout();
  assert.equal(layout.supported, true);
  assert.ok(layout.qqt && layout.qqt.additionParts.length === 3, 'eglinton addition parts resolve');
  assert.ok(layout.redpath && layout.redpath.halls.length >= 12, 'eglinton Redpath halls + annexes resolve');
  assert.equal(layout.redpath.supports, 5, 'the five mapped refinery annexes resolve in eglinton too');
  assert.ok(layout.redpath.sign && layout.redpath.mural, 'the shed face features resolve in eglinton');
  assert.ok(layout.redpath.tower && Math.abs(layout.redpath.tower.h - 22.5) < 0.6, 'the quay tower resolves in eglinton');
  const egLong = layout.redpath.halls.find((h) => h.row === R.longHall);
  assert.ok(egLong && egLong.kind === 'rawstore' && egLong.pitch.pitched, 'the long hall is the pitched raw store in eglinton');

  // build with the REAL (Mesh-returning) helper: this is the exact integrated-runtime path that threw before the fix
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const shell = out.group.children.find((m) => m.name === 'WaterfrontLandmarks_QQT_Shell');
  assert.ok(shell && shell.geometry && shell.geometry.attributes.position, 'the merged QQT shell is a real geometry');
  assert.ok(out.colliders.length >= 10);

  // exclusions in eglinton: every excluded row is a QQT-named building or inside the Redpath zone, never unrelated
  const zone = GEO.areas.find((a) => a[0] === 'zone:industrial' && a[1] === 'Redpath Sugar Refinery');
  const zoneRing = [];
  for (let i = 0; i < zone[2].length; i += 2) zoneRing.push([zone[2][i], zone[2][i + 1]]);
  assert.ok(C.waterfrontLandmarkExcludedRows.size > 0);
  for (const r of C.waterfrontLandmarkExcludedRows) {
    const b = GEO.buildings[r];
    assert.ok(b[9] === "Queen's Quay Terminal" || inRing(zoneRing, b[0], b[1]), `eglinton excluded row ${r} is QQT or in the zone`);
  }
});

test('the merge is safe with the real Mesh-returning helper (no Mesh reaches mergeGeometries)', () => {
  const C = city();
  // a helper that returns a Mesh, exactly like city-grid.js
  C.createExtrudedPolygonMesh = (pts, bottomY, height) => {
    const shape = new THREE.Shape();
    pts.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, bottomY, 0);
    return new THREE.Mesh(geo, null);
  };
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const shell = out.group.children.find((m) => m.name === 'WaterfrontLandmarks_QQT_Shell');
  assert.ok(shell.geometry.attributes.position.count > 0, 'extruded+Merged shell built from Mesh helpers');
});

test('the exclusion predicate answers BEFORE the builder runs (buildings.js runs first in main.js)', () => {
  const C = city();
  // call exactly as buildings.js does, before any createWaterfrontLandmarks()
  const R = C.waterfrontLandmarkResolveComponents();
  assert.equal(C.waterfrontLandmarkExcludesBuilding(R.warehouse), true, 'resolves on its own, no builder needed');
  assert.equal(C.waterfrontLandmarkExcludesBuilding(R.clock), true);
  assert.equal(C.waterfrontLandmarkExcludesBuilding(999999), false);
  assert.ok(C.waterfrontLandmarkExcludedRows instanceof Set || typeof C.waterfrontLandmarkExcludedRows.has === 'function');
  // and the builder then agrees with the cached set
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  assert.ok(out.colliders.length > 0);
});

test('Redpath unloader is a green articulated material handler (gantry, body, counterweight, cab, green boom)', () => {
  const C = city();
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  assert.equal(out.stats.unloaderKind, 'articulated-green-material-handler');
  const by = (n) => out.group.children.find((m) => m.name === n);
  const gantry = by('WaterfrontLandmarks_Redpath_Unloader_Gantry');
  const body = by('WaterfrontLandmarks_Redpath_Unloader_Body');
  const boom = by('WaterfrontLandmarks_Redpath_Unloader_Boom');
  const cab = by('WaterfrontLandmarks_Redpath_Unloader_Cab');
  assert.ok(gantry && body && boom && cab, 'the handler parts exist');
  // the boom is green (material colour, linear): green channel dominant
  const gc = boom.material.color;
  assert.ok(gc.g > gc.r && gc.g > gc.b, `boom is green (${gc.r.toFixed(2)},${gc.g.toFixed(2)},${gc.b.toFixed(2)})`);
  // the body is a light (white/light-grey) grille box; the gantry is dark
  assert.ok(body.material.color.r > 0.6 && body.material.color.g > 0.6 && body.material.color.b > 0.6, 'white grille body');
  assert.ok(gantry.material.color.r < 0.4 && gantry.material.color.g < 0.4, 'dark A-frame gantry');
  // the boom reaches out over the water: its bbox extends past the machine base toward the slip (+x here)
  boom.geometry.computeBoundingBox();
  const bb = boom.geometry.boundingBox, un = out.layout.redpath.unloader;
  assert.ok(bb.max.x > un.x + 2 || bb.max.z > un.z + 2 || bb.min.x < un.x - 2 || bb.min.z < un.z - 2, 'boom projects from the machine base');
});

test('the big mapped long hall is the pitched raw store; ridge = mapped height, eaves lower, weathered grey roof', () => {
  const C = city();
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const rp = out.layout.redpath;
  const R = C.waterfrontLandmarkResolveComponents();
  const longHall = rp.halls.find((h) => h.row === R.longHall);
  assert.ok(longHall, 'the long hall part is present');
  assert.equal(longHall.kind, 'rawstore', 'the 166.8 x 47.4 m hall is the major pitched raw store');
  assert.ok(Math.abs(longHall.h - 16) < 0.5, 'mapped 16 m height retained');
  assert.ok(/inferred/.test(rp.inferences.longHall), 'the function is labelled a photo inference, not a text-confirmed record');
  assert.ok(out.stats.redpath.pitchedSheds >= 2, 'the long hall and the small shed are both pitched');

  const base = 0.22 + 0.004;
  const p = longHall.pitch;
  assert.equal(p.pitched, true);
  assert.ok(Math.abs(base + p.ridgeH - longHall.h) < 0.05, `ridge matches the mapped ${longHall.h} m total height`);
  assert.ok(p.rise > 2 && p.rise < p.totalH * 0.7, `gable rise is a bounded estimate (${p.rise.toFixed(1)} m)`);
  assert.ok(p.eaveH < p.totalH, 'eaves sit below the mapped ridge height');
  assert.ok(p.eaveH > 2, 'walls still rise to real eaves');
  // the longest hall has the largest pitched run; the roof mesh is a separate weathered-metal surface
  const roof = out.group.children.find((m) => m.name === 'WaterfrontLandmarks_Redpath_Roof');
  const walls = out.group.children.find((m) => m.name === 'WaterfrontLandmarks_Redpath_ShedWalls');
  assert.ok(roof && walls, 'pitched walls and roof are separate meshes');
  const rm = roof.material;
  assert.ok(rm.metalness < 0.15, `low metalness (${rm.metalness})`);
  assert.ok(rm.color.b <= rm.color.r + 0.02, 'neutral/weathered, not blue');
  // GPU review caught inverted roof planes despite a neutral material: prove actual triangle winding, not stored
  // material colour. Large tilted triangles isolate the sloped sheets from small ribs and horizontal box bottoms.
  const g = roof.geometry, pos = g.attributes.position, idx = g.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let slopes = 0;
  for (let i = 0, n = idx ? idx.count : pos.count; i < n; i += 3) {
    a.fromBufferAttribute(pos, idx ? idx.getX(i) : i);
    b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).sub(a);
    c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).sub(a);
    const cross = new THREE.Vector3().crossVectors(b, c), twiceArea = cross.length();
    if (twiceArea <= 4) continue;
    const ny = cross.y / twiceArea;
    if (Math.abs(ny) < 0.001 || Math.abs(ny) > 0.9999) continue;
    assert.ok(ny > 0, `sloped roof triangle ${i / 3} faces downward (${ny})`);
    slopes++;
  }
  assert.ok(slopes >= 8, `both pitched buildings expose upward sloped sheets (${slopes})`);
});

test('the mapped quay utility tower is claimed and industrial (no generic condo windows)', () => {
  const C = city();
  const R = C.waterfrontLandmarkResolveComponents();
  const rp = C.waterfrontLandmarksLayout().redpath;
  assert.ok(rp.tower, 'the quay tower part is in the layout');
  assert.ok(R.tower !== null && R.tower !== undefined, 'the mapped tower row resolves');
  assert.ok(Math.abs(rp.tower.h - 22.5) < 0.6, 'mapped tower height retained');
  const excluded = new Set(C.waterfrontLandmarksLayout().excludedRows);
  assert.ok(excluded.has(R.tower), 'tower row is claimed from the generic city');
  assert.ok(/unresolved/.test(rp.inferences.tower), 'the tower function is stated unresolved');

  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  // its shaft is merged into the industrial wall mesh; there is no separate residential facade/window mesh for it
  const names = out.group.children.map((m) => m.name);
  assert.ok(names.includes('WaterfrontLandmarks_Redpath_Halls'));
  assert.ok(!names.some((n) => /Tower.*Facade|Tower.*Windows/.test(n)), 'no apartment-style window skin on the tower');
  const t = rp.tower;
  const near = out.colliders.filter((c) => Math.hypot((c.minX + c.maxX) / 2 - t.cx, (c.minZ + c.maxZ) / 2 - t.cz) < 2);
  assert.ok(near.length >= 1, 'the tower has a solid collider');
  const top = Math.max(...near.map((c) => c.maxY));
  assert.ok(top > t.h && top < t.h + 2, `tower collider reaches the mapped ~22.5 m cap (${top.toFixed(1)})`);
});

test('the Redpath sign carries the legible text target (canvas texture in a browser, ink panel in Node)', () => {
  const C = city();
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const sign = out.group.children.find((m) => m.name === 'WaterfrontLandmarks_Redpath_Sign');
  assert.ok(sign, 'sign present');
  assert.equal(sign.userData.signText, 'REDPATH SUGAR');
  // Node has no document/canvas, so the texture is unavailable and it falls back to the ink panel (no crash)
  assert.equal(sign.userData.legible, false, 'no canvas in Node -> plain ink fallback');
});

// The QQT facade no longer rides the shared punched-window shader (the captain rejected that "bland white window grid"
// from the GPU capture): it is now the explicit green-frame typology the wave-8 captain inspected — green mullions /
// transoms, dark multi-pane glazing over cream piers/spandrels, and dark glazing + pale-green mullions/rails on the 1983
// addition's projecting balcony banks. This asserts the ACTUAL rendered meshes (real `three` material colours and real
// merged geometry), not a stubbed skin: every QQT component exists, its material is non-black and the right family, its
// geometry is bounded (finite, real volume, merged, no degenerate/non-finite positions), and the Redpath refinery keeps
// its own explicit sparse openings instead of either shared shader grid.
test('QQT green-frame facades render as real, non-black bounded materials (not the shared punched-window shader)', () => {
  const C = city();
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const byName = (n) => out.group.children.find((m) => m.name === n);
  const names = out.group.children.map((m) => m.name);
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  // the default WebGL fallback path (no TSL node materials in Node) is a plain MeshStandardMaterial with a real colour
  const requireColor = (n) => {
    const m = byName(n);
    assert.ok(m, `has ${n}`);
    assert.ok(m.material && m.material.color, `${n} carries a real material with a colour (never the (0,0,0) default)`);
    return m;
  };
  // warehouse: dark glazing, green frame, cream piers/spandrels, green roof edge — all their own meshes, non-black
  const glass = requireColor('WaterfrontLandmarks_QQT_Glazing');
  const frame = requireColor('WaterfrontLandmarks_QQT_GreenFrame');
  const cream = requireColor('WaterfrontLandmarks_QQT_Cream');
  const cornice = requireColor('WaterfrontLandmarks_QQT_Cornice');
  const resGlass = requireColor('WaterfrontLandmarks_QQT_ResGlazing');
  const resFrame = requireColor('WaterfrontLandmarks_QQT_ResFrame');
  const resRail = requireColor('WaterfrontLandmarks_QQT_ResRail');
  for (const [n, m] of [['Glazing', glass], ['GreenFrame', frame], ['Cream', cream], ['Cornice', cornice],
    ['ResGlazing', resGlass], ['ResFrame', resFrame], ['ResRail', resRail]]) {
    assert.ok(lum(m.material.color) > 0.01, `QQT_${n} is not black (lum ${lum(m.material.color).toFixed(3)})`);
  }
  // the read: glass is DARK, the frame and roof edge are GREEN, the piers/spandrels are CREAM (warm r>g>b)
  assert.ok(lum(glass.material.color) < 0.2, `dark glazing (lum ${lum(glass.material.color).toFixed(3)})`);
  assert.ok(frame.material.color.g > frame.material.color.r && frame.material.color.g > frame.material.color.b, 'green frame');
  assert.ok(cornice.material.color.g > cornice.material.color.r, 'green roof edge');
  assert.ok(cream.material.color.r > cream.material.color.g && cream.material.color.g > cream.material.color.b, 'cream piers/spandrels');
  // addition banks project as glazing set in pale-green mullions + a green rail (planes with real 3D volume, not a billboard)
  assert.ok(lum(resGlass.material.color) < 0.25, 'addition glazing is dark');
  assert.ok(resFrame.material.color.g > resFrame.material.color.r, 'addition mullions are pale green');
  // bounded, non-degenerate merged geometry for every QQT component (no duplicate interior interface explosion, no NaNs)
  for (const m of out.group.children.filter((c) => /WaterfrontLandmarks_QQT_/.test(c.name))) {
    const pos = m.geometry.attributes.position;
    assert.ok(pos && pos.count > 0, `${m.name} has vertices`);
    let finite = true, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) finite = false;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    assert.ok(finite, `${m.name} has finite positions`);
    if (m.name !== 'WaterfrontLandmarks_QQT_Cornice') assert.ok(maxY - minY > 0.05, `${m.name} spans real height`);
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    assert.ok(bb.max.x - bb.min.x > 0.05 && bb.max.z - bb.min.z > 0.05, `${m.name} is a 3D panel, not a degenerate line`);
  }
  // the old shared-shader meshes are gone: neither the warehouse nor the addition rides the punched-window skin
  assert.ok(!names.includes('WaterfrontLandmarks_QQT_Facade'), 'the warehouse no longer uses the shared facade skin');
  assert.ok(!names.includes('WaterfrontLandmarks_QQT_AdditionFacade'), 'the addition no longer uses the shared punched-window shader');
  // Redpath keeps its explicit sparse openings (an industrial read), not a regular office window grid shader
  assert.ok(!names.includes('WaterfrontLandmarks_Redpath_Facade'), 'no regular office window grid on the refinery');
  const redpathWindows = byName('WaterfrontLandmarks_Redpath_Windows');
  assert.ok(redpathWindows, 'the refinery has its own explicit window strips');
});

test('the whole mapped refinery is claimed and articulated (annexes/plants are no longer generic tan boxes)', () => {
  const C = city();
  const rp = C.waterfrontLandmarksLayout().redpath;
  assert.ok(rp.halls.length >= 12, `all mapped refinery parts claimed (${rp.halls.length})`);
  const kinds = new Set(rp.halls.map((h) => h.kind));
  for (const k of ['shed', 'rawstore', 'plant', 'support']) assert.ok(kinds.has(k), `has a ${k} part`);
  const R = C.waterfrontLandmarkResolveComponents();
  assert.equal(R.supports.length, 5, 'the five extra mapped refinery rows resolve');
  assert.ok(R.tower !== null, 'the mapped quay utility tower row resolves');
  const excluded = new Set(C.waterfrontLandmarksLayout().excludedRows);
  for (const r of R.supports) assert.ok(excluded.has(r), `support row ${r} is claimed (not left to the generic city)`);
  assert.ok(excluded.has(R.tower), 'the utility tower row is claimed (no generic condo)');

  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const names = out.group.children.map((m) => m.name);
  for (const n of ['Redpath_Halls', 'Redpath_ShedWalls', 'Redpath_Roof', 'Redpath_Trim',
    'Redpath_Plinth', 'Redpath_Cladding', 'Redpath_Windows', 'Redpath_Hoods', 'Redpath_PipeRack']) {
    assert.ok(names.some((x) => x.includes(n)), `has ${n}`);
  }
  // the identity pass actually produced geometry, not just a colour change
  assert.ok(out.stats.redpath.windowBands >= 4, `lower-storey window bands (${out.stats.redpath.windowBands})`);
  assert.ok(out.stats.redpath.pilasterBays >= 6, `pilaster bays (${out.stats.redpath.pilasterBays})`);
  assert.ok(out.stats.redpath.hoods >= 8, `sparse gray metal hoods (${out.stats.redpath.hoods})`);
  assert.ok(out.stats.redpath.pipeRacks >= 1, 'the pipe/rack assembly between the tall blocks');
  assert.ok(out.stats.redpath.corrugatedRibs >= 20, `corrugation ribs (${out.stats.redpath.corrugatedRibs})`);
  assert.ok(out.stats.redpath.corrugatedHalls >= 1, 'the shed/annex walls are corrugated');
  // no regular office window grid: the old per-storey ribbon bands (148 strips) are gone; only two lower storeys remain
  assert.ok(out.stats.redpath.windowBands < 120, 'sparse industrial openings, not an office grid');
  // and every hall mass still lies inside the mapped zone (no invented footprint)
  for (const h of rp.halls) assert.ok(inRing(rp.zone, h.cx, h.cz), 'hall part inside the zone');
});

test('Redpath sign is one-line red block caps on the tall plant WEST face; mural on the shed NORTH face', () => {
  const C = city();
  const rp = C.waterfrontLandmarksLayout().redpath;
  assert.equal(rp.sign.face, 'west');
  assert.equal(rp.sign.localFace, '-u');
  assert.equal(rp.sign.text, 'REDPATH SUGAR');
  assert.equal(rp.mural.face, 'north');
  assert.equal(rp.mural.localFace, '-u');
  // the sign is anchored to the tall plant, not the shed
  assert.ok(rp.sign.anchor.h >= 24, `sign on a tall plant wall (h ${rp.sign.anchor.h})`);
  assert.notEqual(rp.sign.anchor.cx, rp.shed.cx);
  // -u world normal points west (-x); the shed's -u points north (-z) in this mapped turn
  assert.ok(rp.sign.normal[0] < -0.5, `sign normal is west (${rp.sign.normal.map((v) => v.toFixed(2))})`);
  assert.ok(rp.mural.normal[1] < -0.5, `mural normal is north (${rp.mural.normal.map((v) => v.toFixed(2))})`);

  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const sign = out.group.children.find((m) => m.name === 'WaterfrontLandmarks_Redpath_Sign');
  const mural = out.group.children.find((m) => m.name === 'WaterfrontLandmarks_Redpath_WhaleMural');
  assert.equal(sign.userData.signFace, 'west (-u)');
  assert.equal(sign.userData.raised, true, 'letters are raised (a thin box, not a flat decal)');
  assert.equal(mural.userData.muralFace, 'north (-u)');
  // source-photo PROPORTIONS (captain's inspection of the west-sign photo): a short, wide one-line sign ~15-17 m across
  // and only ~2.0-2.3 m high (letters ≈ 0.09 of the ~28 m wall), NOT the oversized ~4.4 m panel that stretched the text.
  const [sigW, sigH] = sign.userData.signSize;
  assert.ok(sigW >= 15 && sigW <= 17.5, `sign spans ~15-17 m (${sigW.toFixed(2)})`);
  assert.ok(sigH >= 1.9 && sigH <= 2.4, `sign is a short ~2.0-2.3 m band (${sigH.toFixed(2)})`);
  assert.ok(sigW / sigH >= 6.4, `wide natural-aspect one-line sign (${(sigW / sigH).toFixed(2)}:1)`);
  // the top of the sign sits ~1.5-2 m of brick below the roof line (photo: the sign is near the roof, not at mid-wall)
  const topMargin = rp.sign.topMargin;
  assert.ok(topMargin >= 1.4 && topMargin <= 2.1, `sign holds ~1.5-2 m under the roof (${topMargin.toFixed(2)})`);

  // the sign panel is proud of the tall plant's west wall but still intersects it (no hover)
  const a = rp.sign.anchor;
  sign.geometry.computeBoundingBox();
  const bb = sign.geometry.boundingBox;
  const ccx = (bb.min.x + bb.max.x) / 2, ccz = (bb.min.z + bb.max.z) / 2;
  const dist = (ccx - a.cx) * rp.sign.normal[0] + (ccz - a.cz) * rp.sign.normal[1];
  assert.ok(dist > a.halfW, `sign centre is outside the wall (${dist.toFixed(2)} > ${a.halfW.toFixed(2)})`);
  assert.ok(dist < a.halfW + 0.4, `sign is not hovering (${dist.toFixed(2)} <= ${(a.halfW + 0.4).toFixed(2)})`);
});

test('the Redpath refinement capture list includes roof-profile, unloader and west-sign views', () => {
  const shots = JSON.parse(read('tools/shots/waterfront-redpath-refinement.json'));
  assert.ok(Array.isArray(shots) && shots.length >= 9, `capture list (${shots.length})`);
  for (const re of [/roof-profile/, /unloader/, /west-sign/]) {
    assert.ok(shots.some((s) => re.test(s.name)), `has a ${re} camera`);
  }
  for (const s of shots) {
    assert.ok(typeof s.name === 'string' && typeof s.js === 'string' && Number.isFinite(s.wait), `${s.name} well formed`);
  }
});

// Wave-7 GPU fix: a proposed capture camera is only trustworthy if it stands OUTSIDE every landmark solid and can see
// its target. The wave-6 west-sign camera was inside/behind an unmapped building and the frame came back blank. The
// module exposes a pure CPU verifier (window.CITY.waterfrontLandmarkVerifyCamera) over an OBB occupancy model; every
// camera in the shipped refinement list must pass it against its own look-at point before a GPU run is spent.
const parseCam = (js) => {
  const m = js && js.match(/pos: \[([^\]]+)\], look: \[([^\]]+)\]/);
  if (!m) return null;
  const nums = (s) => s.split(',').map((v) => Number(v.trim()));
  return { pos: nums(m[1]), look: nums(m[2]) };
};

test('every Redpath refinement camera is CPU-verified: outside all solids and clear line-of-sight', () => {
  const C = city();
  const layout = C.waterfrontLandmarksLayout();
  assert.ok(layout.redpath && layout.redpath.sign, 'layout + sign present');
  assert.equal(typeof C.waterfrontLandmarkVerifyCamera, 'function', 'the verifier is exported');
  assert.equal(typeof C.waterfrontLandmarkSignCenter, 'function');
  const shots = JSON.parse(read('tools/shots/waterfront-redpath-refinement.json'));
  let verified = 0;
  for (const s of shots) {
    const cam = parseCam(s.js);
    if (!cam) continue;                       // the first shot only hides the HUD; it has no cinema camera
    const r = C.waterfrontLandmarkVerifyCamera({ x: cam.pos[0], y: cam.pos[1], z: cam.pos[2] }, cam.look);
    assert.ok(r.ok, `${s.name} must be clear: inside=${JSON.stringify(r.inside)} blockedBy=${r.blockedBy}`);
    verified++;
  }
  assert.ok(verified >= 9, `verified ${verified} cameras`);
  // the OBB set spans both landmarks and does not leave the sign outside its own anchor
  const obbs = C.waterfrontLandmarkOBBs(layout);
  assert.ok(obbs.some((o) => /rawstore/.test(o.name)), 'the pitched long hall is an occupancy solid');
  assert.ok(obbs.some((o) => o.name === 'qqtWarehouse'), 'the QQT warehouse is an occupancy solid');

  // the specific west-sign camera must actually see the sign face: LOS to the true sign centre is clear
  const sc = C.waterfrontLandmarkSignCenter(layout);
  assert.ok(Array.isArray(sc) && sc.length === 3, 'sign centre computed');
  const westSign = shots.find((s) => /west-sign-face/.test(s.name));
  const wcam = parseCam(westSign.js);
  const signView = C.waterfrontLandmarkVerifyCamera({ x: wcam.pos[0], y: wcam.pos[1], z: wcam.pos[2] }, sc);
  assert.ok(signView.ok, `west-sign camera sees the sign centre (blockedBy=${signView.blockedBy})`);
  // and it stands on the sign's outward side (in front of the west wall, not behind it)
  const rp = layout.redpath;
  const out = (wcam.pos[0] - rp.sign.anchor.cx) * rp.sign.normal[0] + (wcam.pos[2] - rp.sign.anchor.cz) * rp.sign.normal[1];
  assert.ok(out > rp.sign.anchor.halfW, `camera is outside the west face (${out.toFixed(1)} > ${rp.sign.anchor.halfW.toFixed(1)})`);
});

test('the verifier rejects the old occluded west-sign camera (the wave-6 blank-frame bug)', () => {
  const C = city();
  const layout = C.waterfrontLandmarksLayout();
  const sc = C.waterfrontLandmarkSignCenter(layout);
  // the wave-6 camera that produced the blank white frame, aimed at its old look target
  const old = C.waterfrontLandmarkVerifyCamera({ x: 636, y: 16, z: 520 }, [741, 21, 513]);
  assert.equal(old.ok, false, 'the old camera is rejected (occluded / inside a solid)');
  // and it fails even when aimed straight at the real sign centre
  const oldToSign = C.waterfrontLandmarkVerifyCamera({ x: 636, y: 16, z: 520 }, sc);
  assert.equal(oldToSign.ok, false, 'the old camera cannot see the sign centre');
});

test('on the WebGPU path the plant skin gets a real TSL brick colorNode (course beds, no washed-white shell)', async () => {
  // The browser runs the module's brickMaterial with THREE = three/webgpu and CITY.TSL = the imported three/tsl node
  // module. Build the module in that exact configuration and assert the plant wall's material carries a colour node
  // (the brick course/head-joint/weathering graph) instead of falling back to a flat shell. NOTE: this constructs the
  // node graph on the CPU; it does NOT compile GPU shaders. Only a real rendered frame proves the shader compiles.
  const webgpu = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const ctx = {
    window: { CITY: { THREE: webgpu, TSL, Addons: { mergeGeometries: webgpu.mergeGeometries || mergeGeometries }, CITY_BOUNDS: { sidewalkHeight: 0.22, waterLevel: -0.7 } } },
    console: { info() {}, warn() {}, error() {} }, performance
  };
  vm.runInNewContext(read('js/toronto-geodata.js'), ctx);
  vm.runInNewContext(read('js/waterfront-landmarks.js'), ctx);
  const C = ctx.window.CITY;
  const out = C.createWaterfrontLandmarks(webgpu, new webgpu.Scene());
  const halls = out.group.children.find((m) => m.name === 'WaterfrontLandmarks_Redpath_Halls');
  assert.ok(halls && halls.material, 'the plant wall mesh exists');
  assert.ok(halls.material.isMeshStandardNodeMaterial, 'the plant wall uses a node material on the WebGPU path');
  assert.ok(halls.material.colorNode, 'the brick colour node graph is built (course/head-joint/weathering shading)');
  // base colour is still the darker pale-grey brick (never the near-white that washed out), now sRGB->linear
  const col = halls.material.color;
  assert.ok(Math.max(col.r, col.g, col.b) < 0.72, `linear base below white (${col.r.toFixed(2)},${col.g.toFixed(2)},${col.b.toFixed(2)})`);
});

test('the Redpath brick typology is the source-photo fine brick (0.08-0.10 m course, 0.24-0.30 long, ~8 mm joint, subtle contrast)', () => {
  const C = city();
  const t = C.REDPATH_BRICK_TYPOLOGY;
  assert.ok(t, 'the brick typology is exported');
  // captain's photo inspection: fine SUBTLE brick, not oversized 0.28 x 0.62 cinder blocks
  assert.ok(t.brickH >= 0.08 && t.brickH <= 0.10, `course ~0.08-0.10 m (${t.brickH})`);
  assert.ok(t.brickL >= 0.24 && t.brickL <= 0.30, `brick ~0.24-0.30 m long (${t.brickL})`);
  assert.ok(t.jointW >= 0.006 && t.jointW <= 0.010, `mortar joint ~8 mm (${t.jointW})`);
  assert.ok(t.jointDark <= 0.10, `joint contrast subtle ~0.08, not 0.30 (${t.jointDark})`);
  // the old oversized block proportions are gone
  assert.ok(Math.abs(t.brickH - 0.28) > 0.1 && Math.abs(t.brickL - 0.62) > 0.1, 'old 0.28 x 0.62 blocks removed');
});

test('the Redpath plant skin is pale-grey BRICK (0xa7aaa4), not the near-white 0xd6cfc0 that washed to white', () => {
  const C = city();
  const out = C.createWaterfrontLandmarks(THREE, new THREE.Scene());
  const halls = out.group.children.find((m) => m.name === 'WaterfrontLandmarks_Redpath_Halls');
  assert.ok(halls && halls.material, 'the plant wall mesh exists');
  const col = halls.material.color;
  assert.ok(col, 'the plant wall material carries a base colour');
  // the base is a mid grey-green-grey brick tone: clearly below white and darker than the old 0xd6cfc0
  const maxc = Math.max(col.r, col.g, col.b);
  const minc = Math.min(col.r, col.g, col.b);
  assert.ok(maxc < 0.72, `base is not near-white (max channel ${maxc.toFixed(2)})`);
  assert.ok(minc > 0.25, `base is not black (min channel ${minc.toFixed(2)})`);
  // near-neutral with a faint green cast like the BIA photo's pale grey brick (0xa7aaa4: g slightly > r >= b)
  assert.ok(col.g >= col.r && col.r >= col.b - 0.02, `pale grey brick balance (${col.r.toFixed(2)},${col.g.toFixed(2)},${col.b.toFixed(2)})`);
  // the material is rougher than a washed render and the wall is one merged industrial surface
  assert.ok(halls.material.roughness >= 0.9, 'brick is rough/matte');
  // the old near-white 0xd6cfc0 must be gone from the plant wall
  const old = new THREE.Color(0xd6cfc0);
  assert.ok(Math.abs(col.r - old.r) + Math.abs(col.g - old.g) + Math.abs(col.b - old.b) > 0.15, 'the washed near-white tone is replaced');
});
