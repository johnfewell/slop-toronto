import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness() {
  let now = 1000000, nextId = 0, visibility;
  const timers = new Map(), requests = [], published = [];
  const window = { CITY: { TRANSIT: {}, worldFromLatLon: (x, z) => ({ x, z }) } };
  const document = { hidden: false, addEventListener(_, fn) { visibility = fn; } };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(fs.readFileSync(new URL('../js/transit-live.js', import.meta.url), 'utf8'), {
    window, location: { search: '', protocol: 'http:' }, document, Date: Clock, AbortController,
    console: { info() {} },
    setTimeout(fn, delay) { timers.set(++nextId, { fn, at: now + delay }); return nextId; },
    clearTimeout(id) { timers.delete(id); },
    fetch(_, { signal }) {
      return new Promise(resolve => requests.push({
        signal, reply(t = now / 1000, x = 1) {
          resolve({ ok: true, json: async () => ({ t, v: [['504', 0, x, 2, -1, t, 'ttc-1']] }) });
        }
      }));
    }
  });
  const T = window.CITY.TRANSIT;
  T.onLive(live => published.push(structuredClone(live)));
  return {
    T, requests, published, timers,
    hide(hidden) { document.hidden = hidden; visibility(); },
    async advance(ms) {
      const until = now + ms;
      while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (timer.at > until) break;
        timers.delete(id);
        now = timer.at;
        timer.fn();
        await new Promise(resolve => setImmediate(resolve));
      }
      now = until;
    },
    async reply(i, t, x) {
      requests[i].reply(t, x);
      await new Promise(resolve => setImmediate(resolve));
    }
  };
}

test('resume during a slow poll keeps one request; late completion after timeout cannot overwrite its retry', async () => {
  const h = harness();
  await h.advance(1500);
  h.hide(true); h.hide(false);
  await h.advance(10000);
  assert.equal(h.requests.length, 1);
  await h.advance(5000);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.T.live.mode, 'timetable');
  await h.advance(20000);
  await h.reply(1, undefined, 2);
  await h.reply(0, 1000, 1);
  assert.equal(h.T.live.polls, 1);
  assert.equal(h.T.live.vehicles[0].x, 2);
  await h.advance(20000);
  assert.equal(h.requests.length, 3);
  await h.reply(2, 1020, 3);
  assert.equal(h.T.live.vehicles[0].x, 2);
});

test('feed expires during a pending poll and hold publishes only the latest state', async () => {
  const h = harness();
  h.T.setPresentationHeld(true);
  await h.advance(1500); await h.reply(0);
  await h.advance(20000); await h.reply(1, undefined, 2);
  h.T.setPresentationHeld(false);
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0].vehicles[0].x, 2);
  h.T.setPresentationHeld(true);
  // Returning the same snapshot must never extend its lifetime.
  for (let i = 2; i <= 5; i++) {
    await h.advance(20000); await h.reply(i, 1021.5);
  }
  h.hide(true); h.hide(false);
  await h.advance(10000);
  assert.equal(h.T.live.mode, 'timetable');
  assert.equal(h.published.length, 1);
  h.T.setPresentationHeld(false);
  assert.equal(h.published.length, 2);
  assert.equal(h.published[1].vehicles.length, 0);
});

test('feed expires while hidden and a stale reply after resume cannot restore it', async () => {
  const h = harness();
  await h.advance(1500); await h.reply(0, 930);
  await h.advance(20000);
  h.hide(true);
  await h.advance(10000);
  assert.equal(h.requests[1].signal.aborted, false);
  assert.equal(h.T.live.mode, 'timetable');
  h.hide(false);
  await h.reply(1, 930);
  assert.equal(h.T.live.mode, 'timetable');
});
