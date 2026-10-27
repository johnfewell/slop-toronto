const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/traffic.js'), 'utf8');
const body = (name) => source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`))[0];
function harness(yaw = 0) {
  const movers = [{ x: Math.sin(yaw) * 7.6, z: Math.cos(yaw) * 7.6, y: 0, yaw: yaw + Math.PI, halfL: 3.3, halfW: 1.27, speed: 0 }];
  const api = vm.runInNewContext(`${body('obstacleGap')}\n${body('brake')}\n${body('laneAcc')}\n${body('laneSafe')}\n${body('changeLanes')}\n({ obstacleGap, laneAcc, laneSafe, changeLanes })`, {
    movers, moverGap: {}, LOOKAHEAD: 100, freeAcc: () => 2, ahead: () => null, playerGap: () => Infinity,
    player: { halfL: 0, halfW: 0 }, stopLane: () => -1
  });
  const v = { x: 0, z: 0, y: 0, yaw, half: 2.3, halfWidth: 0.92, driver: { a: 2, b: 3, s0: 2, T: 1 },
    speed: 0, dl: 0, wait: 8, lane: 0, s: 97.7, conn: null, commit: null, pRight: 100, pAhead: 100,
    move: { out: [0, 1], turn: 'S' }, edge: { lanes: [0, 3.5], occ: [[], []], len: 100, tram: true } };
  return { api, v, movers };
}

test('lane evaluation sees the tram in the shared lane and the clear curb lane at every heading', () => {
  for (const angle of [0, 0.7, Math.PI / 2, Math.PI, -1.3]) {
    const { api, v } = harness(angle);
    assert.ok(api.obstacleGap(v).gap < 2.1);
    assert.equal(api.obstacleGap(v, 3.5).gap, Infinity);
    assert.ok(api.laneAcc(v, 1) > api.laneAcc(v, 0) + 0.6);
    api.changeLanes(v);
    assert.equal(v.lane, 1, 'a stopped straight-through car can make a safe lane change before its stop line');
  }
});

test('yielding out of the tram lane cannot merge into another tram or bypass a turn-only lane', () => {
  const { api, v, movers } = harness();
  movers.push({ ...movers[0], x: -3.5, z: 5.5 });
  assert.equal(api.laneSafe(v, 1, -3), false);
  api.changeLanes(v); assert.equal(v.lane, 0);
  movers.pop(); v.move.out[1] = -1;
  api.changeLanes(v); assert.equal(v.lane, 0);
});
