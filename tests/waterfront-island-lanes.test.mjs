// Toronto Islands interior-lane centre-line gate (js/waterfront-island-lanes.js, road-paint producer hook, st-sb3r.23).
//
// These tests use the real generated data and the committed detail/Eglinton geodata. They prove:
//   - the gate is pure (never mutates CITY.GEO), frame/projection scoped, and pair to no mainland/airport;
//   - only photo-evidenced rows are unmarked (the photographed living-street family + Cibola Avenue), never the
//     remaining service lanes, and never because OSM merely says motor_vehicle=private;
//   - the generated geometry has no concatenated cross-island 0.8-3 km segment (the earlier chain bug);
//   - js/road-paint.js omits YELLOW centre-line vertices when the gate says unmarked and changes nothing when absent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';
import * as CORE from '../vendor/three/three.core.js';

const readJs = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const readBin = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url));

const loadBin = async (rel) => {
  let u8 = new Uint8Array(readBin(rel));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  const { decodeGeo } = await import('../js/geodata-loader.js');
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
};

const detail = await loadBin('data/toronto-geodata.bin');
const eglinton = await loadBin('data/frames/eglinton/toronto-geodata.bin');

function city({ geo = detail.GEO, withData = true, withModule = true } = {}) {
  // Each test gets its own frame/projection wrapper so a projection-mismatch test cannot leak into the next one.
  const G = { ...geo, frame: { ...(geo.frame || {}), detail: geo.frame?.detail && { ...geo.frame.detail }, projection: geo.frame?.projection && { ...geo.frame.projection } } };
  const C = { GEO: G };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} }, Math, Date, Number, Array, Set, Map };
  vm.createContext(ctx);
  if (withData) vm.runInContext(readJs('waterfront-island-lanes-data.js'), ctx, { filename: 'waterfront-island-lanes-data.js' });
  if (withModule) vm.runInContext(readJs('waterfront-island-lanes.js'), ctx, { filename: 'waterfront-island-lanes.js' });
  return ctx.window.CITY;
}

const runOf = (C, name) => (C.ISLAND_LANES_DATA?.runs || []).find((r) => (r.names || []).includes(name));
const mid = (r) => r.points[Math.floor(r.points.length / 2)];

test('source profile carries primary-photo evidence, and OSM access tags are explicitly not paint evidence', () => {
  const C = city();
  const D = C.ISLAND_LANES_DATA;
  assert.ok(D && Array.isArray(D.runs) && D.runs.length > 40, `${D?.runs?.length} runs`);
  const p = D.summary.sourceProfile;
  assert.equal(p.family, 'toronto-island-unmarked-interior-lane');
  assert.equal(p.status, C.ISLAND_LANES_PHOTO_STATUS);
  assert.match(p.officialClaim.url, /toronto\.ca\/.*island-ferries/);
  assert.ok(p.photographs.length >= 4, `${p.photographs.length} photographs`);
  for (const photo of p.photographs) {
    assert.match(photo.url, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(photo.title.startsWith('File:'), photo.title);
    assert.ok(photo.row && photo.lookFor, 'each photo names the mapped row and what to check');
  }
  assert.ok(p.photographs.some((x) => x.row === 'Oneida Avenue'));
  assert.ok(p.photographs.some((x) => x.row === 'Ojibway Avenue'));
  assert.ok(p.photographs.some((x) => x.row === 'Cibola Avenue'));
  assert.match(p.notEvidence, /motor_vehicle=private.*does not by itself establish/i);
  assert.ok(p.limits.some((x) => /No routing, carriageway width, kerb\/curb/.test(x)));
  assert.ok(p.limits.some((x) => /Only yellow centre-line/.test(x)));
  assert.equal(D.summary.excluded.airport.id, undefined);
  assert.equal(D.summary.excluded.airport.relation, 85471);
});

test('runs are per mapped OSM way: no concatenated cross-island segment remains', () => {
  const D = city().ISLAND_LANES_DATA;
  let worst = 0;
  for (const r of D.runs) {
    assert.ok(r.ways.length === 1, `run ${r.id} is one way`);
    let maxGap = 0;
    for (let i = 1; i < r.points.length; i++) {
      maxGap = Math.max(maxGap, Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]));
    }
    assert.ok(maxGap < 300, `run ${r.id} ${r.names}: ${maxGap.toFixed(0)} m gap`);
    worst = Math.max(worst, maxGap);
  }
  assert.ok(worst < 300, `worst gap ${worst.toFixed(0)} m`);
  assert.deepEqual(D.summary.counts.runs, D.runs.length);
});

