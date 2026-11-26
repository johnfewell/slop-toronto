(function () {
// js/roadworks.js
// Real road works and closures from the City of Toronto's Road Restrictions open data, drawn on the roads they are reported
// on: orange-and-white barrels and cones down a closed kerb lane, jersey barriers or barricades across a closed road, a
// "ROAD CLOSED" / "ROAD WORK" / "LANE CLOSED" sign, an arrow board on a big road's long works.
//
// Data: /live/roadworks (worker/live.js, worker/roadworks.js): the City's feed, cut to the records in the playable frames and
// cached by the Worker for 15 minutes. The page asks for it as it loads (CITY.roadworksFeed, a Promise) and waits for it,
// at most FEED_WAIT_MS, just before the street furniture is drawn. A feed that is down, late or malformed draws nothing and
// raises nothing: the city is exactly what it was without this file. ?roadworks=0 leaves it out altogether.
//
// Only the records in effect on the scene's day are drawn (js/roadworks-layout.js: the City's dates and weekday schedule;
// the day the city opened on, today's for a preset, whose summer day is only a look). They are the City's *reported*
// restrictions: submitted by the permit applicants and not field verified, with no lane geometry, so where the barrels
// stand is a rule (roadworks-layout.js), and the card each shows (CITY.roadworksCard) says so and carries the City's own
// words and dates. Not drawn: sidewalks, crossings, streetcar tracks, junctions, flyovers, parked cars or anything solid.
//
// One instanced mesh per kind (cone, barrel, jersey barrier, barricade, three signs, arrow board), all one material over
// one canvas atlas: eight draw calls for the city, chunked and distance-culled by scene-culling.js (group CityRoadworks).
// Every piece is solid to the player like other street furniture. A full closure's rows are also boxes the traffic keeps
// behind (traffic.js setObstacles), and the traffic edges a closure covers whole are closed to cars (closeEdges).

const C = window.CITY;
const FEED_URL = './live/roadworks';
const FEED_WAIT_MS = 2500, FEED_TIMEOUT_MS = 6000;
const params = () => new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const enabled = () => params().get('roadworks') !== '0';

/** Starts the feed request (once). Resolves { t, counts, records } or null. */
function fetchRoadworks() {
  if (!enabled()) return Promise.resolve(null);
  const override = params().get('roadworksFeed'); // (a same-origin file: the captures' recorded feed)
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), FEED_TIMEOUT_MS);
  return fetch(override && override.startsWith('/') ? override : FEED_URL, { signal: ctl ? ctl.signal : undefined })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data && Array.isArray(data.records) && Number.isFinite(data.t) ? data : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}
C.roadworksFeed = fetchRoadworks();

