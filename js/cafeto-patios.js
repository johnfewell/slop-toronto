(function () {
// js/cafeto-patios.js
// The City's CaféTO patios (js/toronto-cafeto.js), placed by js/patio-layout.js's rules, built in code: no model files.
// Curb lane cafés are a wooden deck level with the sidewalk in the curb lane, a planter barrier on their three road
// sides with the 1 m emergency gap and reflective posts at the ends; sidewalk cafés are a low black railing round a
// strip against the building face, open at the door. Both carry bistro tables, chairs and, where there is room, an
// umbrella. Every part is one InstancedMesh (eight draw calls for every patio in the city) that scene-culling.js chunks
// and hides with distance; each patio adds one oriented player collider, like a bench. Shown in the CaféTO season only
// (patioSeason against the scene's fixed date); ?patios=0 leaves them out.
//
// The layout is prebuilt (st-cmf): js/toronto-patios.js (tools/build-patios.mjs) holds the sites js/patio-layout.js
// placed in the browser with this city's own inputs, so startup only instances them and adds their colliders. The
// inputs that exist only once the city is built (the solid colliders, the laid-out furniture, the Bike Share
// footprints, the City sidewalk pieces near the cafés) are fingerprinted here and checked against the ones the layout
// was built from: if they differ, the layout is recomputed (js/patio-layout.js loaded then) and a warning names the
// rebuild. ?patios=layout recomputes and exposes CITY.patioLayoutDump (the generator's input); ?patios=check also
// recomputes and compares the result with the prebuilt one (CITY.patioStats.check). docs/cafeto-patios.md.

const { THREE, CITY_BOUNDS } = window.CITY;
const SW = CITY_BOUNDS.sidewalkHeight;

// The CaféTO season against the scene's fixed date. The 2026 guidelines require curb-lane platforms installed by
// June 1 and removed between October 1 and 15; the dataset lists the current season's permits. Patios are shown from
// June 1 to September 30 (sidewalk cafés too: the records carry no dates of their own).
function patioSeason(date = { month: 8, day: 22 }) {
  const md = date.month * 100 + date.day;
  return md >= 601 && md <= 930;
}

// A prebuilt site's fields (js/toronto-patios.js `sites` rows, in this order), merged over its CaféTO record as the
// layout makes them: everything the patio's instances, collider, walkers' detour and lane audit read
const SITE_FIELDS = ['id', 'kind', 'cx', 'cz', 'tx', 'tz', 'nx', 'nz', 'length', 'depth', 'entrance', 'outerLine', 'flank'];
const siteRow = (s) => SITE_FIELDS.map((k) => (k === 'flank' ? (s.flank ? 1 : 0) : k === 'outerLine' ? s.outerLine ?? null : s[k]));
function builtSites(PATIOS, records) {
  const byId = new Map(records.map((r) => [r.id, r]));
  return PATIOS.sites.map((row) => {
    const o = Object.fromEntries(SITE_FIELDS.map((k, i) => [k, row[i]]));
    const rec = byId.get(o.id);
    if (!rec) throw new Error(`patios: prebuilt site ${o.id} has no CaféTO record`);
    const site = { ...rec, ...o };
    if (o.outerLine === null && o.kind !== 'sidewalk') delete site.outerLine;
    if (o.flank) site.flank = true; else delete site.flank;
    return site;
  });
}

// The solid static colliders a café keeps off (landmarks & anything else the GEO buildings don't cover): blocked(x, z)
// over their boxes in a 32 m grid, a 5 cm probe circle against each. `hits` collects the colliders that answered, the
// generator's record of what the layout actually met (tools/build-patios.mjs; tests/cafeto.test.mjs replays them).
function patioBlocked(staticColliders, W, hits = null) {
  const G = 32, grid = new Map();
  for (const c of staticColliders) {
    if (!(c.maxY > SW + 1.5) || c.maxX - c.minX > 400 || c.maxZ - c.minZ > 400) continue;
    for (let i = Math.floor(c.minX / G); i <= Math.floor(c.maxX / G); i++) {
      for (let j = Math.floor(c.minZ / G); j <= Math.floor(c.maxZ / G); j++) {
        const k = i * 100003 + j;
        (grid.get(k) || grid.set(k, []).get(k)).push(c);
      }
    }
  }
  const probe = W?.circleShape(0, 0, 0.05);
  return (x, z) => {
    for (const c of grid.get(Math.floor(x / G) * 100003 + Math.floor(z / G)) || []) {
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (!W) { hits?.add(c); return true; }
      W.circleShape(x, z, 0.05, probe);
      if (W.contact(probe, c)) { hits?.add(c); return true; }
    }
    return false;
  };
}

// What of a collider the layout can see (blocked above): its box and its outline
const COLLIDER_FIELDS = ['minX', 'maxX', 'minZ', 'maxZ', 'maxY', 'obb', 'circle', 'polygon'];
const pickCollider = (c) => Object.fromEntries(COLLIDER_FIELDS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]));

