(function () {
// js/mapped-poles.js
// The City of Toronto's mapped poles (Topographic Mapping - Poles, js/toronto-poles.js by tools/build-poles.mjs) laid
// out on the city's curb islands for js/street-details.js and js/pedestrian-signals.js:
// - Street light poles: a 9 m galvanised pole with its arm out over the nearest road (11 m, an arm over each roadway,
//   down a median). The source has no heights or headings: the height is the model's, the arm faces the road.
// - Street light & traffic signal poles: the same light, and the signal heads of the junction approach whose corner
//   it stands on (street-details.js); traffic signal poles carry the heads alone. The signals' poles come from here
//   wherever the City mapped one near the spot the procedural layout wanted; the procedural pole is the fallback.
// - Each pole's look (tools/build-poles.mjs poleLooks): the street lights of the older residential streets hang on
//   wooden hydro poles (a crossarm with the line's insulators, some with a transformer, the LED head on a bracket
//   below; the lines strung between them on the high tier), the Distillery's on black heritage lantern posts; the
//   pedestrian light poles are lantern posts, the waterfront's slim promenade posts or park lamps (pole models below)
// - Miscellaneous (utility, trolley-wire) poles and hydro towers have no model: not shipped.
// A pole is moved at most NUDGE metres off the roadway onto its curb island, never drawn under a flyover deck, and a
// light at the wrong height there (a road cut) follows cutAt. Mapped lights also keep the procedural streetlights
// away (a fallback where the source has a gap: poles beside tall buildings or in deep shadow were not digitized).

const LIGHT = 6006, LIGHT_SIGNAL = 6005, SIGNAL = 6008, PEDESTRIAN = 6004;
const NUDGE = 1.5; // m: the furthest a pole moves off the roadway (the source's accuracy is +-0.3 m; curbs are approximate)

// Each pole's look where its type's default is not it (galvanised steel; a pedestrian light's lantern post)
function decodeLooks(data) {
  const looks = new Map();
  for (const [look, ids] of Object.entries(data?.looks || {})) {
    let id = 0;
    for (const d of ids) looks.set((id += d), look);
  }
  return looks;
}

function decode(data) {
  const out = [], looks = decodeLooks(data);
  for (const code of data?.shipped || []) {
    const t = data.types[code];
    if (!t) continue;
    let id = 0;
    for (let i = 0; i < t.ids.length; i++) {
      id += t.ids[i];
      const type = Number(code);
      out.push({ id, type, x: t.xz[2 * i] / 10, z: t.xz[2 * i + 1] / 10, look: looks.get(id) || (type === PEDESTRIAN ? 'lantern' : 'steel') });
    }
  }
  return out;
}

// Each shipped pole's site: { id, type, look, x, z, block, median, road: nearest at-grade road (nearestRoads entry) | null,
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
    sites.push({ id: p.id, type: p.type, look: p.look, x, z, block, median: !!block.median, road, toRoad, ax, az, y0: SW_Y + cutAt(x, z) });
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

// =====================================================================================================================
// Pole models (street-details.js instances them; built here, with the caller's THREE & mergeGeometries, so the tests
// can measure them). Each is one geometry, its parts told apart by vertex colour and a per-vertex `glow` (1 on the lamp
// glass, which street-details.js lights at night), at its true size: base at y = 0, +x the arm's / crossarm's
// direction (towards the road), so an instance is a translation and a yaw (atan2(-az, ax)).
// =====================================================================================================================
// The wooden hydro pole: a 10.7 m cedar pole (weathered grey, darker at the foot), a 2.4 m crossarm with the line's
// three insulators; the LED head is street-details.js's on a galvanised bracket (WOOD.lightY). A pole-top transformer
// (a grey can) on about one pole in five
const WOOD = { h: 10.7, r: 0.16, armY: 10.2, insulators: [-1.0, -0.35, 1.0], wireY: 10.36, lightY: 7.9, transformerShare: 0.2 };
// The pedestrian lamp posts: height, collider radius, the lamp's height (the night pool's spot) and its pool's strength
// (x a 9 m streetlight's: the spot's light falls off with the square of the height)
const PED_LAMPS = {
  // black heritage lantern post: a fluted base, a slim shaft, a four-sided lantern with a pyramid cap and finial
  lantern: { h: 4.55, r: 0.18, lampY: 3.85, k: 0.3 },
  // the waterfront's slim charcoal post with a flat round LED head (Queens Quay, CityPlace, Liberty Village)
  promenade: { h: 5.85, r: 0.1, lampY: 5.75, k: 0.45 },
  // the parks' dark green post with an acorn globe
  park: { h: 4.5, r: 0.14, lampY: 4.0, k: 0.3 }
};

function colourParts(THREE, merge, parts) {
  // parts: [geometry, [r, g, b] (sRGB), glow (0/1), bottomColour?]: the colour (a gradient from bottomColour at y = 0
  // up the part when given; vertex colours are linear), merged non-indexed
  const geos = parts.map(([g, c, glow, c0]) => {
    const n = g.toNonIndexed();
    const pos = n.attributes.position, count = pos.count;
    n.computeBoundingBox();
    const y0 = n.boundingBox.min.y, y1 = n.boundingBox.max.y;
    const col = new Float32Array(count * 3), gl = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const t = c0 ? Math.min(1, Math.max(0, (pos.getY(i) - y0) / Math.max(0.01, y1 - y0))) : 1;
      for (let k = 0; k < 3; k++) col[3 * i + k] = (c0 ? c0[k] + (c[k] - c0[k]) * Math.min(1, t * 4) : c[k]) ** 2.2; // sRGB -> linear
      gl[i] = glow;
    }
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    n.setAttribute('glow', new THREE.BufferAttribute(gl, 1));
    n.deleteAttribute('uv');
    return n;
  });
  return merge(geos, false);
}
const cyl = (THREE, rt, rb, h, seg, y, open = true) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(0, y + h / 2, 0);

function woodPoleGeometry(THREE, merge, { transformer = false } = {}) {
  const wood = [0.45, 0.4, 0.34], foot = [0.24, 0.18, 0.13], arm = [0.4, 0.34, 0.26], insulator = [0.66, 0.68, 0.66];
  const parts = [
    [cyl(THREE, 0.12, WOOD.r, WOOD.h, 8, 0), wood, 0, foot],
    [new THREE.BoxGeometry(2.4, 0.1, 0.09).translate(0, WOOD.armY, 0), arm, 0],
    ...WOOD.insulators.map((x) => [cyl(THREE, 0.045, 0.07, 0.16, 6, WOOD.armY + 0.05).translate(x, 0, 0), insulator, 0])
  ];
  if (transformer) parts.push([cyl(THREE, 0.3, 0.3, 0.95, 8, 8.75, false).translate(-0.42, 0, 0), [0.55, 0.58, 0.58], 0]);
  return colourParts(THREE, merge, parts);
}

function pedLampGeometry(THREE, merge, look) {
  const black = [0.07, 0.075, 0.08], glass = [0.93, 0.91, 0.84];
  if (look === 'lantern') return colourParts(THREE, merge, [
    [cyl(THREE, 0.13, 0.18, 0.75, 8, 0, false), black, 0],
    [cyl(THREE, 0.06, 0.075, 2.75, 8, 0.75), black, 0],
    [cyl(THREE, 0.1, 0.1, 0.12, 8, 3.48, false), black, 0],
    [cyl(THREE, 0.06, 0.1, 0.08, 4, 3.58).rotateY(Math.PI / 4), black, 0],
    [cyl(THREE, 0.21, 0.14, 0.52, 4, 3.66).rotateY(Math.PI / 4), glass, 1],
    [new THREE.ConeGeometry(0.29, 0.22, 4, 1, false).rotateY(Math.PI / 4).translate(0, 4.29, 0), black, 0],
    [new THREE.ConeGeometry(0.035, 0.16, 4, 1, true).translate(0, 4.47, 0), black, 0]
  ]);
  if (look === 'promenade') {
    const charcoal = [0.19, 0.2, 0.21];
    return colourParts(THREE, merge, [
      [cyl(THREE, 0.06, 0.1, 5.72, 8, 0), charcoal, 0],
      [cyl(THREE, 0.34, 0.34, 0.12, 12, 5.72), charcoal, 0],
      [new THREE.CircleGeometry(0.34, 12).rotateX(-Math.PI / 2).translate(0, 5.84, 0), charcoal, 0],
      [new THREE.CircleGeometry(0.3, 12).rotateX(Math.PI / 2).translate(0, 5.715, 0), glass, 1]
    ]);
  }
  const green = [0.11, 0.2, 0.14];
  return colourParts(THREE, merge, [
    [cyl(THREE, 0.11, 0.14, 0.45, 8, 0, false), green, 0],
    [cyl(THREE, 0.065, 0.085, 3.25, 8, 0.45), green, 0],
    [cyl(THREE, 0.1, 0.07, 0.12, 8, 3.7), green, 0],
    [cyl(THREE, 0.15, 0.2, 0.32, 8, 3.82), glass, 1],
    [cyl(THREE, 0.06, 0.15, 0.18, 8, 4.14), glass, 1],
    [new THREE.ConeGeometry(0.05, 0.2, 6, 1, true).translate(0, 4.4, 0), green, 0]
  ]);
}

// Sun-shadow stand-ins (scene-culling.js, as the steel poles' POLE_SHADOW): open 4-sided prisms, circumradius 1.11 x the
// part's radius, so the shadow is the part's width on average as the sun goes round: the shaft, and the crossarm
// (a vertical quad) or the lamp head
function shadowStandIn(THREE, merge, kind) {
  const prism = (r, h, y) => new THREE.CylinderGeometry(r * 1.11, r * 1.11, h, 4, 1, true).translate(0, y + h / 2, 0).toNonIndexed();
  const parts = kind === 'wood'
    ? [prism(0.14, WOOD.h, 0), new THREE.PlaneGeometry(2.4, 0.1).translate(0, WOOD.armY, 0).toNonIndexed()]
    : kind === 'lantern' ? [prism(0.08, 3.66, 0), prism(0.2, 0.8, 3.66)]
      : kind === 'promenade' ? [prism(0.08, 5.72, 0), prism(0.34, 0.12, 5.72)]
        : [prism(0.08, 3.82, 0), prism(0.18, 0.5, 3.82)];
  for (const g of parts) for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  return merge(parts, false);
}

// The lines between the wooden poles: three wires from the insulators, sagging 0.35 m mid-span; a unit span along +z
// (an instance scales z to the span's length), each wire two crossed ribbons so it reads from below and from the side
function wireSpanGeometry(THREE, SEG = 4, W = 0.03, SAG = 0.35) {
  const pos = [];
  for (const x of WOOD.insulators) {
    for (let s = 0; s < SEG; s++) {
      const t0 = s / SEG, t1 = (s + 1) / SEG;
      const y0 = WOOD.wireY - SAG * 4 * t0 * (1 - t0), y1 = WOOD.wireY - SAG * 4 * t1 * (1 - t1);
      // vertical ribbon, then horizontal
      pos.push(x, y0 - W / 2, t0, x, y1 - W / 2, t1, x, y1 + W / 2, t1, x, y0 - W / 2, t0, x, y1 + W / 2, t1, x, y0 + W / 2, t0);
      pos.push(x - W / 2, y0, t0, x + W / 2, y1, t1, x - W / 2, y1, t1, x - W / 2, y0, t0, x + W / 2, y0, t0, x + W / 2, y1, t1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// The spans between the placed wooden poles: each pole to its nearest wooden neighbour ahead along its street (the
// road's direction, across its arm), on the same side, 12-48 m away: { a, b } site pairs, each pair once
const SPAN = { min: 12, max: 48 };
function woodSpans(sites) {
  const wood = sites.filter((s) => s.look === 'wood' && !s.median);
  const idx = poleIndex(wood, 24);
  const spans = [];
  for (const a of wood) {
    const dx = -a.az, dz = a.ax; // along the street
    const b = idx.nearest(a.x, a.z, SPAN.max, null, (b) => {
      const ox = b.x - a.x, oz = b.z - a.z, d = Math.hypot(ox, oz);
      // ahead, nearly along the street, its arm the same way (the same side)
      return d >= SPAN.min && (ox * dx + oz * dz) / d > 0.94 && a.ax * b.ax + a.az * b.az > 0.8;
    });
    if (b) spans.push({ a, b });
  }
  return spans;
}

Object.assign(window.CITY, {
  mappedPoleSites, poleIndex, woodSpans, POLE_TYPES: { LIGHT, LIGHT_SIGNAL, SIGNAL, PEDESTRIAN },
  poleModels: { WOOD, PED_LAMPS, woodPoleGeometry, pedLampGeometry, shadowStandIn, wireSpanGeometry, SPAN }
});
})();
