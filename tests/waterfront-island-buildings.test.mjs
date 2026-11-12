// Toronto Islands source-matched building profiles (js/waterfront-island-buildings.js + -data.js).
//
// These tests exercise the real generated data and the real committed geodata: Ward's/Algonquin cottages and small
// park/service buildings must get conservative low profiles (never the inherited generic towers), while the mapped
// Billy Bishop airport, the mainland and the Gibraltar Point Lighthouse must never be overridden. Identity is by the
// committed row's world centre, so the same row resolves in the detail and Eglinton frames. GEO is never mutated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';

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

function city({ geo = detail.GEO, withData = true, withModule = true, frame = null } = {}) {
  const C = { GEO: { ...geo, frame: { ...geo.frame, detail: { ...geo.frame?.detail }, projection: { ...geo.frame?.projection } } } };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} } };
  if (frame) C.GEO.frame.detail = frame;
  vm.createContext(ctx);
  if (withData) vm.runInContext(readJs('waterfront-island-buildings-data.js'), ctx, { filename: 'waterfront-island-buildings-data.js' });
  if (withModule) vm.runInContext(readJs('waterfront-island-buildings.js'), ctx, { filename: 'waterfront-island-buildings.js' });
  return ctx.window.CITY;
}

const rowAt = (geo, cx, cz, tol = 0.2) => geo.buildings.find((r) => Math.abs(r[0] - cx) < tol && Math.abs(r[1] - cz) < tol);

// The cottage renderer's pure geometry helpers are exported by js/buildings.js so the roof and trim can be measured
// directly instead of only asserting profile metadata (the GPU review's first pass failed exactly here).
function buildingGeometry() {
  const C = { THREE: {}, Addons: {}, TSL: {}, GEO: { buildings: [] } };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(readJs('buildings.js'), ctx, { filename: 'buildings.js' });
  return C;
}

test('the generated data is source-attributed and excludes the airport and the Gibraltar Point Lighthouse', () => {
  const C = city();
  const D = C.ISLAND_BUILDINGS_DATA;
  assert.ok(D && Array.isArray(D.records) && D.records.length > 250, `${D?.records?.length} records`);
  assert.equal(D.summary.airport.id, 85471);
  assert.match(D.summary.airport.name, /Billy Bishop/i);
  assert.ok(D.summary.projection && Number.isFinite(D.summary.projection.kx), 'the build projection is recorded');
  assert.equal(JSON.stringify(D.summary.landmarksExcluded.map((l) => l.id).sort((a, b) => a - b)), JSON.stringify([878933152, 892934946]));
  const ids = new Set(D.records.map((r) => r.osm.id));
  assert.equal(ids.has(878933152), false, 'lighthouse way 878933152 is never profiled');
  assert.equal(ids.has(892934946), false, 'lighthouse way 892934946 is never profiled');
  for (const r of D.records) {
    assert.equal(r.osm.type, 'way');
    assert.ok(Number.isInteger(r.osm.id) && r.osm.id > 0, 'every record names its OSM way');
    assert.ok(Number.isFinite(r.cx) && Number.isFinite(r.cz));
    assert.ok(['residential', 'apartments', 'worship', 'civic', 'retail', 'service', 'generic'].some((c) => r.category.startsWith(c)), r.category);
    assert.ok(r.heightSource === 'OSM height tag' || r.heightSource === 'OSM building:levels' || r.heightSource === 'conservative island estimate');
  }
  assert.ok(D.summary.counts.explicitHeightOrLevels > 0);
  assert.ok(D.summary.counts.inheritedHighRiseRowsCorrected > 150);
});

test('Ward\'s/Algonquin cottages are low cottages, not the inherited generic towers', () => {
  const C = city();
  const D = C.ISLAND_BUILDINGS_DATA;
  const ward = D.records.filter((r) => r.kind === 0 && r.cx > 1400 && r.cx < 1800 && r.cz > 1880 && r.cz < 2200);
  assert.ok(ward.length >= 40, `${ward.length} Ward's Island cottage records`);
  for (const r of ward) {
    const row = rowAt(detail.GEO, r.cx, r.cz);
    assert.ok(row, `row at ${r.cx},${r.cz}`);
    const p = C.islandBuildingProfile(row);
    assert.ok(p, 'profile resolves');
    assert.ok(p.height <= 7, `${r.cx},${r.cz}: ${p.height} m`);
    assert.equal(p.kind, 0, 'cottages use the house/low-rise material path');
    assert.equal(p.roof, 1, 'cottages keep a pitched roof');
  }
  // A specific inherited ~22 m Ward's row (centre 1627.9, 2012.4) that rendered as a mid-rise tower.
  const row = rowAt(detail.GEO, 1627.9, 2012.4);
  assert.ok(row, 'the sample Ward row exists');
  assert.ok(row[4] >= 15 && row[5] === 2, `sample native height/kind ${row[4]}/${row[5]}`);
  const p = C.islandBuildingProfile(row);
  assert.equal(p.height, 6.5);
  assert.equal(p.kind, 0);
  assert.equal(p.roof, 1);
});

