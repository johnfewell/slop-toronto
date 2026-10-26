(function () {
// js/bike-share.js
// Bike Share Toronto: every station in the detailed city where the system says it stands (CITY.BIKE_SHARE,
// js/bike-share-stations.js from the GBFS station list), as a row of its docks (its capacity) along the nearest curb,
// its pay station at the row's end (not at the "SMART" map-frame stations, which have none), and its bikes in the
// docks. The bikes are the live count: the system's station_status feed (open to any page, CORS *) is read once a
// minute while the page is visible, and each station near the rider shows its real bikes (available + disabled ones,
// which still stand in their docks). Without the feed (offline, blocked, ?bikes=static) every station is filled to a
// plausible share of its own. The request carries no key, no cookie and no referrer.
// Models: assets/props/bike-share-{dock,kiosk,bike}.glb (tools/blender/bikeshare_props.py), one palette texture, one
// material for all three. Docks & pay stations are static instanced meshes that scene-culling.js chunks & culls; the
// bikes are one instanced mesh of the nearby stations' bikes, rewritten as the rider moves or the counts change, so
// a whole city of stations is three draw calls and only the bikes in sight are ever drawn. Each station's footprint
// (docks and docked bikes) and each pay station is a collider.

const { THREE, CITY_BOUNDS, blockAt, blocksInRect, nearestRoads, worldFromLatLon } = window.CITY;


const SP = 0.80;        // m between docks (each dock model carries its 0.80 m slice of the base plate)
const CURB_IN = 1.3;    // the docks' line, m in from the curb (the plate's edge 1.04 m in: clear of the street lights'
                        // poles, 0.8 m in, street-details.js)
const BIKE_DEPTH = 2.05; // m from the docks' line to a docked bike's back wheel
const ROW_GAP = 2.75;   // a second row (a station too long for its curb) stands this far behind the first
const AXLE = 0.45;      // a docked bike's front axle, m in front of its dock's centre (its wheel in the dock's slot)
const BIKE_AXLE = 0.56; // the bike model's front axle, m ahead of its origin
const DOCK_CULL = 160, KIOSK_CULL = 220, BIKE_R = 130; // m
const MAX_BIKES = 2400;
const LIVE_EVERY = 60000; // ms

const params = new URLSearchParams(location.search);
const LIVE = params.get('bikes') !== 'static';

function hash(a, b = 0) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// Open sidewalk or plaza: on a block, and not inside one of its lots (a park's ground is open)
function onWalk(x, z) {
  const b = blockAt(x, z);
  if (!b) return false;
  if (b.park > 0.5) return true;
  for (const r of b.rects) if (x > r[0] && x < r[1] && z > r[2] && z < r[3]) return false;
  return true;
}

// The curb edge nearest (x, z): its foot point, its direction (ux, uz) and the normal into its block (nx, nz)
function nearestCurb(x, z, R = 40) {
  const here = blockAt(x, z);
  let best = null;
  for (const b of blocksInRect(x - R, x + R, z - R, z + R)) {
    if (b.median && b !== here) continue; // (a dual carriageway's median strip only if the station is on it)
    const P = b.poly;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[j], c = P[i];
      const ex = c.x - a.x, ez = c.z - a.z, L2 = ex * ex + ez * ez;
      if (L2 < 1e-4) continue;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2));
      const fx = a.x + ex * t, fz = a.z + ez * t, d = Math.hypot(fx - x, fz - z);
      if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, fx, fz, ux: ex / L, uz: ez / L, L, block: b }; }
    }
  }
  if (!best) return null;
  // a short edge (a corner's rounding) is a poor guide: the street's own direction instead, when it runs alongside
  if (best.L < 8) {
    const road = nearestRoads(x, z, 30)[0];
    if (road && Math.abs(road.dx * best.ux + road.dz * best.uz) > 0.7) { best.ux = road.dx; best.uz = road.dz; }
  }
  best.nx = -best.uz; best.nz = best.ux;
  if (blockAt(best.fx + best.nx, best.fz + best.nz) !== best.block) { best.nx = -best.nx; best.nz = -best.nz; }
  return best;
}

// How far a row's line through (cx, cz) along u stays on open ground, docks and bikes both, each way (m)
function freeRun(cx, cz, ux, uz, nx, nz, max = 30) {
  const ok = (t) => onWalk(cx + ux * t, cz + uz * t) && onWalk(cx + ux * t + nx * BIKE_DEPTH, cz + uz * t + nz * BIKE_DEPTH);
  let a = 0, b = 0;
  if (!ok(0)) return { a: 0, b: 0 };
  while (a < max && ok(-(a + 0.4))) a += 0.4;
  while (b < max && ok(b + 0.4)) b += 0.4;
  return { a: a + 0.3, b: b + 0.3 };
}

