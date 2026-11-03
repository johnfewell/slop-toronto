// Ontario Place's pods & bridges found in the City's massing (js/ontario-place-pods.js), run on the real data
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = { window: { CITY: {} } };
vm.createContext(context);
for (const file of ['../js/toronto-landmarks.js', '../js/ontario-place-pods.js']) {
  vm.runInContext(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), context);
}
const { ontarioPodLayout, OntarioPodGeometry: G, LANDMARK_MESHES } = context.window.CITY;
const decode = (b64, Type) => { const b = Buffer.from(b64, 'base64'); return new Type(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const mesh = LANDMARK_MESHES.cinesphere;
const pos = decode(mesh.positions, Float32Array), idx = decode(mesh.indices, Uint32Array);
const SITE = { x: -3461.7, z: 1002.6 }; // the Cinesphere's (GEO.landmarks.cinesphere)
const L = ontarioPodLayout(pos, idx, SITE);

test('five square pods of about 88 ft, turned alike, apart from each other and the Cinesphere', () => {
  assert.equal(L.pods.length, 5);
  for (const p of L.pods) {
    assert.ok(p.half * 2 > 26 && p.half * 2 < 32, `side ${(p.half * 2).toFixed(1)} m`);
    assert.ok(Math.hypot(p.x - SITE.x, p.z - SITE.z) > 45, 'clear of the Cinesphere');
  }
  const ang = L.pods.map((p) => p.ang);
  assert.ok(Math.max(...ang) - Math.min(...ang) < (3 * Math.PI) / 180, 'all turned the same way');
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
    const a = L.pods[i], b = L.pods[j];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > a.half + b.half, 'pods do not overlap');
  }
  assert.ok(Math.abs(L.top - 18.43) < 0.05, 'the massing roof height');
});

test('the roof is kept: pods + strips + scraps + the Cinesphere disc add up to the massing outline', () => {
  let roof = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    if (v.some((a) => pos[a + 1] < L.top - 0.5)) continue;
    roof += Math.abs(G.polyArea(v.map((a) => [pos[a], pos[a + 2]])));
  }
  const pieces = L.pieces.reduce((s, p) => s + Math.abs(G.polyArea(p.pts)), 0);
  const pods = L.pods.reduce((s, p) => s + 4 * p.half * p.half, 0);
  // pods and the drawn pieces never overlap (the pieces are cut out of them) and stay inside the outline
  assert.ok(pieces + pods <= roof + 1, `${pieces.toFixed(0)} + ${pods.toFixed(0)} <= ${roof.toFixed(0)}`);
  // what is dropped (the disc ~1290 m², the slivers & scraps) stays small
  assert.ok(roof - pieces - pods < 1700, `dropped ${(roof - pieces - pods).toFixed(0)} m²`);
  for (const p of L.pieces) {
    const [x, z] = p.pts.reduce((s, q) => [s[0] + q[0] / p.pts.length, s[1] + q[1] / p.pts.length], [0, 0]);
    for (const pod of L.pods) {
      const cs = Math.cos(pod.ang), sn = Math.sin(pod.ang);
      const u = (x - pod.x) * cs - (z - pod.z) * sn, v = (x - pod.x) * sn + (z - pod.z) * cs;
      assert.ok(Math.max(Math.abs(u), Math.abs(v)) >= pod.half - 1e-6, 'no piece inside a pod');
    }
  }
});

test('bridges to the shore & the islands end in stair towers; the Cinesphere has three ramps', () => {
  const bridges = L.strips.filter((s) => s.kind === 'bridge'), ramps = L.strips.filter((s) => s.kind === 'ramp');
  assert.equal(ramps.length, 3);
  for (const r of ramps) assert.ok(r.width < 2.6);
  // the entrance bridge from the mainland: the longest, ~90 m, one free end
  const entrance = bridges.reduce((a, b) => (b.length > a.length ? b : a));
  assert.ok(entrance.length > 80 && entrance.ends.filter((e) => e.free).length === 1);
  assert.ok(entrance.piers.length >= 3, 'piers along it');
  const free = bridges.flatMap((b) => b.ends.filter((e) => e.free));
  assert.ok(free.length >= 5 && free.length <= 9, `${free.length} stair towers`);
  // every wall & piece belongs to a kept strip
  for (const w of L.walls) assert.ok(L.strips[w.part] && L.strips[w.part].kind !== 'scrap');
  for (const p of L.pieces) assert.ok(L.strips[p.part] && L.strips[p.part].kind !== 'scrap');
});

test('convex subtraction & segment clipping', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const cut = G.squareEdges({ x: 5, z: 5, ang: 0, half: 2 });
  const pieces = G.subtractConvex(square, cut);
  const area = pieces.reduce((s, p) => s + Math.abs(G.polyArea(p)), 0);
  assert.ok(Math.abs(area - 84) < 1e-6);
  const segs = G.segmentOutside([0, 5], [10, 5], cut);
  assert.equal(JSON.stringify(segs.map(([a, b]) => [a[0], b[0]])), "[[0,3],[7,10]]"); // (arrays from the vm context)
  assert.equal(G.segmentOutside([0, 0], [10, 0], cut).length, 1);
});
