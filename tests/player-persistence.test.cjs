const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('saving a transit/photo session retains its safe ground anchor and multiplayer privacy zone', () => {
  const main = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
  const start = main.indexOf('  function savePlayerState() {');
  const end = main.indexOf("\n  window.addEventListener('pagehide'", start);
  assert.ok(start >= 0 && end > start);
  const anchor = { x: 12, y: 0.22, z: 34, heading: 0.7 };
  const liveZone = { x: 400, z: 500, hidden: true }, restoredZone = { x: 600, z: 700, hidden: true };
  for (const multiplayer of [{ privateZone: liveZone }, null]) {
    let saved;
    vm.runInNewContext(main.slice(start, end) + '\nsavePlayerState();', {
      keepPlayerState: true, PLAYER_STATE_KEY: 'test-state', multiplayer, restoredPrivateZone: restoredZone,
      controllerManager: { activeMode: 'car', entities: { person: { position: { x: 90, y: 17, z: 91 }, heading: 2 } } },
      rideSession: { surfaceMode: 'person', savedGround: () => anchor }, subwayRide: { surfaceMode: 'cyclist' },
      localStorage: { setItem(key, value) { assert.equal(key, 'test-state'); saved = JSON.parse(value); } }
    });
    assert.equal(saved.activeMode, 'person');
    assert.deepEqual(saved.entities.person, anchor);
    assert.deepEqual(saved.privateZone, multiplayer ? liveZone : restoredZone);
  }
});
