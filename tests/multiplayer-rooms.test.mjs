// The rooms' rules (rooms/core.js, docs/multiplayer-spec.md "Acceptance checks"), with a fake clock and fake sockets:
// admission and the spending caps, presence expiry, hiding, the tick, abuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/mp-protocol.js';
import { RoomCore, GateCore, ROOM, CLOSE, originAllowed } from '../rooms/core.js';

const P = globalThis.MP_PROTOCOL;

function harness(name = 'public-1') {
  let t = 1e6;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const inbox = new Map(), closed = new Map();
  let seed = 1;
  const room = new RoomCore({
    name, now: clock.now, random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
    send: (ws, d) => inbox.get(ws).push(d), close: (ws, code) => closed.set(ws, code)
  });
  const join = (ip = '1.1.1.1') => { const ws = {}; inbox.set(ws, []); room.add(ws, { ip }); return ws; };
  const texts = (ws) => inbox.get(ws).filter((d) => typeof d === 'string').map((d) => JSON.parse(d));
  const snaps = (ws) => inbox.get(ws).filter((d) => typeof d !== 'string').map((d) => P.decodeSnapshot(d));
  const state = (ws, x, z, extra = {}) => room.message(ws, P.encodeState({ mode: 2, x, y: 0, z, heading: 0, speed: 5, epoch: 0, ...extra }));
  return { room, clock, join, texts, snaps, state, inbox, closed };
}

test('the Gate: 8 per address across rooms, one private room per address, the service caps, bans', () => {
  let t = 0;
  const gate = new GateCore({ now: () => t, limits: { PER_MINUTE: 100 } });
  for (let i = 0; i < 8; i++) assert.ok(gate.admit({ ip: 'home', room: i % 2 ? 'public-1' : 'public-2' }).ok);
  assert.deepEqual(gate.admit({ ip: 'home', room: 'public-1' }), { ok: false, why: 'ip' });
  assert.ok(gate.admit({ ip: 'a', room: 'abcdef', priv: true }).ok);
  assert.ok(gate.admit({ ip: 'a', room: 'abcdef', priv: true }).ok); // the same private room again: fine
  assert.equal(gate.admit({ ip: 'a', room: 'ghijkl', priv: true }).why, 'private');

  const full = new GateCore({ now: () => t, limits: { MAX_SOCKETS: 3, MAX_ROOMS: 2 } });
  assert.ok(full.admit({ ip: 'x', room: 'public-1' }).ok);
  assert.ok(full.admit({ ip: 'y', room: 'aaaaaa', priv: true }).ok);
  assert.equal(full.admit({ ip: 'z', room: 'bbbbbb', priv: true }).why, 'rooms');
  const last = full.admit({ ip: 'z', room: 'public-1' });
  assert.ok(last.ok);
  assert.equal(full.admit({ ip: 'w', room: 'public-1' }).why, 'sockets');
  full.release([last.key]);
  assert.ok(full.admit({ ip: 'w', room: 'public-1' }).ok);

  const quick = new GateCore({ now: () => t });
  for (let i = 0; i < 10; i++) quick.admit({ ip: 'r', room: 'public-1' });
  assert.equal(quick.admit({ ip: 'r', room: 'public-1' }).why, 'rate'); // (the 11th connection in a minute)
  quick.ban('evil');
  assert.equal(quick.admit({ ip: 'evil', room: 'public-1' }).why, 'banned');
  t += 11 * 60000;
  assert.ok(quick.admit({ ip: 'evil', room: 'public-1' }).ok); // bans and unrenewed leases lapse
  // a lapsed lease frees its slot; state survives a restart
  const again = new GateCore({ now: () => t, state: JSON.parse(quick.serialize()) });
  assert.equal(again.leases.size, quick.leases.size);

  assert.ok(P.isRoomName('public-2', 2) && !P.isRoomName('public-3', 2)); // checked in the Worker before any lookup
  assert.ok(originAllowed('https://mp-slop-toronto.cloud6711.workers.dev', { ALLOWED_ORIGINS: 'https://*-slop-toronto.cloud6711.workers.dev' }));
  assert.ok(!originAllowed('https://evil.example', { ALLOWED_ORIGINS: 'https://*-slop-toronto.cloud6711.workers.dev' }));
  assert.ok(!originAllowed(null, {}));
});

