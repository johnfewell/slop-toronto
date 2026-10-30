// rooms/core.js: the multiplayer rooms' rules as plain classes (docs/multiplayer-spec.md), so they run the same in the
// Durable Objects that wrap them (rooms/room.js, rooms/gate.js) and in Node with a fake clock & fake sockets
// (tests/multiplayer-rooms.test.mjs).
// - RoomCore: one room. Keeps each player's latest fresh sample; while two or more are publishing it is ticked every
//   100 ms and sends each player a snapshot of the others near them (and once a second, map-only records of everyone
//   else). A sample is fresh for 2.5 s: older ones are never sent, so a silent player fades; 30 s of silence closes
//   the socket. Hiding deletes the player's sample at once. Every frame is validated and rate-limited.
// - GateCore: the whole service's admission (sockets per IP across rooms, connections per minute, private rooms per IP,
//   total sockets & rooms, bans). Rooms hold a lease per socket, renewed every minute; a lease not renewed for 3
//   minutes lapses, so a lost room can't hold slots.
import '../js/mp-protocol.js';

const P = globalThis.MP_PROTOCOL;

export const ROOM = {
  CAP: 50,
  TICK: 100, // ms
  NEAR: 500, // m
  NEAR_MAX: 24,
  MAP_EVERY: 10, // ticks
  IDLE: 30000, // ms of silence before the socket is closed
  RATE: 12, BURST: 24, // frames a second per socket (malformed ones count), and the burst allowed
  FLOOD: 3000, // ms over the rate before the socket is closed
  MALFORMED: 20, // malformed frames before the socket is closed
  JUMP_EVERY: 2000, // ms between movements beyond the distance budget (they need a new epoch)
  TOP_SPEED: [10, 70, 22, 60], // m/s: person, car, cyclist, helicopter (the budget allows 1.5x and a 1 s slack)
  COLOURS: 8
};

export const CLOSE = { VERSION: 4000, FULL: 4001, IDLE: 4002, MALFORMED: 4003, LIMITED: 4005, FLOOD: 4008 };

// "Maple Heron": checked by hand; nothing a player types
const ADJECTIVES = ['Maple', 'Harbour', 'Lakeshore', 'Ravine', 'Island', 'Bluff', 'Beach', 'Junction', 'Annex', 'Kensington',
  'Leslie', 'Humber', 'Don', 'Cabbagetown', 'Parkdale', 'Riverdale', 'Trillium', 'Sumac', 'Cedar', 'Willow', 'Northern',
  'Sunny', 'Misty', 'Breezy', 'Golden', 'Copper', 'Velvet', 'Quiet', 'Swift', 'Lucky'];
const ANIMALS = ['Heron', 'Raccoon', 'Beaver', 'Loon', 'Goose', 'Squirrel', 'Coyote', 'Cardinal', 'Fox', 'Otter', 'Owl',
  'Swan', 'Chipmunk', 'Moose', 'Robin', 'Gull', 'Turtle', 'Hare', 'Mink', 'Bluejay', 'Kestrel', 'Sparrow', 'Deer', 'Duck'];

const json = (o) => JSON.stringify(o);

// The Worker's Origin check: one of env.ALLOWED_ORIGINS (comma-separated, "*" matches within a host name), or localhost
// where env.ALLOW_LOCALHOST is "1"
export function originAllowed(origin, env) {
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (env.ALLOW_LOCALHOST === '1' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).some((pattern) => {
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+')}$`);
    return re.test(u.origin);
  });
}

export class RoomCore {
  // send(ws, data) & close(ws, code, reason) talk to the sockets; now() is the clock (ms); random() for ids & names
  constructor({ name = '', cap = ROOM.CAP, maxPublic = 2, now = Date.now, random = Math.random, send, close }) {
    Object.assign(this, { name, cap, maxPublic, now, random, sendTo: send, closeWs: close });
    this.players = new Map(); // ws -> player
    this.t0 = now();
    this.tickNo = 0;
    this.lastRiding = -1;
  }

  canJoin() { return this.players.size < this.cap; }

  // why a newcomer can't join: the next public room to try, if any
  fullReply() {
    const n = this.name.startsWith('public-') ? Number(this.name.slice(7)) : 0;
    return { type: 'full', next: n && n < this.maxPublic ? `public-${n + 1}` : null };
  }

  player(a) {
    const t = this.now();
    return { ...a, sample: null, at: 0, last: null, lastMsg: t, tokens: ROOM.BURST, refill: t, overSince: 0, bad: 0, lastJump: -Infinity };
  }

