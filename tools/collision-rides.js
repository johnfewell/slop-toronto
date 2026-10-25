// tools/collision-rides.js: scripted collision rides & measurements, for before/after comparisons (dev only, never
// shipped). A shot loads it into the running city (tools/shots/collision-rides.json); it steps the player's real
// controller (controllerManager.update) synchronously at a fixed dt, so a ride is deterministic and the same on any
// machine, and judges each ride against its own geometry: the colliders' outlines and, for the landmarks, a slice of
// their rendered meshes at 1 m (what the rider sees). It uses only APIs that main 0486f11 has too.
// Prints one line: [collide-probe] {json}
(function () {
  const app = window.__CITY_APP, C = window.CITY, cm = app.controllerManager;
  const t0 = performance.now();
  const R = { version: C.WorldCollision ? 'world-collision' : 'boxes', colliders: cm.colliders.length };
  const BAND = { person: [0, 1.9], cyclist: [0, 1.9], car: [0, 1.8], helicopter: [-0.25, 3.2] };
  const RADIUS = { person: 0.48, cyclist: 0.65, car: 0.95, helicopter: 4.5 };

  // ---- the oracle: every collider's outline (polygon, turned box or bounds), at a height band
  const shapes = new WeakMap();
  function shapeOf(c) {
    let s = shapes.get(c);
    if (s) return s;
    let pts;
    if (c.polygon) pts = c.polygon.map((p) => ({ x: p.x, z: p.z }));
    else if (c.obb) {
      const o = c.obb;
      pts = [[-o.hx, -o.hz], [o.hx, -o.hz], [o.hx, o.hz], [-o.hx, o.hz]].map(([u, v]) => ({ x: o.cx + u * o.cs + v * o.sn, z: o.cz - u * o.sn + v * o.cs }));
    } else pts = [{ x: c.minX, z: c.minZ }, { x: c.maxX, z: c.minZ }, { x: c.maxX, z: c.maxZ }, { x: c.minX, z: c.maxZ }];
    s = { pts };
    shapes.set(c, s);
    return s;
  }
  const inBand = (c, y, mode) => !(y + BAND[mode][0] >= c.maxY || y + BAND[mode][1] <= (c.minY ?? 0));
  function inside(x, z, pts) {
    let yes = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) yes = !yes;
    }
    return yes;
  }
  function segDist(x, z, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    return Math.hypot(ax + dx * t - x, az + dz * t - z);
  }
  function edgeDist(x, z, pts) {
    let d = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      d = Math.min(d, segDist(x, z, a.x, a.z, b.x, b.z));
    }
    return d;
  }
  // how deep a circle at (x, z) sits in the solids at height y (0: clear)
  function penetration(x, z, y, mode, r = RADIUS[mode]) {
    let worst = 0, what = null;
    for (const c of cm.nearColliders(x, z, r + 2)) {
      if (!inBand(c, y, mode)) continue;
      if (x + r < c.minX || x - r > c.maxX || z + r < c.minZ || z - r > c.maxZ) continue;
      const { pts } = shapeOf(c);
      const d = edgeDist(x, z, pts), inn = inside(x, z, pts);
      const p = inn ? r + d : r - d;
      if (p > worst) { worst = p; what = c; }
    }
    for (const v of visualAt(x, z, y)) { // (the landmarks as drawn)
      const d = v.dist(x, z), inn = v.inside(x, z);
      const p = inn ? r + d : r - d;
      if (p > worst) { worst = p; what = v; }
    }
    return { depth: worst, what };
  }

  // ---- the landmarks as drawn: their meshes sliced at 1 m above the street (segments, inside by even-odd)
  const visuals = [];
  const T = C.THREE;
  function slice(object, y) {
    const segs = [];
    const v = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
    object.updateMatrixWorld(true);
    object.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const g = o.geometry, pos = g.attributes.position, idx = g.index;
      const n = idx ? idx.count : pos.count;
      const inst = o.isInstancedMesh ? o.count : 0;
      const m = new T.Matrix4();
      const mats = [];
      if (inst) for (let i = 0; i < inst; i++) { const mi = new T.Matrix4(); o.getMatrixAt(i, mi); mats.push(mi.premultiply(o.matrixWorld)); }
      else mats.push(o.matrixWorld);
      for (const mw of mats) {
        for (let i = 0; i + 2 < n; i += 3) {
          for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(mw);
          const pts = [];
          for (let k = 0; k < 3; k++) {
            const a = v[k], b = v[(k + 1) % 3];
            if ((a.y - y) * (b.y - y) < 0) {
              const t = (y - a.y) / (b.y - a.y);
              pts.push(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
            }
          }
          if (pts.length === 4) segs.push(pts);
        }
      }
      void m;
    });
    return segs;
  }
  function visualFrom(name, segs) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const s of segs) { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); z0 = Math.min(z0, s[1], s[3]); z1 = Math.max(z1, s[1], s[3]); }
    return {
      name, segs, minX: x0, maxX: x1, minZ: z0, maxZ: z1,
      inside(x, z) {
        if (x < x0 || x > x1 || z < z0 || z > z1) return false;
        let yes = false;
        for (const s of segs) {
          const [ax, az, bx, bz] = s;
          if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) yes = !yes;
        }
        return yes;
      },
      dist(x, z) {
        let d = Infinity;
        for (const s of segs) d = Math.min(d, segDist(x, z, s[0], s[1], s[2], s[3]));
        return d;
      }
    };
  }
  const landmarkGroup = app.scene.getObjectByName('CityLandmarks');
  if (landmarkGroup) {
    for (const o of landmarkGroup.children) {
      if (!/^Landmark_/.test(o.name || '')) continue;
      const segs = slice(o, 1.0);
      if (segs.length >= 3) visuals.push(visualFrom(o.name.slice(9), segs));
    }
  }
  function visualAt(x, z, y) {
    if (y > 2.5 || y < -1) return [];
    return visuals.filter((v) => x > v.minX - 3 && x < v.maxX + 3 && z > v.minZ - 3 && z < v.maxZ + 3);
  }

  // ---- 1. inventory
  const sets = { buildings: new Set(app.cityBlocks.colliders), subway: new Set(app.subway.colliders || []), rail: new Set(app.railCorridor.colliders || []) };
  const kinds = { buildings: 0, subway: 0, rail: 0, cutWalls: 0, other: 0, polygon: 0, obb: 0, aabb: 0 };
  for (const c of cm.colliders) {
    if (sets.buildings.has(c)) kinds.buildings++;
    else if (sets.subway.has(c)) kinds.subway++;
    else if (sets.rail.has(c)) kinds.rail++;
    else if ((c.minY ?? 0) < -0.5) kinds.cutWalls++;
    else kinds.other++;
    kinds[c.polygon ? 'polygon' : c.obb ? 'obb' : 'aabb']++;
  }
  R.inventory = kinds;
  R.roadCuts = (C.ROAD_CUTS || []).map((c) => c.name);

  // ---- 2. how far the colliders are from what's drawn: the landmarks (slice at 1 m vs the colliders there)
  const pct = (a, q) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] : null);
  const r2 = (v) => (v === null || v === undefined ? v : Math.round(v * 100) / 100);
  R.landmarkGap = {};
  for (const v of visuals) {
    const near = cm.nearColliders((v.minX + v.maxX) / 2, (v.minZ + v.maxZ) / 2, Math.max(v.maxX - v.minX, v.maxZ - v.minZ) / 2 + 5)
      .filter((c) => inBand(c, 0.15, 'person') && !sets.buildings.has(c) && !sets.subway.has(c) && !sets.rail.has(c)
        && c.maxX > v.minX - 2 && c.minX < v.maxX + 2 && c.maxZ > v.minZ - 2 && c.minZ < v.maxZ + 2 && (c.maxX - c.minX) * (c.maxZ - c.minZ) > 6);
    // visual walls a rider can pass through (no collider within 0.25 m of them, outside every collider)
    const ghost = [], wall = [];
    for (const s of v.segs) {
      const L = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.ceil(L / 0.5));
      for (let k = 0; k <= n; k += 1) {
        const x = s[0] + ((s[2] - s[0]) * k) / n, z = s[1] + ((s[3] - s[1]) * k) / n;
        let d = Infinity, covered = false;
        for (const c of near) {
          const { pts } = shapeOf(c);
          d = Math.min(d, edgeDist(x, z, pts));
          if (inside(x, z, pts)) covered = true;
        }
        ghost.push(covered ? 0 : d);
        wall.push(d);
      }
    }
    // collider walls with nothing drawn there (invisible walls)
    const invisible = [];
    for (const c of near) {
      const { pts } = shapeOf(c);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.5));
        for (let k = 0; k < n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n, z = a.z + ((b.z - a.z) * k) / n;
          invisible.push(v.inside(x, z) ? 0 : v.dist(x, z));
        }
      }
    }
    R.landmarkGap[v.name] = {
      colliders: near.length,
      wallGap: { mean: r2(wall.reduce((t, x) => t + x, 0) / (wall.length || 1)), p95: r2(pct(wall, 0.95)), max: r2(pct(wall, 1)) },
      passThrough: { share: r2(ghost.filter((x) => x > 0.25).length / (ghost.length || 1)), max: r2(pct(ghost, 1)) },
      invisibleWall: { share: r2(invisible.filter((x) => x > 0.25).length / (invisible.length || 1)), max: r2(pct(invisible, 1)) }
    };
  }
  // the pylons' poles (TtcPylons: the model's pole at 1-2 m up, per instance) vs the pole colliders
  let pylonMesh = null;
  app.scene.traverse((o) => { if (o.isInstancedMesh && o.name === 'TtcPylons') pylonMesh = o; });
  if (pylonMesh && pylonMesh.isInstancedMesh) {
    const pos = pylonMesh.geometry.attributes.position;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 0.6) continue; // (the pole's base & collar: a plain cylinder has no vertices part-way up)
      x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i)); z0 = Math.min(z0, pos.getZ(i)); z1 = Math.max(z1, pos.getZ(i));
    }
    const local = new T.Vector3((x0 + x1) / 2, 1.4, (z0 + z1) / 2), m = new T.Matrix4(), off = [];
    for (let i = 0; i < pylonMesh.count; i++) {
      pylonMesh.getMatrixAt(i, m);
      const p = local.clone().applyMatrix4(m);
      let best = Infinity;
      for (const c of cm.nearColliders(p.x, p.z, 3)) if (c.maxX - c.minX < 1.5 && c.maxZ - c.minZ < 1.5) best = Math.min(best, Math.hypot((c.minX + c.maxX) / 2 - p.x, (c.minZ + c.maxZ) / 2 - p.z));
      off.push(best);
    }
    R.pylonPoleOffset = { n: off.length, poleInModel: [r2((x0 + x1) / 2), r2((z0 + z1) / 2)], poleSize: [r2(x1 - x0), r2(z1 - z0)], mean: r2(off.reduce((t, x) => t + x, 0) / off.length), max: r2(Math.max(...off)), over10cm: off.filter((x) => x > 0.1).length };
  }

  // ---- rides: the real controller, stepped at a fixed dt
  function place(mode, x, z, heading, speed, y) {
    app.selectMode(mode);
    const e = cm.getActiveEntity();
    cm.resetInput();
    e.position.set(x, y ?? cm.getGroundHeight(x, z, mode), z);
    e.heading = heading;
    e.speed = speed;
    for (const k of ['vx', 'vz', 'angularVel', 'verticalSpeed', 'verticalVel', 'pitchVel', 'rollVel', 'heaveVel']) if (k in e) e[k] = 0;
    if (mode === 'car') { e.health = 100; e.wrecked = 0; e.lastCrash = null; e.gear = 0; }
    e.mesh.position.copy(e.position);
    return e;
  }
  let clock = 1000;
  function ride(spec) {
    const { mode, x, z, heading, speed = 0, keys = { forward: true }, dt = 1 / 60, seconds = 2, y = null } = spec;
    const e = place(mode, x, z, heading, speed, y);
    Object.assign(cm.keys, keys);
    const steps = Math.round(seconds / dt), path = [];
    let maxPen = 0, penSteps = 0, maxDh = 0;
    for (let i = 0; i < steps; i++) {
      const h0 = e.heading;
      if (mode === 'car') { e.health = 100; e.wrecked = 0; }
      cm.update(dt, (clock += dt));
      maxDh = Math.max(maxDh, Math.abs(Math.atan2(Math.sin(e.heading - h0), Math.cos(e.heading - h0))));
      const p = penetration(e.position.x, e.position.z, e.position.y, mode, mode === 'car' ? 0.8 : RADIUS[mode] * 0.6);
      if (p.depth > 0.05) { penSteps++; maxPen = Math.max(maxPen, p.depth); }
      path.push([e.position.x, e.position.z, e.position.y, e.speed]);
    }
    cm.resetInput();
    return { e, path, maxPen, penSteps, maxDh };
  }
  // A rider stuck: forward held but under 0.5 m made good over the last second
  const lastSecond = (path, dt) => {
    const n = Math.round(1 / dt), a = path[Math.max(0, path.length - 1 - n)], b = path[path.length - 1];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  const clearAt = (x, z, mode, y, r = RADIUS[mode] + 0.3) => !C.waterAt(x, z) && penetration(x, z, y ?? cm.getGroundHeight(x, z, mode), mode, r).depth === 0 && (C.cutAt ? C.cutAt(x, z) : 0) === 0;
  const clearRun = (x, z, ux, uz, len, mode) => {
    for (let s = 0; s <= len; s += 1.5) if (!clearAt(x + ux * s, z + uz * s, mode)) return false;
    return true;
  };

  // ---- 3. tunnelling: straight at thin walls & poles, fast, at 60, 30 & 20 frames a second
  const thin = [];
  for (const c of cm.colliders) {
    if (c.polygon) continue;
    const hx = c.obb ? c.obb.hx : (c.maxX - c.minX) / 2, hz = c.obb ? c.obb.hz : (c.maxZ - c.minZ) / 2;
    const t = Math.min(hx, hz);
    if (t > 0.6 || Math.max(hx, hz) < 0.25 || c.maxY < 1.2) continue;
    const kind = (c.minY ?? 0) < -0.5 ? 'cutWall' : sets.subway.has(c) ? (Math.max(hx, hz) < 0.5 ? 'pole' : 'fence') : sets.rail.has(c) ? 'rail' : sets.buildings.has(c) ? 'building' : 'other';
    thin.push({ c, kind, hx, hz });
  }
  // deterministic picks: every k-th of each kind, up to 14 a kind
  const byKind = {};
  for (const t of thin) (byKind[t.kind] ||= []).push(t);
  const targets = [];
  for (const [kind, list] of Object.entries(byKind)) {
    const step = Math.max(1, Math.floor(list.length / 40));
    let n = 0;
    for (let i = 0; i < list.length && n < 14; i += step) {
      const t = list[i], c = t.c;
      const o = c.obb || { cx: (c.minX + c.maxX) / 2, cz: (c.minZ + c.maxZ) / 2, hx: t.hx, hz: t.hz, cs: 1, sn: 0 };
      // the thin axis: the wall's normal
      const thinU = o.hx <= o.hz;
      const nx = thinU ? o.cs : o.sn, nz = thinU ? -o.sn : o.cs, half = thinU ? o.hx : o.hz;
      for (const sg of [1, -1]) {
        const sx = o.cx + nx * sg * (half + 7), sz = o.cz + nz * sg * (half + 7);
        const y = kind === 'cutWall' ? 0.0 : null;
        if (!clearRun(sx, sz, -nx * sg, -nz * sg, 5, 'car') && kind !== 'pole') continue;
        if (kind === 'cutWall' && cm.getGroundHeight(sx, sz, 'cyclist') < -0.3) continue; // (from the street, not the cut floor)
        targets.push({ kind, c, o, nx: nx * sg, nz: nz * sg, half, sx, sz, y });
        n++;
        break;
      }
    }
  }
  const tunnelRuns = { 'car 64 m/s': ['car', 64], 'car 35 m/s': ['car', 35], 'cyclist 19 m/s': ['cyclist', 19], 'walker 8 m/s': ['person', 8.2] };
  R.tunnel = {};
  for (const [label, [mode, v]] of Object.entries(tunnelRuns)) {
    for (const fps of [60, 30, 20]) {
      let n = 0, through = 0, inside = 0;
      const examples = [];
      for (const t of targets) {
        if (mode !== 'car' && t.kind === 'rail') continue;
        const heading = Math.atan2(-t.nx, -t.nz);
        const r = ride({ mode, x: t.sx, z: t.sz, heading, speed: v, keys: { forward: true, boost: true }, dt: 1 / fps, seconds: 0.6 });
        const end = r.e.position;
        const sd = (end.x - t.o.cx) * t.nx + (end.z - t.o.cz) * t.nz; // + the approach side
        // crossed: the body's centre beyond the wall's far face, along the wall
        const along = Math.abs((end.x - t.o.cx) * -t.nz + (end.z - t.o.cz) * t.nx);
        const len = Math.max(t.o.hx, t.o.hz);
        n++;
        if (sd < -t.half && along < len + 1) { through++; if (examples.length < 3) examples.push([t.kind, Math.round(t.o.cx), Math.round(t.o.cz)]); }
        else if (Math.abs(sd) <= t.half) inside++;
      }
      R.tunnel[`${label} @${fps}`] = { n, through, inside, examples };
    }
  }
  R.tunnelTargets = Object.fromEntries(Object.entries(byKind).map(([k, l]) => [k, { all: l.length, tested: targets.filter((t) => t.kind === k).length }]));

  // ---- 4. glancing into long walls: does the rider slide along, or grind to a halt / get kicked round?
  const walls = [];
  {
    const list = app.cityBlocks.colliders;
    const step = Math.max(1, Math.floor(list.length / 4000));
    for (let i = 0; i < list.length && walls.length < 24; i += step) {
      const c = list[i], o = c.obb;
      if (!o || c.maxY < 4) continue;
      const turned = Math.abs(Math.sin(4 * Math.atan2(o.sn, o.cs))) > 0.3;
      if ((walls.filter((w) => w.turned === turned).length) >= 12) continue;
      for (const [len, half, ux, uz, nx, nz] of [[o.hz, o.hx, o.sn, o.cs, o.cs, -o.sn], [o.hx, o.hz, o.cs, -o.sn, o.sn, o.cs]]) {
        if (len < 15) continue;
        let done = false;
        for (const sg of [1, -1]) {
          const fx = o.cx + nx * sg * half, fz = o.cz + nz * sg * half; // the face's middle
          const sx = fx - ux * (len - 4) + nx * sg * 3.2, sz = fz - uz * (len - 4) + nz * sg * 3.2;
          let ok = true;
          for (let s = 0; s <= 2 * len - 8 && ok; s += 2) for (const off of [2.2, 4.2]) if (!clearAt(fx - ux * (len - 4) + ux * s + nx * sg * off, fz - uz * (len - 4) + uz * s + nz * sg * off, 'car', null, 0.4)) ok = false;
          if (!ok) continue;
          walls.push({ c, turned, ux, uz, nx: nx * sg, nz: nz * sg, sx, sz, len: 2 * len - 8 });
          done = true;
          break;
        }
        if (done) break;
      }
    }
  }
  R.slide = {};
  const slideRuns = { 'car 15 m/s 20deg': ['car', 15, 20], 'car 30 m/s 12deg': ['car', 30, 12], 'cyclist 10 m/s 25deg': ['cyclist', 10, 25], 'walker 4.4 m/s 35deg': ['person', 4.4, 35] };
  for (const [label, [mode, v, deg]] of Object.entries(slideRuns)) {
    let n = 0, stuck = 0, kept = 0, kick = 0, pen = 0;
    for (const w of walls) {
      const a = (deg * Math.PI) / 180;
      const dx = w.ux * Math.cos(a) - w.nx * Math.sin(a), dz = w.uz * Math.cos(a) - w.nz * Math.sin(a);
      const r = ride({ mode, x: w.sx, z: w.sz, heading: Math.atan2(dx, dz), speed: v, keys: { forward: true }, dt: 1 / 60, seconds: 2.5 });
      const end = r.path[r.path.length - 1];
      const prog = (end[0] - w.sx) * w.ux + (end[1] - w.sz) * w.uz;
      n++;
      const wanted = Math.min(w.len, v * 2.5 * Math.cos(a));
      kept += Math.min(1, Math.max(0, prog / wanted));
      if (lastSecond(r.path, 1 / 60) < 0.5) stuck++;
      if (r.maxDh > 0.06) kick++;
      if (r.penSteps) pen++;
    }
    R.slide[label] = { walls: n, stuck, keptProgress: r2(kept / (n || 1)), headingKicks: kick, penetrating: pen };
  }
  R.slideWalls = { turned: walls.filter((w) => w.turned).length, grid: walls.filter((w) => !w.turned).length };

  // ---- 4b. concave corners between buildings (two footprints meeting at an angle): ride in, then back out
  {
    const list = app.cityBlocks.colliders;
    const corners = [];
    const segX = (a, b, c, d) => {
      const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z }, den = r.x * s.z - r.z * s.x;
      if (Math.abs(den) < 1e-9) return null;
      const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den, u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
      return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98 ? { x: a.x + r.x * t, z: a.z + r.z * t, ea: [a, b], eb: [c, d] } : null;
    };
    const step = Math.max(1, Math.floor(list.length / 3000));
    for (let i = 0; i < list.length && corners.length < 20; i += step) {
      const A = list[i];
      if (A.maxY < 3) continue;
      const pa = shapeOf(A).pts;
      for (const B of cm.nearColliders((A.minX + A.maxX) / 2, (A.minZ + A.maxZ) / 2, 2)) {
        if (B === A || !sets.buildings.has(B) || B.maxX < A.minX || B.minX > A.maxX || B.maxZ < A.minZ || B.minZ > A.maxZ) continue;
        const pb = shapeOf(B).pts;
        let found = null;
        for (let k = 0; k < 4 && !found; k++) for (let m = 0; m < 4 && !found; m++) found = segX(pa[k], pa[(k + 1) % 4], pb[m], pb[(m + 1) % 4]);
        if (!found) continue;
        // out of the corner: away from both footprints' centres
        let ox = found.x - (A.minX + A.maxX) / 2 + found.x - (B.minX + B.maxX) / 2, oz = found.z - (A.minZ + A.maxZ) / 2 + found.z - (B.minZ + B.maxZ) / 2;
        const L = Math.hypot(ox, oz) || 1;
        ox /= L; oz /= L;
        if (inside(found.x + ox * 0.3, found.z + oz * 0.3, pa) || inside(found.x + ox * 0.3, found.z + oz * 0.3, pb)) continue;
        if (!clearRun(found.x + ox * 3, found.z + oz * 3, ox, oz, 6, 'car')) continue;
        corners.push({ x: found.x, z: found.z, ox, oz });
        break;
      }
    }
    R.corners = { n: corners.length };
    for (const [label, mode, v] of [['car', 'car', 8], ['cyclist', 'cyclist', 7], ['walker', 'person', 4]]) {
      let jitter = 0, trapped = 0, pen = 0;
      for (const k of corners) {
        const d = mode === 'car' ? 6 : 4;
        const r = ride({ mode, x: k.x + k.ox * d, z: k.z + k.oz * d, heading: Math.atan2(-k.ox, -k.oz), speed: v, keys: { forward: true }, dt: 1 / 60, seconds: 1.5 });
        const tail = r.path.slice(-30);
        const mx = tail.reduce((t, p) => t + p[0], 0) / tail.length, mz = tail.reduce((t, p) => t + p[1], 0) / tail.length;
        const sd = Math.sqrt(tail.reduce((t, p) => t + (p[0] - mx) ** 2 + (p[1] - mz) ** 2, 0) / tail.length);
        if (sd > 0.03) jitter++;
        if (r.penSteps) pen++;
        // then back out (keys: backward), from where it stopped
        const e = r.e, sx = e.position.x, sz = e.position.z;
        Object.assign(cm.keys, { backward: true });
        for (let i = 0; i < 120; i++) { if (mode === 'car') { e.health = 100; e.wrecked = 0; } cm.update(1 / 60, (clock += 1 / 60)); }
        cm.resetInput();
        if (Math.hypot(e.position.x - sx, e.position.z - sz) < 1) trapped++;
      }
      R.corners[label] = { jitter, trapped, penetrating: pen };
    }
  }

  // ---- 5. the helicopter coming down onto roofs: lands on them, or is shoved sideways?
  {
    let n = 0, shoved = 0, landed = 0, sunk = 0, maxShove = 0;
    const list = app.cityBlocks.colliders;
    for (let i = 0; i < list.length && n < 16; i += Math.floor(list.length / 60)) {
      const c = list[i], o = c.obb;
      if (!o || Math.min(o.hx, o.hz) < 9 || c.maxY < 8) continue;
      const e = place('helicopter', o.cx, o.cz, 0, 0, c.maxY + 5);
      cm.keys.down = 1;
      for (let k = 0; k < 40; k++) cm.update(1 / 20, (clock += 1 / 20));
      cm.resetInput();
      const d = Math.hypot(e.position.x - o.cx, e.position.z - o.cz);
      n++;
      maxShove = Math.max(maxShove, d);
      if (d > 1) shoved++;
      else if (e.position.y >= c.maxY - 0.3) landed++;
      else sunk++;
    }
    R.heliOntoRoofs = { n, landed, shovedSideways: shoved, sunk, maxShove: r2(maxShove) };
  }

  // ---- 6. the road cuts, the GO embankments' bridges & the decks: ride through, nothing in the way
  R.through = {};
  for (const [ci, cut] of (C.ROAD_CUTS || []).entries()) {
    for (const mode of ['cyclist', 'car']) {
      for (const lane of [3.2, -3.2]) {
        const nx = -cut.uz, nz = cut.ux;
        const sx = cut.x0 - cut.ux * 20 + nx * lane, sz = cut.z0 - cut.uz * 20 + nz * lane;
        const heading = Math.atan2(cut.ux, cut.uz) + (lane < 0 ? Math.PI : 0);
        const start = lane < 0 ? { x: cut.x0 + cut.ux * (cut.len + 20) + nx * lane, z: cut.z0 + cut.uz * (cut.len + 20) + nz * lane } : { x: sx, z: sz };
        const v = mode === 'car' ? 14 : 9;
        const r = ride({ mode, x: start.x, z: start.z, heading, speed: v, keys: { forward: true }, dt: 1 / 60, seconds: (cut.len + 40) / v + 1 });
        const end = r.path[r.path.length - 1];
        const made = Math.hypot(end[0] - start.x, end[1] - start.z);
        const minY = Math.min(...r.path.map((p) => p[2]));
        R.through[`cut ${ci} ${cut.name} ${mode} ${lane > 0 ? 'fwd' : 'back'}`] = { ok: made > cut.len + 30, made: Math.round(made), want: Math.round(cut.len + 40), lowest: r2(minY), pen: r.penSteps };
      }
    }
  }
  // under the rail bridges: along each bridged street (RAIL_LIFTS with a road), both ways
  {
    const lifts = (C.RAIL_LIFTS || []).filter((l) => l.road);
    const step = Math.max(1, Math.floor(lifts.length / 8));
    let n = 0, ok = 0;
    const fails = [];
    for (let i = 0; i < lifts.length; i += step) {
      const l = lifts[i];
      const L = Math.hypot(l.x1 - l.x0, l.z1 - l.z0) || 1, ux = (l.x1 - l.x0) / L, uz = (l.z1 - l.z0) / L;
      // the street runs across the lift's span: along the lift's segment, the tracks over its middle
      for (const lane of [2.5]) {
        const nx = -uz, nz = ux;
        const sx = l.x0 - ux * 25 + nx * lane, sz = l.z0 - uz * 25 + nz * lane;
        if (!clearAt(sx, sz, 'cyclist')) continue;
        const r = ride({ mode: 'cyclist', x: sx, z: sz, heading: Math.atan2(ux, uz), speed: 8, dt: 1 / 60, seconds: (L + 50) / 8 });
        const end = r.path[r.path.length - 1];
        const made = (end[0] - sx) * ux + (end[1] - sz) * uz;
        n++;
        if (made > L + 40) ok++;
        else fails.push([Math.round(sx), Math.round(sz), Math.round(made), Math.round(L + 50)]);
      }
    }
    R.through['under rail bridges (cyclist)'] = { n, ok, fails: fails.slice(0, 4) };
  }
  // along the decks (the Gardiner & the ramps), at deck height
  {
    const decks = (C.DECKS || []).filter((d) => d.pts.length > 3 && d.w >= 7).sort((a, b) => b.pts.length - a.pts.length).slice(0, 6);
    let n = 0, ok = 0;
    const fails = [];
    for (const d of decks) {
      const k = Math.floor(d.pts.length / 2), a = d.pts[k], b = d.pts[k + 1];
      if (a.h < 3) continue;
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      const sx = a.x - uz * 1.8, sz = a.z + ux * 1.8;
      const r = ride({ mode: 'car', x: sx, z: sz, heading: Math.atan2(ux, uz), speed: 20, dt: 1 / 60, seconds: 3, y: a.h });
      const end = r.path[r.path.length - 1];
      const made = Math.hypot(end[0] - sx, end[1] - sz);
      n++;
      if (made > 45 && end[2] > 2) ok++;
      else fails.push([d.name, Math.round(sx), Math.round(sz), Math.round(made), r2(end[2])]);
    }
    R.through['on the decks (car 20 m/s)'] = { n, ok, fails };
  }

  // ---- 7. teleports & map clicks: land clear (of what's drawn too), near the click
  {
    const B = C.CITY_BOUNDS;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const res = {};
    for (const mode of ['person', 'cyclist', 'car']) {
      let n = 0, inSolid = 0, none = 0, far = 0, dist = [];
      const bad = [];
      for (let i = 0; i < 120; i++) {
        const x = B.minX + (B.maxX - B.minX) * (0.1 + 0.8 * rnd()), z = B.minZ + (B.maxZ - B.minZ) * (0.1 + 0.8 * rnd());
        // half the clicks on a landmark or a building's middle (the hard cases)
        let cx = x, cz = z;
        if (i % 3 === 1 && visuals.length) { const v = visuals[i % visuals.length]; cx = (v.minX + v.maxX) / 2; cz = (v.minZ + v.maxZ) / 2; }
        else if (i % 3 === 2) { const c = app.cityBlocks.colliders[Math.floor(rnd() * app.cityBlocks.colliders.length)]; cx = (c.minX + c.maxX) / 2; cz = (c.minZ + c.maxZ) / 2; }
        app.selectMode(mode);
        const e = cm.getActiveEntity();
        const before = { x: e.position.x, z: e.position.z };
        app.teleportTo(cx, cz, rnd() * Math.PI * 2);
        n++;
        if (e.position.x === before.x && e.position.z === before.z) { none++; continue; }
        const d = Math.hypot(e.position.x - cx, e.position.z - cz);
        dist.push(d);
        if (d > 60) far++;
        const p = mode === 'car' ? carPen(e) : penetration(e.position.x, e.position.z, e.position.y, mode).depth;
        if (p > 0.05) { inSolid++; if (bad.length < 3) bad.push([Math.round(cx), Math.round(cz), r2(p)]); }
      }
      res[mode] = { n, inSolid, none, farOver60m: far, medianDist: r2(pct(dist, 0.5)), bad };
    }
    R.teleport = res;
  }
  // the car's actual body (its 4.5 x 1.9 m outline) against the solids
  function carPen(e) {
    const s = Math.sin(e.heading), c = Math.cos(e.heading);
    let worst = 0;
    for (const [u, v] of [[0.95, 2.25], [-0.95, 2.25], [0.95, -2.25], [-0.95, -2.25], [0, 2.25], [0, -2.25], [0.95, 0], [-0.95, 0], [0, 0]]) {
      const x = e.position.x + u * c + v * s, z = e.position.z - u * s + v * c;
      worst = Math.max(worst, penetration(x, z, e.position.y, 'car', 0.02).depth);
    }
    return worst;
  }

  // ---- 8. the R key's reset to a clear road (main has none)
  if (cm.findRoadReset) {
    const B = C.CITY_BOUNDS;
    let seed = 777;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const res = {};
    for (const mode of ['person', 'cyclist', 'car']) {
      let n = 0, ok = 0, far = 0;
      const d = [];
      for (let i = 0; i < 40; i++) {
        const c = app.cityBlocks.colliders[Math.floor(rnd() * app.cityBlocks.colliders.length)];
        const x = i % 2 ? (c.minX + c.maxX) / 2 : B.minX + (B.maxX - B.minX) * (0.1 + 0.8 * rnd()), z = i % 2 ? (c.minZ + c.maxZ) / 2 : B.minZ + (B.maxZ - B.minZ) * (0.1 + 0.8 * rnd());
        const e = place(mode, x, z, 0, 0);
        const t = performance.now();
        const road = cm.findRoadReset();
        d.push(performance.now() - t);
        n++;
        if (!road) continue;
        app.teleportTo(road.x, road.z, road.heading);
        const p = mode === 'car' ? carPen(e) : penetration(e.position.x, e.position.z, e.position.y, mode).depth;
        if (p <= 0.05 && Math.hypot(e.position.x - road.x, e.position.z - road.z) < 1) ok++;
        if (Math.hypot(road.x - x, road.z - z) > 150) far++;
      }
      res[mode] = { n, ok, farOver150m: far, ms: r2(pct(d, 0.5)), msMax: r2(pct(d, 1)) };
    }
    R.roadReset = res;
  }

  // ---- 9. the per-frame cost: controller updates riding fast through downtown (ms per update)
  {
    const cost = {};
    for (const mode of ['car', 'cyclist', 'person', 'helicopter']) {
      const start = { x: 0.5, z: 140 }; // Yonge St by Sankofa Square, heading north
      const e = place(mode, start.x, start.z, Math.PI, mode === 'car' ? 25 : mode === 'cyclist' ? 12 : 4, mode === 'helicopter' ? 20 : null);
      cm.keys.forward = true;
      const n = 600, t = performance.now();
      for (let i = 0; i < n; i++) { if (mode === 'car') { e.health = 100; e.wrecked = 0; } cm.update(1 / 60, (clock += 1 / 60)); }
      cost[mode] = r2(((performance.now() - t) / n) * 1000) / 1000;
      cm.resetInput();
    }
    R.updateMs = cost;
  }

  app.selectMode('cyclist');
  R.ms = Math.round(performance.now() - t0);
  console.log('[collide-probe] ' + JSON.stringify(R));
  window.__COLLIDE_PROBE = R;
})();
