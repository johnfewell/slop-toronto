(function () {
// js/mapped-poles.js
// The City of Toronto's mapped poles (Topographic Mapping - Poles, js/toronto-poles.js by tools/build-poles.mjs) laid
// out on the city's curb islands for js/street-details.js and js/pedestrian-signals.js:
// - Street light poles: a 9 m galvanised pole with its arm out over the nearest road (11 m, an arm over each roadway,
//   down a median). The source has no heights or headings: the height is the model's, the arm faces the road.
// - Street light & traffic signal poles: the same light, and the signal heads of the junction approach whose corner
//   it stands on (street-details.js); traffic signal poles carry the heads alone. The signals' poles come from here
//   wherever the City mapped one near the spot the procedural layout wanted; the procedural pole is the fallback.
// - Pedestrian light poles, miscellaneous (utility, trolley-wire) poles and hydro towers have no model: not drawn.
// A pole is moved at most NUDGE metres off the roadway onto its curb island, never drawn under a flyover deck, and a
// light at the wrong height there (a road cut) follows cutAt. Mapped lights also keep the procedural streetlights
// away (a fallback where the source has a gap: poles beside tall buildings or in deep shadow were not digitized).

const LIGHT = 6006, LIGHT_SIGNAL = 6005, SIGNAL = 6008;
const NUDGE = 1.5; // m: the furthest a pole moves off the roadway (the source's accuracy is +-0.3 m; curbs are approximate)

function decode(data) {
  const out = [];
  for (const code of data?.shipped || []) {
    const t = data.types[code];
    if (!t) continue;
    let id = 0;
    for (let i = 0; i < t.ids.length; i++) {
      id += t.ids[i];
      out.push({ id, type: Number(code), x: t.xz[2 * i] / 10, z: t.xz[2 * i + 1] / 10 });
    }
  }
  return out;
}

// Each shipped pole's site: { id, type, x, z, block, median, road: nearest at-grade road (nearestRoads entry) | null,
// toRoad: the distance to its centre line, ax, az: the arm's direction (towards the road), y0: its base }; and the rejected ones counted by reason
function mappedPoleSites(data, { blockAt, nearestRoads, deckHeightAt = () => 0, cutAt = () => 0, SW_Y = 0.22 }) {
  const sites = [], rejected = { roadway: 0, deck: 0 };
  let nudged = 0;
  for (const p of decode(data)) {
    const roads = nearestRoads(p.x, p.z, 40).filter((r) => !r.road.raised);
    const road = roads[0] || null;
    let x = p.x, z = p.z, block = blockAt(x, z);
    if (!block && road && road.dist > 0.05) {
      // off the curb island: step straight away from the road's centre line onto it
      const ux = (p.x - road.px) / road.dist, uz = (p.z - road.pz) / road.dist;
      for (let s = 0.25; s <= NUDGE && !block; s += 0.25) {
        const b = blockAt(p.x + ux * s, p.z + uz * s);
        if (b) { block = b; x = p.x + ux * s; z = p.z + uz * s; }
      }
      if (block) nudged++;
    }
    if (!block) { rejected.roadway++; continue; }
    if (deckHeightAt(x, z, 1000) > 1) { rejected.deck++; continue; }
    let ax, az;
    const toRoad = road ? Math.hypot(road.px - x, road.pz - z) : 0;
    if (toRoad > 0.3) { ax = (road.px - x) / toRoad; az = (road.pz - z) / toRoad; }
    else { const a = ((p.id * 2654435761) % 6283) / 1000; ax = Math.sin(a); az = Math.cos(a); }
    // (a median's lights reach over both roadways: across the road's direction)
    if (block.median && road) { ax = -road.dz; az = road.dx; }
    sites.push({ id: p.id, type: p.type, x, z, block, median: !!block.median, road, toRoad, ax, az, y0: SW_Y + cutAt(x, z) });
  }
  return { sites, rejected, nudged };
}

// A cell index of sites for the "is there a mapped pole near here" questions
function poleIndex(sites, cell = 16) {
  const cells = new Map();
  const key = (i, j) => i * 100000 + j;
  for (const s of sites) {
    const k = key(Math.floor(s.x / cell), Math.floor(s.z / cell));
    (cells.get(k) || cells.set(k, []).get(k)).push(s);
  }
  return {
    // the nearest site within r of (x, z) whose type is in `types` and passing `ok`, or null
    nearest(x, z, r, types, ok) {
      let best = null, bd = r;
      const R = Math.ceil(r / cell), ci = Math.floor(x / cell), cj = Math.floor(z / cell);
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
        for (const s of cells.get(key(ci + a, cj + b)) || []) {
          if (types && !types.includes(s.type)) continue;
          const d = Math.hypot(s.x - x, s.z - z);
          if (d < bd && (!ok || ok(s))) { bd = d; best = s; }
        }
      }
      return best;
    }
  };
}

Object.assign(window.CITY, { mappedPoleSites, poleIndex, POLE_TYPES: { LIGHT, LIGHT_SIGNAL, SIGNAL } });
})();
