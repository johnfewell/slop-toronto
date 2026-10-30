import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('live responses update freshness but publish only the newest pose after a hold, with stale fallback', async () => {
  let now = 1000000, seq = 0;
  const timers = [], published = [];
  const window = { CITY: { TRANSIT: {}, worldFromLatLon: (x, z) => ({ x, z }) } };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(fs.readFileSync(new URL('../js/transit-live.js', import.meta.url), 'utf8'), {
    window, location: { search: '', protocol: 'http:' }, document: { hidden: false, addEventListener() {} }, Date: Clock,
    console: { info() {} }, setTimeout(fn) { timers.push(fn); return timers.length; },
    fetch: async () => ({ ok: true, json: async () => ({ t: now / 1000, v: [['504', 0, ++seq, 2, -1, now / 1000, 'ttc-1']] }) })
  });
  const T = window.CITY.TRANSIT;
  T.onLive((live) => published.push(JSON.parse(JSON.stringify(live))));
  T.setPresentationHeld(true);
  await timers.shift()(); now += 20000; await timers.shift()();
  assert.equal(published.length, 0);
  assert.equal(T.live.polls, 2); assert.equal(T.live.at, now); assert.equal(T.live.vehicles[0].x, 2);
  T.setPresentationHeld(false); T.setPresentationHeld(false);
  assert.equal(published.length, 1); assert.equal(published[0].vehicles[0].x, 2);
  T.setPresentationHeld(true); await timers.shift()(); now += 100000;
  T.setPresentationHeld(false);
  assert.equal(published.length, 2); assert.equal(published[1].mode, 'timetable');
  assert.equal(published[1].vehicles.length, 0);
});