test('presence: fresh samples only, ages kept, silent players fade at 2.5 s and are closed at 30 s', () => {
  const { room, clock, join, snaps, state, closed } = harness();
  const a = join(), b = join();
  state(a, 0, 0);
  state(b, 10, 0);
  assert.ok(room.wantsTick());
  clock.advance(400);
  state(a, 1, 0);
  for (let i = 0; i < 10; i++) room.tick(); // (the first tick also carries map records)
  const s = snaps(a).at(-1);
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0].age, 400); // b's sample is 400 ms old, and says so however often it's repeated
  clock.advance(2200); // b silent for 2.6 s
  assert.equal(room.riding(), 1);
  assert.ok(!room.wantsTick()); // one publishing: the tick stops
  for (let i = 0; i < 10; i++) room.tick();
  assert.ok(snaps(a).at(-1).records.every((r) => r.id !== [...room.players.values()][1].id));
  clock.advance(30000);
  state(a, 2, 0);
  const { released } = room.sweep();
  assert.equal(released.length, 1);
  assert.equal(closed.get(b), CLOSE.IDLE);
});

test('hiding deletes the sample at once and tells the others; resuming is accepted', () => {
  const { room, join, texts, state, clock } = harness();
  const a = join(), b = join();
  state(a, 0, 0);
  state(b, 5, 0);
  room.message(b, P.encodeHide('private'));
  const bid = [...room.players.values()][1].id;
  assert.ok(texts(a).some((m) => m.type === 'hidden' && m.id === bid));
  assert.equal([...room.players.values()][1].sample, null);
  assert.equal(room.riding(), 1);
  clock.advance(1000);
  state(b, 3000, 0, { epoch: 1 }); // reappearing 3 km off: no budget to compare with after a hide
  assert.equal(room.riding(), 2);
});

test('movement: bursts pass, impossible jumps need a new epoch (once per 2 s), abuse is closed', () => {
  const { room, join, state, clock, closed } = harness();
  const a = join();
  state(a, 0, 0);
  for (let i = 1; i <= 5; i++) state(a, i * 3, 0); // a burst after a delay: inside the 1 s slack
  assert.equal([...room.players.values()][0].sample.x, 15);
  state(a, 900, 0); // no epoch change: dropped
  assert.equal([...room.players.values()][0].sample.x, 15);
  state(a, 900, 0, { epoch: 1 });
  assert.equal([...room.players.values()][0].sample.x, 900);
  clock.advance(500);
  state(a, 2000, 0, { epoch: 2 }); // a second jump within 2 s: dropped
  assert.equal([...room.players.values()][0].sample.x, 900);

  const b = join('6.6.6.6');
  let abuse = null;
  for (let i = 0; i < ROOM.MALFORMED && !abuse; i++) { clock.advance(200); abuse = room.message(b, new ArrayBuffer(7)); }
  assert.deepEqual([abuse.closed, abuse.ip], [CLOSE.MALFORMED, '6.6.6.6']);
  assert.equal(closed.get(b), CLOSE.MALFORMED);

  const c = join('7.7.7.7');
  abuse = null;
  for (let i = 0; i < 2000 && !abuse; i++) { clock.advance(2); abuse = state(c, 0, 0); } // 500 a second
  assert.equal(abuse.closed, CLOSE.FLOOD);
});

test('a full room points to the next public room, and the last one nowhere', () => {
  const one = harness('public-1');
  one.room.cap = 1;
  one.join();
  assert.ok(!one.room.canJoin());
  assert.deepEqual(one.room.fullReply(), { type: 'full', next: 'public-2' });
  assert.deepEqual(harness('public-2').room.fullReply(), { type: 'full', next: null });
  assert.deepEqual(harness('abcdef').room.fullReply(), { type: 'full', next: null });
});
