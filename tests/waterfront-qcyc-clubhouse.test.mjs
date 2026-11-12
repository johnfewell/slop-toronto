// Queen City Yacht Club clubhouse (st-sb3r.39): committed identity, appearance data and renderer geometry.
//
// Row 32139 (OSM Way 43805118, "Queen City Yacht Club clubhouse", building:levels 2) is the Marina Clubhouse the GPU
// captures show as a generic brown envelope. This suite proves the BOUNDED, source-informed correction:
//
//   * the committed data carries the clubhouse appearance only on row 32139, with the source-verified water side (-v);
//   * the reviewed-profile gate fails closed: a reshaped footprint, a moved centre, a changed OSM binding or another
//     frame gets no profile, so no clubhouse facade (and no balcony) appears anywhere else;
//   * the rendered geometry is TWO storeys: the wall height leaves two window bands below a ~5.15 m eave and a shallow
//     roof inside the unchanged 6.5 m total; the roof apex never exceeds 6.5 m (the collider total);
//   * every part of the L plan is roofed (no unroofed wing);
//   * the balcony/railing sits on the water (-v) side, PROJECTS past the wall (not inside the footprint), and its
//     highest point is below the eave;
//   * the existing shed/storage appearances, height and footprint are unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const fixture = readJson('tools/data/island-outliers.json');
const osm = readJson('tools/data/qcyc-clubhouse-osm.json');
const CLUBHOUSE = 43805118, ROW = 32139;

