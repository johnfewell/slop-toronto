(function () {
// js/holiday.js
// Toronto's holiday-season installations (docs/holiday-installations.md), shown only on their real dates:
//   - Nathan Phillips Square: the City Hall holiday tree and the Cavalcade of Lights' bulb lines along the Freedom Arches
//     (js/freedom-arches.js draws the arches themselves, all year)
//     (28 November 2026 to 7 January 2027, toronto.ca)
//   - the Distillery District's Winter Village (Toronto Christmas Market): its tree, overhead light strings over the lanes
//     and wooden stalls (12 November 2026 to 3 January 2027, thedistillerywintervillage.com)
// They follow the scene's day like the rinks do (seasons.js CITY.SITE_DATE: Toronto's date live, the presets' 22 August,
// a capture fixture's ?liveDate=), chosen once at load. ?holiday=0 turns them off; ?holiday=1 previews both on any date.
// Pure rules first (loaded by tests in node), then the builder: low poly, merged and instanced (one merged mesh of tree,
// poles, wires and stalls plus one InstancedMesh per bulb colour, per site), no per-bulb lights. Bulbs are emissive: a quiet
// glow by day, a gentle twinkle on the same night ramp the windows use (cityUniforms.uInteriorGlow).
const C = window.CITY;

// Month-day windows (inclusive), both running over the new year. The 2026 dates are published; other years assume the same
// pattern (docs/holiday-installations.md marks it).
const WINDOWS = Object.freeze({
  nathanPhillips: Object.freeze({ from: [11, 28], to: [1, 7] }),
  distillery: Object.freeze({ from: [11, 12], to: [1, 3] })
});
const md = (m, d) => m * 100 + d;
function inWindow(date, w) {
  const m = date?.month, d = date?.day;
  if (!Number.isInteger(m) || !Number.isInteger(d)) throw new Error('holiday windows need {month, day}');
  const x = md(m, d), a = md(...w.from), b = md(...w.to);
  return a <= b ? x >= a && x <= b : x >= a || x <= b;
}
// Which installations stand on a day. `search` is location.search: ?holiday=0 off, ?holiday=1 (or on) both on.
function holidaySeason(date, search = '') {
  const q = new URLSearchParams(search || '').get('holiday');
  if (q === '0' || q === 'off') return { nathanPhillips: false, distillery: false, forced: true };
  if (q === '1' || q === 'on') return { nathanPhillips: true, distillery: true, forced: true };
  return { nathanPhillips: inWindow(date, WINDOWS.nathanPhillips), distillery: inWindow(date, WINDOWS.distillery), forced: false };
}

// Bulb colours (a restrained festive set; no brands, no artwork)
const BULB = { warm: 0xffd9a0, cool: 0xcfe6ff, red: 0xff5a4a, green: 0x6fe08a, gold: 0xffc247 };

// ---- pure layout helpers
// n bulbs along a spiral round a cone: [x, y, z] relative to its base centre
function spiralBulbs({ radius, height, turns, spacing, inset = 0.25 }) {
  const out = [];
  const length = Math.hypot(radius * Math.PI * 2 * turns * 0.55, height);
  const n = Math.max(8, Math.round(length / spacing));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, r = radius * (1 - t) * (1 - inset * 0.2) + 0.12, a = t * turns * Math.PI * 2;
    out.push([Math.cos(a) * r, 0.6 + (height - 0.9) * t, Math.sin(a) * r]);
  }
  return out;
}
// A string between two anchors (x, z, y) sagging in the middle: points every `spacing` m
function sagPoints(a, b, y, sag, spacing) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.round(len / spacing)), pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([a[0] + (b[0] - a[0]) * t, y - sag * 4 * t * (1 - t), a[1] + (b[1] - a[1]) * t]);
  }
  return pts;
}