// A station's layout: its rows of docks (a dock = x, z, yaw), its pay station, its footprint colliders
function layStation(x, z, cap, kiosk) {
  const curb = nearestCurb(x, z);
  let cx = x, cz = z, ux = 1, uz = 0, nx = 0, nz = 1;
  if (curb) {
    ({ ux, uz, nx, nz } = curb);
    // at the curb: the station's spot along it, its docks a little in from the curb, the bikes on the sidewalk side.
    // Further in (a park, a plaza): where it stands, square to the nearest edge
    if (curb.d < 10) { cx = curb.fx + nx * CURB_IN; cz = curb.fz + nz * CURB_IN; }
  }
  const yaw = Math.atan2(nx, nz); // the dock model's +z (its slot, where the bike stands) toward n
  const rows = [];
  let left = cap, off = 0;
  for (let r = 0; left > 0; r++) {
    const rx = cx + nx * off, rz = cz + nz * off;
    const run = freeRun(rx, rz, ux, uz, nx, nz);
    let m = Math.floor((run.a + run.b) / SP);
    if (r === 2 || (r > 0 && m < 3) || m >= left) m = left; // the last row takes the rest
    if (m < 1) m = left;
    const L = m * SP;
    const c = run.a + run.b >= L ? Math.max(-run.a + L / 2, Math.min(run.b - L / 2, 0)) : (run.b - run.a) / 2;
    rows.push({ x: rx + ux * c, z: rz + uz * c, n: m, L });
    left -= m;
    off += ROW_GAP;
    if (r === 0 && left > 0 && !onWalk(rx + nx * ROW_GAP, rz + nz * ROW_GAP)) { rows[0].n += left; rows[0].L = rows[0].n * SP; left = 0; }
  }
  const docks = [];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const t = -row.L / 2 + SP * (i + 0.5);
      docks.push(row.x + ux * t, row.z + uz * t);
    }
  }
  // the pay stations (one per station of the site that has one): just past the first row's ends, the end with room
  // first (their screens toward the sidewalk, like the docks)
  const kiosks = [];
  const r0 = rows[0];
  const ends = [-1, 1].sort((s, t) => onWalk(r0.x + ux * t * (r0.L / 2 + 0.6), r0.z + uz * t * (r0.L / 2 + 0.6)) -
    onWalk(r0.x + ux * s * (r0.L / 2 + 0.6), r0.z + uz * s * (r0.L / 2 + 0.6)));
  for (let k = 0; k < kiosk; k++) {
    const s = ends[k % 2], o = r0.L / 2 + 0.55 + 0.75 * Math.floor(k / 2);
    kiosks.push([r0.x + ux * s * o, r0.z + uz * s * o]);
  }
  return { yaw, ux, uz, nx, nz, rows, docks, kiosks };
}

// Every station's layout, worked out once (before the trees: they keep out of the stations' way). Stations a few
// metres apart (a station and its later extension, listed as two) share one site: one run of docks along the curb,
// the first station's docks first, each with its own pay station at an end.
let SITES = null, FOOT = null;
function layouts() {
  if (SITES) return SITES;
  SITES = [];
  const DATA = window.CITY.BIKE_SHARE;
  if (!DATA) return SITES;
  const all = [];
  for (const [id, lat, lon, cap, hasKiosk] of DATA.stations) {
    const { x, z } = worldFromLatLon(lat, lon);
    if (x < CITY_BOUNDS.minX || x > CITY_BOUNDS.maxX || z < CITY_BOUNDS.minZ || z > CITY_BOUNDS.maxZ) continue;
    all.push({ id, cap, kiosk: hasKiosk, x, z });
  }
  const used = new Set();
  for (let i = 0; i < all.length; i++) {
    if (used.has(i)) continue;
    const members = [all[i]];
    used.add(i);
    for (let j = i + 1; j < all.length; j++) {
      if (!used.has(j) && members.some((s) => Math.hypot(s.x - all[j].x, s.z - all[j].z) < 25)) { members.push(all[j]); used.add(j); }
    }
    members.sort((a, b) => b.cap - a.cap); // the biggest station sets the spot
    const cap = members.reduce((n, s) => n + s.cap, 0);
    const lay = layStation(members[0].x, members[0].z, cap, members.reduce((n, s) => n + s.kiosk, 0));
    let d0 = 0, k = 0;
    for (const s of members) {
      s.first = d0; d0 += s.cap; // its docks: lay.docks[first .. first + cap)
      s.kioskAt = s.kiosk ? lay.kiosks[k++] : null;
    }
    SITES.push({ members, cap, lay });
  }
  // the footprints (each row's plate, docks & docked bikes), for the colliders & the trees
  FOOT = [];
  for (const site of SITES) {
    const { lay } = site;
    const cs = Math.cos(lay.yaw), sn = Math.sin(lay.yaw);
    for (const row of lay.rows) {
      const hx = row.L / 2, hz = (BIKE_DEPTH + 0.45) / 2, off = (BIKE_DEPTH - 0.45) / 2;
      FOOT.push({ cx: row.x + lay.nx * off, cz: row.z + lay.nz * off, hx, hz, cs, sn });
    }
  }
  return SITES;
}

