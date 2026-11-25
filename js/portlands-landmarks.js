(function () {
'use strict';
// js/portlands-landmarks.js — the Port Lands set pieces: the Atlas Crane and the two silo complexes (bead jf-li1).
//
// Shapes and placement come from the Canoe Cove rowing world's landmark module (a sister project whose plan was cut
// from this map: plan metres + [2250, 500] = world metres on the same axes). Only the shapes are carried over, and they
// are drawn in this map's lit standard materials (js/portlands-kit.js). What is NOT here: the crane's hoisted canoe,
// the people at its feet, gulls, pigeons, flags, the painter on a cradle and the climber on a rope that the rowing
// world adds for fun. These are the places as they stand.
//
//   Atlas Crane — the 1961 dockside lifting frame of Marine Terminal 35, restored white (Waterfront Toronto, "Meet the
//     Atlas Crane"). Two waterside pivot bases, each a single pin from which a PAIR of steep square lattice members
//     springs to the two heads; the heads are white pulley housings ~12 m apart tied by parallel runway beams; a
//     separate fifth lattice member slopes from the inland head down to its own footing with the old hoist ropes fanned
//     beside it. No tower, no jib, no cab, no counterweight. Read from Waterfront Toronto's restoration photo, a
//     November 2026 photo and a pivot-base close-up, and placed from the City's 2025 aerial: the frame's middle is
//     0.8 m east and 6.5 m south of the OSM node, the head line runs on compass bearing 333 (square to the bank).
//   Victory Soya Mills (1944-48, 351 Lake Shore Blvd E on the Parliament Slip; the City's park map calls them "St Marys
//     Silos"): 36 concrete bins in four rows of nine under a full-length headhouse (City heritage designation, 2016),
//     placed on the City 3D massing block named "Silo" (56 x 25 m); bin tops ~33 m, headhouse ridge ~38 m (lidar).
//   Essroc (80 Ookwemin St): a northern group of four darker weathered bins with a steel frame on top and a southern
//     pair with lighter tops and machinery above, joined high up by an elevated conveyor gallery on a trestle.
//
// Heights, bin counts and bearings are the source's; the photo-estimated ones are named in the docs (docs/portlands.md).
const C = window.CITY;
const K = C.PORTLANDS_KIT;

const CRANE = Object.freeze({ heightM: 36, baseHalfM: 5.4, headHalfM: 6.2, reachM: 24,
  white: '#e9e7e1', band: '#f1efe9', housing: '#efede6', dark: '#3d4148', footing: '#a9a69d', cable: '#34383e' });

// True north in world axes at lat/lon (this map's frame is turned from the compass: about -16.6 degrees here)
function trueNorth(lat, lon) {
  if (typeof C.worldFromLatLon === 'function' && Number.isFinite(lat)) {
    const a = C.worldFromLatLon(lat, lon), b = C.worldFromLatLon(lat + 1e-5, lon);
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    if (l > 0) return [dx / l, dz / l];
  }
  return [0.2855, -0.9584]; // the Port Lands, from the Canoe Cove plan frame
}

/**
 * The Atlas Crane, built about the OSM node (local origin = the node at ground, axes = world axes). Returns the same
 * shape as the other Biidaasige factories: { group, colliders, surfaces, triangles, drawCalls, ... }.
 */
function buildAtlasCrane(options = {}) {
  const T = C.THREE;
  const H = Number.isFinite(options.height) ? options.height : CRANE.heightM;
  const [nx, nz] = options.north || trueNorth(options.lat, options.lon);
  const ex = -nz, ez = nx;
  // the frame's middle, from the aerial: 0.8 m east, 6.5 m south of the node
  const cx = ex * 0.8 - nx * 6.5, cz = ez * 0.8 - nz * 6.5;
  // inland: compass bearing 333
  const br = (333 * Math.PI) / 180;
  const ix = Math.cos(br) * nx + Math.sin(br) * ex, iz = Math.cos(br) * nz + Math.sin(br) * ez;
  const sx = -iz, sz = ix; // along the bank
  const angle = Math.atan2(iz, ix);
  const P = (s, i, y) => [cx + sx * s + ix * i, y, cz + sz * s + iz * i];
  const steel = new K.Parts(), stone = new K.Parts(), cables = new K.Parts();
  const colliders = [];

  // pivot bases: a concrete plinth sunk into the ground, a white flared shoe, and the pin the pair springs from
  const bases = [];
  for (const s of [-CRANE.baseHalfM, CRANE.baseHalfM]) {
    const p = P(s, 0, 0);
    const f = new K.Frame(p[0], 0, p[2], angle);
    stone.push(K.block(f, 0, -2.5, 0, 4.4, 3.1, 4.2, CRANE.footing));
    steel.push(K.cylinder(p[0], 0.6, p[2], 1.25, 2.0, 1.4, CRANE.white, 12));
    steel.push(K.block(f, 0, 2.0, 0, 1.4, 1.1, 2.4, CRANE.white));
    bases.push([p[0], 2.8, p[2]]);
    colliders.push({ minX: p[0] - 2.4, maxX: p[0] + 2.4, minZ: p[2] - 2.4, maxZ: p[2] + 2.4, minY: 0, maxY: 3, prop: true, kind: `atlascrane-base-${colliders.length + 1}`, id: 'atlas-crane' });
  }
  const yTop = H;
  const heads = [P(0, -CRANE.headHalfM, yTop), P(0, CRANE.headHalfM, yTop)];

  // the four members: every base to every head
  for (const b of bases) {
    for (const h of heads) {
      const len = Math.hypot(h[0] - b[0], h[1] - b[1], h[2] - b[2]);
      const foot = K.lerp3(b, h, 0.6 / len), head = K.lerp3(b, h, (len - 1.6) / len);
      K.lattice(steel, foot, head, { side: 1.3, sideTop: 1.7, chord: 0.3, brace: 0.17, bays: Math.round(len / 2.6), colour: CRANE.white, cuffEvery: 3, cuffColour: CRANE.band });
      steel.push(K.bar(b, K.lerp3(b, h, 3.4 / len), 1.5, CRANE.band)); // a solid shoe where the member leaves the pin
    }
  }

  // heads: pulley housings with sheave drums and a railed platform under each
  heads.forEach((h, k) => {
    const f = new K.Frame(h[0], h[1], h[2], angle);
    steel.push(K.block(f, 0, -2.1, 0, 4.6, 0.4, 5.6, CRANE.white));
    steel.push(K.block(f, 0, -1.7, 0, 3.8, 3.4, 4.4, CRANE.housing));
    steel.push(K.block(f, 0, 1.7, 0, 4.1, 0.35, 4.7, CRANE.white));
    for (const w of [-2.5, 2.5]) {
      const c = f.at(0, 0, w);
      const drum = K.paint(new T.CylinderGeometry(1.5, 1.5, 0.6, 14), CRANE.band);
      drum.rotateX(Math.PI / 2).rotateY(-angle + Math.PI / 2);
      steel.push(drum.translate(c[0], c[1], c[2]));
    }
    const rail = (u0, w0, u1, w1) => steel.push(K.bar(f.at(u0, -0.6, w0), f.at(u1, -0.6, w1), 0.09, CRANE.white));
    const ou = k === 0 ? -1.8 : 1.8;
    rail(ou, -2.3, ou, 2.3); rail(-1.8, -2.3, 1.8, -2.3); rail(-1.8, 2.3, 1.8, 2.3);
  });

  // the runway: two white girders along the head line with the dark rails between them
  const span = (w, y, side, colour) => steel.push(K.bar(P(w, -CRANE.headHalfM, yTop + y), P(w, CRANE.headHalfM, yTop + y), side, colour));
  span(-1.3, -1.0, 0.75, CRANE.white); span(1.3, -1.0, 0.75, CRANE.white);
  for (const w of [-0.45, 0.45]) span(w, -0.6, 0.28, CRANE.dark);
  span(0, 0.4, 0.3, CRANE.dark);
  for (const i of [-3, 0, 3]) steel.push(K.bar(P(-1.3, i, yTop - 1.0), P(1.3, i, yTop - 1.0), 0.35, CRANE.white));

  // the fifth member: from the inland head down to its own footing
  const footG = P(0, CRANE.headHalfM + CRANE.reachM, 0);
  const fifthFoot = [footG[0], 1.2, footG[2]];
  const fifthHead = K.lerp3(heads[1], fifthFoot, 1.6 / Math.hypot(CRANE.reachM, H));
  const flen = Math.hypot(fifthHead[0] - fifthFoot[0], fifthHead[1] - fifthFoot[1], fifthHead[2] - fifthFoot[2]);
  K.lattice(steel, fifthFoot, fifthHead, { side: 1.7, sideTop: 1.5, chord: 0.32, brace: 0.18, bays: Math.round(flen / 2.6), colour: CRANE.white, cuffEvery: 3, cuffColour: CRANE.band });
  {
    const f = new K.Frame(fifthFoot[0], 0, fifthFoot[2], angle);
    stone.push(K.block(f, 0, -2.5, 0, 3.6, 3.7, 3.2, CRANE.footing));
    steel.push(K.bar(fifthFoot, K.lerp3(fifthFoot, fifthHead, 3.2 / flen), 2.1, CRANE.band));
    colliders.push({ minX: fifthFoot[0] - 2, maxX: fifthFoot[0] + 2, minZ: fifthFoot[2] - 2, maxZ: fifthFoot[2] + 2, minY: 0, maxY: 3, prop: true, kind: 'atlascrane-fifth-footing', id: 'atlas-crane' });
  }
  // the old hoist ropes: four lines fanned from the inland head down to a winch block short of the footing
  const winch = P(0, CRANE.headHalfM + CRANE.reachM - 5, 0);
  stone.push(K.block(new K.Frame(winch[0], 0, winch[2], angle), 0, -2.2, 0, 2.6, 3.4, 3.2, CRANE.footing));
  for (const w of [-0.9, -0.3, 0.3, 0.9]) cables.push(K.bar(P(w, CRANE.headHalfM + 0.6, yTop - 1.0), P(w * 1.2, CRANE.headHalfM + CRANE.reachM - 5, 1.2), 0.12, CRANE.cable));
  // the trolley on the runway, its two ropes and the hook block (no load: the rowing world's hoisted canoe is not here)
  const trolley = P(0, -1.2, yTop - 1.35);
  steel.push(K.block(new K.Frame(trolley[0], trolley[1], trolley[2], angle), 0, -0.3, 0, 2.2, 0.7, 1.6, CRANE.white));
  for (const w of [-0.3, 0.3]) cables.push(K.bar([trolley[0] + sx * w, trolley[1], trolley[2] + sz * w], [trolley[0] + sx * w, 18, trolley[2] + sz * w], 0.09, CRANE.dark));
  steel.push(K.block(new K.Frame(trolley[0], 0, trolley[2], angle), 0, 17.2, 0, 0.9, 1.0, 0.7, '#d9a62e'));

  const group = new T.Group();
  group.name = 'PortLandsAtlasCrane';
  let triangles = 0;
  const drawCalls = [];
  for (const [key, parts, kind] of [['steel', steel, 'steel'], ['footing', stone, 'stone'], ['cable', cables, 'steel']]) {
    const n = parts.triangles, geo = parts.merged();
    if (!geo) continue;
    group.add(K.meshOf(geo, kind, `PortLandsAtlasCrane-${key}`, { cullDistance: 900, cullCell: 140 }));
    triangles += n; drawCalls.push({ key, triangles: n });
  }
  const box3 = new T.Box3().setFromObject(group);
  return {
    id: 'atlas-crane', name: 'Atlas Crane', group, colliders, surfaces: [], climbable: false, triangles, drawCalls,
    footprint: { widthM: Math.round((box3.max.x - box3.min.x) * 10) / 10, depthM: Math.round((box3.max.z - box3.min.z) * 10) / 10,
      source: 'two pivot bases 10.8 m apart, heads 12.4 m apart, a fifth member reaching 24 m inland (photo + 2025 aerial estimates)' },
    heights: { representativeM: H, representativeRangeM: [35, 38], source: 'photo estimate (NOT measured; WT 40 m/140 ft is restoration scaffolding, a different property)', installed: 1961,
      massLabel: '300-ton (the structure mass label Waterfront Toronto publishes; NOT a lifting capacity)' },
    form: 'white frame: two pivot bases each springing a pair of steep lattice members to two pulley-housing heads tied by runway beams, plus a fifth lattice member sloping from the inland head to its own footing with fanned hoist ropes',
    faceDirection: 'head line on compass bearing 333 (square to the bank); local origin is the OSM node, axes are world axes',
    placement: 'local-origin factory; place at the OSM node with yaw 0',
    source: 'https://www.waterfrontoronto.ca/news/meet-atlas-crane-unusual-park-feature-port-lands',
    attribution: 'Atlas Crane — Waterfront Toronto (heritage restoration). Procedural reconstruction for Slop Toronto; shape worked out in the Canoe Cove rowing world.'
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Silos
const massingFrame = (x, y, z, angleRad) => new K.Frame(x, y, z, -angleRad); // the City massing frame's +u runs along (cos a, -sin a)

function victorySilos(parts, row) {
  const T = C.THREE;
  const cols = 9, rows = 4, L = 56.2, W = 25.4, d = Math.min(L / cols, W / rows), r = d / 2;
  const f = massingFrame(row.x, 0, row.z, row.angle);
  const S = parts;
  const binTop = 33.2;
  S.push(K.block(f, 0, -2.5, 0, L + 0.6, 2.5, W + 0.6, '#8f8a80')); // the basement slab, sunk
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const u = -L / 2 + r + i * d, w = -W / 2 + r + j * d, p = f.at(u, 0, w), outer = j === 0 || j === rows - 1;
      const g = K.paint(new T.CylinderGeometry(r - 0.02, r - 0.02, binTop - 1.5, outer ? 16 : 8, 1, !outer), (i + j) % 2 ? '#9a968b' : '#a29e93');
      g.translate(p[0], 1.5 + (binTop - 1.5) / 2, p[2]);
      S.push(g);
      S.push(K.cylinder(p[0], binTop - (outer ? 0.5 : 0.4), p[2], r + (outer ? 0.1 : 0), r + (outer ? 0.1 : 0), outer ? 0.5 : 0.4, '#8c887e', outer ? 16 : 8));
      if (outer) { // the basement door on the long faces
        const dp = f.at(u, 0, w + Math.sign(w) * (r - 0.05));
        S.push(K.paint(new T.BoxGeometry(1.3, 2.2, 0.3), '#5d5a57').rotateY(f.yaw).translate(dp[0], 2.6, dp[2]));
      }
    }
  }
  // the bin-top deck between the bins closes the gaps
  S.push(K.block(f, 0, binTop - 0.3, 0, L - d + 0.4, 0.5, W - d + 0.4, '#8c887e'));
  // the headhouse: the full length, set in from the outer bins; 3.3 m walls, nine windows a side, a low pitched roof
  const hw = W - d * 1.2, hl = L - 0.6, h0 = binTop, wall = 3.3;
  S.push(K.block(f, 0, h0, 0, hl, wall, hw, '#98948a'));
  S.push(K.block(f, 0, h0 + wall, 0, hl + 0.5, 0.35, hw + 0.5, '#827e75'));
  for (let i = 0; i < 9; i++) {
    const u = -hl / 2 + (hl / 9) * (i + 0.5);
    for (const side of [-1, 1]) S.push(K.block(f, u, h0 + 0.9, side * (hw / 2 + 0.02), 3.6, 1.6, 0.12, '#444b55'));
  }
  const ridge = 1.9, y1 = h0 + wall + 0.35, hu = hl / 2 + 0.25, hwid = hw / 2 + 0.25, roof = '#615e59';
  const ra = (u, w, y) => f.at(u, y, w);
  S.push(K.quad(ra(-hu, hwid, y1), ra(hu, hwid, y1), ra(hu, 0, y1 + ridge), ra(-hu, 0, y1 + ridge), roof));
  S.push(K.quad(ra(hu, -hwid, y1), ra(-hu, -hwid, y1), ra(-hu, 0, y1 + ridge), ra(hu, 0, y1 + ridge), roof));
  S.push(K.tri(ra(hu, hwid, y1), ra(hu, -hwid, y1), ra(hu, 0, y1 + ridge), '#8e8a80'));
  S.push(K.tri(ra(-hu, -hwid, y1), ra(-hu, hwid, y1), ra(-hu, 0, y1 + ridge), '#8e8a80'));
  for (const side of [-1, 1]) S.push(K.block(f, side * (hl / 2 + 0.02), h0 + 0.6, 0, 0.12, 2.2, 3, '#444b55')); // conveyor openings on the ends
  return { colliders: [obbCollider(f, L + 0.6, W + 0.6, binTop + ridge + wall + 0.35, 'victory-silos')] };
}

function essrocSilos(parts, anchor, north) {
  const T = C.THREE;
  const [nx, nz] = north, e = [-nz, nx];
  // aerial pixel (centred on the anchor, 0.175 m per pixel, north up) to world
  const px = (x, y) => { const de = (x - 325) * 0.175, dn = -(y - 325) * 0.175; return [anchor[0] + e[0] * de + nx * dn, anchor[1] + e[1] * de + nz * dn]; };
  // the complex runs on compass bearing 53 (its pair line and its northern grid)
  const b = (53 * Math.PI) / 180, ax = Math.cos(b) * nx + Math.sin(b) * e[0], az = Math.cos(b) * nz + Math.sin(b) * e[1];
  const angle = Math.atan2(az, ax);
  const S = parts;
  const colliders = [];
  const group = (centre, spots, d, height, body, shade, cap, id) => {
    const f = new K.Frame(centre[0], 0, centre[1], angle);
    spots.forEach(([u, w], k) => {
      const p = f.at(u, 0, w);
      const g = K.paint(new T.CylinderGeometry(d / 2, d / 2, height + 2.5, 20, 6), k % 2 ? shade : body);
      // weathering streaks: darker bands down the bins
      const pos = g.getAttribute('position'), col = g.getAttribute('color'), cc = new T.Color();
      for (let i = 0; i < pos.count; i++) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        if (Math.sin(a * 7 + k) > 0.6 && pos.getY(i) > -height * 0.2) { cc.set(shade).multiplyScalar(0.88); col.setXYZ(i, cc.r, cc.g, cc.b); }
      }
      g.translate(p[0], -2.5 + (height + 2.5) / 2, p[2]);
      S.push(g);
      S.push(K.cylinder(p[0], height, p[2], d / 2 + 0.15, d / 2 + 0.15, 0.6, cap, 20));
      colliders.push({ minX: p[0] - d / 2, maxX: p[0] + d / 2, minZ: p[2] - d / 2, maxZ: p[2] + d / 2, minY: 0, maxY: height, prop: true, kind: 'essroc-silo', id });
    });
    return f;
  };
  // northern group: four darker bins, 9.6 m, 2 x 2, roofs at ~34 m
  const nd = 9.6;
  const nf = group(px(423, 303), [[-nd / 2, -nd / 2], [nd / 2, -nd / 2], [-nd / 2, nd / 2], [nd / 2, nd / 2]], nd, 33.5, '#8d8579', '#80786d', '#746d63', 'essroc-north');
  S.push(K.block(nf, 0, 33.4, 0, nd * 1.6, 0.6, nd * 1.6, '#746d63'));
  S.push(K.block(nf, -2, 34, 0, 7, 3.4, 5, '#9a9285'));
  S.push(K.block(nf, -2, 35.4, 2.52, 5.6, 1, 0.1, '#4a525c'));
  {
    const frameTop = 43, cs = [[-7, -4], [7, -4], [7, 4], [-7, 4]];
    for (const [u, w] of cs) S.push(K.bar(nf.at(u, 34, w), nf.at(u, frameTop, w), 0.3, '#6a717b'));
    for (const y of [38.5, frameTop]) for (let k = 0; k < 4; k++) {
      const [u0, w0] = cs[k], [u1, w1] = cs[(k + 1) % 4];
      S.push(K.bar(nf.at(u0, y, w0), nf.at(u1, y, w1), 0.26, '#6a717b'));
    }
    for (let k = -6; k <= 6; k += 3) S.push(K.bar(nf.at(k, 38.5, -4), nf.at(k, frameTop, -4), 0.16, '#6a717b'));
  }
  { // the external stair tower up the side
    const su = nd + 1.4;
    K.lattice(S, nf.at(su, -1.5, -2), nf.at(su, 33.4, -2), { side: 2.4, chord: 0.22, brace: 0.13, bays: 12, colour: '#7b8089' });
    S.push(K.block(nf, su, 33.4, -2, 3, 0.3, 3, '#7b8089'));
  }
  // southern pair: lighter tops, 10.5 m, ~40 m with machinery above
  const sd = 10.5;
  const sf = group(px(493, 455), [[-sd / 2 - 0.6, 0], [sd / 2 + 0.6, 0]], sd, 39.5, '#aaa393', '#a09989', '#d0ccc1', 'essroc-south');
  S.push(K.block(sf, 0, 39.5, 0, sd * 1.4, 0.5, sd * 0.6, '#d0ccc1'));
  S.push(K.block(sf, -2.5, 40, 0, 5.5, 3.6, 4.2, '#c2bdb0'));
  S.push(K.block(sf, 3, 40, 1, 2.4, 5.5, 2.4, '#878e98'));
  { const p = sf.at(3, 45.5, 1); S.push(K.cylinder(p[0], p[1], p[2], 0.8, 1.1, 2.2, '#878e98', 8)); }
  // the conveyor gallery from the pair's top deck to the northern frame: a closed truss with daylight under it, on a trestle
  const fromG = sf.at(-1, 41.2, 0), toN = nf.at(-2, 37.0, 0);
  const tx = toN[0] - fromG[0], tz = toN[2] - fromG[2], tl = Math.hypot(tx, tz);
  const gp = (s, side, up) => [fromG[0] + tx * s - (tz / tl) * side, fromG[1] + (toN[1] - fromG[1]) * s + up, fromG[2] + tz * s + (tx / tl) * side];
  for (const side of [-0.9, 0.9]) { S.push(K.bar(gp(0, side, 0), gp(1, side, 0), 0.25, '#7a7f88')); S.push(K.bar(gp(0, side, 2.2), gp(1, side, 2.2), 0.25, '#7a7f88')); }
  const bays = Math.max(4, Math.round(tl / 3));
  for (let k = 0; k <= bays; k++) {
    const s = k / bays;
    for (const side of [-0.9, 0.9]) S.push(K.bar(gp(s, side, 0), gp(s, side, 2.2), 0.16, '#7a7f88'));
    if (k < bays) for (const side of [-0.9, 0.9]) S.push(K.bar(gp(s, side, k % 2 ? 0 : 2.2), gp((k + 1) / bays, side, k % 2 ? 2.2 : 0), 0.12, '#7a7f88'));
  }
  S.push(K.bar(gp(0, 0, 1.6), gp(1, 0, 1.6), 1.7, '#b4afa5')); // its cladding: a pale skin along the upper half
  const mid = gp(0.5, 0, 0);
  K.lattice(S, [mid[0], -1.5, mid[2]], [mid[0], mid[1] - 0.2, mid[2]], { side: 1.6, chord: 0.22, brace: 0.13, bays: 10, colour: '#7a7f88' });
  colliders.push({ minX: mid[0] - 1, maxX: mid[0] + 1, minZ: mid[2] - 1, maxZ: mid[2] + 1, minY: 0, maxY: mid[1], prop: true, kind: 'essroc-trestle', id: 'essroc' });
  return { colliders };
}

function obbCollider(f, L, W, maxY, id) {
  const cs = Math.abs(f.cos), sn = Math.abs(f.sin), ex = (cs * L + sn * W) / 2, ez = (sn * L + cs * W) / 2;
  return { minX: f.x - ex, maxX: f.x + ex, minZ: f.z - ez, maxZ: f.z + ez, minY: 0, maxY, prop: true, kind: 'silo-block', id,
    obb: { cx: f.x, cz: f.z, hx: L / 2, hz: W / 2, cs: Math.cos(f.yaw), sn: Math.sin(f.yaw) } };
}

// The two City massing rows the silos replace (js/buildings.js builds them as plain boxes). Matched by place AND form so
// nothing else is ever excluded.
const SILO_ROWS = Object.freeze([
  { id: 'victory-silos', x: 1721.2, z: 298.5, angle: -1.322, height: 42.8, name: 'Silo' },
  { id: 'essroc-silos', x: 2075.1, z: 425.6, angle: -1.324, height: 36.9, name: '' }
]);
const siloRowMatches = (b, row) => !!b && Math.hypot(b[0] - row.x, b[1] - row.z) < 1 && Math.abs(b[4] - row.height) < 0.15;

/** The silo complexes in WORLD coordinates (the group sits at the origin). `geo` is the packed geodata (to verify the rows). */
function buildPortLandsSilos(options = {}) {
  const T = C.THREE;
  const geo = options.geo || C.GEO;
  const north = options.north || trueNorth(options.lat ?? 43.6455, options.lon ?? -79.3525);
  const group = new T.Group();
  group.name = 'PortLandsSilos';
  const colliders = [], built = [], matched = [];
  for (const row of SILO_ROWS) {
    // placed on the City's own massing row when the data has it (or, with no geodata, at its documented place)
    const rowIndex = geo?.buildings ? geo.buildings.findIndex((b) => siloRowMatches(b, row)) : -1;
    if (geo?.buildings && rowIndex < 0) continue;
    if (rowIndex >= 0) matched.push(rowIndex);
    const parts = new K.Parts();
    const out = row.id === 'victory-silos' ? victorySilos(parts, row) : essrocSilos(parts, [row.x, row.z], north);
    const n = parts.triangles, g = parts.merged();
    if (g) group.add(K.meshOf(g, 'stone', `PortLandsSilos-${row.id}`, { cullDistance: 1100, cullCell: 220 }));
    colliders.push(...out.colliders);
    built.push({ id: row.id, triangles: n });
  }
  return { id: 'port-lands-silos', name: 'Victory and Essroc silos', group, colliders, surfaces: [], climbable: false, built, matchedRows: matched,
    triangles: built.reduce((s, b) => s + b.triangles, 0),
    source: 'City of Toronto 3D massing rows (Silo; 80 Ookwemin St), City 2025 aerial, lidar bin tops; Victory Soya Mills heritage designation 2016' };
}

Object.assign(C, { buildPortLandsCrane: buildAtlasCrane, buildPortLandsSilos, PORTLANDS_SILO_ROWS: SILO_ROWS,
  portLandsSiloRowMatches: (b) => SILO_ROWS.some((row) => siloRowMatches(b, row)) });
})();