test('the mapped Billy Bishop airport rows are never overridden', () => {
  const C = city();
  const terminal = detail.GEO.buildings.find((r) => /^Billy Bishop Airport Terminal$/i.test(r[9] || ''));
  assert.ok(terminal, 'the airport terminal row is in the committed geodata');
  assert.equal(C.islandBuildingProfile(terminal), null);
  const firehall = detail.GEO.buildings.find((r) => /Toronto City Centre Airport Firehall/i.test(r[9] || ''));
  assert.ok(firehall, 'the airport firehall row is in the committed geodata');
  assert.equal(C.islandBuildingProfile(firehall), null);
  // No record may sit inside the airport relation's bbox (-2433..-998 x, 910..2204 z) except none: every recorded
  // centre is outside that box or the relation's ring (the records were filtered by point-in-polygon at build time).
  for (const r of C.ISLAND_BUILDINGS_DATA.records) {
    assert.ok(!(r.cx > -2100 && r.cx < -1450 && r.cz > 1000 && r.cz < 1450), `airport-area record ${r.cx},${r.cz}`);
  }
});

test('mainland rows are no-ops', () => {
  const C = city();
  for (const name of ['Harbourview Estates 2', 'Tip Top Lofts', 'Quebec Quay West']) {
    const row = detail.GEO.buildings.find((r) => (r[9] || '') === name);
    if (!row) continue;
    assert.equal(C.islandBuildingProfile(row), null, `${name} is mainland`);
  }
  // A far mainland row with no name, and one across the frame, are null too.
  assert.equal(C.islandBuildingProfile([-5000, -2000, 0, [[-5, 5, -5, 5]], 20, 2, 0, 1, 0, '']), null);
});

test('the lookup is pure: it never mutates the committed row or GEO', () => {
  const C = city();
  const rec = C.ISLAND_BUILDINGS_DATA.records.find((r) => r.kind === 0 && r.roof === 1);
  const row = rowAt(detail.GEO, rec.cx, rec.cz);
  const before = JSON.stringify(row);
  const p = C.islandBuildingProfile(row);
  assert.ok(p);
  assert.equal(JSON.stringify(row), before, 'the row is unchanged');
  assert.equal(row[4], rec.native.height, 'native height preserved on the row');
  assert.equal(row[5], rec.native.kind, 'native kind preserved on the row');
  // The override is a fresh object, not a reference into the data records.
  p.height = -1;
  assert.notEqual(C.islandBuildingProfile(row).height, -1);
});

test('explicit OSM levels win uncapped and unsupported source keeps the native roof', () => {
  const C = city();
  const levelsRows = C.ISLAND_BUILDINGS_DATA.records.filter((r) => r.heightSource === 'OSM building:levels');
  assert.ok(levelsRows.length > 0);
  for (const r of levelsRows) {
    const row = rowAt(detail.GEO, r.cx, r.cz);
    const p = C.islandBuildingProfile(row);
    assert.equal(p.height, r.height);
    assert.equal(p.heightSource, 'OSM building:levels');
  }
  // A service building with no mapped roof:shape returns roof null ("keep the native roof").
  const noRoof = C.ISLAND_BUILDINGS_DATA.records.find((r) => r.roof == null && r.category.startsWith('service'));
  assert.ok(noRoof, 'a service record without a source roof shape exists');
  const p = C.islandBuildingProfile(rowAt(detail.GEO, noRoof.cx, noRoof.cz));
  assert.equal(p.roof, null);
});

test('the same row resolves in the Eglinton frame by centre, not by array index', () => {
  const C1 = city({ geo: detail.GEO });
  const C2 = city({ geo: eglinton.GEO });
  const rec = C1.ISLAND_BUILDINGS_DATA.records.find((r) => r.cx > 1400 && r.cx < 1800 && r.cz > 1880 && r.cz < 2200);
  const dRow = rowAt(detail.GEO, rec.cx, rec.cz);
  const eRow = rowAt(eglinton.GEO, rec.cx, rec.cz);
  assert.ok(dRow && eRow, 'both frames hold the footprint');
  assert.notEqual(detail.GEO.buildings.indexOf(dRow), eglinton.GEO.buildings.indexOf(eRow), 'the row indices differ');
  const a = C1.islandBuildingProfile(dRow, detail.GEO.buildings.indexOf(dRow));
  const b = C2.islandBuildingProfile(eRow, eglinton.GEO.buildings.indexOf(eRow));
  assert.deepEqual({ height: a.height, kind: a.kind, roof: a.roof }, { height: b.height, kind: b.kind, roof: b.roof });
});

