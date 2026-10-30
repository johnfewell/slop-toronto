const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
function productionFunction(name, context) {
  const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, `${name} is present`);
  return vm.runInNewContext(`(${match[0].trim()})`, context);
}

for (const [hasView, inView, draw] of [[true, false, false], [true, true, true], [false, false, true]]) {
  test(`pedestrian gait advances within 50 m; pose generation follows drawing (${hasView}, ${inView})`, () => {
    let args, drawn = 0;
    const ped = { x: 10, z: 20, ux: 0, uz: 1, dir: 1, dodge: 0, dodgeTarget: 0, diveStart: -Infinity,
      rig: { update(...values) { args = values; } } };
    const renderPed = productionFunction('renderPed', {
      hasView, visible: () => inView, pedGround: () => 0, focusX: 0, focusZ: 0, clock: 0, PEDESTRIAN_DIVE_DURATION: 2.5,
      pedCrowd: { add(rig) { assert.equal(rig, ped.rig); drawn++; } }
    });
    renderPed(ped, 1 / 60);
    assert.equal(args[0], 1 / 60);
    assert.equal(args[1], ped.x);
    assert.equal(args[2], ped.z);
    assert.equal(args[5], ped);
    assert.equal(args[7], draw);
    assert.equal(args[8], -1);
    assert.equal(drawn, draw ? 1 : 0);
  });
}

test('hidden pedestrians finish their dive without drawing or changing the escape heading', () => {
  let args;
  const ped = { x: 10, z: 20, ux: 0, uz: 1, dir: 1, dodge: 1.8, dodgeTarget: 1.8,
    diveStart: 9.5, diveHeading: Math.PI / 2, rig: { update(...values) { args = values; } } };
  const context = {
    hasView: true, visible: () => false, pedGround: () => 0, focusX: 0, focusZ: 0,
    clock: 10, PEDESTRIAN_DIVE_DURATION: 2.5,
    pedCrowd: { add() { assert.fail('hidden pedestrians must not be drawn'); } }
  };
  const renderPed = productionFunction('renderPed', context);
  renderPed(ped, 1 / 60);
  assert.equal(args[3], ped.diveHeading);
  assert.equal(args[7], false);
  assert.equal(args[8], 0.5);
  context.clock = 12;
  renderPed(ped, 1 / 60);
  assert.equal(args[3], 0);
  assert.equal(args[7], false);
  assert.equal(args[8], -1);
});

// Upstream 1fe128d: a hidden person more than 50 m from the focus skips its gait and re-plants on its next update.
test('hidden pedestrians beyond 50 m skip their gait unless diving; visible ones still walk and draw', () => {
  const calls = [];
  let drawn = 0;
  const context = {
    hasView: true, inView: false, pedGround: () => 0, focusX: 0, focusZ: 0, clock: 10, PEDESTRIAN_DIVE_DURATION: 2.5,
    pedCrowd: { add(rig, distance) { drawn++; calls.push(['draw', distance]); } }
  };
  context.visible = () => context.inView;
  const renderPed = productionFunction('renderPed', context);
  const ped = { x: 30, z: 40.01, ux: 0, uz: 1, dir: 1, dodge: 0, dodgeTarget: 0, diveStart: -Infinity,
    rig: { placed: true, update(...values) { calls.push(['update', values[7]]); } } };
  renderPed(ped, 1 / 60);
  assert.deepEqual(calls, [], 'no gait work for a hidden person 50.01 m away');
  assert.equal(ped.rig.placed, false, 'its feet are re-planted when it next updates');
  ped.z = 39.99; ped.rig.placed = true;
  renderPed(ped, 1 / 60);
  assert.deepEqual(calls, [['update', false]], 'within 50 m a hidden person still advances its gait');
  assert.equal(ped.rig.placed, true);
  calls.length = 0; ped.z = 400; ped.diveStart = 9.5;
  renderPed(ped, 1 / 60);
  assert.deepEqual(calls, [['update', false]], 'a hidden dive always finishes');
  calls.length = 0; ped.diveStart = -Infinity; context.inView = true;
  renderPed(ped, 1 / 60);
  assert.equal(calls[0][0], 'update'); assert.equal(calls[0][1], true);
  assert.equal(drawn, 1); assert.ok(Math.abs(calls[1][1] - Math.hypot(30, 400)) < 1e-9, 'drawn with its focus distance');
});

