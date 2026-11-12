// Jack Layton Ferry Terminal (js/waterfront-ferries.js): the measured terminal building, the mapped harbour finger
// piers, the ticket booths under their canopy, the three-route directory, and — importantly — the reusable route
// endpoint table for the islands followup. The tests check geometry against the loaded geodata and the harbour water
// mask, not that source strings merely exist. They also lock in the honest design: no invented slip→route assignment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';

const read = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');

// A minimal 2D canvas so the browser lettering path can be exercised in Node without a native canvas. It records the
// strings drawn and measures them by a fixed per-character width; CanvasTexture only ever stores the canvas.
function fakeDocument() {
  const drawn = [];
  const ctx = {
    font: '', textAlign: '', textBaseline: '', fillStyle: '',
    clearRect() {}, fillRect() {},
    fillText(text) { drawn.push(String(text)); },
    measureText(text) { return { width: String(text).length * 9 }; }
  };
  return {
    drawn,
    createElement(tag) {
      if (tag !== 'canvas') return null;
      const canvas = { width: 0, height: 0, getContext: () => ctx };
      ctx.canvas = canvas;
      return canvas;
    }
  };
}

const makeContext = (options = {}) => {
  const context = vm.createContext({
    window: { CITY: { THREE } }, console: { info() {}, log() {}, warn() {} },
    location: { search: '' }, URLSearchParams, Buffer, performance,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    ...(options.document ? { document: options.document } : {})
  });
  for (const file of ['toronto-geodata.js', 'high-park-data.js', 'don-valley.js', 'city-config.js', 'waterfront-ferries.js', 'waterfront-island-arrivals-data.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return context.window.CITY;
};
const C = makeContext();
const ROUTES = C.FERRY_ROUTES;
const LAYOUT = C.ferryLayout();
const scene = { added: [], add(object) { this.added.push(object); } };
const terminal = C.createWaterfrontFerries(THREE, scene);
const W = (x, z) => !!C.waterAt(x, z);

const buildingRecord = C.GEO.buildings.find((b) => b[b.length - 1] === 'Jack Layton Ferry Terminal');
const FRAME = C.terminalFrame();

// world point inside a geodata building record's part, using buildings.js's local frame convention
const partCentreWorld = (rec, part) => {
  const [cx, cz, ang] = rec;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const uc = (part[0] + part[1]) / 2, vc = (part[2] + part[3]) / 2;
  return [cx + uc * cs + vc * sn, cz - uc * sn + vc * cs];
};

test('the terminal building is built from the mapped geodata footprint and height', () => {
  assert.ok(buildingRecord, 'the geodata carries a Jack Layton Ferry Terminal building');
  const [cx, cz, ang, parts, h] = buildingRecord;
  assert.equal(FRAME.cx, cx);
  assert.equal(FRAME.cz, cz);
  assert.equal(FRAME.ang, ang);
  assert.equal(FRAME.height, h);
  assert.equal(FRAME.parts.length, parts.length);
  // all three mapped parts are modelled
  assert.equal(terminal.stats.terminalBoxes, parts.length);
  assert.equal(terminal.stats.terminalBoxes, 3);
  // the building straddles the mapped footprint: its bbox corners bracket the part centres
  for (const part of parts) {
    const [x, z] = partCentreWorld(buildingRecord, part);
    assert.ok(x > FRAME.bbox.x0 && x < FRAME.bbox.x1, `part centre x ${x.toFixed(1)} inside bbox`);
    assert.ok(z > FRAME.bbox.z0 && z < FRAME.bbox.z1, `part centre z ${z.toFixed(1)} inside bbox`);
    assert.ok(C.buildingReplacedAt(x, z), 'the replacement predicate covers each part centre');
  }
  // the building is on dry land, with harbour water just south of the quay front
  assert.equal(W(cx, cz), false, 'the terminal centre is not in the water');
  let southWater = false;
  for (let x = 240; x <= 320; x += 5) if (C.waterEdgeSouth(x, FRAME.bbox.z1, 40) !== null) { southWater = true; break; }
  assert.ok(southWater, 'there is harbour water south of the terminal front');
  // the predicate is false well away from the terminal
  assert.equal(C.buildingReplacedAt(0, 0), false);
});

test('the replacement predicate does not swallow open harbour between the fingers', () => {
  // a point in the central water channel south of the building must NOT be "replaced" as terminal building
  const central = LAYOUT.berths.find((b) => b.id === 'central-slip');
  assert.ok(central, 'a central water channel is mapped');
  const mx = (central.x0 + central.x1) / 2;
  assert.equal(W(mx, central.sampleZ), true, 'the central channel sample point is water');
  assert.equal(C.buildingReplacedAt(mx, central.sampleZ), false, 'open water is not replaced terminal massing');
});

test('the three routes resolve by name and carry the mapped island endpoints', () => {
  assert.deepEqual(Array.from(ROUTES, (r) => r.name), ["Ward's Island", 'Centre Island', "Hanlan's Point"]);
  for (const name of ["Ward's Island", 'Centre Island', "Hanlan's Point", 'Wards', 'centre island', 'hanlans']) {
    const r = C.routeByName(name);
    assert.ok(r, `routeByName("${name}") resolves`);
  }
  assert.equal(C.routeByName('Wards').id, 'ward');
  assert.equal(C.routeByName('Centre Island').id, 'centre');
  assert.equal(C.routeByName('Hanlan\u2019s Point').id, 'hanlans'); // curly apostrophe also accepted
  // each endpoint is recorded for the islands wave
  for (const r of LAYOUT.routes) {
    assert.ok(r.endpoint && Number.isFinite(r.endpoint.x) && Number.isFinite(r.endpoint.z), `${r.name} has an endpoint`);
  }
});

test('the three mainland route endpoints are the REAL OSM island terminals, not bike-share POIs', () => {
  const D = C.ISLAND_ARRIVALS_DATA;
  assert.ok(D, 'the islands wave has fetched the real OSM terminal geometry');
  const centroid = (ring) => {
    let x = 0, z = 0;
    for (const p of ring) { x += p[0]; z += p[1]; }
    return [x / ring.length, z / ring.length];
  };
  for (const r of ROUTES) {
    const d = D.docks[r.id];
    assert.ok(d, `${r.id} is in the OSM island data`);
    // the contract names the exact OSM feature it anchors on
    assert.equal(r.endpoint.osmType, d.osmType, `${r.id} osmType`);
    assert.equal(r.endpoint.osmId, d.osmId, `${r.id} osmId`);
    const ref = d.ring ? centroid(d.ring) : d.point;
    assert.ok(Math.abs(r.endpoint.x - ref[0]) < 0.01 && Math.abs(r.endpoint.z - ref[1]) < 0.01,
      `${r.id} endpoint (${r.endpoint.x}, ${r.endpoint.z}) is its OSM terminal centroid/point (${ref[0].toFixed(2)}, ${ref[1].toFixed(2)})`);
    // it is a ferry terminal, not a bicycle-rental station, and it is close to harbour water
    assert.notEqual((d.tags || {}).amenity, 'bicycle_rental', `${r.id} is not a bike station`);
    let nearestWater = Infinity;
    for (let dx = -120; dx <= 120; dx += 2) for (let dz = -120; dz <= 120; dz += 2) {
      if (W(r.endpoint.x + dx, r.endpoint.z + dz)) nearestWater = Math.min(nearestWater, Math.hypot(dx, dz));
    }
    assert.ok(nearestWater <= 70, `${r.id} terminal is within 70 m of water (${nearestWater.toFixed(0)} m)`);
    // the old invented "rejected duplicate" narrative is gone
    assert.equal(r.rejected, undefined, `${r.id} carries no invented rejected node`);
  }
});

test('the finger piers are the mapped land features, flanked by water', () => {
  assert.equal(LAYOUT.fingers.length, 2);
  assert.equal(terminal.stats.fingerPiers, 2);
  for (const p of LAYOUT.fingers) {
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    assert.equal(W(cx, cz), false, `${p.id} centre is land (a mapped finger, not water)`);
    // water immediately west and east of the finger at its mid-z (a slip channel either side or beside)
    const westWet = W(p.x0 - 3, cz), eastWet = W(p.x1 + 3, cz);
    assert.ok(westWet || eastWet, `${p.id} is flanked by harbour water`);
  }
  // the modelled finger/kerb instances do not float on water
  for (const mesh of terminal.group.children) {
    if (!mesh.isInstancedMesh) continue;
    const role = mesh.userData.role;
    if (role !== 'finger-piers' && role !== 'finger-kerbs') continue;
    const m = new THREE.Matrix4(), pos = new THREE.Vector3();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); pos.setFromMatrixPosition(m);
      assert.equal(W(pos.x, pos.z), false, `${role} instance ${i} sits on dry land`);
    }
  }
});