  // A new member: assigns an id, a name & a colour, welcomes them and tells the others. Returns the socket's attachment.
  add(ws, { ip = '', lease = null } = {}) {
    const used = new Set([...this.players.values()].map((p) => p.id));
    let id = 1 + Math.floor(this.random() * 60000);
    while (used.has(id)) id = (id % 65535) + 1;
    const counts = new Array(ROOM.COLOURS).fill(0);
    for (const p of this.players.values()) counts[p.colour]++;
    const colour = counts.indexOf(Math.min(...counts));
    const name = `${ADJECTIVES[Math.floor(this.random() * ADJECTIVES.length)]} ${ANIMALS[Math.floor(this.random() * ANIMALS.length)]}`;
    const a = { id, name, colour, ip, lease, room: this.name };
    const others = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, colour: p.colour }));
    this.players.set(ws, this.player(a));
    this.sendTo(ws, json({ type: 'welcome', id, name, colour, room: this.name, players: others, riding: this.riding() }));
    this.broadcast(json({ type: 'join', id, name, colour }), ws);
    return a;
  }

  // a socket that outlived the object (hibernation): its attachment brings it back, without a sample until it sends
  restore(ws, a) {
    if (!a) return;
    if (a.room) this.name = a.room;
    this.players.set(ws, this.player(a));
  }

  // Gone (closed, errored, expired): tells the others. Returns its attachment (for the Gate lease) or null.
  remove(ws) {
    const p = this.players.get(ws);
    if (!p) return null;
    this.players.delete(ws);
    this.broadcast(json({ type: 'leave', id: p.id }));
    this.announceRiding();
    return { id: p.id, ip: p.ip, lease: p.lease };
  }

  // One frame from a client. Returns null, or { closed: code, ip } when the socket was closed for abuse (ban it).
  message(ws, data) {
    const p = this.players.get(ws);
    if (!p) return null;
    const now = this.now();
    p.lastMsg = now;
    p.tokens = Math.min(ROOM.BURST, p.tokens + ((now - p.refill) / 1000) * ROOM.RATE);
    p.refill = now;
    if (p.tokens < 1) {
      if (!p.overSince) p.overSince = now;
      else if (now - p.overSince > ROOM.FLOOD) return this.abuse(ws, p, CLOSE.FLOOD, 'too many messages');
      return null;
    }
    p.tokens -= 1;
    // (a steady flood still earns the odd token: the flood clock only resets once the sender has calmed down)
    if (p.tokens >= ROOM.BURST / 2) p.overSince = 0;
    const f = typeof data === 'string' ? null : P.decodeClient(data);
    if (!f) {
      if (++p.bad >= ROOM.MALFORMED) return this.abuse(ws, p, CLOSE.MALFORMED, 'malformed frames');
      return null;
    }
    if (f.kind === 'hide') {
      const was = !!p.sample;
      p.sample = null;
      p.last = null;
      if (was) this.broadcast(json({ type: 'hidden', id: p.id }), ws);
      this.announceRiding();
      return null;
    }
    // the distance budget: what the mode can travel since the last accepted sample (+1 s of slack, so a burst after a
    // network delay passes); beyond it, only with a new epoch (a teleport or mode switch) and at most every 2 s
    const q = p.last;
    if (q) {
      const budget = ROOM.TOP_SPEED[Math.max(f.mode, q.mode)] * 1.5 * ((now - q.at) / 1000 + 1);
      if (Math.hypot(f.x - q.x, f.z - q.z) > budget) {
        if (f.epoch === q.epoch || now - p.lastJump < ROOM.JUMP_EVERY) return null;
        p.lastJump = now;
      }
    }
    p.last = { x: f.x, z: f.z, mode: f.mode, epoch: f.epoch, at: now };
    p.sample = f;
    p.at = now;
    this.announceRiding();
    return null;
  }

  abuse(ws, p, code, reason) {
    this.closeWs(ws, code, reason);
    const ip = p.ip;
    const gone = this.remove(ws);
    return { closed: code, ip, lease: gone && gone.lease };
  }

  fresh(p, now = this.now()) { return !!p.sample && now - p.at <= P.FRESH; }

  riding(now = this.now()) {
    let n = 0;
    for (const p of this.players.values()) if (this.fresh(p, now)) n++;
    return n;
  }

  announceRiding() {
    const n = this.riding();
    if (n === this.lastRiding) return;
    this.lastRiding = n;
    this.broadcast(json({ type: 'riding', n }));
  }

  // The tick runs only while two or more are publishing: one player alone needs no snapshots
  wantsTick() { return this.riding() >= 2; }

  tick() {
    const now = this.now();
    const map = this.tickNo++ % ROOM.MAP_EVERY === 0;
    const live = [...this.players.values()].filter((p) => this.fresh(p, now));
    const riding = live.length;
    for (const [ws, r] of this.players) {
      const me = this.fresh(r, now) ? r.sample : null;
      let near = [];
      if (me) {
        for (const p of live) {
          if (p === r) continue;
          const d2 = (p.sample.x - me.x) ** 2 + (p.sample.z - me.z) ** 2;
          if (d2 < ROOM.NEAR * ROOM.NEAR) near.push([d2, p]);
        }
        near.sort((a, b) => a[0] - b[0]);
        near = near.slice(0, ROOM.NEAR_MAX).map((e) => e[1]);
      }
      if (!near.length && !map) continue;
      const rec = (p, flags) => ({ id: p.id, mode: p.sample.mode, flags: (p.sample.flags & P.FLAG_BOOST) | flags, epoch: p.sample.epoch,
        age: now - p.at, x: p.sample.x, y: p.sample.y, z: p.sample.z, heading: p.sample.heading, speed: p.sample.speed });
      const list = near.map((p) => rec(p, 0));
      if (map) {
        const seen = new Set(near);
        for (const p of live) {
          if (list.length >= P.MAX_RECORDS) break;
          if (p !== r && !seen.has(p)) list.push(rec(p, P.FLAG_MAP_ONLY));
        }
      }
      this.sendTo(ws, P.encodeSnapshot(now - this.t0, riding, list));
    }
    this.announceRiding();
  }

  // The alarm's sweep: closes sockets silent for 30 s. Returns { released: [attachments], kept: [leases] }.
  sweep() {
    const now = this.now();
    const released = [];
    for (const [ws, p] of [...this.players]) {
      if (now - p.lastMsg > ROOM.IDLE) {
        this.closeWs(ws, CLOSE.IDLE, 'idle');
        released.push(this.remove(ws));
      }
    }
    this.announceRiding();
    return { released, kept: [...this.players.values()].map((p) => p.lease).filter(Boolean) };
  }

  broadcast(text, except = null) {
    for (const ws of this.players.keys()) if (ws !== except) this.sendTo(ws, text);
  }
}

