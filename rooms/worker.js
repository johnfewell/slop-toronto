// rooms/worker.js: Slop Toronto's multiplayer rooms (docs/multiplayer-spec.md), a Worker of its own so the site's Worker
// keeps no Durable Objects (and so keeps its preview URLs). Production: slop-toronto-rooms; staging, with its own
// Durable Object namespaces: slop-toronto-rooms-staging (rooms/wrangler.jsonc, --env staging).
// GET /mp/<room>?v=1 with Upgrade: websocket -> that room's Durable Object (rooms/room.js), after, in order:
// - the kill switch: MP_ENABLED other than "on" answers 503 before any Durable Object is touched (pages ride alone)
// - the room name: public-1 .. public-<MAX_PUBLIC_ROOMS>, or six lowercase letters; anything else 404
// - the Origin: one of ALLOWED_ORIGINS (comma-separated, "*" matches within a host name), or localhost where
//   ALLOW_LOCALHOST is "1". This only keeps other sites from embedding the rooms; the Gate's limits do the rest.
import '../js/mp-protocol.js';
export { Room } from './room.js';
export { Gate } from './gate.js';
import { originAllowed } from './core.js';

const P = globalThis.MP_PROTOCOL;

export default {
  fetch(request, env) {
    if (env.MP_ENABLED !== 'on') return new Response('Multiplayer is off', { status: 503 });
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/mp/')) return new Response('Not found', { status: 404 });
    const room = decodeURIComponent(url.pathname.slice(4));
    if (!P.isRoomName(room, Number(env.MAX_PUBLIC_ROOMS) || 2)) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (!originAllowed(request.headers.get('Origin'), env)) return new Response('Forbidden', { status: 403 });
    // public rooms next to Toronto; a private room near whoever opens it first
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room), room.startsWith('public-') ? { locationHint: 'enam' } : undefined);
    return stub.fetch(request);
  }
};