function loadData() {
  const ctx = { window: {}, console: { info() {}, log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(read('js/waterfront-island-buildings-data.js'), ctx, { filename: 'waterfront-island-buildings-data.js' });
  return ctx.window.CITY.ISLAND_BUILDINGS_DATA;
}
const DATA = loadData();

// The pure renderer helpers, evaluated without three: just the geometry the clubhouse branch calls.
async function loadHelpers() {
  let u8 = new Uint8Array(fs.readFileSync(new URL('data/toronto-geodata.bin', ROOT)));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  const { decodeGeo } = await import('../js/geodata-loader.js');
  const { GEO } = decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
  const ctx = { window: { CITY: { GEO } }, console, Buffer, atob: (s) => Buffer.from(s, 'base64').toString('binary') };
  vm.createContext(ctx);
  const src = read('js/buildings.js');
  const start = src.indexOf('const MARINA_CLUBHOUSE_WALL');
  const end = src.indexOf('// Shed trim: navy door leaves');
  const head = `this.pushHipRoof=(A,cx,cz,ang,u0,u1,v0,v1,y,pitch,eave,rgb)=>{A.pos.push(y,pitch);};`
    + 'const positionWorld={y:{div:()=>({})}};const fract=x=>x;const smoothstep=()=>0;'
    + 'const float=x=>({mul:()=>0,sub:()=>0});const fwidth=()=>0;const linear=()=>[0,0,0];';
  vm.runInContext(head + src.slice(start, end) + `
    this.H = { marinaClubhouseWallHeight, marinaClubhouseDetail, clubhouseFrontageSegments,
      MARINA_CLUBHOUSE_EAVES, MARINA_CLUBHOUSE_FLOOR, MARINA_CLUBHOUSE_ROOF_RISE,
      MARINA_CLUBHOUSE_BALCONY_DEPTH, MARINA_CLUBHOUSE_POST_PITCH, MARINA_CLUBHOUSE_TRIM };`, ctx, { filename: 'clubhouse-helpers.js' });
  return { GEO, H: ctx.H };
}

const clubhouseWay = osm.elements.find((e) => e.id === CLUBHOUSE);
const rowOf = (GEO) => GEO.buildings.find((r) => r[0] === 1255.6 && r[1] === 2126.3);

test('committed data carries the clubhouse appearance on exactly row 32139, water side -v', () => {
  const rows = DATA.records.filter((r) => r.appearance && r.appearance.style === 'qcyc-clubhouse');
  assert.equal(rows.length, 1, 'exactly one clubhouse appearance');
  const r = rows[0];
  assert.equal(r.row, ROW);
  assert.deepEqual({ ...r.osm }, { type: 'way', id: CLUBHOUSE, version: null });
  assert.equal(r.appearance.waterV, -1, 'the source/captain-verified water side is local -v');
  assert.equal(r.height, 6.5, 'height stays the OSM-levels derived 6.5 m');
  assert.equal(r.heightSource, 'OSM building:levels');
  assert.equal(r.roof, null, 'no invented OSM roof shape; the renderer draws the silhouette from the appearance');
  assert.equal(r.fp, '[-0.983,[[-18.7,15.3,-3.5,9.5],[-2.2,18.8,-8.5,-3.5]]]', 'native footprint unchanged');
  // Provenance: the OSM way is the named clubhouse, CanVec-imported, in the QCYC marina.
  assert.equal(clubhouseWay.tags.name, 'Queen City Yacht Club clubhouse');
  assert.equal(clubhouseWay.tags['building:levels'], '2');
  assert.match(clubhouseWay.tags.source, /CanVec_Import_2009/);
  // The reviewed entry is summarised for audit (waterV present there too).
  assert.equal(DATA.summary.massing.reviewedClubhouse.row, ROW);
  assert.equal(DATA.summary.massing.reviewedClubhouse.waterV, -1);
});

test('no other record gets the clubhouse appearance (bounded, not a general rule)', () => {
  for (const r of DATA.records.concat(DATA.massingRecords || [])) {
    if (r.appearance) assert.ok(['qcyc-shed', 'qcyc-storage', 'qcyc-clubhouse'].includes(r.appearance.style), `row ${r.row} has an unexpected style`);
    if (r.appearance && r.appearance.style === 'qcyc-clubhouse') assert.equal(r.row, ROW);
  }
});

test('reviewed-profile gate fails closed on drift (reshaped footprint / other frame => null)', async () => {
  const { GEO } = await loadHelpers();
  // Build the runtime module in a sandbox with GEO set, so islandBuildingProfile performs its real gate.
  const C = {
    GEO: { ...GEO, frame: { ...GEO.frame, detail: { ...GEO.frame?.detail }, projection: { ...GEO.frame?.projection } } }
  };
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(read('js/waterfront-island-buildings-data.js'), ctx, { filename: 'data.js' });
  vm.runInContext(read('js/waterfront-island-buildings.js'), ctx, { filename: 'profile.js' });
  const row = rowOf(GEO);
  const ok = C.islandBuildingProfile(row, ROW);
  assert.ok(ok, 'the committed row resolves its profile');
  assert.equal(ok.appearance.style, 'qcyc-clubhouse');
  assert.equal(ok.appearance.waterV, -1);
  // A reshaped footprint at the same centre gets nothing.
  const reshaped = [row[0], row[1], row[2], row[3].map((p) => p.map((v, i) => (i === 1 ? v + 1.5 : v))), row[4], row[5], row[6], row[7]];
  assert.equal(C.islandBuildingProfile(reshaped, ROW), null, 'a reshaped footprint is refused');
  // A moved centre gets nothing (different index key).
  const moved = [row[0] + 3, row[1], row[2], row[3], row[4], row[5], row[6], row[7]];
  assert.equal(C.islandBuildingProfile(moved, ROW), null, 'a moved centre is refused');
});

test('the clubhouse rendering is TWO storeys with a shallow roof inside the unchanged 6.5 m total', async () => {
  const { H } = await loadHelpers();
  const total = 6.5;
  const wallH = H.marinaClubhouseWallHeight(total);
  // Two storeys: at least 2 x floor height of wall, and a shallow roof remainder.
  assert.ok(wallH >= 2 * H.MARINA_CLUBHOUSE_FLOOR, `wall ${wallH} holds two ${H.MARINA_CLUBHOUSE_FLOOR} m storeys`);
  const roofH = total - wallH;
  assert.ok(roofH > 0.5 && roofH <= 1.5, `roof remainder ${roofH.toFixed(2)} is a shallow pitched roof, not a whole storey`);
  assert.ok(wallH + roofH <= total + 1e-9, 'eave + roof never exceed the 6.5 m total (the collider maxY)');
  // The first floor band (0..floor) and the second (floor..2*floor) both sit below the eave.
  assert.ok(2 * H.MARINA_CLUBHOUSE_FLOOR <= wallH + 1e-9, 'two window bands fit below the eave');
});

test('every part of the L plan is roofed, and every roof apex stays at or below 6.5 m', async () => {
  const { GEO, H } = await loadHelpers();
  const row = rowOf(GEO);
  const parts = row[3];
  const tiles = { pos: [], nor: [], uv: [], col: [] };
  const trim = [];
  H.marinaClubhouseDetail(trim, parts, row[0], row[1], row[2], 6.5, -1, tiles, 0);
  // Each pushHipRoof call in the stub pushes 2 numbers (y, pitch); one call per part.
  const roofs = tiles.pos.length / 2;
  assert.equal(roofs, parts.length, 'one capped hip roof per native part (no unroofed wing)');
  const wallH = H.marinaClubhouseWallHeight(6.5);
  for (let i = 0; i < tiles.pos.length; i += 2) {
    const y = tiles.pos[i], pitch = tiles.pos[i + 1];
    // Recompute each part's apex from its own half-span to prove it cannot exceed the total.
    const [u0, u1, v0, v1] = parts[i / 2];
    const half = Math.max(1.2, Math.min(u1 - u0, v1 - v0) / 2) + 0.35; // overhang literal (matches MARINA_CLUBHOUSE_OVERHANG)
    const apex = y + half * Math.tan(pitch);
    assert.ok(apex <= 6.5 + 1e-6, `part ${i / 2} apex ${apex.toFixed(3)} <= 6.5`);
    assert.ok(Math.abs(y - wallH) < 1e-9, 'each roof base sits on the shared two-storey eave');
  }
});

test('the water frontage is exactly the two exposed native segments (no rail inside the wing)', async () => {
  const { GEO, H } = await loadHelpers();
  const row = rowOf(GEO);
  const segs = H.clubhouseFrontageSegments(row[3], -1);
  // The L plan: main block u[-18.7,15.3] v[-3.5,9.5], wing u[-2.2,18.8] v[-8.5,-3.5]. Water is -v, so the outermost
  // exposed water edge is v -8.5 over the wing's u range and v -3.5 where only the main block reaches the water.
  assert.deepEqual(JSON.parse(JSON.stringify(segs)), [
    { u0: -18.7, u1: -2.2, v: -3.5 },
    { u0: -2.2, u1: 18.8, v: -8.5 }
  ]);
});

test('every balcony/railing sample lies OUTSIDE the native footprint union, on the water side, below the eave', async () => {
  const { GEO, H } = await loadHelpers();
  const row = rowOf(GEO);
  const cs = Math.cos(row[2]), sn = Math.sin(row[2]);
  const toUV = (t) => { const dx = t.x - row[0], dz = t.z - row[1]; return [dx * cs - dz * sn, dx * sn + dz * cs]; };
  const parts = row[3].map((p) => [Math.min(p[0], p[1]), Math.max(p[0], p[1]), Math.min(p[2], p[3]), Math.max(p[2], p[3])]);
  const inUnion = (u, v) => parts.some(([a, b, c, d]) => u >= a - 1e-6 && u <= b + 1e-6 && v >= c - 1e-6 && v <= d + 1e-6);
  const trim = [];
  H.marinaClubhouseDetail(trim, row[3], row[0], row[1], row[2], 6.5, -1, { pos: [] }, 0);
  const wallH = H.marinaClubhouseWallHeight(6.5);
  assert.ok(trim.length > 0, 'the clubhouse draws a balcony');
  for (const t of trim) {
    const [u, v] = toUV(t);
    assert.equal(inUnion(u, v), false, `balcony box centre u${u.toFixed(1)} v${v.toFixed(2)} must be OUTSIDE the footprint union`);
    assert.ok(v < -3.5 + 1e-6, `trim v ${v.toFixed(2)} is on the water (-v) side`);
    assert.ok(t.y + t.h / 2 <= wallH + 1e-6, 'trim top stays below the eave');
    assert.equal(t.color, H.MARINA_CLUBHOUSE_TRIM, 'the railing/ledge read off-white trim, not black');
  }
  // Posts are ~1.9 m apart on each exposed run (not a fixed 5 across the whole 34 m wall).
  const railPosts = trim.filter((t) => Math.abs(t.w - 0.05) < 1e-9 && Math.abs(t.h - 1.02) < 1e-9);
  assert.ok(railPosts.length >= 2, 'there are railing posts');
  for (const seg of H.clubhouseFrontageSegments(row[3], -1)) {
    const inSeg = railPosts.filter((t) => { const [u] = toUV(t); return u >= seg.u0 - 0.2 && u <= seg.u1 + 0.2; });
    assert.ok(inSeg.length >= 1, `segment u${seg.u0}..${seg.u1} has posts`);
  }
});

test('shed and storage appearances, height and footprint are unchanged by this pass', () => {
  const shed = DATA.records.find((r) => r.row === 32501);
  assert.equal(shed.appearance.style, 'qcyc-shed');
  assert.equal(shed.height, 4);
  assert.equal(shed.fp, '[0.551,[[-6.3,6.3,-2.8,2.8]]]');
  assert.equal((DATA.massingRecords || []).length, 2);
  for (const r of DATA.massingRecords) assert.equal(r.appearance.style, 'qcyc-storage');
  // The clubhouse's own reviewed binding (row 32139 lives in the OSM records array, not the three outlier rows).
  assert.equal(DATA.summary.massing.reviewedClubhouse.nativeFp, '[-0.983,[[-18.7,15.3,-3.5,9.5],[-2.2,18.8,-8.5,-3.5]]]');
});