// A tree or a small street prop that would stand in a station (its docks or its docked bikes) is left out: ez-trees.js
// and street-props.js ask (what: 'tree' or 'prop', counted)
let TREE_GRID = null;
const cleared = { tree: 0, prop: 0 };
function bikeShareAt(x, z, what = 'tree') {
  if (!TREE_GRID) {
    layouts();
    TREE_GRID = new Map();
    for (const f of FOOT || []) {
      const r = Math.hypot(f.hx, f.hz) + 1;
      for (let i = Math.floor((f.cx - r) / 50); i <= Math.floor((f.cx + r) / 50); i++) {
        for (let j = Math.floor((f.cz - r) / 50); j <= Math.floor((f.cz + r) / 50); j++) {
          const k = i * 100003 + j;
          if (!TREE_GRID.has(k)) TREE_GRID.set(k, []);
          TREE_GRID.get(k).push(f);
        }
      }
    }
  }
  const list = TREE_GRID.get(Math.floor(x / 50) * 100003 + Math.floor(z / 50));
  if (!list) return false;
  for (const f of list) {
    const dx = x - f.cx, dz = z - f.cz;
    const u = dx * f.cs - dz * f.sn, v = dx * f.sn + dz * f.cs; // into the footprint's own axes (world-collision.js)
    if (Math.abs(u) < f.hx + 0.6 && Math.abs(v) < f.hz + 0.6) { cleared[what] = (cleared[what] || 0) + 1; return true; }
  }
  return false;
}

async function loadModel(loader, file) {
  const gltf = await loader.loadAsync(`./assets/props/${file}.glb`);
  let src = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
  const geo = src.geometry.clone();
  // meshopt quantisation: positions back to floats before the node's transform is baked in (street-props.js)
  const pos = geo.attributes.position;
  if (!(pos.array instanceof Float32Array) || pos.normalized) {
    const f = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { f[3 * i] = pos.getX(i); f[3 * i + 1] = pos.getY(i); f[3 * i + 2] = pos.getZ(i); }
    geo.setAttribute('position', new THREE.BufferAttribute(f, 3));
  }
  src.updateWorldMatrix(true, false);
  geo.applyMatrix4(src.matrixWorld);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geo, material: src.material };
}