// The runtime inputs of the layout near the CaféTO records (80 m cells round each address, wider than any probe of
// patio-layout.js reaches): the solid colliders blocked() keeps (the filter above), the laid-out furniture, the Bike
// Share footprints and the City sidewalk pieces (city-grid.js) of the islands there. `fingerprint` is order-free: per
// input, the count and the sums of two 32-bit hashes of every item's numbers (to 0.1 mm) and kind.
function hasher() {
  let h1 = 0, h2 = 0, a = 0, b = 0, n = 0;
  return {
    begin() { h1 = 0x9e3779b1; h2 = 0x85ebca6b; },
    num(v) {
      const k = Math.round(v * 1e4) | 0; // (coordinates within ±214 km)
      h1 = Math.imul(h1 ^ k, 0x5bd1e995); h1 ^= h1 >>> 15;
      h2 = Math.imul(h2 + k, 0xc2b2ae35); h2 ^= h2 >>> 13;
    },
    str(t) { for (let i = 0; i < t.length; i++) this.num(t.charCodeAt(i) / 1e4); this.num(-1e-4); },
    end() { a = (a + (h1 >>> 0)) >>> 0; b = (b + (h2 >>> 0)) >>> 0; n++; },
    value: () => `${n}:${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
  };
}
function patioInputs(CITY, records, staticColliders, furniture) {
  // (the cells as a bitmap over the records' extent, one test per cell)
  const C = 80;
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const r of records) {
    const i = Math.floor(r.x / C), j = Math.floor(r.z / C);
    if (i - 1 < i0) i0 = i - 1; if (i + 1 > i1) i1 = i + 1; if (j - 1 < j0) j0 = j - 1; if (j + 1 > j1) j1 = j + 1;
  }
  const W = i1 - i0 + 1, cells = new Uint8Array(Math.max(0, W * (j1 - j0 + 1)));
  for (const r of records) {
    const i = Math.floor(r.x / C), j = Math.floor(r.z / C);
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) cells[(b - j0) * W + a - i0] = 1;
  }
  const near = (x0, x1, z0, z1) => {
    const a0 = Math.max(i0, Math.floor(x0 / C)), a1 = Math.min(i1, Math.floor(x1 / C));
    const b0 = Math.max(j0, Math.floor(z0 / C)), b1 = Math.min(j1, Math.floor(z1 / C));
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) if (cells[(b - j0) * W + a - i0]) return true;
    return false;
  };
  const h = { colliders: hasher(), furniture: hasher(), bikeShare: hasher(), sidewalks: hasher() };
  const colliders = [];
  for (const c of staticColliders) {
    if (!(c.maxY > SW + 1.5) || c.maxX - c.minX > 400 || c.maxZ - c.minZ > 400 || !near(c.minX, c.maxX, c.minZ, c.maxZ)) continue;
    colliders.push(c);
    const k = h.colliders;
    k.begin(); k.num(c.minX); k.num(c.maxX); k.num(c.minZ); k.num(c.maxZ);
    if (c.obb) { k.num(1); k.num(c.obb.cx); k.num(c.obb.cz); k.num(c.obb.hx); k.num(c.obb.hz); k.num(c.obb.cs); k.num(c.obb.sn); }
    if (c.circle) { k.num(2); k.num(c.circle.x); k.num(c.circle.z); k.num(c.circle.r); }
    if (c.polygon) { k.num(3); for (const p of c.polygon) { k.num(p.x); k.num(p.z); } }
    k.end();
  }
  const nearFurniture = furniture.filter((f) => near(f.x, f.x, f.z, f.z));
  for (const f of nearFurniture) { const k = h.furniture; k.begin(); k.str(f.kind); k.num(f.x); k.num(f.z); k.end(); }
  for (const f of CITY.bikeShareFootprints?.() || []) {
    const r = Math.hypot(f.hx, f.hz) + 1;
    if (!near(f.cx - r, f.cx + r, f.cz - r, f.cz + r)) continue;
    const k = h.bikeShare;
    k.begin(); k.num(f.cx); k.num(f.cz); k.num(f.hx); k.num(f.hz); k.num(f.cs); k.num(f.sn); k.end();
  }
  for (const [id, list] of CITY.sidewalkPieceMap || []) {
    for (const piece of list) {
      for (const ring of [piece.outer, ...piece.holes]) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const p of ring) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; }
        if (!near(x0, x1, z0, z1)) continue;
        const k = h.sidewalks;
        k.begin(); k.str(String(id)); for (const p of ring) { k.num(p.x); k.num(p.z); } k.end();
      }
    }
  }
  const fingerprint = Object.fromEntries(Object.entries(h).map(([name, k]) => [name, k.value()]));
  return { colliders, furniture: nearFurniture, fingerprint };
}
// (the same hash over plain lists of numbers & strings: tests/cafeto.test.mjs)
function fingerprintOf(list) {
  const k = hasher();
  for (const item of list) { k.begin(); for (const v of item) (typeof v === 'string' ? k.str(v) : k.num(v)); k.end(); }
  return k.value();
}

// js/patio-layout.js, loaded on demand (the build fingerprints its URL like the page's scripts)
let layoutScript = null;
function loadLayoutScript() {
  if (window.CITY.patioSites) return Promise.resolve();
  layoutScript ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './js/patio-layout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('patios: js/patio-layout.js did not load'));
    document.head.appendChild(s);
  });
  return layoutScript;
}

// The layout the runtime algorithm makes now, with the city's own inputs (as before st-cmf)
async function runtimeLayout(CITY, records, staticColliders, furniture, bikeShareAt) {
  await loadLayoutScript();
  const hits = new Set();
  const blocked = patioBlocked(staticColliders, CITY.WorldCollision, hits);
  const layout = CITY.patioSites(records, CITY.patioDeps(CITY, { furniture, blocked, bikeShareAt }));
  return { ...layout, sites: layout.sites.map(({ rect, ...s }) => s), hits };
}

// Two layouts' placements (the fields the patios are built from), rejections and blockers alike: [] or what differs
function compareLayouts(built, runtime) {
  const diff = [];
  const a = built.sites.map((s) => JSON.stringify(siteRow(s))), b = runtime.sites.map((s) => JSON.stringify(siteRow(s)));
  if (a.length !== b.length) diff.push(`sites ${a.length} vs ${b.length}`);
  for (let i = 0; i < Math.max(a.length, b.length) && diff.length < 8; i++) if (a[i] !== b[i]) diff.push(`site ${i}: ${a[i]} vs ${b[i]}`);
  for (const k of ['rejected', 'blockers']) {
    const x = JSON.stringify(Object.entries(built[k] || {}).sort()), y = JSON.stringify(Object.entries(runtime[k] || {}).sort());
    if (x !== y) diff.push(`${k} ${x} vs ${y}`);
  }
  return diff;
}

function hash(a, b) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// a geometry's parts, each with a vertex colour, merged (bottom at y = 0 unless placed otherwise)
function coloured(parts) {
  const geos = parts.map(([g, hex]) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g.index ? g.toNonIndexed() : g;
  });
  const merged = window.CITY.Addons.mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (r0, r1, h, seg, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y + h / 2, z);

// one bistro table (0.6 m round top at 0.74 m), one chair (seat at 0.45 m, back to -z), one umbrella (pole, cone canopy
// at 2.2 m: CaféTO wants the fabric 2.1 m up), unit parts for decks, barriers, planting, railings and posts
function partGeometries() {
  const table = coloured([[cyl(0.3, 0.3, 0.03, 14, 0, 0.71), 0xe9e4da], [cyl(0.025, 0.025, 0.7, 6, 0, 0.01), 0x262626], [cyl(0.2, 0.22, 0.02, 10), 0x262626]]);
  const legs = [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]].map(([x, z]) => [box(0.03, 0.45, 0.03, x, 0, z), 0xffffff]);
  const chair = coloured([[box(0.4, 0.04, 0.4, 0, 0.43, 0), 0xffffff], [box(0.4, 0.38, 0.03, 0, 0.47, -0.19), 0xffffff], ...legs]);
  const umbrella = coloured([[cyl(0.02, 0.02, 2.25, 5), 0xd8d4cc], [new THREE.ConeGeometry(1, 0.42, 8, 1, true).translate(0, 2.2 + 0.21, 0), 0xffffff]]);
  const unit = box(1, 1, 1);
  const post = cyl(0.05, 0.05, 1, 6);
  return { table, chair, umbrella, deck: unit, barrier: unit.clone(), planting: unit.clone(), rail: unit.clone(), post };
}

// Where a café's table sets go along [from, to] (each set a table with a chair either side, 1.75 m), clear of the door
// at `door`. A short café whose sets all stood in the door's way gets them pushed to either side of it instead.
function tableSpots(from, to, door) {
  const step = 1.75, n = Math.max(1, Math.floor((to - from) / step)), pad = (to - from - n * step) / 2;
  const spots = Array.from({ length: n }, (_, k) => from + pad + step * (k + 0.5)).filter((u) => Math.abs(u - door) >= 0.95);
  if (spots.length) return spots;
  const fit = (u) => Math.min(to - 0.6, Math.max(from + 0.6, u));
  return [fit(door + 1.2), fit(door - 1.2)].filter((u, i, a) => Math.abs(u - door) >= 0.95 && a.indexOf(u) === i).slice(0, 1);
}

const CHAIR_COLOURS = [0x1d1d1d, 0x2f5d3a, 0x8c2f2a, 0xb08a5a, 0x3b4f6b, 0xd9d4c7];
const CANOPY_COLOURS = [0xf1ebdc, 0x9e2b25, 0x2f5d3a, 0x22344f, 0x1f1f1f, 0xd8b04a];

async function buildPatios(scene, staticColliders = [], { furniture = [], bikeShareAt = null } = {}) {
  const CITY = window.CITY;
  const records = CITY.CAFETO?.records || [];
  const date = CITY.SCENE_DATE || { month: 8, day: 22 }; // (lighting.js: the scene's fixed day, 22 August)
  const stats = { source: CITY.CAFETO?.source || null, counts: CITY.CAFETO?.counts || null, season: patioSeason(date),
    accepted: 0, placed: { sidewalk: 0, curb: 0 }, rejected: {}, sites: [], instances: {} };
  CITY.patioStats = stats;
  const mode = new URLSearchParams(location.search).get('patios'); // '0' off, 'layout' or 'check' recompute
  const off = mode === '0';
  if (!records.length || off || !stats.season) {
    console.info(`[patios] none: ${off ? '?patios=0' : !stats.season ? `out of the CaféTO season on ${date.month}/${date.day}` : 'no data'}`);
    return { group: null, colliders: [], pedestrianObstacles: [] };
  }
  const t0 = performance.now();
  // the prebuilt layout, if the city's runtime inputs are still the ones it was built from
  const inputs = patioInputs(CITY, records, staticColliders, furniture);
  const PATIOS = CITY.PATIOS;
  const stale = PATIOS ? Object.keys(inputs.fingerprint).filter((k) => PATIOS.fingerprint?.[k] !== inputs.fingerprint[k]) : ['no js/toronto-patios.js'];
  stats.fingerprint = { ok: !stale.length, stale, ms: Math.round((performance.now() - t0) * 10) / 10 };
  let layout;
  if (mode === 'layout' || mode === 'check' || stale.length) {
    if (stale.length && mode !== 'layout') {
      console.warn(`[patios] the prebuilt layout (js/toronto-patios.js) was built from other ${stale.join(', ')}: laid out at startup instead. ` +
        'Rebuild it: tools/build-patios.mjs (docs/cafeto-patios.md)');
    }
    const runtime = await runtimeLayout(CITY, records, staticColliders, furniture, bikeShareAt);
    if (mode === 'layout') {
      // the generator's input (tools/shots/patio-layout.json, tools/build-patios.mjs): what the algorithm placed and the
      // runtime inputs it met, near the records
      CITY.patioLayoutDump = { fingerprint: inputs.fingerprint, fields: SITE_FIELDS, sites: runtime.sites.map(siteRow),
        rejected: runtime.rejected, blockers: runtime.blockers, reasons: runtime.reasons,
        replay: { furniture: inputs.furniture, colliders: [...runtime.hits].map(pickCollider) } };
    }
    if (mode === 'check' && PATIOS) {
      const diff = compareLayouts({ sites: builtSites(PATIOS, records), rejected: PATIOS.rejected, blockers: PATIOS.blockers }, runtime);
      stats.check = { identical: !diff.length, sites: runtime.sites.length, diff };
      (diff.length ? console.error : console.info)(`[patios] check: the prebuilt layout is ${diff.length ? 'NOT ' : ''}the runtime algorithm's ` +
        `(${runtime.sites.length} sites)${diff.length ? ': ' + diff.join('; ') : ''}`);
    }
    layout = mode === 'check' && PATIOS && !stale.length
      ? { sites: builtSites(PATIOS, records), rejected: PATIOS.rejected, blockers: PATIOS.blockers, reasons: runtime.reasons }
      : runtime;
    stats.layout = mode === 'check' && PATIOS && !stale.length ? 'prebuilt (checked)' : 'runtime';
  } else {
    layout = { sites: builtSites(PATIOS, records), rejected: PATIOS.rejected, blockers: PATIOS.blockers };
    stats.layout = 'prebuilt';
  }
  Object.assign(stats, { accepted: layout.sites.length, rejected: layout.rejected, blockers: layout.blockers, sites: layout.sites });
  if (layout.reasons) stats.reasons = layout.reasons;

  // the instances, in each patio's frame: u along the frontage, v out from the road (toward the building), y up
  const P = { deck: [], barrier: [], planting: [], post: [], rail: [], table: [], chair: [], umbrella: [] };
  const colliders = [], pedestrianObstacles = [];
  for (const s of layout.sites) {
    // world point of (u, v) with the patio centre at the origin
    const at = (u, v) => [s.cx + s.tx * u + s.nx * v, s.cz + s.tz * u + s.nz * v];
    // a part at (u, v), height y, scaled (sx along the frontage, sz across it); `heading`: the world direction its local
    // +z faces (a chair's front), else across the frontage (n), which suits the symmetric parts
    const put = (key, u, v, y, sx, sy, sz, heading = null, colour = null) => {
      const [x, z] = at(u, v);
      P[key].push({ x, y, z, sx, sy, sz, rot: heading ?? Math.atan2(s.nx, s.nz), colour });
    };
    const toward = (sign) => Math.atan2(sign * s.tx, sign * s.tz); // facing +t or -t
    const L = s.length, D = s.depth, hl = L / 2, hd = D / 2;
    const variety = hash(s.cx, s.cz), chairColour = CHAIR_COLOURS[Math.floor(variety * CHAIR_COLOURS.length)];
    const canopy = CANOPY_COLOURS[Math.floor(hash(s.cz, s.cx) * CANOPY_COLOURS.length)];
    const ground = s.kind === 'curb' ? (CITY.cutAt?.(s.cx, s.cz) || 0) : SW + (CITY.cutAt?.(s.cx, s.cz) || 0);
    // table sets along a line at depth v, avoiding the door's gap
    const sets = (v, from, to, small, door = s.entrance) => {
      for (const u of tableSpots(from, to, door)) {
        put('table', u, v, ground + (s.kind === 'curb' ? SW : 0), small ? 0.85 : 1, 1, small ? 0.85 : 1);
        // two chairs across the table along the frontage, each facing it (a little askew)
        const y = ground + (s.kind === 'curb' ? SW : 0);
        put('chair', u - 0.55, v, y, 1, 1, 1, toward(1) + (hash(u + s.cx, v) - 0.5) * 0.4, chairColour);
        put('chair', u + 0.55, v, y, 1, 1, 1, toward(-1) + (hash(v, u + s.cz) - 0.5) * 0.4, chairColour);
      }
    };
    if (s.kind === 'curb') {
      // v runs from the road side (-hd) to the curb (+hd)
      put('deck', 0, 0, ground, L, SW, D);
      const bh = 0.95, bt = 0.22, gap = 1.0;
      // road side, split by the emergency access gap at the middle; the two ends
      const run = (hl - gap / 2);
      put('barrier', -(gap / 2 + run / 2), -hd + bt / 2, ground + SW, run, bh - SW, bt);
      put('barrier', gap / 2 + run / 2, -hd + bt / 2, ground + SW, run, bh - SW, bt);
      put('barrier', -hl + bt / 2, 0, ground + SW, bt, bh - SW, D);
      put('barrier', hl - bt / 2, 0, ground + SW, bt, bh - SW, D);
      put('planting', -(gap / 2 + run / 2), -hd + bt / 2, ground + bh, run - 0.05, 0.22, bt - 0.04);
      put('planting', gap / 2 + run / 2, -hd + bt / 2, ground + bh, run - 0.05, 0.22, bt - 0.04);
      for (const u of [-hl + 0.1, hl - 0.1]) put('post', u, -hd + 0.1, ground, 1, 1.15, 1);
      sets(0.05, -hl + bt + 0.1, hl - bt - 0.1, false);
      if (variety < 0.7) for (const u of (L > 6 ? [-hl / 2, hl / 2] : [0])) put('umbrella', u, 0.05, ground + SW, 0.85, 1, 0.85, null, canopy);
      colliders.push(obb(s.cx, s.cz, s, hl, hd, ground, ground + 1.15));
    } else {
      // v runs from the clearway side (-hd) to the wall (+hd); a railing on the street side and the ends, open at the door
      // the railed run [a, b]: a piece beyond the door too short for a table set (under 1.2 m) is left off
      let a = -hl, b = hl, door = Math.abs(s.entrance) < hl - 0.7 ? s.entrance : null;
      if (door !== null && b - (door + 0.6) < 1.2) { b = door - 0.6; door = null; }
      else if (door !== null && (door - 0.6) - a < 1.2) { a = door + 0.6; door = null; }
      const rh = 0.9;
      const rail = (u0, u1, v) => {
        if (u1 - u0 < 0.1) return;
        const m = (u0 + u1) / 2, len = u1 - u0;
        put('rail', m, v, ground + rh - 0.04, len, 0.04, 0.04);
        put('rail', m, v, ground + 0.08, len, 0.04, 0.04); // (a solid base a cane finds)
        for (let k = 0, n = Math.max(1, Math.round(len / 1.5)); k <= n; k++) put('rail', u0 + (len * k) / n, v, ground, 0.04, rh, 0.04);
      };
      if (door === null) rail(a, b, -hd);
      else { rail(a, door - 0.6, -hd); rail(door + 0.6, b, -hd); }
      for (const u of [a, b]) {
        put('rail', u, 0, ground + rh - 0.04, 0.04, 0.04, D);
        put('rail', u, 0, ground + 0.08, 0.04, 0.04, D);
      }
      const small = D < 1.6;
      sets(small ? hd - 0.45 : 0, a + 0.3, b - 0.3, small, door ?? Infinity);
      if (D >= 1.5 && variety < 0.6) put('umbrella', (a + b) / 2, 0, ground, Math.min(1.05, hd + 0.15), 1, Math.min(1.05, hd + 0.15), null, canopy);
      const [ccx, ccz] = at((a + b) / 2, 0);
      colliders.push(obb(ccx, ccz, s, (b - a) / 2, hd, ground, ground + 1));
      // the walkers' outer line along this edge goes round it (pedestrian-routes.js: a detour toward the curb past it)
      if (s.outerLine !== null && s.outerLine !== undefined) {
        const ex = Math.abs(s.tx) * hl + Math.abs(s.nx) * hd, ez = Math.abs(s.tz) * hl + Math.abs(s.nz) * hd;
        pedestrianObstacles.push({ minX: s.cx - ex, maxX: s.cx + ex, minZ: s.cz - ez, maxZ: s.cz + ez, minY: ground, maxY: ground + 1 });
      }
    }
    stats.placed[s.kind]++;
  }

  // the meshes: one per part, each instance a turned & scaled unit (or model) at its spot
  const geos = partGeometries();
  const mats = {
    deck: new THREE.MeshStandardNodeMaterial({ color: 0x8a6748, roughness: 0.85 }),
    barrier: new THREE.MeshStandardNodeMaterial({ color: 0x6e5038, roughness: 0.8 }),
    planting: new THREE.MeshStandardNodeMaterial({ color: 0x41672f, roughness: 0.95 }),
    post: new THREE.MeshStandardNodeMaterial({ color: 0xf2f2ee, roughness: 0.4, emissive: 0x0f0f0c }),
    rail: new THREE.MeshStandardNodeMaterial({ color: 0x1b1c1d, roughness: 0.5, metalness: 0.6 }),
    table: new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5 }),
    chair: new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6 }),
    umbrella: new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })
  };
  const SHADOWS = { deck: false, barrier: true, planting: false, post: false, rail: false, table: false, chair: false, umbrella: true };
  const CULL = { deck: 220, barrier: 220, planting: 160, post: 120, rail: 120, table: 110, chair: 90, umbrella: 180 };
  const group = new THREE.Group();
  group.name = 'CafeTOPatios';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (const [key, list] of Object.entries(P)) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geos[key], mats[key], list.length);
    mesh.name = `Patios_${key}`;
    list.forEach((it, i) => {
      p.set(it.x, it.y, it.z);
      q.setFromAxisAngle(up, it.rot);
      sc.set(it.sx, it.sy, it.sz);
      mesh.setMatrixAt(i, m.compose(p, q, sc));
      if (it.colour !== null && (key === 'chair' || key === 'umbrella')) mesh.setColorAt(i, col.setHex(it.colour));
    });
    if ((key === 'chair' || key === 'umbrella') && !mesh.instanceColor) mesh.setColorAt(0, col.setHex(0xffffff));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = SHADOWS[key];
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = CULL[key];
    mesh.userData.cullCell = 60;
    mesh.computeBoundingSphere();
    group.add(mesh);
    stats.instances[key] = list.length;
  }
  scene.add(group);
  stats.ms = Math.round(performance.now() - t0);
  console.info(`[patios] CaféTO: ${stats.placed.sidewalk} sidewalk cafés, ${stats.placed.curb} curb lane cafés placed of ` +
    `${records.length} (${CITY.CAFETO.counts.private} private patios not placed); rejected ${JSON.stringify(layout.rejected)}; ` +
    `${stats.layout} layout, ${stats.ms} ms`);
  return { group, colliders, pedestrianObstacles };
}