test('the water channels (berths) are mapped water and are NOT assigned to routes', () => {
  assert.ok(LAYOUT.berths.length >= 2, `at least the central and east channels are mapped (${LAYOUT.berths.length})`);
  for (const b of LAYOUT.berths) {
    const mx = (b.x0 + b.x1) / 2;
    assert.equal(W(mx, b.sampleZ), true, `${b.id} sample is harbour water`);
    assert.equal(b.route, null, `${b.id} is not assigned to a route (no source supports a mapping)`);
  }
  // no route object carries a slip/berth/gate field — the module refuses to guess the physical assignment
  for (const r of LAYOUT.routes) {
    for (const forbidden of ['slip', 'berth', 'gate', 'x', 'z', 'rejected', 'fare', 'price', 'timetable', 'schedule']) {
      assert.equal(r[forbidden], undefined, `route ${r.id} does not assert a physical ${forbidden}`);
    }
  }
});

test('the ticket block is four civic-blue paired-counter glass cabins, not sixteen solid boxes', () => {
  // the City's 2025 terminal plan (p.10) shows four paired-counter booths: counters 8/7, 6/5, 4/3, 2/1
  assert.equal(terminal.stats.ticketBooths, 4, 'four paired-counter booths, not a frontage division');
  assert.equal(terminal.stats.ticketCounters, 8, 'eight counters across the four paired cabins');
  // the counters, read across the block, are the plan's sunken labels and the inferred pairs 8/7, 6/5, 4/3, 2/1
  assert.equal(terminal.stats.boothPairs.length, 4);
  assert.deepEqual(Array.from(terminal.stats.counterLabels), [8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(terminal.stats.ticketCanopies, 1, 'one canopy partially covers the block');

  const byRole = (role) => terminal.group.children.find((m) => m.userData.role === role);
  for (const role of ['ticket-booth-curbs', 'ticket-booth-panels', 'ticket-booth-counters', 'ticket-booth-glass', 'ticket-booth-frames', 'ticket-booth-fascia']) {
    const mesh = byRole(role);
    assert.ok(mesh && mesh.isInstancedMesh, `${role} is an instanced cabin part`);
    assert.ok(mesh.count >= 4, `${role} serves all four cabins`);
  }
  // the glazing is see-through and spans waist-to-head height, not another solid wall box
  const glass = byRole('ticket-booth-glass');
  assert.equal(glass.material.transparent, true, 'the cabin glass is transparent');
  assert.ok(glass.material.opacity < 0.6, 'the glazing is clear, not a tinted solid');
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  glass.getMatrixAt(0, m); m.decompose(pos, quat, scl);
  assert.ok(pos.y > 1.2 && pos.y < 2.2, `glass centre ${pos.y.toFixed(2)} m is at waist-to-head height`);
  assert.ok(scl.y > 0.9, `glass band ${scl.y.toFixed(2)} m tall`);

  // every cabin part stands north of the building's north edge, on dry land (the source-backed entrance side)
  for (const mesh of terminal.group.children) {
    if (!mesh.isInstancedMesh || !String(mesh.userData.role).startsWith('ticket-booth-')) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); pos.setFromMatrixPosition(m);
      assert.equal(W(pos.x, pos.z), false, `${mesh.userData.role} instance ${i} is on dry land`);
      const [, v] = FRAME.worldToLocal(pos.x, pos.z);
      assert.ok(v < FRAME.localV[0], `${mesh.userData.role} instance ${i} is north of the building's north edge`);
    }
  }
  // the canopy also covers dry land
  const canopyMesh = terminal.group.children.find((m) => m.userData.role === 'ticket-canopy');
  canopyMesh.getMatrixAt(0, m); pos.setFromMatrixPosition(m);
  assert.equal(W(pos.x, pos.z), false, 'the ticket canopy is over dry land');
});