// ---------------------------------------------------------------------------------------------------------------------
// The look: one atlas, one material
// ---------------------------------------------------------------------------------------------------------------------
// cells (4 x 4, row 0 on top): 0 orange, 1 white, 2 black, 3 concrete, 4 steel, 5 red, 6 diagonal stripes, 7 ROAD CLOSED,
// 8 ROAD WORK, 9 LANE CLOSED, 10 arrow board
const CELL = 256, GRID = 4;
const cellRect = (i) => ({ u0: (i % GRID) / GRID, v1: 1 - Math.floor(i / GRID) / GRID, u1: (i % GRID + 1) / GRID, v0: 1 - (Math.floor(i / GRID) + 1) / GRID });
const cellMid = (i) => { const r = cellRect(i); return [(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2]; };
const ORANGE = '#f26a10', WHITE = '#efefe9', BLACK = '#1b1b1b';

function paintAtlas(THREE) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = CELL * GRID;
  const g = cv.getContext('2d');
  const at = (i) => [(i % GRID) * CELL, Math.floor(i / GRID) * CELL];
  const fill = (i, col) => { const [x, y] = at(i); g.fillStyle = col; g.fillRect(x, y, CELL, CELL); };
  fill(0, ORANGE); fill(1, WHITE); fill(2, BLACK); fill(3, '#a9a79f'); fill(4, '#7b8086'); fill(5, '#b3202a');
  // rails: stripes slanting across a 2.4 x 0.22 m rail (the cell is stretched over it: 32 px of 256 is 0.3 m along it, the
  // slant over the full height is 23.5 px)
  {
    const [x, y] = at(6);
    g.save(); g.beginPath(); g.rect(x, y, CELL, CELL); g.clip();
    g.fillStyle = WHITE; g.fillRect(x, y, CELL, CELL);
    g.fillStyle = ORANGE;
    for (let k = -2; k < 6; k++) { const x0 = x + k * 64 + 8; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 32, y); g.lineTo(x0 + 32 + 23.5, y + CELL); g.lineTo(x0 + 23.5, y + CELL); g.closePath(); g.fill(); }
    g.restore();
  }
  const text = (s, cx, cy, size, col, max) => {
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    g.fillText(s, cx, cy, max);
  };
  // ROAD CLOSED: a 256 x 170 plate in the cell (its panel maps that rectangle), white on red with a white border
  {
    const [x, y] = at(7), top = y + 43;
    g.fillStyle = WHITE; g.fillRect(x, top, CELL, 170);
    g.fillStyle = '#c4202b'; g.fillRect(x + 8, top + 8, CELL - 16, 154);
    text('ROAD', x + CELL / 2, top + 58, 62, WHITE, 220);
    text('CLOSED', x + CELL / 2, top + 118, 62, WHITE, 220);
  }
  // the diamonds: orange with a black border and legend
  const diamond = (i, a, b) => {
    const [x, y] = at(i);
    g.fillStyle = BLACK; g.fillRect(x, y, CELL, CELL);
    g.fillStyle = ORANGE; g.fillRect(x + 9, y + 9, CELL - 18, CELL - 18);
    g.strokeStyle = BLACK; g.lineWidth = 4; g.strokeRect(x + 17, y + 17, CELL - 34, CELL - 34);
    text(a, x + CELL / 2, y + 100, 46, BLACK, 200);
    text(b, x + CELL / 2, y + 156, 46, BLACK, 200);
  };
  diamond(8, 'ROAD', 'WORK'); diamond(9, 'LANE', 'CLOSED');
  // the arrow board: a black plate (256 x 128 of the cell) with a row of amber lamps, the caution bar
  {
    const [x, y] = at(10), top = y + 64;
    g.fillStyle = BLACK; g.fillRect(x, top, CELL, 128);
    g.fillStyle = '#ffb21c';
    for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(x + 32 + k * 32, top + 64, 10, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#5b3d08';
    for (let k = 0; k < 7; k++) for (const dy of [-34, 34]) { g.beginPath(); g.arc(x + 32 + k * 32, top + 64 + dy, 6, 0, Math.PI * 2); g.fill(); }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// geometry: non-indexed position / normal / uv, merged per kind. y up from the ground, x across (a row's width), z its face
function makeGeometries(THREE) {
  const { mergeGeometries } = C.Addons;
  const prep = (geo, matrix) => {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (matrix) g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    return g;
  };
  const paint = (g, cell, sub) => {
    const n = g.attributes.position.count, uv = new Float32Array(n * 2);
    const [u, v] = cellMid(cell);
    for (let i = 0; i < n; i++) { uv[2 * i] = u; uv[2 * i + 1] = v; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  };
  const M = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  const solid = (geo, cell, matrix) => paint(prep(geo, matrix), cell);
  const box = (w, h, d, x, y, z, cell, rot) => solid(new THREE.BoxGeometry(w, h, d), cell, rot ? M(x, y, z, ...rot) : M(x, y, z));
  const frustum = (r0, r1, h, y, cell, seg) => solid(new THREE.CylinderGeometry(r1, r0, h, seg), cell, M(0, y + h / 2, 0));
  // a box whose two z faces show part of a cell: sub = [u0, v0, u1, v1] fractions of the cell; the rest `rest`
  const faceBox = (w, h, d, x, y, z, faceCell, sub, rest, rot) => {
    const g = prep(new THREE.BoxGeometry(w, h, d), M(x, y, z, ...(rot || [0, 0, 0])));
    const uv = new Float32Array(g.attributes.position.count * 2), [ru, rv] = cellMid(rest), r = cellRect(faceCell);
    // BoxGeometry's faces, 6 vertices each once non-indexed: +x -x +y -y +z -z
    for (let i = 0; i < g.attributes.position.count; i++) { uv[2 * i] = ru; uv[2 * i + 1] = rv; }
    // the +z face (vertices 24..29): its uv from the box's own (0..1) to the cell's sub-rectangle
    const src = new THREE.BoxGeometry(w, h, d).toNonIndexed().attributes.uv;
    for (let i = 24; i < 30; i++) {
      uv[2 * i] = r.u0 + (sub[0] + src.getX(i) * (sub[2] - sub[0])) * (r.u1 - r.u0);
      uv[2 * i + 1] = r.v0 + (sub[1] + src.getY(i) * (sub[3] - sub[1])) * (r.v1 - r.v0);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  };

  // cone: 0.7 m, black base plate, orange with two white bands
  const cone = mergeGeometries([
    box(0.38, 0.03, 0.38, 0, 0.015, 0, 2),
    frustum(0.15, 0.125, 0.2, 0.03, 0, 8), frustum(0.125, 0.11, 0.1, 0.23, 1, 8), frustum(0.11, 0.09, 0.07, 0.33, 0, 8),
    frustum(0.09, 0.075, 0.1, 0.40, 1, 8), frustum(0.075, 0.03, 0.2, 0.50, 0, 8)
  ]);
  // barrel (drum): 0.95 m, alternating orange & white bands, black cap ring
  const barrel = mergeGeometries([
    frustum(0.28, 0.28, 0.2, 0, 0, 10), frustum(0.28, 0.28, 0.14, 0.2, 1, 10), frustum(0.28, 0.28, 0.16, 0.34, 0, 10),
    frustum(0.28, 0.28, 0.14, 0.5, 1, 10), frustum(0.28, 0.28, 0.16, 0.64, 0, 10), frustum(0.30, 0.30, 0.08, 0.8, 0, 10), frustum(0.30, 0.26, 0.07, 0.88, 2, 10)
  ]);
  // jersey barrier, 3 m long along x, 0.82 high, an orange reflective band along the top
  const profile = new THREE.Shape([[-0.3, 0], [0.3, 0], [0.3, 0.2], [0.13, 0.55], [0.1, 0.82], [-0.1, 0.82], [-0.13, 0.55], [-0.3, 0.2]].map(([a, b]) => new THREE.Vector2(a, b)));
  const jersey = paint(prep(new THREE.ExtrudeGeometry(profile, { depth: 3, bevelEnabled: false }), new THREE.Matrix4().compose(new THREE.Vector3(1.5, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1))), 3);
  const band = box(3.0, 0.06, 0.22, 0, 0.78, 0, 0);
  const barrier = mergeGeometries([jersey, band]);
  // Type III barricade, 2.4 m wide: three striped rails on two legs
  const railSub = [0.03, 0.04, 0.97, 0.96];
  const barricade = mergeGeometries([
    faceBox(2.4, 0.2, 0.04, 0, 0.55, 0, 6, railSub, 0), faceBox(2.4, 0.2, 0.04, 0, 0.88, 0, 6, railSub, 0), faceBox(2.4, 0.2, 0.04, 0, 1.21, 0, 6, railSub, 0),
    box(0.06, 1.45, 0.06, -1.0, 0.725, 0, 4), box(0.06, 1.45, 0.06, 1.0, 0.725, 0, 4),
    box(0.06, 0.05, 0.7, -1.0, 0.025, 0, 4), box(0.06, 0.05, 0.7, 1.0, 0.025, 0, 4)
  ]);
  // ROAD CLOSED plate on two posts (stands on a barricade's top rail or a barrier): 0.9 x 0.6 m, bottom at 1.3
  const signClosed = mergeGeometries([
    faceBox(0.9, 0.6, 0.02, 0, 1.6, 0.03, 7, [0, 43 / 256, 1, 213 / 256], 4),
    box(0.04, 0.8, 0.04, -0.3, 1.0, 0, 4), box(0.04, 0.8, 0.04, 0.3, 1.0, 0, 4)
  ]);
  // a work sign: a 0.8 m diamond on a stand
  const stand = (cell) => mergeGeometries([
    faceBox(0.8, 0.8, 0.02, 0, 1.5, 0.03, cell, [0.02, 0.02, 0.98, 0.98], 2, [0, 0, Math.PI / 4]),
    box(0.04, 1.1, 0.04, 0, 0.62, 0, 4),
    box(0.04, 0.04, 0.7, 0, 0.04, 0, 4), box(0.7, 0.04, 0.04, 0, 0.04, 0, 4)
  ]);
  // an arrow board on its trailer: a 2.4 x 1.2 m panel on a mast over a two-wheeled trailer
  const wheel = (x) => solid(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 12), 2, M(x, 0.32, -0.4, 0, 0, Math.PI / 2));
  const arrow = mergeGeometries([
    faceBox(2.4, 1.2, 0.12, 0, 2.15, 0, 10, [0, 0.25, 1, 0.75], 2),
    box(0.12, 1.0, 0.12, 0, 1.0, 0, 4),
    box(1.8, 0.14, 1.6, 0, 0.52, -0.2, 4), box(0.12, 0.12, 1.2, 0, 0.5, 1.2, 4), wheel(-1.0), wheel(1.0)
  ]);
  return { cone, barrel, barrier, barricade, signClosed, signWork: stand(8), signLane: stand(9), arrow };
}

// the unit width of the kinds scaled by a site's w, and how far each is drawn (m), and whether it casts a shadow
const KIND = {
  cone: { cull: 90, shadow: false }, barrel: { cull: 110, shadow: true },
  barrier: { cull: 140, shadow: true, unit: 3.0 }, barricade: { cull: 140, shadow: true, unit: 2.4 },
  signClosed: { cull: 140, shadow: false, unit: 0.9 }, signWork: { cull: 150, shadow: false }, signLane: { cull: 150, shadow: false }, arrow: { cull: 170, shadow: true }
};

// ---------------------------------------------------------------------------------------------------------------------
// Dates & the card
// ---------------------------------------------------------------------------------------------------------------------
const fmtDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(ms));
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Mon-Fri 07:00-16:30" from a record's seven daily windows (Sunday first), or the City's work period text */
function scheduleText(rec) {
  if (!rec.sc) return rec.w || '';
  const days = [];
  rec.sc.forEach((win, i) => { if (win) days.push([i, win]); });
  if (!days.length) return rec.w || '';
  const groups = [];
  for (const [i, win] of days) {
    const last = groups[groups.length - 1];
    if (last && last.win === win && last.to === i - 1) last.to = i; else groups.push({ from: i, to: i, win });
  }
  return groups.map((g) => `${g.from === g.to ? WEEK[g.from] : `${WEEK[g.from]}–${WEEK[g.to]}`} ${g.win.replace('-', '–')}`).join(', ');
}
/** The card's facts for a record: [[label, text], ...], with the disclaimer last */
function cardFacts(rec, feedAt) {
  const facts = [];
  facts.push(['Where', rec.n || rec.r]);
  facts.push(['Dates', `${fmtDay(rec.s)} – ${fmtDay(rec.e)}`]);
  const sched = scheduleText(rec);
  if (sched) facts.push(['Hours', sched]);
  if (rec.by) facts.push(['Work', rec.by]);
  if (rec.de) facts.push(['City’s description', rec.de]);
  if (rec.ci && rec.ci !== 'None') facts.push(['Traffic impact when reported', rec.ci]);
  facts.push(['About this', `Reported by the City of Toronto's Road Restrictions open data, fetched ${fmtDay(feedAt)}. The permit holder submitted it and the City does not verify it in the field; the barrels show the report, not what is on the street today.`]);
  return facts;
}
const titleFor = (rec) => (rec.t === 'R' ? `Road closed · ${rec.r}` : `Lane closure · ${rec.r}`);

function buildCard() {
  const el = document.createElement('section');
  el.id = 'roadworks-card';
  el.className = 'panel roadworks-card';
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  const head = document.createElement('div'); head.className = 'rw-head';
  const title = document.createElement('h2'); title.className = 'rw-title';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'icon-btn'; close.setAttribute('aria-label', 'Hide'); close.textContent = '×';
  head.append(title, close);
  const body = document.createElement('div'); body.className = 'rw-body';
  const link = document.createElement('a'); link.className = 'pc-source'; link.href = 'https://www.toronto.ca/services-payments/streets-parking-transportation/road-restrictions-closures/restrictions-map/';
  link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'City of Toronto road restrictions map';
  el.append(head, body, link);
  document.body.appendChild(el);
  return { el, title, body, close };
}

// ---------------------------------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------------------------------
async function buildRoadworks(scene, { trafficSystem = null, parkedAt = null, colliders = [] } = {}) {
  if (!enabled()) return null;
  try {
    const t0 = performance.now();
    const feed = await Promise.race([C.roadworksFeed || fetchRoadworks(), new Promise((resolve) => setTimeout(() => resolve(null), FEED_WAIT_MS))]);
    if (!feed || !feed.records.length) {
      C.roadworksStats = { feed: null, drawn: 0 };
      console.info('[roadworks] no feed: nothing drawn');
      return null;
    }
    const { THREE, CITY_BOUNDS, nearestRoads, blockAt } = C;
    const W = C.WorldCollision;
    const G = C.streetPropGrid;
    // solid things already standing (buildings, furniture, parked cars, cafe patios, bike posts): nothing is laid on them
    let grid = null;
    const blocked = (x, z, r) => {
      const shape = W.circleShape(x, z, r), ground = C.cutAt ? C.cutAt(x, z) : 0;
      grid ||= G.boundsGrid(colliders, (c) => [c.minX, c.maxX, c.minZ, c.maxZ]);
      return grid.some(shape.minX, shape.maxX, shape.minZ, shape.maxZ, (c) => (c.maxY ?? Infinity) > ground + 0.05 && (c.minY ?? -Infinity) < ground + 1.2 && W.contact(shape, c));
    };
    const deps = {
      toWorld: C.worldFromLatLon, nearestRoads, blockAt, isOnLand: C.isOnLand, blocked, parkedAt,
      inFrame: (x, z) => x > CITY_BOUNDS.minX + 5 && x < CITY_BOUNDS.maxX - 5 && z > CITY_BOUNDS.minZ + 5 && z < CITY_BOUNDS.maxZ - 5,
      tramNear: C.nearestTram ? (x, z, r) => !!C.nearestTram(x, z, r) : null,
      crossings: [...(C.SIGNAL_CROSSINGS || []), ...(C.PXOS || [])]
    };
    const layout = C.roadworksSites(feed.records, deps, { siteDate: C.SITE_DATE, now: Date.now() });
    const stats = { feedAt: feed.t, feed: feed.counts, ...layout.counts, rejected: layout.rejected, day: layout.day, sites: layout.sites.length, byKind: {}, ms: 0, closedEdges: 0 };
    C.roadworksStats = stats;
    C.roadworksLive = { sites: layout.sites, plans: layout.plans, records: feed.records, stats }; // (for the captures & probes)
    for (const s of layout.sites) stats.byKind[s.kind] = (stats.byKind[s.kind] || 0) + 1;
    if (!layout.sites.length) { console.info('[roadworks] none placed', stats); return null; }

    // meshes
    const tex = paintAtlas(THREE);
    const material = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.72, metalness: 0.02 });
    const geos = makeGeometries(THREE);
    const group = new THREE.Group();
    group.name = 'CityRoadworks';
    const byKind = {};
    for (const s of layout.sites) (byKind[s.kind] ||= []).push(s);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const newColliders = [], boxes = [];
    for (const [kind, list] of Object.entries(byKind)) {
      const geo = geos[kind];
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      mesh.name = `Roadworks_${kind}`;
      const unit = KIND[kind].unit;
      list.forEach((s, i) => {
        const y = C.cutAt ? C.cutAt(s.x, s.z) : 0;
        q.setFromAxisAngle(up, s.yaw);
        p.set(s.x, y, s.z);
        sc.set(unit && s.w ? s.w / unit : 1, 1, 1);
        m.compose(p, q, sc);
        mesh.setMatrixAt(i, m);
        const col = collider(kind, s, y);
        if (col) newColliders.push(col);
        if ((kind === 'barricade' || kind === 'barrier')) boxes.push({ x: s.x, y, z: s.z, yaw: s.yaw + Math.PI / 2, halfW: 0.3, halfL: (s.w || unit) / 2, speed: 0 });
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = KIND[kind].shadow;
      mesh.receiveShadow = true;
      mesh.userData.cullDistance = KIND[kind].cull;
      mesh.userData.cullCell = 60;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    scene.add(group);

    // the traffic: the rows' boxes (cars stop in front of them) & the roads a closure covers whole
    if (trafficSystem && trafficSystem.setObstacles && boxes.length) trafficSystem.setObstacles(boxes, 'roadworks');
    if (trafficSystem && trafficSystem.network && C.roadworks.closeEdges) {
      const lines = layout.plans.filter((pl) => pl.placed && feed.records[pl.rec].t === 'R' && pl.full).map((pl) => ({ pts: pl.line, half: 7 }));
      if (lines.length) { const r = C.roadworks.closeEdges(trafficSystem.network, lines); stats.closedEdges = r.closed; stats.closedStubs = r.stubs; }
    }

    // the card
    const card = buildCard();
    let shownRec = -1, dismissed = -1, acc = 0;
    const bySite = new Map();
    for (const s of layout.sites) { const k = Math.floor(s.x / 40) * 100003 + Math.floor(s.z / 40); (bySite.get(k) || bySite.set(k, []).get(k)).push(s); }
    card.close.addEventListener('click', () => { dismissed = shownRec; card.el.hidden = true; });
    const show = (rec) => {
      const r = feed.records[rec];
      card.title.textContent = titleFor(r);
      card.body.replaceChildren(...cardFacts(r, feed.t).map(([label, text]) => {
        const row = document.createElement('p'); const b = document.createElement('strong'); b.textContent = `${label}: `;
        row.append(b, document.createTextNode(text)); return row;
      }));
      card.el.hidden = false;
      shownRec = rec;
    };
    const update = (pos, dt) => {
      acc += dt || 0;
      if (acc < 0.3) return;
      acc = 0;
      let best = -1, bd = 16;
      const cx = Math.floor(pos.x / 40), cz = Math.floor(pos.z / 40);
      for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++)
        for (const s of bySite.get(a * 100003 + b) || []) { const d = Math.hypot(s.x - pos.x, s.z - pos.z); if (d < bd) { bd = d; best = s.rec; } }
      const overlay = C.uiOverlay || document.body.classList.contains('place-open');
      if (best < 0 || overlay) { if (shownRec >= 0) { card.el.hidden = true; shownRec = -1; } if (best < 0) dismissed = -1; return; }
      if (best === dismissed) return;
      if (best !== shownRec) show(best);
    };
    stats.ms = Math.round(performance.now() - t0);
    console.info(`[roadworks] ${stats.sites} pieces for ${stats.placed} of ${stats.active} active records (${stats.inFrame} in the frame, ${stats.records} in the feed), ${stats.closedEdges} traffic edges closed, in ${stats.ms} ms`);
    return { group, colliders: newColliders, update, stats, sites: layout.sites, records: feed.records };
  } catch (e) {
    console.warn('[roadworks] left out:', e);
    return null;
  }
}

function collider(kind, s, y) {
  const { circleCollider, boxCollider } = C.WorldCollision;
  let c = null;
  if (kind === 'cone') c = circleCollider(s.x, s.z, 0.2, y, 0.7, 'roadwork');
  else if (kind === 'barrel') c = circleCollider(s.x, s.z, 0.3, y, 0.95, 'roadwork');
  else if (kind === 'barrier') c = boxCollider(s.x, s.z, (s.w || 3) / 2, 0.3, s.yaw, y, 0.82, 'roadwork');
  else if (kind === 'barricade') c = boxCollider(s.x, s.z, (s.w || 2.4) / 2, 0.25, s.yaw, y, 1.4, 'roadwork');
  else if (kind === 'arrow') c = boxCollider(s.x, s.z, 1.2, 0.8, s.yaw, y, 2.8, 'roadwork');
  else if (kind === 'signWork' || kind === 'signLane') c = circleCollider(s.x, s.z, 0.2, y, 2, 'roadwork');
  if (c) c.openData = true;
  return c;
}

Object.assign(C, { buildRoadworks, fetchRoadworks, roadworksCard: { cardFacts, scheduleText, titleFor } });
})();