test('a real rig whose gait was skipped re-plants where it reappears', async () => {
  const THREE = await import('three');
  const window = { CITY: { THREE, TSL: {}, Addons: {} } };
  vm.runInNewContext(readFileSync(join(__dirname, '../js/pedestrians.js'), 'utf8'), { window, Math });
  const rig = new window.CITY.PersonRig({ seed: 0.4 });
  const ground = () => 0.22;
  for (let f = 0; f < 60; f++) rig.update(1 / 60, 0, f / 60 * 1.3, 0, ground, null, 0, true);
  rig.placed = false; // skipped while it walked 0.8 m further out of sight
  rig.update(1 / 60, 0, 2.1, 0, ground, null, 0, true);
  assert.equal(rig.placed, true);
  assert.equal(rig.x, 0); assert.equal(rig.z, 2.1);
  for (const foot of rig.feet) {
    assert.ok(Math.hypot(foot.px - rig.x, foot.pz - rig.z) < 0.3, 'both feet stand under the body');
    assert.equal(foot.py, 0.22); assert.equal(foot.swing, false);
  }
  assert.ok(rig.pose.every(Number.isFinite));
});

function sparkHarness(updates = 3) {
  const sparks = Array.from({ length: 120 }, () => ({ life: 0 }));
  const writes = [];
  const zero = { zero: true };
  const dummy = { matrix: {} };
  for (const key of ['position', 'rotation', 'scale']) dummy[key] = { set(...values) { dummy.matrix[key] = values; } };
  dummy.updateMatrix = () => {};
  let uploads = 0, range = 0;
  const attr = {
    itemSize: 16,
    clearUpdateRanges() { range = 0; },
    addUpdateRange(offset, count) { assert.equal(offset, 0); range = count; },
    set needsUpdate(value) { if (value) uploads++; }
  };
  const sparkInst = {
    instanceMatrix: attr,
    setMatrixAt(index, matrix) { writes.push({ index, matrix: JSON.parse(JSON.stringify(matrix)) }); }
  };
  const context = { MAX_SPARKS: 120, sparks, sparkInst, dummy, zero, updates };
  const flag = productionFunction('flagRange', {});
  context.flagRange = flag;
  return {
    sparks, writes, sparkInst,
    update: productionFunction('updateSparks', context),
    uploads: () => uploads,
    range: () => range
  };
}

test('idle collision sparks write and upload nothing after warm-up', () => {
  const h = sparkHarness();
  for (let frame = 0; frame < 60; frame++) h.update(1 / 60);
  assert.equal(h.writes.length, 0);
  assert.equal(h.uploads(), 0);
  assert.equal(h.sparkInst.count, 0);
  assert.equal(h.sparkInst.visible, false);
});

for (const frame of [1, 2]) {
  test(`spark shader warm-up keeps one degenerate visible instance on frame ${frame}`, () => {
    const h = sparkHarness(frame);
    h.update(1 / 60);
    assert.deepEqual(h.writes, [{ index: 0, matrix: { zero: true } }]);
    assert.equal(h.sparkInst.count, 1);
    assert.equal(h.sparkInst.visible, true);
    assert.equal(h.range(), 16);
  });
}

test('live sparks preserve motion, bounce and fade while packing only live matrices', () => {
  const h = sparkHarness();
  h.sparks[13] = { x: 2, y: 0.04, z: 3, vx: 1, vy: -2, vz: 4, life: 0.1, maxLife: 0.4 };
  h.sparks[80] = { x: 0, y: 2, z: 0, vx: 0, vy: 3, vz: 0, life: 0.2, maxLife: 0.4 };
  h.update(0.05);
  const bounced = h.sparks[13];
  assert.equal(bounced.x, 2.05);
  assert.equal(bounced.y, 0.03);
  assert.equal(bounced.z, 3.2);
  assert.equal(bounced.vx, 0.78);
  assert.equal(bounced.vz, 3.12);
  assert.ok(Math.abs(bounced.vy - 1.395) < 1e-12);
  assert.ok(Math.abs(h.sparks[80].y - 2.095) < 1e-12);
  assert.deepEqual(h.writes.map((write) => write.index), [0, 1]);
  assert.deepEqual(h.writes[0].matrix.position, [2.05, 0.03, 3.2]);
  assert.equal(h.writes[0].matrix.scale[0], 0.125);
  assert.equal(h.writes[0].matrix.scale[1], 0.125);
  assert.equal(h.sparkInst.count, 2);
  assert.equal(h.range(), 32);
  assert.equal(h.uploads(), 1);
  // An expiring particle retains the original zero-life fade on its last simulated frame, then disappears.
  h.update(0.2);
  assert.equal(h.sparkInst.count, 2);
  assert.equal(h.writes.at(-1).matrix.scale[0], 0);
  const uploads = h.uploads();
  h.update(1 / 60);
  assert.equal(h.sparkInst.count, 0);
  assert.equal(h.sparkInst.visible, false);
  assert.equal(h.uploads(), uploads);
});
