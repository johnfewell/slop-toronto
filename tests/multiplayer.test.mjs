// Multiplayer's wire format and privacy rules (js/mp-protocol.js, docs/multiplayer-spec.md "Acceptance checks"):
// a slip in the format freezes every ghost; a slip in privacy publishes where someone lives.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/mp-protocol.js';

const P = globalThis.MP_PROTOCOL;
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('frames survive encode -> decode, and malformed ones are refused', () => {
  const s = { mode: 2, flags: 1, epoch: 300, x: -1234.56, y: 3.25, z: 987.5, heading: -0.75, speed: -4.37 };
  const d = P.decodeClient(P.encodeState(s));
  assert.equal(d.kind, 'state');
  assert.deepEqual([d.mode, d.flags, d.epoch], [2, 1, 300 & 0xff]);
  close(d.x, s.x, 1e-3);
  close(d.z, s.z, 1e-3);
  close(Math.atan2(Math.sin(d.heading - s.heading), Math.cos(d.heading - s.heading)), 0, 1e-4);
  close(d.speed, s.speed, 0.05);

  const h = P.encodeHide('private');
  assert.equal(h.byteLength, 4); // no room for a position
  assert.deepEqual(P.decodeClient(h), { kind: 'hide', reason: 'private' });

  const bad = (patch) => { const b = P.encodeState(s); patch(new DataView(b)); return P.decodeClient(b); };
  assert.equal(bad((v) => v.setFloat32(4, NaN, true)), null);
  assert.equal(bad((v) => v.setFloat32(12, Infinity, true)), null);
  assert.equal(bad((v) => v.setUint8(1, 4)), null); // mode
  assert.equal(bad((v) => v.setFloat32(8, 900, true)), null); // altitude
  assert.equal(bad((v) => v.setFloat32(4, 50000, true)), null); // out of the world
  assert.equal(P.decodeClient(new ArrayBuffer(19)), null);

  const records = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, mode: i % 4, flags: i % 2 ? P.FLAG_MAP_ONLY : 0, epoch: i, age: i * 37, x: i, y: 1, z: -i, heading: i, speed: i / 3 }));
  const buf = P.encodeSnapshot(123456, 17, records);
  assert.equal(buf.byteLength, P.HEADER_BYTES + P.MAX_RECORDS * P.RECORD_BYTES); // capped at 49 records, 1,086 B
  const snap = P.decodeSnapshot(buf);
  assert.deepEqual([snap.roomTime, snap.riding, snap.records.length], [123456, 17, 49]);
  assert.deepEqual([snap.records[48].id, snap.records[48].epoch, snap.records[48].age], [49, 48, Math.min(2500, Math.round(48 * 37 / 10) * 10)]);
  assert.ok(P.isRoomName('public-2') && P.isRoomName('abcdef') && !P.isRoomName('public-3') && !P.isRoomName('public-99999') && !P.isRoomName('../x'));
});

test('the private zone: hidden inside it, after a reload, in links; resumes only on a teleport out or at 2 km', () => {
  const home = { x: 100, z: 200 };
  const p = P.createPrivacy();
  assert.equal(p.update({ x: 0, z: 0 }), false); // no fix yet
  assert.equal(p.update({ x: 0, z: 0, real: home }), true); // the fix arrives: 224 m away, inside 500 m
  assert.equal(p.linkAt(), false);
  assert.equal(p.update({ x: 700, z: 200, real: home }), true); // riding out: 600 m, still hidden
  assert.equal(p.update({ x: 2200, z: 200, real: home }), false); // 2.1 km: resumes
  assert.equal(p.linkAt(), true);
  assert.equal(p.update({ x: 150, z: 200, real: home }), true); // back home: hidden again

  // a reload restores the zone with the player's state: hidden from the first frame, with no fix this session
  const stored = p.zone;
  const q = P.createPrivacy(stored);
  assert.equal(q.update({ x: 120, z: 180 }), true);
  assert.equal(q.update({ x: 400, z: 400, teleported: true }), true); // a teleport inside the zone stays hidden
  assert.equal(q.update({ x: 3000, z: -900, teleported: true }), false); // one landing outside resumes
  assert.equal(q.zone, null); // and, with no live fix, the stored zone is forgotten
});