// an oriented collider over a patio's footprint, like a bench's (street-props.js)
function obb(cx, cz, s, hl, hd, minY, maxY) {
  // the footprint's frame: hx along the frontage, hz across it, turned like buildings.js's parts
  const ang = Math.atan2(s.nx, s.nz), cs = Math.cos(ang), sn = Math.sin(ang);
  const rx = Math.abs(cs) * hl + Math.abs(sn) * hd, rz = Math.abs(sn) * hl + Math.abs(cs) * hd;
  return { minX: cx - rx, maxX: cx + rx, minZ: cz - rz, maxZ: cz + rz, minY, maxY, obb: { cx, cz, hx: hl, hz: hd, cs, sn } };
}

// After the traffic is built: any curb lane platform a traffic lane runs within a car's half width (+0.3 m) of. The
// rules keep platforms clear of the lanes they model (road-network.js); this checks the lanes actually built.
function auditPatioLanes(network) {
  const stats = window.CITY.patioStats;
  if (!stats?.sites?.length || !network?.edges) return null;
  const conflicts = [];
  for (const s of stats.sites) {
    if (s.kind !== 'curb') continue;
    const hl = s.length / 2, hd = s.depth / 2;
    for (const e of network.edges) {
      if (Math.min(e.h0 || 0, e.h1 || 0) > 2) continue;
      // the platform's centre in the edge's frame
      const px = s.cx - e.x0, pz = s.cz - e.z0, along = px * e.dx + pz * e.dz;
      if (along < -hl - 2 || along > e.span + hl + 2) continue;
      const across = px * e.rx + pz * e.rz;
      if (Math.abs(across) > 15) continue;
      for (const o of e.lanes) {
        // the lane's line crosses within 1.3 m of the platform (its half depth, turned to the lane: the street's own axis)
        const c = Math.abs(e.dx * s.tx + e.dz * s.tz);
        const reach = hd * c + hl * Math.sqrt(Math.max(0, 1 - c * c)) + 1.3;
        if (Math.abs(across - o) < reach && along > -hl && along < e.span + hl) { conflicts.push({ id: s.id, lane: o, across: +across.toFixed(2) }); break; }
      }
    }
  }
  stats.laneConflicts = conflicts;
  console.info(`[patios] curb lane platforms within a car's reach of a traffic lane: ${conflicts.length}`);
  return conflicts;
}

Object.assign(window.CITY, { buildPatios, auditPatioLanes, patioTableSpots: tableSpots, patioSeason, patioBlocked, patioInputs,
  patioFingerprint: fingerprintOf, builtPatioSites: builtSites, patioSiteRow: siteRow, PATIO_SITE_FIELDS: SITE_FIELDS });
})();
