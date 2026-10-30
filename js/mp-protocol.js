// js/mp-protocol.js
// Multiplayer's wire format and its pure rules (docs/multiplayer-spec.md), shared by the page (js/multiplayer.js, a
// classic script: they land on window.CITY.MP_PROTOCOL), the rooms Worker (rooms/*.js), tools/mp-bots.mjs and the
// tests (ES modules importing this file for its side effect: globalThis.MP_PROTOCOL). Binary frames, little-endian:
// - state (client -> room, 20 B): u8 type=1, u8 mode, u8 flags, u8 epoch, f32 x, f32 y, f32 z, u16 heading, i16 speed
// - hide (client -> room, 4 B): u8 type=3, u8 reason, u16 0. No position, by design: a hidden player sends none.
// - snapshot (room -> client, 8 B + 22 B a record, at most 49 records): u8 type=2, u8 count, u16 riding,
//   u32 room time (ms), then per record u16 id, u8 mode, u8 flags, u8 epoch, u8 age (10 ms units), f32 x, f32 y, f32 z,
//   u16 heading, i16 speed
// heading: 0..65535 for 0..2π (the controllers' heading); speed: decimetres per second, signed; epoch: the sender's
// teleport counter (a change between two samples means snap, don't interpolate). JSON text frames carry the rest
// (welcome, join, leave, hidden, riding, full).
(function (root) {
  const VERSION = 1;
  const STATE = 1, SNAPSHOT = 2, HIDE = 3;
  const STATE_BYTES = 20, HIDE_BYTES = 4, HEADER_BYTES = 8, RECORD_BYTES = 22, MAX_RECORDS = 49;
  const MODES = ['person', 'car', 'cyclist', 'helicopter'];
  const HIDE_REASONS = ['private', 'passenger', 'background'];
  const FLAG_BOOST = 1, FLAG_MAP_ONLY = 2;
  // the detailed city (GEO.frame.detail) plus the helicopter's 6 km margin, in world metres; altitude
  const BOUNDS = { x0: -13900, x1: 9700, z0: -9000, z1: 9600, y0: -30, y1: 400 };
  const FRESH = 2500; // ms: a sample older than this is never sent, and its player fades
  const TAU = Math.PI * 2;

  const headingBits = (h) => Math.round((((h % TAU) + TAU) % TAU) / TAU * 65536) & 0xffff;
  const headingRad = (bits) => (bits / 65536) * TAU;
  const speedBits = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 10)));

  // s: { mode, flags, epoch, x, y, z, heading, speed }
  function encodeState(s, buf = new ArrayBuffer(STATE_BYTES)) {
    const d = new DataView(buf);
    d.setUint8(0, STATE);
    d.setUint8(1, s.mode);
    d.setUint8(2, (s.flags || 0) & FLAG_BOOST);
    d.setUint8(3, (s.epoch || 0) & 0xff);
    d.setFloat32(4, s.x, true);
    d.setFloat32(8, s.y, true);
    d.setFloat32(12, s.z, true);
    d.setUint16(16, headingBits(s.heading), true);
    d.setInt16(18, speedBits(s.speed), true);
    return buf;
  }

  function encodeHide(reason, buf = new ArrayBuffer(HIDE_BYTES)) {
    const d = new DataView(buf);
    d.setUint8(0, HIDE);
    d.setUint8(1, Math.max(0, HIDE_REASONS.indexOf(reason)));
    d.setUint16(2, 0, true);
    return buf;
  }

  const inBounds = (x, y, z) => x >= BOUNDS.x0 && x <= BOUNDS.x1 && z >= BOUNDS.z0 && z <= BOUNDS.z1 && y >= BOUNDS.y0 && y <= BOUNDS.y1;

  // A frame from a client: { kind: 'state', mode, flags, epoch, x, y, z, heading, speed } | { kind: 'hide', reason },
  // or null for anything malformed (wrong size or type, non-finite numbers, a bad mode, out of the world)
  function decodeClient(buf) {
    if (!(buf instanceof ArrayBuffer)) return null;
    const d = new DataView(buf);
    if (buf.byteLength === HIDE_BYTES && d.getUint8(0) === HIDE) {
      const reason = HIDE_REASONS[d.getUint8(1)];
      return reason ? { kind: 'hide', reason } : null;
    }
    if (buf.byteLength !== STATE_BYTES || d.getUint8(0) !== STATE) return null;
    const s = {
      kind: 'state', mode: d.getUint8(1), flags: d.getUint8(2) & FLAG_BOOST, epoch: d.getUint8(3),
      x: d.getFloat32(4, true), y: d.getFloat32(8, true), z: d.getFloat32(12, true),
      heading: headingRad(d.getUint16(16, true)), speed: d.getInt16(18, true) / 10
    };
    if (s.mode >= MODES.length || !(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z))) return null;
    if (!inBounds(s.x, s.y, s.z)) return null;
    return s;
  }

  // records: [{ id, mode, flags, epoch, age (ms), x, y, z, heading, speed }], at most MAX_RECORDS
  function encodeSnapshot(roomTime, riding, records) {
    const n = Math.min(MAX_RECORDS, records.length);
    const buf = new ArrayBuffer(HEADER_BYTES + n * RECORD_BYTES);
    const d = new DataView(buf);
    d.setUint8(0, SNAPSHOT);
    d.setUint8(1, n);
    d.setUint16(2, Math.min(65535, riding), true);
    d.setUint32(4, roomTime >>> 0, true);
    for (let i = 0; i < n; i++) {
      const p = records[i], o = HEADER_BYTES + i * RECORD_BYTES;
      d.setUint16(o, p.id, true);
      d.setUint8(o + 2, p.mode);
      d.setUint8(o + 3, p.flags || 0);
      d.setUint8(o + 4, (p.epoch || 0) & 0xff);
      d.setUint8(o + 5, Math.max(0, Math.min(250, Math.round((p.age || 0) / 10))));
      d.setFloat32(o + 6, p.x, true);
      d.setFloat32(o + 10, p.y, true);
      d.setFloat32(o + 14, p.z, true);
      d.setUint16(o + 18, headingBits(p.heading), true);
      d.setInt16(o + 20, speedBits(p.speed), true);
    }
    return buf;
  }

  function decodeSnapshot(buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < HEADER_BYTES) return null;
    const d = new DataView(buf);
    if (d.getUint8(0) !== SNAPSHOT) return null;
    const n = d.getUint8(1);
    if (n > MAX_RECORDS || buf.byteLength !== HEADER_BYTES + n * RECORD_BYTES) return null;
    const records = new Array(n);
    for (let i = 0; i < n; i++) {
      const o = HEADER_BYTES + i * RECORD_BYTES;
      records[i] = {
        id: d.getUint16(o, true), mode: d.getUint8(o + 2), flags: d.getUint8(o + 3), epoch: d.getUint8(o + 4),
        age: d.getUint8(o + 5) * 10,
        x: d.getFloat32(o + 6, true), y: d.getFloat32(o + 10, true), z: d.getFloat32(o + 14, true),
        heading: headingRad(d.getUint16(o + 18, true)), speed: d.getInt16(o + 20, true) / 10
      };
    }
    return { riding: d.getUint16(2, true), roomTime: d.getUint32(4, true), records };
  }

  // Room names: public-1 .. public-<maxPublic>, or exactly six lowercase letters (a private room)
  function isRoomName(name, maxPublic = 2) {
    if (/^[a-z]{6}$/.test(name)) return true;
    const m = /^public-([1-9]\d{0,2})$/.exec(name);
    return !!m && Number(m[1]) <= maxPublic;
  }

  // The private zone round the player's real location (the spec's Privacy section), as a pure state machine the page
  // feeds once a frame: update({ x, z, real, teleported }) -> true while the player must stay hidden.
  // - real: the live GPS fix in the city ({ x, z }) or null; it (re)centres the zone
  // - hidden from entering the zone (or starting inside a stored one, after a reload) until a teleport lands outside it
  //   or the player is RESUME metres from its centre; after that, with no live fix, the stored zone is forgotten
  // - linkAt(): whether a share link may carry the player's position (only while publishing)
  function createPrivacy(stored = null, { radius = 500, resume = 2000 } = {}) {
    let zone = stored && Number.isFinite(stored.x) && Number.isFinite(stored.z) ? { x: stored.x, z: stored.z } : null;
    let hidden = false, started = false;
    const dist = (x, z) => (zone ? Math.hypot(x - zone.x, z - zone.z) : Infinity);
    return {
      update({ x, z, real = null, teleported = false }) {
        if (real) zone = { x: real.x, z: real.z };
        const d = dist(x, z);
        if (!started) { started = true; hidden = d < radius; }
        if (!hidden && d < radius) hidden = true;
        else if (hidden && ((teleported && d >= radius) || d >= resume)) {
          hidden = false;
          if (!real) zone = null;
        }
        return hidden;
      },
      get hidden() { return hidden; },
      get zone() { return zone ? { ...zone } : null; },
      linkAt() { return !hidden; }
    };
  }

  root.MP_PROTOCOL = {
    VERSION, STATE, SNAPSHOT, HIDE, STATE_BYTES, HIDE_BYTES, HEADER_BYTES, RECORD_BYTES, MAX_RECORDS, MODES, HIDE_REASONS,
    FLAG_BOOST, FLAG_MAP_ONLY, BOUNDS, FRESH,
    encodeState, encodeHide, decodeClient, encodeSnapshot, decodeSnapshot, isRoomName, createPrivacy
  };
})(typeof window !== 'undefined' ? (window.CITY = window.CITY || {}) : globalThis);
