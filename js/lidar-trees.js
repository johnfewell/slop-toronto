(function () {
// js/lidar-trees.js — the lidar-only trees (docs/lidar-trees.md), behind ?lidarTrees=1: every tree the province's lidar
// sees in the detail frame that no other layer draws (private yards, the parks without a woods layer), baked by
// tools/build-lidar-trees.mjs from the shared Toronto data repo's trees/2 into js/lidar-trees-data.js. Like
// js/park-woods.js, it hands street-details.js tree sites (replaceTrees): the trees street-details.js invents in the parks
// and yards of the frame go, the lidar's come in, and ez-trees.js draws them in their named model, height and crown width,
// through the city's one tree field (its levels, seasons and shadows). The data names the frame it was baked for; on any
// other map nothing changes. Two bakes: the detail map's one file (js/lidar-trees-data.js, CITY.LIDAR_TREES_DATA) and the
// Eglinton map's 1,200 m cells (data/frames/eglinton/lidar-trees/, fetched by js/lidar-trees-cells.js into
// CITY.LIDAR_TREES_CELLS before this runs). Desktop only for now (John, 2026-11-12): explore.html loads this file only with
// ?lidarTrees=1, and either bake only on a desktop.
const C = window.CITY;
const D = C.LIDAR_TREES_DATA || C.LIDAR_TREES_CELLS;

// n packed trees (tools/lidar-trees-lib.mjs packBytes) from (x0, z0), appended to `out` as { x, z, h, r, model, woods, park }
function decodeBytes(u8, N, x0, z0, data, out) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), q = data.quantum;
  for (let i = 0; i < N; i++) {
    const code = u8[N * 6 + i];
    out.push({ x: x0 + dv.getUint16(i * 2, true) * q.xz, z: z0 + dv.getUint16(N * 2 + i * 2, true) * q.xz,
      h: u8[N * 4 + i] * q.h, r: u8[N * 5 + i] * q.r, model: data.models[code & 15], woods: !!(code & 16), park: !!(code & 32) });
  }
  return out;
}

/** Every baked tree: the one base64 file (detail map) or every cell (Eglinton map) */
function decode(data) {
  const out = [];
  if (data.cells) {
    for (const c of data.cells) decodeBytes(c.data, c.count, c.x0, c.z0, data, out);
    return out;
  }
  const bin = atob(data.trees), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return decodeBytes(u8, data.count, data.origin.x0, data.origin.z0, data, out);
}

/** True when the data was baked for the frame the city has loaded (the same projection and detail box) */
function sameFrame(data, GEO) {
  const a = data.frame.projection, b = GEO.frame.projection, f = data.frame.detail, g = GEO.frame.detail;
  return !!(a && b && f && g) && ['lat0', 'lon0', 'kx', 'ky', 'theta', 'ox', 'oz'].every((k) => a[k] === b[k])
    && ['x0', 'x1', 'z0', 'z1'].every((k) => f[k] === g[k]);
}

C.lidarTreesDecode = decode;
C.lidarTreesSameFrame = sameFrame;
if (!D) {
  // (explore.html loads a bake only on a desktop: say why there is none)
  // eslint-disable-next-line no-undef
  const loader = typeof cityAppScripts !== 'undefined' ? cityAppScripts : null;
  if (loader && loader.cityDesktop === false) console.info('[lidarTrees] desktop only for now (this is a phone, a tablet, ?quality=low|medium or a machine under 8 GB); nothing changes');
  else console.info('[lidarTrees] no lidar trees baked for this map; nothing changes');
  return;
}
if (D.error) {
  console.warn(`[lidarTrees] the Eglinton map's cells did not load (${D.error}); the lidar trees stay off`);
  return;
}
if (!sameFrame(D, C.GEO)) {
  console.warn('[lidarTrees] baked for the detail frame; this map has another, so the lidar trees stay off');
  return;
}

const box = D.frame.detail;
const inFrame = (x, z) => x >= box.x0 && x < box.x1 && z >= box.z0 && z < box.z1;
const baked = D.cells ? D.cells.reduce((n, c) => n + c.count, 0) : D.count;
const stats = { baked, drawn: 0, inventedReplaced: 0, dropped: { handBuilt: 0, sportsGround: 0, highParkFeature: 0 },
  ...(D.cells ? { cells: D.cells.length, load: D.load } : {}) };

// The hand-built areas keep what they have (their own tests, each present only when its module is loaded): Biidaasige
// Park, the HTO Park and beach landscapes. Returns the reason, or null
function handBuilt(x, z) {
  if (C.biidaasigeParkInside?.(x, z)) return 'handBuilt';
  if (C.htoLandscapeFootprintAt?.(x, z, 1)) return 'handBuilt';
  if (C.waterfrontBeachLandscapeKeepoutAt?.(x, z, 1)) return 'handBuilt';
  return null;
}

/**
 * street-details.js's tree sites (`sites`, `y` the islands' level): in the frame, the invented park and yard trees (no
 * model of their own, not the street tier) go, outside the hand-built areas; the lidar's trees come in, off the sports
 * grounds and High Park's paths, beds and buildings. Called before the parkettes' trees and the wooded parks' (which
 * keep theirs)
 */
function replaceTrees(sites, y) {
  const kept = sites.filter((t) => {
    if (t.model || t.tier === 1 || !inFrame(t.x, t.z) || handBuilt(t.x, t.z)) return true;
    stats.inventedReplaced++;
    return false;
  });
  sites.length = 0;
  for (const t of kept) sites.push(t); // (one at a time: spreading a map-sized list into push() overflows the call stack, st-6m6l)
  for (const c of decode(D)) {
    const why = handBuilt(c.x, c.z) || (C.sportsGroundAt?.(c.x, c.z) ? 'sportsGround' : null)
      || (C.highParkFeatureAt?.(c.x, c.z, 1.5) ? 'highParkFeature' : null);
    if (why) { stats.dropped[why]++; continue; }
    sites.push({ x: c.x, y, z: c.z, scale: c.h / 13, species: c.model.includes('ash') ? 1 : c.model.includes('aspen') ? 2 : 0,
      tier: c.park ? 0 : 2, model: c.model, height: c.h, width: c.r, woods: c.woods, lidar: true });
    stats.drawn++;
  }
  console.info(`[lidarTrees] ${stats.drawn} lidar trees of ${stats.baked} baked${D.cells ? ` (${D.cells.length} cells, ${(D.load.bytes / 1e6).toFixed(2)} MB fetched in ${D.load.ms} ms, all in before the tree field)` : ''} (${stats.dropped.handBuilt} in hand-built areas, ${stats.dropped.sportsGround} on sports grounds, ${stats.dropped.highParkFeature} on High Park's features left out); ${stats.inventedReplaced} invented park & yard trees replaced`);
}

C.lidarTrees = { replaceTrees, stats };
})();
