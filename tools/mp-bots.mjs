// tools/mp-bots.mjs: pretend players for multiplayer (docs/multiplayer-spec.md): N clients that join a room and ride
// back & forth along real streets near a point (the roads of js/toronto-geodata.js), mostly on bicycles, some driving,
// some walking, one helicopter circling. For load checks and for seeing a busy room.
// usage: node tools/mp-bots.mjs [ws(s)://rooms] [--n 48] [--room public-1] [--x 970 --z 576] [--radius 1200] [--secs 600]
//   [--mode helicopter|cyclist|car|person] (everyone in one mode) [--cluster 50] (circling within that many metres of
//   the point instead of riding streets) [--churn 5] (that many bots a second leave and a new one joins)
//   default: the staging rooms (rooms/wrangler.jsonc --env staging), which allow 60 sockets from one address and 60 to a
//   room, so 48 bots fit next to two people. Production allows 8 per address: don't point bots at it.
import fs from 'node:fs';
import vm from 'node:vm';
import '../js/mp-protocol.js';

const P = globalThis.MP_PROTOCOL;
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const base = args.find((a) => /^wss?:\/\//.test(a)) || 'wss://slop-toronto-rooms-staging.cloud6711.workers.dev';
const N = Number(opt('n', 48)), ROOM = opt('room', 'public-1'), CX = Number(opt('x', 970)), CZ = Number(opt('z', 576));
const RADIUS = Number(opt('radius', 1200)), SECS = Number(opt('secs', 600));
const ONLY = opt('mode', null), CLUSTER = Number(opt('cluster', 0)), CHURN = Number(opt('churn', 0));
// the staging rooms take the site's preview pages; the bots say they're one
const origin = opt('origin', 'https://mp-slop-toronto.cloud6711.workers.dev');

// streets near (CX, CZ): long enough to ride, at street level, not expressways
const win = {};
vm.runInNewContext(fs.readFileSync(new URL('../js/toronto-geodata.js', import.meta.url), 'utf8'), { window: win });
const roads = [];
for (const [, , , , , raised, flat, cls] of win.CITY.GEO.roads) {
  if (raised || /motorway|trunk/.test(cls)) continue;
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const near = pts.some(([x, z]) => Math.hypot(x - CX, z - CZ) < RADIUS);
  if (near && len > 150) roads.push({ pts, len });
}
if (!roads.length) { console.error('no streets near that point'); process.exit(1); }
console.log(`${roads.length} streets within ${RADIUS} m of (${CX}, ${CZ}); ${N} bots -> ${base}/mp/${ROOM}`);

// position s metres along a polyline, and its heading (the controllers' heading: atan2(dx, dz))
function along(road, s) {
  let i = 1;
  for (; i < road.pts.length; i++) {
    const [ax, az] = road.pts[i - 1], [bx, bz] = road.pts[i];
    const l = Math.hypot(bx - ax, bz - az);
    if (s <= l || i === road.pts.length - 1) {
      const k = l ? Math.min(1, s / l) : 0;
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, heading: Math.atan2(bx - ax, bz - az) };
    }
    s -= l;
  }
}

const SPEED = { cyclist: 6.5, car: 11, person: 1.5 };
let open = 0, joined = 0;
const live = new Map(); // bot index -> its socket
function bot(i) {
  const mode = ONLY || (i === 0 ? 'helicopter' : i % 7 < 4 ? 'cyclist' : i % 7 < 6 ? 'car' : 'person');
  const road = roads[(i * 7919) % roads.length];
  const speed = (SPEED[mode] || 30) * (0.85 + ((i * 37) % 30) / 100);
  let s = (i * 53) % road.len, dir = 1;
  const ws = new WebSocket(`${base}/mp/${ROOM}?v=${P.VERSION}`, { headers: { Origin: origin } });
  ws.binaryType = 'arraybuffer';
  live.set(i, ws);
  let timer = 0, t = (i * 13) % 100;
  ws.onopen = () => { open++; };
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    const m = JSON.parse(e.data);
    if (m.type === 'welcome') {
      joined++;
      timer = setInterval(() => {
        t += 0.1;
        let x, z, y = 0, heading;
        if (CLUSTER || mode === 'helicopter') {
          // circling: a helicopter 400 m out at 110 m, or everyone within CLUSTER metres of the point
          const r = CLUSTER ? CLUSTER * (0.3 + ((i * 29) % 70) / 100) : 400;
          const a = t * (speed / r) + i;
          x = CX + Math.cos(a) * r; z = CZ + Math.sin(a) * r; y = mode === 'helicopter' ? 60 + (i % 5) * 15 : 0;
          heading = Math.atan2(-Math.sin(a), Math.cos(a));
        } else {
          s += dir * speed * 0.1;
          if (s > road.len) { s = road.len; dir = -1; } else if (s < 0) { s = 0; dir = 1; }
          const p = along(road, s);
          heading = dir > 0 ? p.heading : p.heading + Math.PI;
          // keep right: 2.5 m to the right of the centre line for traffic, 4 m for walkers
          const off = mode === 'person' ? 4 : 2.5;
          x = p.x - Math.cos(heading) * off; z = p.z + Math.sin(heading) * off;
        }
        ws.send(P.encodeState({ mode: P.MODES.indexOf(mode), flags: 0, epoch: 0, x, y, z, heading, speed: mode === 'helicopter' ? 25 : speed }));
      }, 100);
    } else if (m.type === 'full' || m.type === 'limited') console.log(`bot ${i}: ${m.type} ${m.next || m.why || ''}`);
  };
  ws.onclose = (e) => { clearInterval(timer); open--; if (live.get(i) === ws) live.delete(i); if (e.code !== 1000) console.log(`bot ${i} closed ${e.code} ${e.reason}`); };
  ws.onerror = () => {};
}

for (let i = 0; i < N; i++) setTimeout(() => bot(i), i * 60);
// churn: once everyone is in, CHURN bots a second leave and as many new ones join
let next = N;
if (CHURN) setTimeout(() => setInterval(() => {
  for (let k = 0; k < CHURN; k++) {
    const [i, ws] = live.entries().next().value || [];
    if (ws) { live.delete(i); ws.close(1000); }
    bot(next++);
  }
}, 1000), N * 60 + 3000);
const report = setInterval(() => console.log(`${open} open, ${joined} joined`), 5000);
setTimeout(() => { clearInterval(report); console.log('done'); process.exit(0); }, SECS * 1000);