export const GATE = {
  PER_IP: 8,
  PER_MINUTE: 10,
  PRIVATE_PER_IP: 1,
  MAX_SOCKETS: 100,
  MAX_ROOMS: 6,
  LEASE: 180000, // ms without a renewal before a lease lapses
  BAN: 600000 // ms
};

export class GateCore {
  constructor({ now = Date.now, random = Math.random, limits = {}, state = null } = {}) {
    this.now = now;
    this.random = random;
    this.limits = { ...GATE, ...limits };
    const s = state || {};
    this.leases = new Map(Object.entries(s.leases || {})); // key -> { ip, room, priv, exp }
    this.bans = new Map(Object.entries(s.bans || {})); // ip -> until
    this.recent = new Map(Object.entries(s.recent || {})); // ip -> [connection times in the last minute]
  }

  prune(now) {
    for (const [k, l] of this.leases) if (l.exp < now) this.leases.delete(k);
    for (const [ip, t] of this.bans) if (t < now) this.bans.delete(ip);
    for (const [ip, ts] of this.recent) {
      const keep = ts.filter((t) => now - t < 60000);
      if (keep.length) this.recent.set(ip, keep); else this.recent.delete(ip);
    }
  }

  // { ok: true, key } or { ok: false, why: 'banned' | 'rate' | 'ip' | 'private' | 'sockets' | 'rooms' }
  admit({ ip, room, priv }) {
    const now = this.now(), L = this.limits;
    this.prune(now);
    if (this.bans.has(ip)) return { ok: false, why: 'banned' };
    const recent = this.recent.get(ip) || [];
    if (recent.length >= L.PER_MINUTE) return { ok: false, why: 'rate' };
    recent.push(now);
    this.recent.set(ip, recent);
    const mine = [...this.leases.values()].filter((l) => l.ip === ip);
    if (mine.length >= L.PER_IP) return { ok: false, why: 'ip' };
    if (priv) {
      const rooms = new Set(mine.filter((l) => l.priv).map((l) => l.room));
      rooms.add(room);
      if (rooms.size > L.PRIVATE_PER_IP) return { ok: false, why: 'private' };
    }
    if (this.leases.size >= L.MAX_SOCKETS) return { ok: false, why: 'sockets' };
    const open = new Set([...this.leases.values()].map((l) => l.room));
    if (!open.has(room) && open.size >= L.MAX_ROOMS) return { ok: false, why: 'rooms' };
    const key = `${room}:${now.toString(36)}${Math.floor(this.random() * 1e9).toString(36)}`;
    this.leases.set(key, { ip, room, priv: !!priv, exp: now + L.LEASE });
    return { ok: true, key };
  }

  release(keys) { for (const k of keys) this.leases.delete(k); }

  renew(keys) {
    const exp = this.now() + this.limits.LEASE;
    for (const k of keys) { const l = this.leases.get(k); if (l) l.exp = exp; }
  }

  ban(ip) { if (ip) this.bans.set(ip, this.now() + this.limits.BAN); }

  serialize() {
    return json({ leases: Object.fromEntries(this.leases), bans: Object.fromEntries(this.bans), recent: Object.fromEntries(this.recent) });
  }
}
