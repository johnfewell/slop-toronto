const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAudio() {
  const window = { CITY: { AudioSynthesis: {}, AudioEvents: {}, AudioToronto: {} } };
  const document = { hidden: false, currentScript: null };
  vm.runInNewContext(readFileSync(join(__dirname, '../js/audio-system.js'), 'utf8'), {
    window, document, location: { search: '' }, URLSearchParams
  });
  return { System: window.CITY.CityAudioSystem, document };
}
function harness() {
  const { System, document } = loadAudio();
  const player = { type: 'car' };
  const system = Object.create(System.prototype);
  const events = [];
  Object.assign(system, {
    ready: true, enabled: true, haveListener: true, master: {},
    listener: { x: 0, y: 0, z: 0 }, context: { currentTime: 10, state: 'running' },
    controllers: { getActiveEntity: () => player },
    collisionPairs: new WeakMap(), collisionSequence: 0, lastHorn: -Infinity,
    emit(kind, source, options) { events.push({ kind, source, options }); return true; }
  });
  const vehicle = { x: 0, y: 7.6, z: 0, yaw: 0, yawOffset: 0 };
  const impact = { a: player, b: vehicle, x: 0, y: 8.2, z: 0, speed: 10, kind: 'vehicle' };
  return { system, document, events, vehicle, impact };
}

test('struck drivers honk at their deck height and sustained contact stays quiet', () => {
  const h = harness();
  assert.equal(h.system.crash(h.impact), true);
  assert.deepEqual(h.events.map(e => e.kind), ['horn', 'crash']);
  assert.ok(Math.abs(h.events[0].source.y - 8.3) < 1e-9);
  assert.equal(h.events[0].source.id, h.vehicle);
  h.system.context.currentTime += 0.1;
  assert.equal(h.system.crash({ ...h.impact, a: h.impact.b, b: h.impact.a }), false);
  assert.equal(h.events.length, 2, 'pair order shares the contact gate');
  h.system.context.currentTime += 2;
  h.system.crash(h.impact);
  assert.equal(h.events.length, 4, 'a later distinct hit can sound again');
});

test('muted, hidden and world collisions never trigger a driver horn', () => {
  for (const mode of ['muted', 'hidden', 'world']) {
    const h = harness();
    if (mode === 'muted') h.system.enabled = false;
    if (mode === 'hidden') h.document.hidden = true;
    if (mode === 'world') h.impact.kind = 'building';
    h.system.crash(h.impact);
    assert.equal(h.events.some(e => e.kind === 'horn'), false);
  }
});