async function buildBikeShare(scene) {
  const group = new THREE.Group();
  group.name = 'CityBikeShare';
  const colliders = [];
  const DATA = window.CITY.BIKE_SHARE;
  const { GLTFLoader, MeshoptDecoder } = window.CITY.Addons;
  const none = { group, colliders, update() {}, count: 0 };
  if (!DATA || !DATA.stations.length || !GLTFLoader || !MeshoptDecoder) return none;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let dock, kiosk, bike;
  try {
    [dock, kiosk, bike] = await Promise.all(['bike-share-dock', 'bike-share-kiosk', 'bike-share-bike'].map((f) => loadModel(loader, f)));
  } catch (e) {
    console.warn('[bikeShare] a model did not load:', e);
    return none;
  }
  const material = dock.material; // one material for all three (their shared palette)
  if (material.map) { material.map.magFilter = THREE.NearestFilter; material.map.minFilter = THREE.NearestFilter; material.map.generateMipmaps = false; }

  // 1. every station's place (layouts(): the sites, their docks & pay stations), its colliders
  const sites = layouts();
  const stations = [];
  let nDocks = 0, nKiosks = 0;
  const groundY = (x, z) => (blockAt(x, z) ? CITY_BOUNDS.sidewalkHeight : 0) + (window.CITY.cutAt ? window.CITY.cutAt(x, z) : 0);
  for (const site of sites) {
    const { lay } = site;
    site.dock0 = nDocks;
    site.y = groundY(lay.rows[0].x, lay.rows[0].z);
    for (const s of site.members) {
      // the order its docks fill in (a fixed shuffle: a count that changes by one adds or takes one bike)
      const order = Array.from({ length: s.cap }, (_, i) => i);
      for (let i = s.cap - 1; i > 0; i--) { const j = Math.floor(hash(s.id, i) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const d = 2 * (s.first + Math.floor(s.cap / 2)); // its middle dock: where its bikes are counted from
      stations.push({ id: s.id, cap: s.cap, x: lay.docks[d], z: lay.docks[d + 1], order, dock0: nDocks + s.first, site,
        plausible: Math.round(s.cap * (0.2 + 0.6 * hash(s.id, 7))), live: null });
      if (s.kioskAt) nKiosks++;
    }
    nDocks += site.cap;
  }
  for (const f of FOOT) {
    const ex = Math.abs(f.cs) * f.hx + Math.abs(f.sn) * f.hz, ez = Math.abs(f.sn) * f.hx + Math.abs(f.cs) * f.hz;
    colliders.push({ minX: f.cx - ex, maxX: f.cx + ex, minZ: f.cz - ez, maxZ: f.cz + ez, maxY: groundY(f.cx, f.cz) + 1.2, obb: { ...f } });
  }

  // 2. docks & pay stations: static instanced meshes (scene-culling.js chunks & culls them)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const docksMesh = new THREE.InstancedMesh(dock.geo, material, nDocks);
  docksMesh.name = 'BikeShareDocks';
  const kiosksMesh = new THREE.InstancedMesh(kiosk.geo, material, Math.max(1, nKiosks));
  kiosksMesh.name = 'BikeShareKiosks';
  const slots = new Float32Array(nDocks * 4); // each dock: x, y, z, yaw (the bikes' anchors)
  let di = 0, ki = 0;
  for (const site of sites) {
    const { lay, y } = site;
    q.setFromAxisAngle(up, lay.yaw);
    const cs = Math.cos(lay.yaw), sn = Math.sin(lay.yaw);
    for (let i = 0; i < lay.docks.length; i += 2) {
      const dx = lay.docks[i], dz = lay.docks[i + 1], dy = groundY(dx, dz);
      p.set(dx, dy, dz);
      m.compose(p, q, sc);
      docksMesh.setMatrixAt(di, m);
      slots.set([dx, dy, dz, lay.yaw], di * 4);
      di++;
    }
    for (const s of site.members) {
      if (!s.kioskAt) continue;
      const [kx, kz] = s.kioskAt;
      p.set(kx, y, kz);
      m.compose(p, q, sc);
      kiosksMesh.setMatrixAt(ki++, m);
      colliders.push({ minX: kx - 0.36, maxX: kx + 0.36, minZ: kz - 0.36, maxZ: kz + 0.36, maxY: y + 3.2, obb: { cx: kx, cz: kz, hx: 0.28, hz: 0.22, cs, sn } });
    }
  }
  for (const [mesh, cull] of [[docksMesh, DOCK_CULL], [kiosksMesh, KIOSK_CULL]]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = cull;
    mesh.userData.cullCell = 60;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // 3. the bikes: the nearby stations' docked bikes, one instanced mesh rewritten as the rider moves
  const bikesMesh = new THREE.InstancedMesh(bike.geo, material, MAX_BIKES);
  bikesMesh.name = 'BikeShareBikes';
  bikesMesh.frustumCulled = false; // (a few hundred bikes round the rider: drawn whole, never in scene-culling's chunks)
  bikesMesh.castShadow = true;
  bikesMesh.receiveShadow = true;
  group.add(bikesMesh);
  const CELL = 100;
  const Q = window.CITY.QUALITY || {};
  const grid = new Map();
  stations.forEach((st, i) => {
    const k = Math.floor(st.x / CELL) * 100003 + Math.floor(st.z / CELL);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const bq = new THREE.Quaternion(), bp = new THREE.Vector3();
  let lastX = Infinity, lastZ = Infinity, dirty = true;
  function writeBikes(cx, cz) {
    const bikeR = BIKE_R * (Q.cull || 1) * (Q.dist || 1); // (the phone tiers' shorter reach, like the other props')
    const near = [];
    const r = Math.ceil(bikeR / CELL);
    const ix = Math.floor(cx / CELL), iz = Math.floor(cz / CELL);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const list = grid.get((ix + a) * 100003 + iz + b);
      if (!list) continue;
      for (const i of list) {
        const st = stations[i];
        const d = Math.hypot(st.x - cx, st.z - cz) - st.cap * SP * 0.5;
        if (d < bikeR) near.push([d, st]);
      }
    }
    near.sort((u, v) => u[0] - v[0]);
    let n = 0;
    for (const [, st] of near) {
      const k = Math.min(st.cap, st.live !== null ? st.live : st.plausible);
      for (let j = 0; j < k && n < MAX_BIKES; j++) {
        const s = (st.dock0 + st.order[j]) * 4;
        const yaw = slots[s + 3], w = (hash(st.id, j + 31) - 0.5) * 0.06; // a docked bike sits a touch askew
        const fx = Math.sin(yaw), fz = Math.cos(yaw); // the dock's front (n)
        const o = AXLE + BIKE_AXLE;
        bp.set(slots[s] + fx * o, slots[s + 1], slots[s + 2] + fz * o);
        bq.setFromAxisAngle(up, yaw + Math.PI + w); // the bike's front into the dock
        m.compose(bp, bq, sc);
        bikesMesh.setMatrixAt(n++, m);
      }
    }
    bikesMesh.count = Math.max(n, 0);
    const im = bikesMesh.instanceMatrix;
    if (im.clearUpdateRanges && n) { im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); }
    im.needsUpdate = true;
    stats.bikesShown = n;
    stats.stationsNear = near.length;
  }

  // 4. the live counts
  const stats = { cleared, sites: sites.length, stations: stations.length, docks: nDocks, kiosks: nKiosks, live: false, liveStations: 0, liveAt: null, liveError: null, bikesShown: 0, stationsNear: 0 };
  const byId = new Map(stations.map((st) => [st.id, st]));
  let nextFetch = 0, failures = 0, inFlight = false;
  async function fetchStatus() {
    inFlight = true;
    try {
      const res = await fetch(DATA.statusUrl, { credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      let n = 0;
      const now = Date.now() / 1000;
      for (const s of j.data.stations) {
        const st = byId.get(+s.station_id);
        if (!st) continue;
        // a station that hasn't reported in a day (or is not installed) keeps its plausible fill
        const fresh = s.is_installed !== 0 && (!s.last_reported || now - s.last_reported < 86400);
        st.live = fresh ? Math.max(0, (s.num_bikes_available | 0) + (s.num_bikes_disabled | 0)) : null;
        if (fresh) n++;
      }
      Object.assign(stats, { live: true, liveStations: n, liveAt: new Date((j.last_updated || now) * 1000).toISOString(), liveError: null });
      failures = 0;
      dirty = true;
    } catch (e) {
      failures++;
      stats.liveError = String(e && e.message || e);
      if (failures === 1) console.warn('[bikeShare] the live station status did not load; plausible counts instead:', stats.liveError);
    } finally {
      inFlight = false;
      nextFetch = performance.now() + Math.min(10 * 60000, LIVE_EVERY * (failures ? 2 ** Math.min(failures, 3) : 1));
    }
  }
  if (LIVE && DATA.statusUrl) fetchStatus();

  // the warm-up frame draws one bike, so its pipeline is compiled behind the loading screen (main.js)
  if (stations.length) writeBikes(stations[0].x, stations[0].z);
  if (!bikesMesh.count) { bikesMesh.count = 1; bikesMesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(stations[0].x, -50, stations[0].z)); }

  function update(cam) {
    if (LIVE && DATA.statusUrl && !inFlight && !document.hidden && performance.now() >= nextFetch) fetchStatus();
    if (dirty || Math.hypot(cam.x - lastX, cam.z - lastZ) > 8) {
      lastX = cam.x; lastZ = cam.z; dirty = false;
      writeBikes(cam.x, cam.z);
    }
  }

  scene.add(group);
  window.CITY.bikeShareStats = stats;
  window.CITY.bikeShareStations = stations.map((st) => ({ id: st.id, cap: st.cap, x: st.x, z: st.z, rows: st.site.lay.rows.length, yaw: st.site.lay.yaw, docks: st.site.lay.docks.slice(2 * (st.dock0 - st.site.dock0), 2 * (st.dock0 - st.site.dock0 + st.cap)), shared: st.site.members.length }));
  console.info(`[bikeShare] ${stations.length} stations, ${nDocks} docks, ${nKiosks} pay stations${LIVE ? ', live counts on' : ', plausible counts (?bikes=static)'}`);
  return { group, colliders, update, stats, count: stations.length };
}

Object.assign(window.CITY, { buildBikeShare, bikeShareAt });
})();
