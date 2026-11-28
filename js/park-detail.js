(function () {
'use strict';
// js/park-detail.js — Biidaasige Park and the Port Lands: what their detail leaves in the base city while it is not loaded,
// and the loader that brings it in after the city is on screen (st-nz3v, docs/park-detail-loading.md).
//
// The park's and the Port Lands' modules (explore.html's cityAppScripts.detail, ~24 scripts, a third of a megabyte of
// data among them) cost a phone ~5 s of its start-up and sit ~1.5 km from where a visit starts. They load once the city
// is ready (or when the player comes near, or a teleport, link or saved position names them), and are assembled in
// main.js (assembleParkDetail). Three things the base city reads at its own build do not wait for them, so they live here:
//   - the building rows the park and the Port Lands replace (js/buildings.js asks biidaasigeParkExcludesBuilding and
//     portLandsExcludesBuilding while it builds), the one City tree the turf replaces (js/ez-trees.js), and the City poles
//     the 2025 orthophoto shows are not there (js/mapped-poles.js);
//   - the Sights/teleport arrival (TELEPORT_LOCATIONS.biidaasige), from the always-loaded map anchors;
//   - which places need the detail (regions), so a start, a teleport or a link there loads it first.
// The same predicates were part of the park's own build; they now stand on the data they always matched (a row's place and
// height), so the base city is the same before and after the load.
const C = window.CITY;
// (the address is parsed once a turn of the event loop, not on every call: the building and tree builds ask a few hundred thousand times in one
// go (reading location.search is the cost), ~0.5 s of start-up. The next turn, after any await, reads it afresh)
let parsed = null;
const params = () => {
  if (typeof URLSearchParams === 'undefined' || typeof location === 'undefined') return null;
  if (parsed === null) { parsed = new URLSearchParams(location.search); Promise.resolve().then(() => { parsed = null; }); }
  return parsed;
};
const query = (k) => params()?.get(k) ?? null;
const has = (k) => params()?.has(k) ?? false;
const biidaasigeOn = () => query('biidaasige') !== '0';
const portLandsOn = () => query('portlands') !== '0';

// --- the replaced building rows (City massing rows, matched by place and form so nothing else is ever excluded) ---------
// The seven rows each checked in the 2025 City ortho at their own georeferenced centre (tools/fixtures/biidaasige-native-
// identities.json): [x, z, height]
const REVIEWED_OLD_MASSING = Object.freeze([[2677.7, 630.1, 26.1], [2848.2, 624.4, 12.6], [2887, 755.6, 12.1],
  [1780.9, 757.5, 11.3], [2189, 884.9, 10.4], [2486.6, 687.1, 4.3], [2422.4, 608.3, 3.6]]);
const FIRE_HALL_30 = Object.freeze({ x: 2384, z: 622, height: 8.4, radius: 1.5 }); // the old Fire Hall 30, which the park rebuilds
const ATLAS_CRANE_ROW = Object.freeze({ x: 1998.2, z: 782.4, height: 3.1, radius: 1 }); // the shed under the Atlas Crane
// The two silo complexes the Port Lands rebuild (js/portlands-landmarks.js SILO_ROWS says the same)
const SILO_ROWS = Object.freeze([[1721.2, 298.5, 42.8], [2075.1, 425.6, 36.9]]);
// The one City inventory trunk that stands in the dog turf (City asset989014): [x, z, tree model, height dm]
const TURF_TRUNK = Object.freeze({ x: 2180.9, z: 679.9, model: 6, heightDm: 104 });

function rowSet(geo, wants) {
  const out = new Set();
  const rows = geo && geo.buildings;
  if (!rows) return out;
  for (let i = 0; i < rows.length; i++) {
    const b = rows[i];
    for (const [x, z, h, r = 1] of wants) if (Math.hypot(b[0] - x, b[1] - z) < r && Math.abs(b[4] - h) < 0.15) { out.add(i); break; }
  }
  return out;
}
const biidaasigeWants = () => [...REVIEWED_OLD_MASSING.map(([x, z, h]) => [x, z, h]),
  [FIRE_HALL_30.x, FIRE_HALL_30.z, FIRE_HALL_30.height, FIRE_HALL_30.radius], [ATLAS_CRANE_ROW.x, ATLAS_CRANE_ROW.z, ATLAS_CRANE_ROW.height, ATLAS_CRANE_ROW.radius]];

// What the base city holds for each piece: the geodata it was claimed for, and its rows. Claimed when the piece's build
// succeeds (createBiidaasigePark, createPortLands) or, while the detail has not loaded, by main.js at start-up
const claims = { biidaasige: null, portLands: null };
const cache = { biidaasige: null, portLands: null };
function rowsFor(key, wants) {
  const geo = C.GEO;
  if (!cache[key] || cache[key].geo !== geo) cache[key] = { geo, rows: rowSet(geo, wants()) };
  return cache[key].rows;
}
const biidaasigeParkExcludesBuilding = (i) => claims.biidaasige === C.GEO && biidaasigeOn() && rowsFor('biidaasige', biidaasigeWants).has(i);
const portLandsExcludesBuilding = (i) => claims.portLands === C.GEO && portLandsOn() && rowsFor('portLands', () => SILO_ROWS.map(([x, z, h]) => [x, z, h])).has(i);
const biidaasigeParkExcludesTree = (x, z, model, heightDm) => claims.biidaasige === C.GEO && biidaasigeOn() && model === TURF_TRUNK.model &&
  heightDm === TURF_TRUNK.heightDm && Math.hypot(x - TURF_TRUNK.x, z - TURF_TRUNK.z) < 0.15;
// js/mapped-poles.js: the park's stale City poles are left out while the park's claim stands
const biidaasigeBaseEditsOn = () => claims.biidaasige === C.GEO && biidaasigeOn();
// City pole OBJECTIDs inside the park polygon that the 2025 orthophoto shows are not there (in the river and its basins, or
// on bare ground; tools/fixtures/biidaasige-timber-poles.json orthoCheck). The generic street light layer would otherwise
// draw each as a 9 m light, because the dataset predates the park. The bridge-deck lights (real) and the 3 poles not checked
// are left alone
const BIIDAASIGE_STALE_CITY_POLE_IDS = Object.freeze([142451, 142452, 142453, 142458, 142461, 142462, 142463, 142464, 142483, 142485, 142486, 142488, 142489, 142490, 142599, 142600, 142601, 142616, 142618]);

// --- the young planting ------------------------------------------------------------------------------------------------------
// This park opened in 2025-26: its generated park trees are young, not mature woodland (the City's inventory trees stay as measured).
// The tree model a generated tree gets follows its height, so the scale has to be in before the base city's trees are built: the
// park's polygon (lat, lon; js/biidaasige-park-data.js has the same, tests/park-detail.test.mjs says so) lives here
const BIIDAASIGE_YOUNG_TREE_SCALE = 0.45;
const PARK_POLYGON = Object.freeze([[43.643766,-79.3515378],[43.6437558,-79.3515447],[43.6437247,-79.3515658],[43.6436936,-79.351587],[43.6436766,-79.3515985],[43.6436588,-79.3516106],[43.6436494,-79.351617],[43.6436359,-79.3516262],[43.6436229,-79.351635],[43.6435951,-79.3515562],[43.6435542,-79.35145],[43.6434853,-79.3513078],[43.6434139,-79.3511792],[43.6433017,-79.3510251],[43.6432267,-79.3509514],[43.6431326,-79.3508732],[43.6430999,-79.3508539],[43.6430671,-79.3508507],[43.643037,-79.350862],[43.6430196,-79.3508968],[43.642707,-79.351615],[43.6426916,-79.3517013],[43.64277,-79.3516893],[43.6428363,-79.3516917],[43.6428991,-79.3517037],[43.6429845,-79.3517278],[43.6433663,-79.3520025],[43.6434324,-79.3522003],[43.6434702,-79.3522311],[43.6435218,-79.3522028],[43.6435619,-79.3521463],[43.6436884,-79.3520613],[43.6437501,-79.3520198],[43.6439017,-79.3519043],[43.6441187,-79.3524976],[43.6439543,-79.3525723],[43.6439263,-79.3526698],[43.6438753,-79.3528937],[43.6438337,-79.3531525],[43.6437865,-79.3532868],[43.6435759,-79.3534922],[43.6434517,-79.353726],[43.6432712,-79.3541501],[43.6432592,-79.354206],[43.6432617,-79.3542551],[43.6432707,-79.354302],[43.643286,-79.3543201],[43.6433125,-79.3543192],[43.6433353,-79.3543183],[43.6433786,-79.3543054],[43.6434292,-79.3542971],[43.6435039,-79.3543047],[43.6435493,-79.3543126],[43.6436243,-79.354348],[43.6436683,-79.3544423],[43.6436582,-79.3545298],[43.6436423,-79.3545858],[43.6435937,-79.3546282],[43.643495,-79.3546639],[43.6433841,-79.3547767],[43.6433449,-79.3548999],[43.6433321,-79.3550232],[43.6433445,-79.3551438],[43.6433863,-79.3551896],[43.6434092,-79.3552615],[43.643417,-79.3553438],[43.6434021,-79.3554157],[43.6433343,-79.3554899],[43.6432216,-79.3556465],[43.6431315,-79.3558291],[43.6430761,-79.3559076],[43.6430094,-79.3559392],[43.6429369,-79.3559552],[43.6428645,-79.3559451],[43.6427877,-79.355902],[43.6426164,-79.3558253],[43.6425212,-79.3558178],[43.6425036,-79.3558299],[43.6424786,-79.3558462],[43.6423882,-79.3559828],[43.6423586,-79.356033],[43.6422691,-79.3562385],[43.642259,-79.3562875],[43.6422642,-79.3563249],[43.6422745,-79.3563529],[43.642177,-79.3565894],[43.643896,-79.3579728],[43.6440165,-79.3580827],[43.6440976,-79.3578995],[43.6441029,-79.3578875],[43.6441358,-79.3578131],[43.6441586,-79.3578439],[43.64417,-79.3578594],[43.6441557,-79.3578737],[43.6441384,-79.3579014],[43.6441406,-79.3579292],[43.6441518,-79.3579546],[43.6441618,-79.3579714],[43.6444734,-79.3582204],[43.6445036,-79.3582337],[43.6445124,-79.3582188],[43.6445032,-79.3581947],[43.644489,-79.358134],[43.6444834,-79.3580848],[43.6444785,-79.3580709],[43.6445174,-79.3580718],[43.644516,-79.3580145],[43.644545,-79.3579835],[43.6445977,-79.3579398],[43.6445977,-79.3578931],[43.6445969,-79.3578795],[43.6445882,-79.3577386],[43.6445545,-79.3576395],[43.6445091,-79.3575652],[43.644449,-79.3575084],[43.6443773,-79.3574661],[43.644294,-79.3574442],[43.6446525,-79.3565898],[43.6445166,-79.3563881],[43.6440555,-79.3556946],[43.6440057,-79.3555194],[43.6440232,-79.355349],[43.6440541,-79.3552668],[43.6446918,-79.3538175],[43.6445683,-79.3537231],[43.644504,-79.3536705],[43.6443828,-79.3535594],[43.6442839,-79.3534421],[43.6441932,-79.353286],[43.6441634,-79.3532128],[43.6440882,-79.3529423],[43.6440634,-79.3528726],[43.6440774,-79.352863],[43.6440911,-79.3528537],[43.6441004,-79.3528474],[43.6441173,-79.3528359],[43.6441346,-79.3528241],[43.6441666,-79.3528024],[43.6441965,-79.3527821],[43.6442066,-79.3527752],[43.6442315,-79.352845],[43.6442405,-79.3528746],[43.6442821,-79.352999],[43.6443445,-79.3531035],[43.6444157,-79.3531973],[43.6444918,-79.3532803],[43.6446537,-79.3534116],[43.6446672,-79.3533744],[43.6446733,-79.3533388],[43.644672,-79.3533057],[43.6446665,-79.3532785],[43.6446567,-79.3532521],[43.6446417,-79.35323],[43.6446539,-79.3531962],[43.6447884,-79.3533097],[43.6449342,-79.3529704],[43.6449647,-79.3529086],[43.6450025,-79.3528503],[43.645081,-79.3527345],[43.6451367,-79.3526056],[43.6453145,-79.3521927],[43.6453479,-79.3521176],[43.6461819,-79.3501352],[43.6463801,-79.3496936],[43.6466187,-79.3491472],[43.6468091,-79.3486923],[43.6472535,-79.3477023],[43.647536,-79.3471185],[43.6475815,-79.3470233],[43.6475893,-79.3470069],[43.6477643,-79.3471794],[43.6477514,-79.3472506],[43.6478992,-79.3472749],[43.6483027,-79.3473512],[43.648462,-79.3474821],[43.6486003,-79.3476938],[43.648708,-79.3478684],[43.6487923,-79.3479767],[43.6489315,-79.3480285],[43.6490707,-79.3480536],[43.6492135,-79.3479381],[43.6492983,-79.3477605],[43.6494319,-79.3474051],[43.6498746,-79.3462928],[43.6486822,-79.3453857],[43.6486543,-79.3453723],[43.6486397,-79.3453763],[43.6486251,-79.3453861],[43.6485321,-79.3455917],[43.6483588,-79.3454267],[43.6484031,-79.3453045],[43.6484817,-79.3450821],[43.6484484,-79.3447494],[43.6474501,-79.3439297],[43.6459088,-79.3426125],[43.6457108,-79.3424459],[43.6456293,-79.3425895],[43.645179,-79.3433823],[43.6450527,-79.3436046],[43.6450079,-79.3436835],[43.6447392,-79.3441565],[43.6448275,-79.3442565],[43.6458164,-79.3453788],[43.6445799,-79.3477378],[43.643254,-79.3504074],[43.6432088,-79.3504881],[43.6431987,-79.3505201],[43.6432006,-79.3505433],[43.6432092,-79.3505678],[43.6432184,-79.3505853],[43.643208,-79.350605],[43.6433656,-79.3507441],[43.6434791,-79.3508752],[43.6435784,-79.351026],[43.6437382,-79.3514596],[43.643766,-79.3515378]]);
let ringCache = null;
function parkRing() {
  if (!ringCache || ringCache.geo !== C.GEO) ringCache = { geo: C.GEO, ring: C.worldFromLatLon ? PARK_POLYGON.map(([lat, lon]) => C.worldFromLatLon(lat, lon)) : [] };
  return ringCache.ring;
}
function biidaasigeParkInside(x, z) {
  if (!biidaasigeBaseEditsOn()) return false;
  const ring = parkRing();
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// --- the Sights / teleport arrival, from the anchors -------------------------------------------------------------------
function biidaasigeParkArrival() {
  const a = C.biidaasigeMapAnchor?.('snowy-owl');
  return a ? { x: a.x - 24, z: a.z + 12, heading: Math.atan2(24, -12), road: 'Biidaasige Park Main Path' } : null;
}

// --- where the detail stands --------------------------------------------------------------------------------------------
// World metres (js/city-config.js frame: x east, z south). The park's models stand within x 1650..3050, z 250..1000 (tests/
// biidaasige-runtime.test.mjs); the Port Lands pieces (silos, the Commissioners and Cherry Street bridges, the banks) within
// the same. EAGER is the box a start, a saved position or a link inside it loads the detail for before the city is built (a
// hole in the Port Lands is never the first thing seen); NEAR is how close a rider comes before the load goes first.
const REGION = Object.freeze({ x0: 1500, x1: 3300, z0: 100, z1: 1250 });
const NEAR_M = 2200;
const inBox = (x, z, m = 0) => x >= REGION.x0 - m && x <= REGION.x1 + m && z >= REGION.z0 - m && z <= REGION.z1 + m;
const distanceTo = (x, z) => Math.hypot(Math.max(REGION.x0 - x, 0, x - REGION.x1), Math.max(REGION.z0 - z, 0, z - REGION.z1));
// Place names in a link (#place=..., #to=...) that stand in the region: such a link loads the detail up front. Any other
// link is covered by the teleport itself (main.js teleportTo waits for the detail)
const REGION_PLACE = /biidaasige|port lands|snowy owl|cherry (street|beach)|commissioners|essroc|victory (soya|silo)|atlas crane|ookwemin|polson|keating|villiers|unwin/i;

// Does a visit start in the region? (the saved player, the hash, ?parkDetail=now)
function startsInRegion() {
  const mode = query('parkDetail');
  if (mode === 'now' || mode === 'eager') return true;
  if (mode === 'late') return false;
  // (the lidar trees' hand-built test reads the park's own inside test: ?lidarTrees=1 keeps the old, start-up build)
  if (query('lidarTrees') === '1' || has('gallery')) return true;
  try {
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.get('park') === 'biidaasige') return true;
    for (const k of ['place', 'to']) if (hash.get(k) && REGION_PLACE.test(hash.get(k))) return true;
  } catch { /* no location */ }
  try {
    const saved = JSON.parse(localStorage.getItem('toronto-player-state'));
    if (saved?.version === 1 && !has('film')) {
      for (const p of Object.values(saved.entities || {})) if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && inBox(p.x, p.z, 300)) return true;
    }
  } catch { /* storage unavailable: no saved visit */ }
  return false;
}

// --- the loader ---------------------------------------------------------------------------------------------------------
let loading = null;
const PD = {
  REGION, NEAR_M, state: 'idle', // idle | loading | loaded | failed
  inBox, distanceTo, startsInRegion,
  // the detail's scripts, in their load order (explore.html)
  scripts: () => (typeof cityAppScripts !== 'undefined' && cityAppScripts.detail) || [],
  // Fetch and run the detail's scripts in order; one promise, however often it is asked for
  load() {
    if (loading) return loading;
    PD.state = 'loading';
    PD.loadStart = typeof performance !== 'undefined' ? performance.now() : 0;
    const list = PD.scripts();
    loading = new Promise((resolve, reject) => {
      if (!list.length || typeof document === 'undefined') { PD.state = 'loaded'; resolve(); return; }
      let left = list.length;
      for (const src of list) {
        const s = document.createElement('script');
        s.src = src;
        s.async = false; // (fetched together, run in this order)
        s.onload = () => { if (--left === 0) { PD.state = 'loaded'; PD.loadMs = performance.now() - PD.loadStart; resolve(); } };
        s.onerror = () => { PD.state = 'failed'; reject(new Error(`park detail: ${src} did not load`)); };
        document.head.appendChild(s);
      }
    });
    loading.catch((e) => console.warn('[park-detail]', e.message));
    return loading;
  },
  // Put the detail's files in the browser's cache without running them (the page's own preload does it for the base city)
  prefetch() {
    if (typeof document === 'undefined' || PD.prefetched) return;
    PD.prefetched = true;
    for (const src of PD.scripts()) {
      const l = document.createElement('link');
      l.rel = 'preload'; l.as = 'script'; l.href = src;
      document.head.appendChild(l);
    }
  }
};

Object.assign(C, {
  parkDetail: PD,
  biidaasigeParkExcludesBuilding, biidaasigeParkExcludesTree, portLandsExcludesBuilding, biidaasigeBaseEditsOn,
  BIIDAASIGE_STALE_CITY_POLE_IDS, biidaasigeParkArrival, biidaasigeParkInside, BIIDAASIGE_YOUNG_TREE_SCALE, BIIDAASIGE_PARK_POLYGON: PARK_POLYGON,
  biidaasigeExcludedRows: (geo = C.GEO) => rowSet(geo, biidaasigeWants()), // (the park's stats and tests)
  // The park's or the Port Lands' build says what the base city drops for it (rows, the trunk, the poles); main.js says it
  // for the geodata while their scripts are not loaded
  claimParkBaseEdits(geo = C.GEO) { claims.biidaasige = geo; claims.portLands = geo; },
  claimBiidaasigeBaseEdits(geo = C.GEO) { claims.biidaasige = geo; },
  claimPortLandsBaseEdits(geo = C.GEO) { claims.portLands = geo; },
  releaseBiidaasigeBaseEdits() { claims.biidaasige = null; },
  releasePortLandsBaseEdits() { claims.portLands = null; }
});
// the Sights jump and the Places menu's button: wired from the anchors, the park's own build repeats it
if (C.TELEPORT_LOCATIONS && !C.TELEPORT_LOCATIONS.biidaasige && biidaasigeOn()) {
  const arrival = biidaasigeParkArrival();
  if (arrival) C.TELEPORT_LOCATIONS.biidaasige = arrival;
}
})();