test('the runtime refuses a different projection or a reshaped footprint at the same centre', () => {
  const C = city();
  const rec = C.ISLAND_BUILDINGS_DATA.records.find((r) => r.kind === 0);
  assert.ok(typeof rec.fp === 'string' && rec.fp.length > 4, 'records carry a footprint signature');
  const row = rowAt(detail.GEO, rec.cx, rec.cz);
  assert.ok(C.islandBuildingProfile(row), 'the committed row resolves');

  // Same centre, changed footprint (re-cut parts) -> no-op.
  const reshaped = [row[0], row[1], row[2], [[-99, 99, -99, 99]], row[4], row[5], row[6], row[7], row[8], row[9]];
  assert.equal(C.islandBuildingProfile(reshaped), null, 'a reshaped footprint at the same centre is refused');

  // A frame whose projection differs but whose bounds (and centres) coincide -> no-op.
  const other = city({ geo: { ...detail.GEO, frame: { ...detail.GEO.frame } } });
  other.GEO.frame.projection = { ...detail.GEO.frame.projection, kx: detail.GEO.frame.projection.kx * 1.5 };
  assert.equal(other.islandBuildingsSupported(), false);
  assert.equal(other.islandBuildingProfile(rowAt(other.GEO, rec.cx, rec.cz)), null);
});

test('cottage appearance metadata is source-labelled and only on confirmed cottages', () => {
  const C = city();
  const D = C.ISLAND_BUILDINGS_DATA;
  const cottages = D.records.filter((r) => r.typology === 'cottage');
  assert.ok(cottages.length >= 200, `${cottages.length} cottage records`);
  for (const r of cottages) {
    assert.equal(r.kind, 0, 'a cottage is on the house material path');
    assert.ok(['clapboard', 'wood'].includes(r.siding), r.siding);
    assert.ok(r.sidingSource === 'OSM building:material' || r.sidingSource === 'island cottage typology approximation');
    assert.equal(r.entry, 'inset-front-porch');
    assert.ok(['gable', 'hip', 'pyramidal', 'gambrel', 'round', 'pitched'].includes(r.roofType), r.roofType);
    assert.ok(r.roofSource === 'OSM roof:shape' || r.roofSource === 'island cottage typology approximation');
    // The runtime profile exposes the same metadata for the renderer.
    const p = C.islandBuildingProfile(rowAt(detail.GEO, r.cx, r.cz));
    assert.equal(p.typology, 'cottage');
    assert.equal(p.siding, r.siding);
    assert.equal(p.roofType, r.roofType);
  }
  // Service buildings are never given the cottage material/porch: they keep the native paths.
  const service = D.records.filter((r) => r.typology === 'service');
  assert.ok(service.length > 0);
  for (const r of service) {
    assert.equal(r.siding, null);
    assert.equal(r.entry, null);
    const p = C.islandBuildingProfile(rowAt(detail.GEO, r.cx, r.cz));
    assert.equal(p.typology, 'service');
    assert.equal(p.siding, null);
    assert.equal(p.entry, null);
  }
});

test('explicit OSM roof:shape keeps its source subtype and provenance', () => {
  const C = city();
  const D = C.ISLAND_BUILDINGS_DATA;
  const shaped = D.records.filter((r) => r.roofSource === 'OSM roof:shape');
  assert.ok(shaped.length > 0, 'the mapped island buildings include explicit roof shapes');
  for (const r of shaped) {
    assert.ok(r.tags['roof:shape'], 'the source tag is recorded');
    assert.notEqual(r.roofType, null);
    assert.equal(r.roof, r.roofType === 'flat' ? 0 : 1);
    const p = C.islandBuildingProfile(rowAt(detail.GEO, r.cx, r.cz));
    assert.equal(p.roofSource, 'OSM roof:shape');
    assert.equal(p.roofType, r.roofType);
  }
});

test('unsupported inputs and frames are honest no-ops', () => {
  assert.equal(city({ withData: false, withModule: false }).islandBuildingProfile, undefined);
  const noData = city({ withData: false, withModule: true });
  assert.equal(noData.islandBuildingsSupported(), false);
  assert.equal(noData.islandBuildingProfile([1600, 2000, 0, [[-5, 5, -5, 5]], 20, 2, 0, 1, 0, '']), null);
  const tiny = city({ frame: { x0: 0, x1: 10, z0: 0, z1: 10 } });
  assert.equal(tiny.islandBuildingProfile([1600, 2000, 0, [[-5, 5, -5, 5]], 20, 2, 0, 1, 0, '']), null);
  const C = city();
  assert.equal(C.islandBuildingProfile(null), null);
  assert.equal(C.islandBuildingProfile([1, 2]), null);
});