test('no ticket-booth or canopy part overlaps another geodata building (not the adjacent Westin)', () => {
  // a point-in-record test in the geodata's own frame (x = cx + u cos + v sin, z = cz - u sin + v cos)
  const inRecord = (x, z, rec) => {
    const [cx, cz, ang, parts] = rec;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const dx = x - cx, dz = z - cz;
    const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
    return parts.some(([u0, u1, v0, v1]) => u >= u0 && u <= u1 && v >= v0 && v <= v1);
  };
  const terminalRecord = buildingRecord;
  const others = C.GEO.buildings.filter((b) => b !== terminalRecord);
  const othersAt = (x, z) => others.find((b) => inRecord(x, z, b)) || null;
  // the provisional anchor itself is clear, and the row is north of the terminal's north edge
  const anchor = C.FERRY_BOOTH_ANCHOR;
  assert.ok(anchor && Number.isFinite(anchor.u) && Number.isFinite(anchor.v), 'the module exposes its booth anchor');
  const [ax, az] = FRAME.localToWorld(anchor.u, anchor.v);
  assert.equal(!!othersAt(ax, az), false, 'the booth anchor is not inside another building');
  assert.ok(FRAME.worldToLocal(ax, az)[1] < FRAME.localV[0], 'the anchor is north of the terminal');
  // every cabin part: its centre and its four footprint corners avoid every non-terminal building
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  for (const mesh of terminal.group.children) {
    if (!mesh.isInstancedMesh || !String(mesh.userData.role).startsWith('ticket-booth-')) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); m.decompose(pos, quat, scl);
      const hx = scl.x / 2, hz = scl.z / 2;
      for (const [dx, dz] of [[0, 0], [-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) {
        const wx = pos.x + dx * Math.cos(quat.y) + dz * Math.sin(quat.y);
        const wz = pos.z - dx * Math.sin(quat.y) + dz * Math.cos(quat.y);
        const hit = othersAt(wx, wz);
        assert.equal(hit, null, `${mesh.userData.role} instance ${i} overlaps ${hit && hit[hit.length - 1]}`);
      }
    }
  }
  // the canopy and its columns avoid other buildings too (they may sit under the terminal's own part)
  for (const mesh of terminal.group.children) {
    if (!mesh.isInstancedMesh) continue;
    const role = mesh.userData.role;
    if (!['ticket-canopy', 'ticket-canopy-rib', 'canopy-posts', 'ticket-canopy-beam', 'ticket-canopy-fascia'].includes(role)) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); pos.setFromMatrixPosition(m);
      const hit = othersAt(pos.x, pos.z);
      assert.equal(hit, null, `${role} instance ${i} overlaps ${hit && hit[hit.length - 1]}`);
    }
  }
});