function buildHoliday(scene, staticColliders = []) {
  const { THREE, TSL, Addons } = C;
  const sceneDate = C.SITE_DATE || C.SCENE_DATE || { month: 8, day: 22 };
  const season = holidaySeason(sceneDate, typeof location !== 'undefined' ? location.search : '');
  C.holidayStats = { season, sceneDate: { month: sceneDate.month, day: sceneDate.day, source: sceneDate.source || 'scene' }, sites: {}, bulbs: 0, triangles: 0, colliders: 0 };
  if (!season.nathanPhillips && !season.distillery) return null;

  const groundAt = (x, z) => (C.blockAt?.(x, z) ? C.CITY_BOUNDS.sidewalkHeight : 0) + (C.cutAt?.(x, z) || 0);
  const colliders = [];
  const up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), vp = new THREE.Vector3(), vs = new THREE.Vector3();
  const col = new THREE.Color();
  const shadowOn = C.QUALITY?.kerbShadows !== false;

  // One site's parts: static solid geometry (merged) and bulbs by colour (instanced)
  function makeSite(name) {
    const parts = [], bodyParts = [], bulbs = {};
    return {
      name, bulbs,
      // `into` is the list a part joins: the structure (default) or the evergreen body, which has its own faint glow at night
      part(geo, hex, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0, into = parts) {
        const g = geo.index ? geo.toNonIndexed() : geo.clone();
        g.deleteAttribute('uv');
        col.setHex(hex);
        const n = g.attributes.position.count, c = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        q.setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
        g.applyMatrix4(m4.compose(vp.set(x, y, z), q, vs.set(sx, sy, sz)));
        into.push(g);
      },
      body(geo, hex, x, y, z, ry = 0) { this.part(geo, hex, x, y, z, ry, 1, 1, 1, 0, 0, bodyParts); },
      // a thin bar from a to b ([x, y, z])
      bar(a, b, w, hex) {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
        const geo = BOX;
        const g = geo.toNonIndexed(); g.deleteAttribute('uv');
        col.setHex(hex);
        const n = g.attributes.position.count, c = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        q.setFromUnitVectors(vp.set(0, 0, 1), vs.set(dx / len, dy / len, dz / len));
        g.applyMatrix4(m4.compose(vp.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, vs.set(w, w, len)));
        parts.push(g);
      },
      bulb(kind, x, y, z, s = 1) { (bulbs[kind] ||= []).push([x, y, z, s]); },
      merged() { return parts.length ? Addons.mergeGeometries(parts, false) : null; },
      mergedBody() { return bodyParts.length ? Addons.mergeGeometries(bodyParts, false) : null; }
    };
  }
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const CONE = (r, h, seg = 9) => new THREE.ConeGeometry(r, h, seg);
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 7);
  const PRISM = (() => { // a gabled roof: unit width (x), height (y), depth (z)
    const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g;
  })();

  // A low-poly conifer with a spiral of bulbs and a star: a tree of `height` m with its base on `y`
  function tree(site, x, y, z, height, spiralSpacing) {
    const R = height * 0.27, tiers = 5;
    site.part(CYL, 0x4a3426, x, y, z, 0, height * 0.035, height * 0.18, height * 0.035);
    for (let i = 0; i < tiers; i++) {
      const t0 = i / tiers, h = height * (0.36 - i * 0.02), r = R * (1 - t0 * 0.78);
      site.body(CONE(r, h), i % 2 ? 0x275c3b : 0x1f5034, x, y + height * 0.12 + height * 0.78 * t0 + h / 2, z, i * 0.4);
    }
    for (const [bx, by, bz] of spiralBulbs({ radius: R * 0.86, height: height * 0.92, turns: 9, spacing: spiralSpacing })) {
      const k = Math.round((bx * 7.1 + bz * 3.7 + by) * 10);
      site.bulb(((k % 7) + 7) % 7 < 4 ? 'warm' : ((k % 7) + 7) % 7 === 4 ? 'red' : ((k % 7) + 7) % 7 === 5 ? 'green' : 'cool', x + bx, y + by, z + bz, 1);
    }
    site.bulb('gold', x, y + height * 0.99, z, 3.6); // the star
    return { x, z, r: height * 0.035 + 0.5 };
  }
  const solid = (x, z, r, y0, y1) => colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, minY: y0, maxY: y1 });

  const sites = [];
  // ---- Nathan Phillips Square: the tree beside the pool, and the Cavalcade's arches over it
  if (season.nathanPhillips) {
    const rec = (C.RINKS?.records || []).find((r) => r.assetId === '43599');
    const placed = C.rinkStats?.sites?.find((s) => s.assetId === '43599');
    if (rec) {
      const site = makeSite('NathanPhillipsHoliday');
      const rect = C.outlineRectangle(rec.polygons[0].outer); // { x, z, ax, az, length, width }
      const y = placed ? placed.y : groundAt(rect.x, rect.z);
      const ax = rect.ax, az = rect.az;
      // the City Hall tree stands just beyond the pool's east end (the square's open paving)
      const tx = rect.x + ax * (rect.length / 2 + 11), tz = rect.z + az * (rect.length / 2 + 11);
      const ty = groundAt(tx, tz);
      const T = tree(site, tx, ty, tz, 17, 0.32);
      solid(T.x, T.z, 0.7, ty, ty + 4);
      sites.push(site);
      C.holidayStats.sites.nathanPhillips = { tree: [+tx.toFixed(1), +tz.toFixed(1)], arches: 0, y };
    }
    // the Cavalcade's lights on the Freedom Arches (freedom-arches.js, drawn all year): a bulb line along the crown and one
    // under the soffit of each arch; the arches alternate warm and cool white with a gold bulb now and then
    const FA = C.FREEDOM_ARCHES;
    if (FA) {
      const site = rec ? sites[sites.length - 1] : makeSite('NathanPhillipsHoliday');
      if (!rec) sites.push(site);
      const lines = { top: FA.archLinePoints('top', 0.9), under: FA.archLinePoints('under', 1.0) };
      let count = 0;
      FA.SPEC.xs.forEach((ax, i) => {
        const y0 = groundAt(ax, FA.SPEC.zc), base = i % 2 ? 'cool' : 'warm';
        for (const [side, pts] of Object.entries(lines)) {
          pts.forEach(([py, pz], k) => {
            site.bulb(k % 9 === 4 ? 'gold' : base, ax, y0 + py, pz, side === 'top' ? 1.15 : 0.95);
            count++;
          });
        }
      });
      C.holidayStats.sites.nathanPhillips = { ...(C.holidayStats.sites.nathanPhillips || {}), arches: FA.SPEC.xs.length, archBulbs: count };
    }
  }

  // ---- The Distillery's Winter Village: tree, light strings across the lanes, stalls
  const lanes = C.HOLIDAY_LANES;
  if (season.distillery && lanes) {
    const site = makeSite('DistilleryWinterVillage');
    const [tx, tz] = lanes.tree, ty = groundAt(tx, tz);
    const T = tree(site, tx, ty, tz, 9, 0.4);
    solid(T.x, T.z, 0.5, ty, ty + 3);
    for (const [x0, z0, x1, z1, y] of lanes.strings) {
      const gy = groundAt((x0 + x1) / 2, (z0 + z1) / 2), pts = sagPoints([x0, z0], [x1, z1], gy + y, 0.5, 0.9);
      for (let i = 0; i < pts.length - 1; i++) site.bar(pts[i], pts[i + 1], 0.035, 0x2a2a2a);
      pts.forEach((p, i) => site.bulb(i % 5 === 3 ? 'red' : i % 5 === 1 ? 'green' : 'warm', p[0], p[1] - 0.06, p[2], 0.8));
    }
    let k = 0;
    for (const [x, z, rot] of lanes.stalls) {
      const gy = groundAt(x, z), L = 2.6, D = 2.0, hh = 2.1, roof = k++ % 3 === 0 ? 0x8c2f2a : k % 3 === 1 ? 0x2f5a3c : 0xe4dccb;
      const ry = rot + Math.PI / 2; // the long side runs along the lane (the string spans across it)
      site.part(BOX, 0x6b4a32, x, gy + hh / 2, z, ry, L, hh, D);
      site.part(PRISM, roof, x, gy + hh, z, ry, D + 0.4, 0.9, L + 0.5);
      site.part(BOX, 0x3a2a1e, x + Math.sin(ry) * 0, gy + 1.0, z, ry, L + 0.08, 0.1, D + 0.12); // a counter ledge
      const cs = Math.cos(ry), sn = Math.sin(ry);
      for (let b = 0; b < 5; b++) { const o = -L / 2 + 0.25 + (b * (L - 0.5)) / 4; site.bulb(b % 2 ? 'warm' : 'red', x + cs * o, gy + hh - 0.1, z - sn * o + 0.0, 0.7); }
      // the oriented footprint: the stall's long side runs along (cos ry, -sin ry)
      const ux = cs, uz = -sn, hx = D / 2, hz = L / 2, rx = Math.abs(uz) * hx + Math.abs(ux) * hz, rz = Math.abs(ux) * hx + Math.abs(uz) * hz;
      colliders.push({ minX: x - rx, maxX: x + rx, minZ: z - rz, maxZ: z + rz, minY: gy, maxY: gy + hh, obb: { cx: x, cz: z, hx, hz, cs: uz, sn: ux } });
    }
    sites.push(site);
    C.holidayStats.sites.distillery = { tree: [tx, tz], strings: lanes.strings.length, stalls: lanes.stalls.length };
  }
  if (!sites.length) return null;

  // ---- meshes
  const { float, smoothstep, sin, fract, instanceIndex, time, color, vertexColor, positionWorld, normalWorld } = TSL;
  const night = C.cityUniforms?.uInteriorGlow ? smoothstep(float(0.7), float(1.45), C.cityUniforms.uInteriorGlow) : float(0);
  const bulbMaterial = (hex) => {
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5 });
    mat.color.setHex(hex);
    const phase = fract(sin(float(instanceIndex).mul(12.9898)).mul(43758.5453));
    const twinkle = sin(time.mul(phase.mul(2.2).add(1.3)).add(phase.mul(6.2832))).mul(0.5).add(0.5).mul(0.4).add(0.6);
    mat.emissiveNode = color(hex).mul(night.mul(twinkle).mul(2.4).add(0.34));
    return mat;
  };
  // The evergreen's body: its own bulbs light it, so at night it keeps a faint green of its own (on the windows' night ramp)
  // instead of going black between the strings. A slow ripple of the glow with height stands for the bulbs' twinkle on the
  // needles; no light is created, and nothing else in the scene is brightened.
  const bodyMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9 });
  bodyMat.emissiveNode = vertexColor().mul(night.mul(sin(time.mul(0.9).add(positionWorld.y.mul(0.8))).mul(0.1).add(0.9)).mul(normalWorld.y.mul(0.5).add(0.5).mul(0.35).add(0.4)).mul(0.9));
  const bulbGeo = new THREE.IcosahedronGeometry(0.13, 0);
  const structMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85 });
  const group = new THREE.Group(); group.name = 'HolidayInstallations'; scene.add(group);
  let triangles = 0, bulbs = 0;
  for (const site of sites) {
    const sg = new THREE.Group(); sg.name = site.name; group.add(sg);
    const geo = site.merged();
    if (geo) {
      geo.computeVertexNormals(); geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, structMat); mesh.name = site.name + 'Structure';
      mesh.castShadow = shadowOn; mesh.receiveShadow = true; sg.add(mesh);
      triangles += geo.attributes.position.count / 3;
    }
    const body = site.mergedBody();
    if (body) {
      body.computeVertexNormals(); body.computeBoundingSphere();
      const mesh = new THREE.Mesh(body, bodyMat); mesh.name = site.name + 'Evergreen';
      mesh.castShadow = shadowOn; mesh.receiveShadow = true; sg.add(mesh);
      triangles += body.attributes.position.count / 3;
    }
    for (const [kind, list] of Object.entries(site.bulbs)) {
      const mesh = new THREE.InstancedMesh(bulbGeo, bulbMaterial(BULB[kind]), list.length); mesh.name = `${site.name}Bulbs_${kind}`;
      list.forEach(([x, y, z, s], i) => mesh.setMatrixAt(i, m4.compose(vp.set(x, y, z), q.identity(), vs.set(s, s, s))));
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere?.(); mesh.frustumCulled = true;
      sg.add(mesh); bulbs += list.length; triangles += list.length * 20;
    }
  }
  Object.assign(C.holidayStats, { bulbs, triangles, colliders: colliders.length });
  console.info('[holiday] ' + JSON.stringify({ nathanPhillips: season.nathanPhillips, distillery: season.distillery, forced: season.forced, bulbs, triangles, colliders: colliders.length }));
  return { group, colliders };
}

Object.assign(C, { HOLIDAY_WINDOWS: WINDOWS, holidayInWindow: inWindow, holidaySeason, holidaySpiralBulbs: spiralBulbs, holidaySagPoints: sagPoints, buildHoliday });
})();
