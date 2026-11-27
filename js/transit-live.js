(function () {
// js/transit-live.js
// The TTC's vehicles where they are right now: the site's Worker (worker/live.js) reads the TTC's BusTime
// GTFS-Realtime feed (Open Government Licence – Toronto) at most every 15 s and hands back the vehicles in the city
// at /live/vehicles. This polls it every 20 s while the tab is visible and tells streetcars.js & transit-buses.js
// (TRANSIT.onLive) where each vehicle is, in the world frame, with its heading.
// The timetable (transit.js) stays the fallback: no live data at all (offline, local file servers, a failed fetch,
// data older than 90 s) or ?transit=timetable, and, per route, a route with no live vehicles.

const { TRANSIT } = window.CITY;
// (city-config.js, loaded after this file)
const worldFromLatLon = (lat, lon) => window.CITY.worldFromLatLon(lat, lon);
if (!TRANSIT) return;

const POLL = 20000; // ms
const STALE = 90000; // ms: older than this, back to the timetable
const off = /[?&]transit=timetable\b/.test(location.search) || location.protocol === 'file:';
const listeners = [];
const live = { mode: off ? 'timetable' : 'waiting', at: 0, feedTime: 0, vehicles: [], polls: 0, fails: 0 };

// a vehicle's heading (degrees clockwise from true north) as a world direction (x east, z south, the grid turned)
function headingVector(lat, lon, deg) {
  if (!(deg >= 0)) return null;
  const r = (deg * Math.PI) / 180, d = 0.0003;
  const a = worldFromLatLon(lat, lon), b = worldFromLatLon(lat + d * Math.cos(r), lon + (d * Math.sin(r)) / Math.cos((lat * Math.PI) / 180));
  const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
}

let presentationHeld = false, pendingPublish = false;
function publish() {
  if (presentationHeld) { pendingPublish = true; return; }
  pendingPublish = false;
  for (const f of listeners) f(live);
}

const REQUEST_TIMEOUT = 15000;
let timer = null, expiry = null, request = null;

function expireIfStale() {
  if (live.mode !== 'live' || Date.now() < Math.min(live.at, live.feedTime) + STALE) return;
  live.mode = 'timetable';
  live.vehicles = [];
  publish();
}

function schedule(wait) {
  if (!document.hidden && timer === null && !request) timer = setTimeout(poll, wait);
}

function failed() {
  live.fails++;
  if (live.mode === 'waiting') {
    live.mode = 'timetable';
    publish();
  } else expireIfStale();
}

async function poll() {
  timer = null;
  if (document.hidden || request) return;
  const owner = new AbortController();
  request = owner;
  const deadline = setTimeout(() => {
    request = null;
    owner.abort();
    failed();
    schedule(POLL);
  }, REQUEST_TIMEOUT);
  try {
    const res = await fetch('./live/vehicles', { cache: 'no-store', signal: owner.signal });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (request !== owner) return;
    const now = Date.now(), feedTime = data?.t * 1000;
    if (!Array.isArray(data?.v) || !Number.isFinite(feedTime) || feedTime <= 0 ||
        now - feedTime >= STALE || feedTime < live.feedTime) throw new Error('invalid or stale feed');
    live.vehicles = data.v.map(([route, dir, lat, lon, bearing, ts, id]) => {
      const p = worldFromLatLon(lat, lon);
      return { id, route, dir, x: p.x, z: p.z, h: headingVector(lat, lon, bearing), ts: ts * 1000 };
    });
    live.at = now;
    live.feedTime = feedTime;
    live.mode = 'live';
    live.polls++;
    clearTimeout(expiry);
    expiry = setTimeout(expireIfStale, Math.min(now, feedTime) + STALE - now);
    if (live.polls === 1) console.info(`[transit] live: ${live.vehicles.length} TTC vehicles in the city (feed ${new Date(live.feedTime).toLocaleTimeString()})`);
    publish();
  } catch {
    if (request === owner) failed();
  } finally {
    clearTimeout(deadline);
    if (request === owner) {
      request = null;
      schedule(POLL);
    }
  }
}
if (!off) {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(timer);
      timer = null;
    } else {
      expireIfStale();
      schedule(Math.max(0, POLL - (Date.now() - live.at)));
    }
  });
  // (after the city has started: its first frames first)
  timer = setTimeout(poll, 1500);
}

Object.assign(TRANSIT, {
  live,
  setPresentationHeld(held) {
    expireIfStale();
    presentationHeld = Boolean(held);
    if (!presentationHeld && pendingPublish) {
      publish();
    }
  },
  onLive(f) {
    listeners.push(f);
  }
});
})();