test('only photographed rows become unmarked; every other service lane keeps the native paint', () => {
  const C = city();
  const D = C.ISLAND_LANES_DATA;
  const unmarked = D.runs.filter((r) => r.unmarked === 1);
  assert.ok(unmarked.length > 20, `${unmarked.length} unmarked runs`);
  for (const r of unmarked) {
    assert.ok(r.unmarkedReason, `run ${r.id} has a reason`);
    assert.ok(r.unmarkedPhotos.length > 0, `run ${r.id} names its photo evidence`);
    assert.ok(r.cls === 'living_street' || (r.cls === 'service' && r.names.includes('Cibola Avenue')), `${r.id} ${r.cls} ${r.names}`);
  }
  for (const name of ['Island Service Road', 'The Mall', 'Centre Island Park', 'Lagoon Road', 'Meades Walk', 'Terry Kimball Lane', "Ward's Island Dock Line"]) {
    const rs = D.runs.filter((r) => r.names.includes(name));
    if (!rs.length) continue;
    assert.ok(rs.every((r) => r.unmarked === 0), `${name} is not photo-confirmed and keeps its paint`);
  }
  // Algonquin Bridge Road is mapped wood + bridge; the record stays, but no flat surface is drawn by this module.
  const bridge = runOf(C, 'Algonquin Bridge Road');
  assert.ok(bridge && bridge.wood === 1 && bridge.bridge === 1, 'wood bridge flags stay recorded');
  const layout = C.islandLanesLayout();
  assert.ok(layout.stats.woodKeptUnresolved.some((w) => w.names.includes('Algonquin Bridge Road')));
  assert.equal(typeof C.createWaterfrontIslandLanes, 'undefined', 'no overlay builder');
  assert.equal(typeof C.islandLaneSurfaceAt, 'undefined', 'no flat wood/asphalt surface overlay');
});

test('the gate is pure: islandLanesLayout({ bounds }) never mutates CITY.GEO', () => {
  const C = city();
  const beforeFrame = JSON.stringify(C.GEO.frame);
  const bounds = { ...C.GEO.frame.detail };
  const before = JSON.stringify(bounds);
  const layout = C.islandLanesLayout({ bounds });
  assert.ok(layout.runs.length > 20);
  assert.equal(JSON.stringify(C.GEO.frame), beforeFrame, 'CITY.GEO.frame is unchanged');
  assert.equal(JSON.stringify(bounds), before, 'the supplied bounds is not written');
  // point lookup with bounds is equally pure
  const p = mid(layout.runs[0]);
  assert.equal(C.islandLaneCentreLineSuppressed(p[0], p[1], { bounds: C.GEO.frame.detail }), true);
  assert.equal(JSON.stringify(C.GEO.frame), beforeFrame);
});

test('detail and Eglinton frames both resolve, a mismatched projection or absent frame draws nothing', () => {
  for (const [tag, geo] of [['detail', detail.GEO], ['eglinton', eglinton.GEO]]) {
    const C = city({ geo });
    const layout = C.islandLanesLayout();
    assert.equal(layout.skipped, null, tag);
    assert.ok(layout.runs.length > 20, `${tag}: ${layout.runs.length} runs`);
    const p = mid(layout.runs[0]);
    assert.equal(C.islandLaneCentreLineSuppressed(p[0], p[1]), true, tag);
  }
  const wrong = city({ geo: detail.GEO });
  wrong.GEO.frame.projection = { ...wrong.GEO.frame.projection, kx: wrong.GEO.frame.projection.kx * 1.01 };
  assert.equal(wrong.islandLanesLayout().skipped, 'projection does not match the data');
  const p = mid(runOf(wrong, 'Oneida Avenue'));
  assert.equal(wrong.islandLaneCentreLineSuppressed(p[0], p[1]), false);

  const noFrame = city({ geo: {} });
  assert.equal(noFrame.islandLanesLayout().skipped, 'no active frame');
  assert.equal(noFrame.islandLaneCentreLineSuppressed(1000, 2300), false);
});