test('the gable roof sits on the eave, reaches only the profile total, and has outward sealed ends', () => {
  const C = buildingGeometry();
  const A = { pos: [], nor: [], uv: [], col: [] };
  const cx = 10, cz = -5, ang = 0.3, u0 = -4, u1 = 4, v0 = -3, v1 = 3, y = 3.5, pitch = 0.6, eave = 0.45;
  C.pushGableRoof(A, cx, cz, ang, u0, u1, v0, v1, y, pitch, eave, [1, 0, 0], [0.8, 0.8, 0.8]);
  assert.equal(A.pos.length % 9, 0, 'whole triangles only');
  const verts = [];
  for (let i = 0; i < A.pos.length; i += 3) verts.push({ p: [A.pos[i], A.pos[i + 1], A.pos[i + 2]], n: [A.nor[i], A.nor[i + 1], A.nor[i + 2]] });
  const ys = verts.map((v) => v.p[1]);
  const W = u1 - u0 + 2 * eave, D = v1 - v0 + 2 * eave;
  const rise = Math.min(W, D) / 2 * Math.tan(pitch);
  assert.ok(Math.abs(Math.min(...ys) - (y - 0.04)) < 1e-6, 'the soffit is just under the eave');
  assert.ok(Math.abs(Math.max(...ys) - (y + rise)) < 1e-6, `apex ${Math.max(...ys)} is the profile total ${y + rise}`);
  // Slopes face upward (the roof is closed from above).
  for (const v of verts.slice(0, 12)) assert.ok(v.n[1] > 0.5, `slope normal up: ${v.n}`);
  // The six gable-end vertices follow the four slopes; their two triangles are vertical and face outwards.
  const ends = verts.slice(12, 18);
  assert.ok(ends.every((v) => Math.abs(v.n[1]) < 1e-9), 'gable ends are vertical faces');
  for (let t = 0; t < 2; t++) {
    const n = ends[t * 3].n;
    const side = t === 0 ? -1 : 1;
    const outward = [side * Math.cos(ang), 0, -side * Math.sin(ang)];
    const dot = n[0] * outward[0] + n[2] * outward[2];
    assert.ok(dot > 0.999, `gable end ${t} faces outward (dot ${dot})`);
  }
  // Base is at the eave (no floating umbrella) and the ridge runs along the longer axis.
  const baseY = ends.filter((v) => Math.abs(v.p[1] - y) < 1e-6).length;
  // Winding, not just assigned normals, determines visibility from below in WebGPU.
  for (let i = 18; i < verts.length; i += 3) {
    if (verts[i].n[1] > -0.5) continue;
    const [a, b, c] = verts.slice(i, i + 3).map(v => v.p);
    const geometricY = (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    assert.ok(geometricY < 0, 'soffit winding faces downward and closes the eave from street level');
  }
  const edgeCounts = new Map();
  const key = p => p.map(v => v.toFixed(6)).join(',');
  for (let i = 0; i < verts.length; i += 3) {
    const t = verts.slice(i, i + 3).map(v => key(v.p));
    for (let j = 0; j < 3; j++) {
      const e = [t[j], t[(j + 1) % 3]].sort().join('|');
      edgeCounts.set(e, (edgeCounts.get(e) || 0) + 1);
    }
  }
  assert.ok([...edgeCounts.values()].every(n => n === 2), 'roof, ends, underside and fascia form a sealed volume');
  assert.equal(baseY, 4, 'four base vertices sit on the eave');
  assert.ok(ends.some((v) => Math.abs(v.p[1] - (y + rise)) < 1e-6), 'the end triangles reach the ridge');
});

test('cottage eaves use a conservative one/one-and-a-half storey and explicit totals keep their height', () => {
  const C = buildingGeometry();
  const est = C.islandCottageEaveHeight(6.5, 10, 8, true);
  assert.ok(est >= 3 && est <= 4.4, `estimated 6.5 m total eave ${est}`);
  assert.ok(est < 6.5 - 1.0, 'the roof takes the rest of the total, not an extra storey');
  const tall = C.islandCottageEaveHeight(9, 10, 8, false);
  assert.ok(tall > 4.4 && tall < 9, `explicit 9 m total eave ${tall} is taller, still under the total`);
  const low = C.islandCottageEaveHeight(3.5, 6, 5, false);
  assert.ok(low >= 2.4 && low < 3.5, `one-storey total eave ${low}`);
});

test('cottage door and casing remain shallow facade relief at the mapped footprint', () => {
  const C = buildingGeometry();
  const out = [];
  const cx = 10, cz = -5, ang = 0.3, u0 = -4, u1 = 4, v0 = -3, v1 = 3;
  C.islandCottageTrim(out, cx, cz, ang, u0, u1, v0, v1, 3.8, 3, 0, C.islandCottageShaderTone(0.37, 0));
  assert.ok(out.length >= 11, `${out.length} trim boxes`);
  assert.ok(out.some(b => b.color === 0x355a58), 'a distinct painted door leaf is rendered');
  assert.ok(out.some(b => b.color === 0x26393e), 'the door has a separate upper glass pane');
  const cs = Math.cos(ang), sn = Math.sin(ang);
  for (const b of out) {
    const du = b.x - cx, dv = b.z - cz;
    const u = du * cs - dv * sn, v = du * sn + dv * cs;
    assert.ok(u > u0 - 0.2 && u < u1 + 0.2, `trim u ${u} inside ${u0}..${u1}`);
    assert.ok(v > v0 - 0.2 && v < v1 + 0.2, `trim v ${v} inside ${v0}..${v1}`);
    assert.ok(b.y - b.h / 2 >= -0.01, 'trim sits on the ground, never underground');
  }
});

// The custom island door must land in the exact bay the facade shader reserves for the entrance (facadeCell): the wave7
// GPU review showed the door drawn over a procedural window with a blank bay beside it, because the trim sat at the
// wall centre while the shader had punched its window-free opening elsewhere. Two subtleties the first attempt missed:
//   (1) the window/door SUPPRESSION MASK (facadeCell's cornerPier branch) computes bayIdx from s = along·wallWidth —
//       UNFLIPPED — while the flipped wallS only positions the DRAWN procedural entrance/storefront the cottage
//       suppresses (proceduralEntrances: 0). The door must match the mask, so there is NO flip.
//   (2) the shader's tone is DECODED from a Float32 box.w = (i·29 mod 1000) + 0.1 + 0.8·tone (createFacadeBoxes), so it
//       drifts from the raw tone and can pick the adjacent bay right on a boundary. The door must use the decoded tone.
// This re-derives the mask's bay (an INDEPENDENT oracle) and walks the real trim geometry's door leaf back into it on
// every front, across several wall widths (1..6+ bays), boundary tones and high box indices. A wrong flip, the raw
// tone, or a stale pitch fails here.
test('the custom cottage door lands in the facade\'s reserved entrance bay on every front', () => {
  const C = buildingGeometry();
  const pitch = C.ISLAND_COTTAGE_BAY_PITCH, cornerPier = C.ISLAND_COTTAGE_CORNER_PIER, casingW = C.ISLAND_COTTAGE_DOOR_CASING;
  const toneMin = C.ISLAND_COTTAGE_TONE_MIN;
  assert.ok(pitch === 2.5 && cornerPier === 0.35 && toneMin > 0, 'the shared cottage bay metrics the material also uses');
  // Reference: js/tsl-materials.js facadeCell's cornerPier branch (the mask) — UNFLIPPED s, and the box is Float32.
  const reserved = (W, shaderTone) => {
    const Wf = Math.fround(W);
    const pier = Math.min(cornerPier, Wf * 0.2);
    const inner = Math.max(Wf - 2 * pier, 0);
    const bays = Math.max(Math.floor(inner / pitch + 0.5), 1);
    const bayWidth = inner / bays;
    return { pier, bays, bayWidth, chosen: Math.min(Math.floor(shaderTone * bays), bays - 1) };
  };
  const cx = 0, cz = 0;
  const widths = [3.2, 4.6, 6.0, 7.8, 10.4, 14.0, 21.0];
  const indices = [0, 7, 123, 500, 989, 996, 999]; // box indices, incl. the largest Integer parts (worst Float32)
  let checked = 0;
  for (const ang of [0, 0.3, -0.7, 1.9]) {
    const cs = Math.cos(ang), sn = Math.sin(ang);
    for (const W of widths) {
      const u0 = -W / 2, u1 = W / 2, v0 = -W / 2, v1 = W / 2; // a square wall: the bay width is W on every front
      const { bays } = reserved(W, 0.5);
      const rawTones = new Set([0.02, 0.19, 0.37, 0.55, 0.72, 0.93]);
      for (let k = 0; k < bays; k++) { rawTones.add(Math.max(toneMin, k / bays)); rawTones.add(Math.max(toneMin, k / bays + 1e-5)); }
      for (const index of indices) {
        for (const raw of rawTones) {
          const shaderTone = C.islandCottageShaderTone(Math.max(raw, toneMin), index);
          const ref = reserved(W, shaderTone);
          for (const front of [0, 1, 2, 3]) {
            const out = [];
            C.islandCottageTrim(out, cx, cz, ang, u0, u1, v0, v1, 3.8, front, 0, shaderTone);
            const leaf = out.find(b => b.color === 0x355a58);
            assert.ok(leaf, `front ${front}: the door leaf is drawn`);
            const du = leaf.x - cx, dv = leaf.z - cz;
            const u = du * cs - dv * sn, v = du * sn + dv * cs;
            const uWall = front < 2;                 // ±u walls vary along v, ±v walls along u (facadeCell's alongZ)
            const s = uWall ? (v - v0) : (u - u0);   // the mask's s = along·wallWidth, UNFLIPPED (no flip)
            const bayIdx = Math.floor((s - ref.pier) / ref.bayWidth);
            assert.equal(bayIdx, ref.chosen,
              `front ${front} W ${W} index ${index} raw ${raw.toFixed(5)}: door in bay ${bayIdx}, mask reserved ${ref.chosen}`);
            // The fixed axis is on the wall face (shallow relief), and the casing never spills past the reserved bay.
            const fixed = uWall ? Math.abs(front === 0 ? u - u0 : u1 - u) : Math.abs(front === 2 ? v - v0 : v1 - v);
            assert.ok(fixed >= 0.02 && fixed < 0.12, `front ${front}: door sits ~cm in front of the wall (${fixed.toFixed(3)})`);
            assert.ok(Math.min(casingW, ref.bayWidth) <= ref.bayWidth + 1e-9, 'the casing fits the reserved bay');
            checked++;
          }
        }
      }
    }
  }
  assert.ok(checked > 5000, `${checked} front/tone/width/index combinations exercised`);
});

// The shader's tone is decoded from a Float32 box.w, so it drifts from the raw tone and can choose the ADJACENT bay
// right on a boundary. This proves the door-bay helper follows the DECODED tone, not the raw one: it finds a case where
// the two disagree and checks the helper picks the shader's bay.
test('the cottage door bay follows the shader\'s decoded Float32 tone, not the raw tone', () => {
  const C = buildingGeometry();
  const pitch = C.ISLAND_COTTAGE_BAY_PITCH, cornerPier = C.ISLAND_COTTAGE_CORNER_PIER;
  const baysOf = (W) => Math.max(Math.floor((Math.fround(W) - 2 * Math.min(cornerPier, Math.fround(W) * 0.2)) / pitch + 0.5), 1);
  let disagreements = 0;
  for (const W of [6.0, 7.8, 10.4, 14.0]) {
    const bays = baysOf(W);
    for (let index = 980; index < 1000; index++) {
      for (let k = 0; k < bays; k++) {
        for (const d of [-1e-5, 0, 1e-5]) {
          const raw = Math.max(C.ISLAND_COTTAGE_TONE_MIN, k / bays + d);
          const shaderTone = C.islandCottageShaderTone(raw, index);
          const byShader = C.islandCottageDoorBay(W, shaderTone).chosen;
          const byRaw = Math.min(Math.floor(raw * bays), bays - 1);
          assert.equal(byShader, Math.min(Math.floor(shaderTone * bays), bays - 1), 'the helper follows the decoded tone');
          if (byShader !== byRaw) disagreements++;
        }
      }
    }
  }
  assert.ok(disagreements > 0, `the decoded tone disagrees with the raw tone on ${disagreements} boundary cases`);
  // The Float32 drift is real and grows with the box index (the integer part of box.w).
  assert.ok(Math.abs(C.islandCottageShaderTone(0.37, 999) - 0.37) > Math.abs(C.islandCottageShaderTone(0.37, 0) - 0.37),
    'the decode drift is larger at a high box index');
});

test('the cottage door-bay helper clamps narrow walls and reports the reserved bay', () => {
  const C = buildingGeometry();
  const narrow = C.islandCottageDoorBay(1.4, 0.5);
  assert.equal(narrow.bays, 1, 'a wall under one pitch still gets exactly one bay');
  assert.ok(narrow.chosen === 0);
  assert.ok(narrow.center > 0 && narrow.center < 1.4, 'the single bay centre lies on the wall');
  const wide = C.islandCottageDoorBay(12.6, 0.0);
  assert.ok(wide.bays >= 4, `${wide.bays} bays on a 12.6 m wall`);
  assert.equal(wide.chosen, 0, 'tone 0 picks the first bay');
  assert.ok(C.islandCottageDoorBay(12.6, 0.999).chosen === wide.bays - 1, 'tone ~1 picks the last bay, clamped');
  // The cottage tone floor keeps the decoded tone non-negative, so chosen is never the shader's unclamped -1.
  for (let index = 0; index < 1000; index += 37) {
    assert.ok(C.islandCottageShaderTone(C.ISLAND_COTTAGE_TONE_MIN, index) >= 0, `tone floor keeps index ${index} non-negative`);
    assert.ok(C.islandCottageDoorBay(12.6, C.islandCottageShaderTone(C.ISLAND_COTTAGE_TONE_MIN, index)).chosen >= 0);
  }
});



// ---------------------------------------------------------------------------------------------------------------------
// Captured camera clearance (st-sb3r: the first GPU pass put two street cameras inside a cottage, so the frame showed
// only an interior wall). These views must stay outside every committed building OBB, on land, at eye height, with an
// unobstructed line of sight to the front wall, and sit on the mapped road/path network. The check runs against the
// real committed geodata rows and the real shot list (tools/shots/waterfront-cottage-refinement.json), so a future
// edit that moves a camera back inside a wall, off the road network, or behind another building fails here.
// Captured at load, before the negative tests replace `detail.GEO.frame.detail` on the shared object: the clearance
// test builds its own GEO copy from this pristine frame so test order cannot affect the camera verification.
const DETAIL_FRAME = detail.GEO.frame.detail;
function islandGeo() {
  const C = { GEO: { ...detail.GEO, frame: { ...detail.GEO.frame, detail: DETAIL_FRAME } } };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(readJs('city-config.js'), ctx, { filename: 'city-config.js' });
  vm.runInContext(readJs('waterfront-island-buildings-data.js'), ctx, { filename: 'waterfront-island-buildings-data.js' });
  vm.runInContext(readJs('waterfront-island-buildings.js'), ctx, { filename: 'waterfront-island-buildings.js' });
  return ctx.window.CITY;
}

function obbOf(row, part) {
  const [cx, cz, ang] = row;
  const [u0, u1, v0, v1] = part;
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  return { cx: cx + uc * cs + vc * sn, cz: cz - uc * sn + vc * cs, hx: (u1 - u0) / 2, hz: (v1 - v0) / 2, cs, sn, h: row[4] };
}
function inOBB(x, z, o, margin = 0) {
  const du = x - o.cx, dv = z - o.cz;
  const u = du * o.cs - dv * o.sn, v = du * o.sn + dv * o.cs;
  return Math.abs(u) <= o.hx + margin && Math.abs(v) <= o.hz + margin;
}
function segHitsOBB(ax, az, bx, bz, o, margin = 0) {
  const t = (x, z) => { const du = x - o.cx, dv = z - o.cz; return [du * o.cs - dv * o.sn, du * o.sn + dv * o.cs]; };
  const [axl, azl] = t(ax, az), [bxl, bzl] = t(bx, bz);
  const dx = bxl - axl, dz = bzl - azl;
  let t0 = 0, t1 = 1;
  const hx = o.hx + margin, hz = o.hz + margin;
  for (const [p, d, h] of [[axl, dx, hx], [azl, dz, hz]]) {
    if (Math.abs(d) < 1e-9) { if (p < -h || p > h) return false; continue; }
    let ta = (-h - p) / d, tb = (h - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}
function segOBBInterval(ax, az, bx, bz, o, margin = 0) {
  const t = (x, z) => { const du = x - o.cx, dv = z - o.cz; return [du * o.cs - dv * o.sn, du * o.sn + dv * o.cs]; };
  const [axl, azl] = t(ax, az), [bxl, bzl] = t(bx, bz);
  const dx = bxl - axl, dz = bzl - azl;
  let t0 = 0, t1 = 1;
  const hx = o.hx + margin, hz = o.hz + margin;
  for (const [p, d, h] of [[axl, dx, hx], [azl, dz, hz]]) {
    if (Math.abs(d) < 1e-9) { if (p < -h || p > h) return null; continue; }
    let ta = (-h - p) / d, tb = (h - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

test('every captured island-cottage camera is outside all buildings, on the road network, with a clear frontal view', () => {
  const C = islandGeo();
  const { GEO, nearestRoads, blockAt, waterAt } = C;
  const rows = GEO.buildings;
  const shots = JSON.parse(fs.readFileSync(new URL('../tools/shots/waterfront-cottage-refinement.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(shots) && shots.length >= 4, `${shots.length} shots`);
  const streetShots = shots.filter((s) => /fronts/.test(s.name));
  assert.ok(streetShots.length >= 3, 'at least three street-level frontal views');
  assert.ok(shots.some((s) => /aerial/.test(s.name)), 'an aerial view is present');

  for (const s of shots) {
    const m = /pos:\s*\[\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\][\s\S]*?look:\s*\[\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]/.exec(s.js || '');
    assert.ok(m, `${s.name}: the shot exposes a camera pos and look`);
    const cam = [+m[1], +m[2], +m[3]], look = [+m[4], +m[5], +m[6]];

    // Every camera stands in open space: never inside any committed building volume (all rows, all massing parts). An
    // eye-level camera must clear the footprint; an aerial may hover over a roof as long as it is above it.
    for (const r of rows) for (const p of r[3]) assert.equal(inOBB(cam[0], cam[2], obbOf(r, p), 0.5) && cam[1] < r[4], false,
      `${s.name}: the camera is inside a building at ${cam[0]},${cam[2]} (y ${cam[1]})`);

    if (!/fronts/.test(s.name)) { // aerial: above the roofs, nothing between the eye and the target
      let blocked = null;
      for (const r of rows) {
        for (const p of r[3]) {
          const iv = segOBBInterval(cam[0], cam[2], look[0], look[2], obbOf(r, p), 0.1);
          if (!iv) continue;
          const yAt = (t) => cam[1] + (look[1] - cam[1]) * t;
          if (yAt(iv[0]) < r[4] && yAt(iv[1]) < r[4]) { blocked = r; break; }
        }
        if (blocked) break;
      }
      assert.equal(blocked, null, `${s.name}: the aerial ray is blocked`);
      continue;
    }

    // A street camera stands at eye height on land and on the mapped road/path network.
    assert.ok(cam[1] >= 1.7 && cam[1] <= 2, `${s.name}: eye height ${cam[1]}`);
    assert.ok(!waterAt(cam[0], cam[2]), `${s.name}: the camera is in the water`);
    const nr = nearestRoads(cam[0], cam[2], 30);
    const onRoad = nr.length > 0 && nr[0].dist <= nr[0].road.w / 2 + 1.0;
    const onPath = !!blockAt(cam[0], cam[2]) && nr.length > 0 && nr[0].dist <= nr[0].road.w / 2 + 5.0;
    assert.ok(onRoad || onPath, `${s.name}: the camera is off the road/path network (${nr[0]?.road?.name} @ ${nr[0]?.dist})`);

    // The subject is a confirmed source-matched cottage: the nearest cottage row to the look point (the shot aims at
    // the front wall centre, a few metres off the footprint centre the profile is keyed by).
    let t = null, best = Infinity;
    for (const r of rows) {
      const p = C.islandBuildingProfile(r);
      if (!p || p.typology !== 'cottage') continue;
      const d = Math.hypot(r[0] - look[0], r[1] - look[2]);
      if (d < 8 && d < best) { best = d; t = r; }
    }
    assert.ok(t, `${s.name}: no confirmed cottage near the look point ${look[0]},${look[2]}`);
    const [tcx, tcz, tang, tparts] = t;
    const tcs = Math.cos(tang), tsn = Math.sin(tang);
    const near = nearestRoads(tcx, tcz, 90);
    assert.ok(near.length > 0, `${s.name}: the cottage has no mapped road`);
    let front = 3;
    {
      const toRoadX = near[0].px - tcx, toRoadZ = near[0].pz - tcz;
      const lu = toRoadX * tcs - toRoadZ * tsn, lv = toRoadX * tsn + toRoadZ * tcs;
      front = Math.abs(lu) > Math.abs(lv) ? (lu < 0 ? 0 : 1) : (lv < 0 ? 2 : 3);
    }
    const [pu0, pu1, pv0, pv1] = [0, 1, 2, 3].map((k) => (k % 2 ? Math.max : Math.min)(...tparts.map((p) => p[k])));
    const fu = front === 0 ? pu0 : front === 1 ? pu1 : (pu0 + pu1) / 2;
    const fv = front === 2 ? pv0 : front === 3 ? pv1 : (pv0 + pv1) / 2;
    const fx = tcx + fu * tcs + fv * tsn, fz = tcz - fu * tsn + fv * tcs;
    const n = front === 0 ? [-tcs, tsn] : front === 1 ? [tcs, -tsn] : front === 2 ? [-tsn, -tcs] : [tsn, tcs];
    // The road-facing front face is the wall the camera sees; the camera stands in front of it (same side as the road).
    assert.ok((cam[0] - fx) * n[0] + (cam[2] - fz) * n[1] > 0, `${s.name}: the camera is behind the cottage front`);
    // Line of sight to the front wall centre and both front corners is clear of every other building.
    const half = (front === 0 || front === 1 ? pv1 - pv0 : pu1 - pu0) / 2;
    const t2 = front === 0 || front === 1 ? [tsn, tcs] : [tcs, -tsn];
    for (const [vx, vz] of [[fx, fz], [fx + t2[0] * half, fz + t2[1] * half], [fx - t2[0] * half, fz - t2[1] * half]]) {
      for (const r of rows) {
        if (r === t) continue;
        for (const p of r[3]) assert.equal(segHitsOBB(cam[0], cam[2], vx, vz, obbOf(r, p), 0.15), false,
          `${s.name}: another building blocks the view of ${vx},${vz}`);
      }
    }
  }
});