test('the canopy is a shallow corrugated roof on silver columns and dark-blue beams, titled with the real name', () => {
  assert.equal(terminal.stats.terminalName, 'JACK LAYTON FERRY TERMINAL');
  const byRole = (role) => terminal.group.children.find((m) => m.userData.role === role);
  const roof = byRole('ticket-canopy');
  assert.ok(roof && roof.isInstancedMesh && roof.count === 1, 'one shallow canopy roof');
  // the roof's long axis spans the booth row (many metres) and its fall is shallow (a few degrees)
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  roof.getMatrixAt(0, m); m.decompose(pos, quat, scl);
  assert.ok(scl.x > 8 && scl.z > 4, `canopy roof ${scl.x.toFixed(1)} x ${scl.z.toFixed(1)} m over the row`);
  const e = new THREE.Euler().setFromQuaternion(quat);
  assert.ok(Math.abs(e.x) > 0.02 && Math.abs(e.x) < 0.25, `shallow ${(e.x * 180 / Math.PI).toFixed(1)}° slope`);
  // its north (entrance) edge is the low one, so it falls toward the approach
  const northEdge = new THREE.Vector3(0, 0, -scl.z / 2).applyQuaternion(quat).add(pos);
  const southEdge = new THREE.Vector3(0, 0, scl.z / 2).applyQuaternion(quat).add(pos);
  assert.ok(northEdge.y < southEdge.y, 'the canopy falls toward the north entrance');
  // corrugated sheet ribs, dark-blue steel beams, silver round columns, a cream fascia beam
  const ribs = byRole('ticket-canopy-rib');
  assert.ok(ribs && ribs.count >= 4, 'the sheet carries shallow corrugation ribs');
  const beams = byRole('ticket-canopy-beam');
  assert.ok(beams && beams.count >= 5, 'dark-blue steel beams under the roof');
  const posts = byRole('canopy-posts');
  assert.ok(posts && posts.count === 4, 'four silver round columns');
  assert.equal(posts.geometry.type, 'CylinderGeometry', 'the columns are round, not square posts');
  const fascia = byRole('ticket-canopy-fascia');
  assert.ok(fascia && fascia.count === 1, 'the cream fascia beam over the north entrance edge');
});