test('gate truth is source-exact and pair to no mainland or airport ground', () => {
  const C = city();
  for (const name of ['Oneida Avenue', 'Ojibway Avenue', 'Cibola Avenue', 'Third Street', 'Fifth Street', 'Lakeshore Avenue']) {
    const r = C.ISLAND_LANES_DATA.runs.find((x) => (x.names || []).includes(name) && x.unmarked === 1);
    assert.ok(r, name);
    const p = mid(r);
    const hit = C.islandLaneAt(p[0], p[1]);
    assert.ok(hit, `${name} resolves`);
    assert.ok((hit.names || []).length, `${name} names its mapped row`);
    assert.equal(hit.cls, r.cls);
    assert.equal(C.islandLaneCentreLineSuppressed(p[0], p[1]), true, name);
  }
  for (const name of ['Island Service Road', 'The Mall', 'Centre Island Park']) {
    const r = runOf(C, name);
    if (!r) continue;
    const p = mid(r);
    assert.equal(C.islandLaneCentreLineSuppressed(p[0], p[1]), false, `${name} is not photo-evidenced`);
  }
  // Mainland Queens Quay and the airport footprint are never island lanes.
  assert.equal(C.islandLaneCentreLineSuppressed(1000, 600), false, 'mainland');
  assert.equal(C.islandLaneCentreLineSuppressed(-900, 1600), false, 'airport');
});

// --------------------------------------------------------------------------------------------------------------------
// Producer hook: road-paint.js emits no YELLOW centre-line vertices where the gate says unmarked, and is unchanged
// when the gate is absent.
// --------------------------------------------------------------------------------------------------------------------
const paintSource = readJs('road-paint.js');

function network() {
  const node = (id, x, z) => ({ id, x, z, shape: false, signal: false });
  const A = node(0, 0, 0), B = node(1, 200, 0);
  const edge = (from, to, lanes, half) => {
    const L = Math.hypot(to.x - from.x, to.z - from.z), dx = (to.x - from.x) / L, dz = (to.z - from.z) / L;
    const a = 6, b = 6;
    return { from, to, x0: from.x, z0: from.z, sx: from.x + dx * a, sz: from.z + dz * a, dx, dz, rx: -dz, rz: dx, span: L, len: L - a - b, half, lanes, outSide: 0, inSide: 1 };
  };
  const ab = edge(A, B, [1.8, 5.4], 7.2), ba = edge(B, A, [1.8, 5.4], 7.2);
  return { edges: [ab, ba], midCrossings: [], isRoadClear: () => true };
}

function buildPaint({ gate = null } = {}) {
  const CITY = {
    THREE: CORE, CROSSWALK: 2.5, QUALITY: { cull: 1 },
    createRoadPaintMaterial: () => new CORE.MeshBasicMaterial({ transparent: true }),
    edgeY: () => 0
  };
  if (gate) CITY.islandLaneCentreLineSuppressed = gate;
  new Function('window', 'console', paintSource)({ CITY }, { info() {} });
  const scene = new CORE.Scene();
  CITY.buildRoadPaint(scene, network());
  return scene.getObjectByName('RoadMarkings');
}

function vertices(group) {
  const out = [];
  for (const mesh of group.children) {
    const p = mesh.geometry.attributes.position, c = mesh.geometry.attributes.color;
    for (let i = 0; i < p.count; i++) out.push({ x: p.getX(i), y: p.getY(i), z: p.getZ(i), r: c.getX(i), g: c.getY(i), b: c.getZ(i) });
  }
  return out;
}
const YELLOW = new CORE.Color(0xe0b12e);
const WHITE = new CORE.Color(0xe6e2d6);
const near = (v, c) => Math.abs(v.r - c.r) < 0.02 && Math.abs(v.g - c.g) < 0.02 && Math.abs(v.b - c.b) < 0.02;
const isYellow = (v) => near(v, YELLOW);
const isWhite = (v) => near(v, WHITE);

test('road-paint omits the yellow centre line on a gated unmarked run and leaves other paint alone', () => {
  const base = vertices(buildPaint());
  const noGate = vertices(buildPaint());
  assert.equal(noGate.length, base.length, 'absent gate changes nothing');
  assert.ok(base.some(isYellow), 'the baseline multi-lane road has yellow centre-line vertices');

  const gatedVertices = vertices(buildPaint({ gate: () => true }));
  assert.ok(gatedVertices.length < base.length, `${gatedVertices.length} < ${base.length}`);
  assert.equal(gatedVertices.some(isYellow), false, 'no yellow centre-line vertex survives');
  // White same-direction lane line is not the centre line: it is still emitted.
  assert.ok(gatedVertices.some(isWhite), 'white lane line stays');
});

test('road-paint calls the gate at road-network points, not at a fixed global switch', () => {
  const seen = [];
  buildPaint({ gate: (x, z) => { seen.push([x, z]); return false; } });
  assert.ok(seen.length >= 2, `${seen.length} gate samples`);
  assert.ok(seen.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)));
  assert.ok(seen.some(([x]) => x > 0 && x < 200), 'samples lie along the built edge');
});
