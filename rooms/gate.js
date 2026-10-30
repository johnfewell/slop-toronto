// rooms/gate.js: the multiplayer service's admission, one Durable Object (named "gate"), with GateCore's rules
// (rooms/core.js): sockets per IP across all rooms, connections per minute, private rooms per IP, total sockets & rooms,
// and bans. Its state is a few hundred bytes, written to its SQLite storage after every change, so an evicted Gate
// comes back with the same limits. Rooms call it over RPC: admit, release, renew, ban.
import { DurableObject } from 'cloudflare:workers';
import { GateCore } from './core.js';

export class Gate extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    const row = ctx.storage.sql.exec("SELECT v FROM kv WHERE k = 'state'").toArray()[0];
    let state = null;
    try { state = row ? JSON.parse(row.v) : null; } catch { /* start afresh */ }
    const n = (v) => (v === undefined || v === '' ? undefined : Number(v));
    const limits = Object.fromEntries(Object.entries({
      PER_IP: n(env.PER_IP), PER_MINUTE: n(env.PER_MINUTE), PRIVATE_PER_IP: n(env.PRIVATE_PER_IP), MAX_SOCKETS: n(env.MAX_SOCKETS), MAX_ROOMS: n(env.MAX_ROOMS)
    }).filter(([, v]) => Number.isFinite(v)));
    this.core = new GateCore({ limits, state });
  }

  save() { this.ctx.storage.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('state', ?)", this.core.serialize()); }

  admit(request) { const r = this.core.admit(request); this.save(); return r; }
  release(keys) { this.core.release(keys); this.save(); }
  renew(keys) { this.core.renew(keys); this.save(); }
  ban(ip) { this.core.ban(ip); this.save(); }
}