test('a single three-panel route directory names all three routes near the entrance', () => {
  assert.equal(terminal.stats.directoryPanels, 3);
  const dirMesh = terminal.group.children.find((m) => m.userData.role === 'route-directory');
  assert.equal(dirMesh.count, 3, 'three colour panels, one per route');
  const points = terminal.stats.routeSignPoints;
  assert.equal(points.length, 3);
  assert.deepEqual(Array.from(points, (p) => p.routeId), ['ward', 'centre', 'hanlans']);
  for (const p of points) {
    assert.equal(W(p.x, p.z), false, `${p.name} directory point is on dry land`);
    const [, v] = FRAME.worldToLocal(p.x, p.z);
    assert.ok(v < FRAME.localV[0], 'the directory is north of the building, near the entrance');
  }
  // in a headless context (no document) the lettering degrades gracefully: no label plane, no throw
  assert.equal(terminal.stats.textTextures, 0, 'no CanvasTexture without a document');
  assert.ok(!terminal.group.children.some((m) => m.userData.role === 'canopy-title'), 'no title plane headless');
});

test('with a document the canopy title and route names are legible texture planes', () => {
  // the shipped page has a document: the shared atlas and four label planes are built, lettered with real words
  const doc = fakeDocument();
  const D = makeContext({ document: doc });
  const scene2 = { added: [], add(o) { this.added.push(o); } };
  const r = D.createWaterfrontFerries(THREE, scene2);
  assert.equal(r.stats.textTextures, 1, 'one shared label atlas');
  assert.ok(doc.drawn.includes('JACK LAYTON FERRY TERMINAL'), 'the canopy title is drawn');
  for (const route of ["Ward's Island", 'Centre Island', "Hanlan's Point"]) assert.ok(doc.drawn.includes(route), `the atlas has ${route}`);
  const labels = r.group.children.filter((m) => m.userData.role === 'canopy-title' || String(m.userData.role).startsWith('directory-label:'));
  assert.equal(labels.length, 4, 'the title and the three route names');
  for (const label of labels) {
    assert.ok(label.isMesh && !label.isInstancedMesh, `${label.userData.role} is a label plane`);
    assert.ok(label.material.map && label.material.transparent, `${label.userData.role} samples the atlas`);
    assert.ok(label.geometry.attributes.uv, `${label.userData.role} carries atlas-row UVs`);
    assert.equal(label.castShadow, false);
    assert.equal(label.userData.cullDistance, 700);
  }
  // the title plane is on the canopy's street (north) face; each directory label sits at its panel's height
  const title = labels.find((m) => m.userData.role === 'canopy-title');
  const [, titleV] = D.terminalFrame().worldToLocal(title.position.x, title.position.z);
  assert.ok(titleV < D.terminalFrame().localV[0], 'the canopy title faces the north entrance');
  const routeIds = labels.filter((m) => String(m.userData.role).startsWith('directory-label:')).map((m) => m.userData.role.split(':')[1]);
  assert.deepEqual(routeIds.sort(), ['centre', 'hanlans', 'ward']);
  // no invented prices or timetables are drawn anywhere
  assert.ok(!doc.drawn.some((t) => /[$£]|\b(?:fare|price|timetable|departure)\b/i.test(t)), 'no invented fares/timetables');
});

