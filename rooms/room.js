// rooms/room.js: one multiplayer room, a Durable Object named after it (public-1, public-2, or six letters for a private
// room). The rules are RoomCore's (rooms/core.js); this wraps them in the Hibernation API:
// - joining asks the Gate (rooms/gate.js) for a lease first, and each socket's id, name, colour & lease ride on it
//   (serializeAttachment), so a woken object rebuilds its player list
// - the 100 ms tick is a setTimeout chain that runs only while RoomCore wants it (two or more publishing); with no
//   timer pending the object can hibernate between messages
// - an alarm every 30 s closes silent sockets and renews the leases of the rest (alarms don't stop hibernation)
import { DurableObject } from 'cloudflare:workers';
import '../js/mp-protocol.js';
import { RoomCore, ROOM, CLOSE } from './core.js';

const P = globalThis.MP_PROTOCOL;
const SWEEP = 30000; // ms

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new RoomCore({
      cap: Number(env.ROOM_CAP) || ROOM.CAP,
      maxPublic: Number(env.MAX_PUBLIC_ROOMS) || 2,
      send: (ws, data) => { try { ws.send(data); } catch { /* closing */ } },
      close: (ws, code, reason) => { try { ws.close(code, reason); } catch { /* closed */ } }
    });
    for (const ws of ctx.getWebSockets()) this.core.restore(ws, ws.deserializeAttachment());
    this.timer = null;
    this.maybeTick();
  }

  gate() { return this.env.GATE.get(this.env.GATE.idFromName('gate')); }

  async fetch(request) {
    const url = new URL(request.url);
    this.core.name = decodeURIComponent(url.pathname.slice(4));
    const [client, server] = Object.values(new WebSocketPair());
    // turned away: accepted outside the hibernation set only to say why, then closed
    const refuse = (code, reason, message = null) => {
      server.accept();
      if (message) server.send(JSON.stringify(message));
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (Number(url.searchParams.get('v')) !== P.VERSION) return refuse(CLOSE.VERSION, 'protocol version');
    if (!this.core.canJoin()) return refuse(CLOSE.FULL, 'room full', this.core.fullReply());
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const gate = this.gate();
    const admit = await gate.admit({ ip, room: this.core.name, priv: !this.core.name.startsWith('public-') });
    if (!admit.ok) {
      if (admit.why === 'banned') return refuse(CLOSE.FLOOD, 'banned');
      if (admit.why === 'rate' || admit.why === 'ip' || admit.why === 'private') return refuse(CLOSE.LIMITED, admit.why, { type: 'limited', why: admit.why });
      return refuse(CLOSE.FULL, 'service full', { type: 'full', next: null, why: admit.why });
    }
    if (!this.core.canJoin()) { // (filled while the Gate answered)
      await gate.release([admit.key]);
      return refuse(CLOSE.FULL, 'room full', this.core.fullReply());
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(this.core.add(server, { ip, lease: admit.key }));
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + SWEEP);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const abuse = this.core.message(ws, message);
    if (abuse) {
      const gate = this.gate();
      await gate.ban(abuse.ip);
      if (abuse.lease) await gate.release([abuse.lease]);
    }
    this.maybeTick();
  }

  async webSocketClose(ws) { await this.gone(ws); }
  async webSocketError(ws) { await this.gone(ws); }

  async gone(ws) {
    const a = this.core.remove(ws);
    if (a && a.lease) await this.gate().release([a.lease]);
  }

  async alarm() {
    const { released, kept } = this.core.sweep();
    const gate = this.gate();
    const done = released.filter(Boolean).map((a) => a.lease).filter(Boolean);
    if (done.length) await gate.release(done);
    if (kept.length) await gate.renew(kept);
    if (this.core.players.size) await this.ctx.storage.setAlarm(Date.now() + SWEEP);
  }

  maybeTick() {
    if (this.timer || !this.core.wantsTick()) return;
    const run = () => {
      this.timer = null;
      if (!this.core.wantsTick()) return; // (fewer than two publishing: no timer, so the object may hibernate)
      this.core.tick();
      this.timer = setTimeout(run, ROOM.TICK);
    };
    this.timer = setTimeout(run, ROOM.TICK);
  }
}