test('the built terminal: one culling root, instanced parts, colliders, sane triangles', () => {
  assert.equal(scene.added.length, 1);
  assert.equal(terminal.group.name, 'WaterfrontFerries');
  assert.equal(terminal.root, terminal.group);
  assert.equal(terminal.group.userData.waterfrontFerries, terminal.stats);
  assert.equal(terminal.stats.meshes, terminal.group.children.length);
  // the measured building parts become solid colliders (one per modelled box)
  assert.equal(terminal.stats.colliders, terminal.stats.terminalBoxes);
  for (const c of terminal.colliders) {
    assert.equal(c.kind, 'ferryterminal');
    assert.ok(c.maxY > c.minY);
    assert.ok(Array.isArray(c.polygon) && c.polygon.length === 4);
  }
  assert.ok(terminal.stats.triangles > 200 && terminal.stats.triangles < 20000, `${terminal.stats.triangles} triangles`);
  assert.ok(terminal.stats.slips === undefined, 'no invented per-route slips are reported');
});

test('instanced parts carry culling metadata and no mesh floats over open harbour water', () => {
  const m = new THREE.Matrix4(), pos = new THREE.Vector3();
  for (const mesh of terminal.group.children) {
    assert.ok(Number.isFinite(mesh.userData.cullDistance), `${mesh.name} has a cullDistance`);
    assert.ok(Number.isFinite(mesh.userData.cullCell), `${mesh.name} has a cullCell`);
    if (!mesh.isInstancedMesh) continue;
    // every role except an intentional water structure must not be wet; this module has none over water
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); pos.setFromMatrixPosition(m);
      assert.equal(W(pos.x, pos.z), false, `${mesh.userData.role} instance ${i} is not over water`);
    }
  }
});

test('the module exports the reusable ferry contract for the islands wave', () => {
  assert.ok(Array.isArray(C.FERRY_ROUTES) && C.FERRY_ROUTES.length === 3);
  for (const fn of ['terminalFrame', 'ferryLayout', 'routeByName', 'buildingReplacedAt', 'waterEdgeSouth', 'createWaterfrontFerries']) {
    assert.equal(typeof C[fn], 'function', `C.${fn} is exported`);
  }
  assert.equal(C.waterfrontFerriesEnabled, true);
  assert.equal(C.waterfrontFerries, terminal);
  // the layout carries routes, endpoints, berths and the measured fingers for the next wave
  assert.ok(LAYOUT.routes.length === 3 && LAYOUT.berths.length >= 2 && LAYOUT.fingers.length === 2);
});