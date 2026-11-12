(function () {
// Behaviour authored from the supplied COO camera brief; no upstream build code copied.
// Toronto coordinates are metres, Y up, heading zero along +Z (COO uses -Z).
const C = window.CITY;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const gain = (dt, tau) => -Math.expm1(-dt / tau);
const point = () => ({ x: 0, y: 0, z: 0 });
const copy = (a, b) => { a.x = b.x; a.y = b.y; a.z = b.z; };
const CAMERA_TUNING = Object.freeze({
  // Seconds/radians: vehicle-follow reference values. Distances below are Toronto tuning.
  reference: Object.freeze({ dtMax: .05, pivotTau: .09, heightTau: .18, snap: 4,
    yawTau: .30, yawRate: 2.4, slipWeight: .55, slipMax: .7,
    lookIdle: .9, recenterRamp: .5, recenterYawTau: .55, recenterPitchTau: 1.1,
    pitchMin: -.8, pitchMax: .3, pitchHome: -.2, contractTau: .06, recoverTau: .60, lensTau: .50,
    vehicleBoomScale: .72, vehicleBoomBase: 3.3, vehicleSpeedBoom: .05,
    vehicleSpeedStart: 8, vehicleSpeedCap: 24, vehicleFovExtra: 4,
    vehicleFovStart: 6, vehicleFovPerSpeed: .3, vehicleFovCap: 9,
    directorBackStart: 3.3, directorBackEnd: 2.4, directorSide: .45 }),
  toronto: Object.freeze({ cyclistBoom: 4, cyclistPivot: 1.5, cyclistFov: 65,
    cyclistSpeedLow: 4, cyclistSpeedHigh: 12, cyclistFovGain: 5,
    carLength: 4.5, carRoof: 1.445, carFov: 56, carEyeLift: .55,
    lookAhead: 5, aimDrop: .35, nearSkin: .06, groundStep: .3,
    directorDuration: 10, directorActorWeight: .58, directorFov: 25,
    directorCarScale: 1.6,
    // Vehicle dimensions in metres need a longer boom than the COO pigeon two-shot.
    directorActorHeightMin: .08, directorActorHeightMax: .48, directorLosMax: 1800 })
});

// Segment versus an expanded outline prism. Bounds gather candidates only; polygon/OBB
// outlines keep courtyard voids and rotated facades open. The enclosing cylinder is
// conservative for a sphere, including vertical corners.
function circleEntry(ax, az, dx, dz, cx, cz, radius, lo, hi) {
  const x = ax - cx, z = az - cz, aa = dx * dx + dz * dz;
  if (aa < 1e-14) return x * x + z * z <= radius * radius ? lo : Infinity;
  const bb = x * dx + z * dz, cc = x * x + z * z - radius * radius;
  const disc = bb * bb - aa * cc;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc), enter = (-bb - root) / aa, leave = (-bb + root) / aa;
  return leave >= lo && enter <= hi ? Math.max(lo, enter) : Infinity;
}
function prismEntry(a, b, radius, collider) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  let lo = 0, hi = 1;
  // Match the movement proxy contract: absent minY means street datum, not an
  // infinitely deep solid that would block legitimate below-grade passages.
  const bottom = (collider.minY ?? 0) - radius, top = (collider.maxY ?? 10000) + radius;
  if (Math.abs(dy) < 1e-12) { if (a.y < bottom || a.y > top) return Infinity; }
  else {
    const t0 = (bottom - a.y) / dy, t1 = (top - a.y) / dy;
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi) return Infinity;
  }
  if (collider.circle) return circleEntry(a.x, a.z, dx, dz, collider.circle.x, collider.circle.z, collider.circle.r + radius, lo, hi);
  const shape = C.WorldCollision?.colliderShape(collider);
  if (!shape?.edges.length) return Infinity;
  const x = a.x + dx * lo, z = a.z + dz * lo;
  let inside = false, best = Infinity;
  const P = shape.points;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if ((P[i].z > z) !== (P[j].z > z) && x < (P[j].x - P[i].x) * (z - P[i].z) / (P[j].z - P[i].z) + P[i].x) inside = !inside;
  }
  if (inside) return lo;
  for (const edge of shape.edges) {
    best = Math.min(best, circleEntry(a.x, a.z, dx, dz, edge.a.x, edge.a.z, radius, lo, hi));
    const ex = edge.b.x - edge.a.x, ez = edge.b.z - edge.a.z, length = Math.hypot(ex, ez);
    const ux = ex / length, uz = ez / length;
    const originU = (a.x - edge.a.x) * ux + (a.z - edge.a.z) * uz;
    const deltaU = dx * ux + dz * uz;
    const originV = (a.x - edge.a.x) * -uz + (a.z - edge.a.z) * ux;
    const deltaV = dx * -uz + dz * ux;
    let enter = lo, leave = hi;
    for (let axis = 0; axis < 2; axis++) {
      const o = axis ? originV : originU, d = axis ? deltaV : deltaU;
      const min = axis ? -radius : 0, max = axis ? radius : length;
      if (Math.abs(d) < 1e-12) { if (o < min || o > max) { enter = Infinity; break; } }
      else { const t0 = (min - o) / d, t1 = (max - o) / d; enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1)); }
    }
    if (enter <= leave) best = Math.min(best, enter);
  }
  return best;
}

class CameraCollision {
  constructor(controller) {
    this.controller = controller;
    this.sample = point(); this.surfaces = []; this.queries = 0; this.candidates = 0;
    this.queryMs = 0; this.enabledMetrics = false; this.lastHit = null;
    this.lineA = point(); this.lineB = point();
    this.escape = point();
  }
  radius(camera) {
    const near = camera.near || .35, half = near * Math.tan(camera.fov * Math.PI / 360);
    // A sphere around the eye enclosing every near-plane corner at any look angle.
    return Math.hypot(near, half, half * camera.aspect) + CAMERA_TUNING.toronto.nearSkin;
  }
  sweep(a, b, radius, surfaces = true) {
    const start = this.enabledMetrics ? performance.now() : 0;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const length = Math.hypot(dx, dy, dz);
    let safe = 1;
    this.lastHit = null;
    // Reuse the controller's existing static hash, including late model proxy swaps.
    const candidates = this.controller.nearColliders?.((a.x + b.x) / 2, (a.z + b.z) / 2, Math.hypot(dx, dz) / 2 + radius) || [];
    this.queries++; this.candidates += candidates.length;
    for (const c of candidates) {
      if (Math.max(a.x, b.x) + radius < c.minX || Math.min(a.x, b.x) - radius > c.maxX || Math.max(a.z, b.z) + radius < c.minZ || Math.min(a.z, b.z) - radius > c.maxZ) continue;
      const hit = prismEntry(a, b, radius, c);
      if (hit < safe) { safe = Math.max(0, hit - .025 / (length || 1)); this.lastHit = c; }
    }
    if (surfaces) {
      // Bounded local samples cover terrain and *each* vertical deck layer. No max-height
      // ground query: that would turn an overhead bridge into an invisible ground wall.
      const steps = Math.max(1, Math.ceil(length / CAMERA_TUNING.toronto.groundStep));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (t > safe) break;
        const p = this.sample; p.x = a.x + dx * t; p.y = a.y + dy * t; p.z = a.z + dz * t;
        const cut = C.cutAt?.(p.x, p.z) || 0;
        let ground = cut < 0 || (cut > 0 && C.DON_VALLEY?.clearsTerrainAt?.(p.x, p.z)) ? cut : (C.terrainHeightAt?.(p.x, p.z) ?? -10000);
        const sports = C.sportsGroundAt?.(p.x, p.z);
        if (Number.isFinite(sports)) ground = sports;
        let blocked = p.y - radius < ground;
        const levels = C.cameraSurfaceLayersAt?.(p.x, p.z, this.surfaces, radius) || [];
        for (const level of levels) if (p.y + radius > level.bottom && p.y - radius < level.top) blocked = true;
        if (blocked) { safe = Math.max(0, (i - 1) / steps); break; }
      }
    }
    if (this.enabledMetrics) this.queryMs += performance.now() - start;
    return safe;
  }
  clearEye(eye, pivot, radius) {
    if (this.sweep(eye, eye, radius) >= 1) return true;
    // A slim rider can stand closer to a facade than the near-plane sphere fits.
    // Contracting all the way to that pivot is insufficient: find a verified local
    // escape, rather than displaying an overlapping sphere at zero boom length.
    for (let ring = 1; ring <= 4; ring++) for (let side = 0; side < 8; side++) {
      const angle = side * Math.PI / 4, distance = ring * .5, p = this.escape;
      p.x = pivot.x + Math.cos(angle) * distance; p.y = Math.max(pivot.y, eye.y); p.z = pivot.z + Math.sin(angle) * distance;
      if (this.sweep(p, p, radius) >= 1) { copy(eye, p); return true; }
    }
    return false;
  }
  lineClear(a, b, radius = .08) {
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (length > CAMERA_TUNING.toronto.directorLosMax) return false;
    const steps = Math.max(1, Math.ceil(length / 24));
    copy(this.lineA, a);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.lineB.x = a.x + (b.x - a.x) * t; this.lineB.y = a.y + (b.y - a.y) * t; this.lineB.z = a.z + (b.z - a.z) * t;
      if (this.sweep(this.lineA, this.lineB, radius, true) < .9999) return false;
      copy(this.lineA, this.lineB);
    }
    return true;
  }
}

class FollowCameraRig {
  constructor(collision) {
    this.collision = collision; this.entity = null; this.ready = false;
    this.pivot = point(); this.previous = point(); this.velocity = point();
    this.boom = point(); this.aim = point(); this.eye = point(); this.candidate = point();
    this.yaw = 0; this.speed = 0; this.reach = 0; this.fov = 65;
    this.displayedReach = 0; this.lastSafeReach = 0;
    this.lastSafeEye = point(); this.hasSafeEye = false;
    this.idle = 0; this.resumeAim = 0; this.snapCount = 0;
    const spec = C.BODY_SPECS?.sedan;
    this.carPivot = CAMERA_TUNING.toronto.carRoof + .3;
    for (const row of spec?.cabin?.roofY || []) this.carPivot = Math.max(this.carPivot, row[1] + .3);
  }
  reset() { this.ready = false; this.entity = null; this.idle = 0; this.resumeAim = 0; this.hasSafeEye = false; }
  pivotHeight(entity) {
    if (entity.type === 'cyclist') return CAMERA_TUNING.toronto.cyclistPivot;
    if (entity.type === 'car') return this.carPivot;
    return entity.cameraTargetOffset?.y || 1.5;
  }
  length(entity, speed) {
    if (entity.type === 'cyclist') return CAMERA_TUNING.toronto.cyclistBoom;
    if (entity.type === 'car') {
      const spec = C.BODY_SPECS?.sedan;
      const R = CAMERA_TUNING.reference;
      return R.vehicleBoomScale * (spec ? spec.zFront - spec.zRear : CAMERA_TUNING.toronto.carLength) + R.vehicleBoomBase + R.vehicleSpeedBoom * clamp(speed - R.vehicleSpeedStart, 0, R.vehicleSpeedCap);
    }
    return entity.chaseDistance || 4.3;
  }
  update(entity, system, dt) {
    const R = CAMERA_TUNING.reference, T = CAMERA_TUNING.toronto;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, R.dtMax);
    const p = entity.position, height = this.pivotHeight(entity);
    const jump = this.ready && Math.hypot(p.x - this.previous.x, p.y - this.previous.y, p.z - this.previous.z) > R.snap;
    const seed = !this.ready || this.entity !== entity || jump;
    if (seed) {
      this.entity = entity; this.ready = true; this.snapCount++;
      copy(this.previous, p); this.pivot.x = p.x; this.pivot.y = p.y + height; this.pivot.z = p.z;
      this.yaw = entity.heading; this.speed = Math.abs(entity.speed || 0); this.reach = this.length(entity, this.speed) * system.zoomMultiplier;
      this.fov = system.camera.fov; this.velocity.x = this.velocity.y = this.velocity.z = 0;
      this.displayedReach = this.reach; this.lastSafeReach = this.reach; this.hasSafeEye = false;
      if (jump) system.onDiscontinuity?.('camera-jump');
    } else if (dt > 0) {
      this.velocity.x = (p.x - this.previous.x) / dt; this.velocity.y = (p.y - this.previous.y) / dt; this.velocity.z = (p.z - this.previous.z) / dt;
      this.speed = Math.hypot(this.velocity.x, this.velocity.z);
      // Predict the stored pivot, then correct error. Constant travel has no trailing lag.
      this.pivot.x += this.velocity.x * dt; this.pivot.z += this.velocity.z * dt;
      const k = gain(dt, R.pivotTau);
      if (Math.hypot(this.pivot.x - p.x, this.pivot.z - p.z) > R.snap) { this.pivot.x = p.x; this.pivot.z = p.z; }
      else { this.pivot.x += (p.x - this.pivot.x) * k; this.pivot.z += (p.z - this.pivot.z) * k; }
      this.pivot.y += (p.y + height - this.pivot.y) * gain(dt, R.heightTau);
      copy(this.previous, p);
    }
    const forward = this.velocity.x * Math.sin(entity.heading) + this.velocity.z * Math.cos(entity.heading);
    let heading = entity.heading;
    if (this.speed > 3 && forward > 1) heading += R.slipWeight * clamp(wrap(Math.atan2(this.velocity.x, this.velocity.z) - heading), -R.slipMax, R.slipMax);
    const turn = clamp(wrap(heading - this.yaw) * gain(dt, R.yawTau), -R.yawRate * dt, R.yawRate * dt);
    this.yaw = wrap(this.yaw + turn);
    if (system.isDragging || system.userOrbitTimer > 0) this.idle = 0;
    else this.idle += dt;
    if (this.speed > 1.5 && this.idle > R.lookIdle) {
      const strength = clamp((this.idle - R.lookIdle) / R.recenterRamp, 0, 1);
      system.orbitYawOffset = wrap(system.orbitYawOffset) * Math.exp(-dt * strength / R.recenterYawTau);
      system.orbitPitchOffset += (R.pitchHome - system.orbitPitchOffset) * gain(dt * strength, R.recenterPitchTau);
    }
    const pitch = clamp(system.orbitPitchOffset, R.pitchMin, R.pitchMax), yaw = this.yaw + system.orbitYawOffset;
    const fx = Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = Math.cos(yaw) * Math.cos(pitch);
    const length = this.length(entity, this.speed) * system.zoomMultiplier;
    this.boom.x = -fx * length; this.boom.y = -fy * length + T.carEyeLift; this.boom.z = -fz * length;
    this.candidate.x = this.pivot.x + this.boom.x; this.candidate.y = this.pivot.y + this.boom.y; this.candidate.z = this.pivot.z + this.boom.z;
    const fov = entity.type === 'cyclist' ? T.cyclistFov + T.cyclistFovGain * clamp((this.speed - T.cyclistSpeedLow) / (T.cyclistSpeedHigh - T.cyclistSpeedLow), 0, 1)
      : T.carFov + R.vehicleFovExtra + clamp((this.speed - R.vehicleFovStart) * R.vehicleFovPerSpeed, 0, R.vehicleFovCap);
    this.fov += (fov - this.fov) * gain(dt, R.lensTau);
    system.camera.fov = this.fov;
    const radius = this.collision.radius(system.camera);
    const boomLength = Math.hypot(this.boom.x, this.boom.y, this.boom.z);
    const safeReach = boomLength * this.collision.sweep(this.pivot, this.candidate, radius);
    if (safeReach > this.lastSafeReach) this.reach = Math.min(this.reach, this.displayedReach);
    this.reach += (safeReach - this.reach) * gain(dt, safeReach < this.reach ? R.contractTau : R.recoverTau);
    // The displayed eye is ALWAYS capped to the current verified reach, even while the
    // comfort filter catches up to an approaching wall or a newly refined collider.
    const reach = Math.min(this.reach, safeReach), ratio = reach / (boomLength || 1);
    this.lastSafeReach = safeReach; this.displayedReach = reach;
    this.eye.x = this.pivot.x + this.boom.x * ratio; this.eye.y = this.pivot.y + this.boom.y * ratio; this.eye.z = this.pivot.z + this.boom.z * ratio;
    if (this.collision.clearEye(this.eye, this.pivot, radius)) { copy(this.lastSafeEye, this.eye); this.hasSafeEye = true; }
    else if (this.hasSafeEye && this.collision.sweep(this.lastSafeEye, this.lastSafeEye, radius) >= 1) copy(this.eye, this.lastSafeEye);
    else return false; // No verified eye: retain the last rendered image, never publish an unsafe candidate.
    const ax = fx * T.lookAhead, ay = fy * T.lookAhead - T.aimDrop, az = fz * T.lookAhead;
    const aimGain = this.resumeAim > 0 ? gain(dt, .12) : 1;
    this.aim.x += (ax - this.aim.x) * aimGain; this.aim.y += (ay - this.aim.y) * aimGain; this.aim.z += (az - this.aim.z) * aimGain;
    this.resumeAim = Math.max(0, this.resumeAim - dt);
    system.currentPos.set(this.eye.x, this.eye.y, this.eye.z);
    system.currentLookAt.set(this.pivot.x + this.aim.x, this.pivot.y + this.aim.y, this.pivot.z + this.aim.z);
    system.smoothedSpeed = this.speed;
    system.initialized = true;
    return true;
  }
  resume(system, entity) {
    this.reset(); this.entity = entity; this.ready = true; copy(this.previous, entity.position);
    this.pivot.x = entity.position.x; this.pivot.y = entity.position.y + this.pivotHeight(entity); this.pivot.z = entity.position.z;
    const dx = this.pivot.x - system.currentPos.x, dz = this.pivot.z - system.currentPos.z;
    const horizontal = Math.hypot(dx, dz);
    this.yaw = entity.heading;
    system.orbitYawOffset = wrap(Math.atan2(dx, dz) - this.yaw);
    system.orbitPitchOffset = clamp(Math.atan2(this.pivot.y + CAMERA_TUNING.toronto.carEyeLift - system.currentPos.y, horizontal), -.8, .3);
    system.zoomMultiplier = clamp(horizontal / (Math.cos(system.orbitPitchOffset) * this.length(entity, 0)), .45, 2.4);
    this.reach = Math.hypot(dx, this.pivot.y - system.currentPos.y, dz); this.fov = system.camera.fov;
    this.aim.x = system.currentLookAt.x - this.pivot.x; this.aim.y = system.currentLookAt.y - this.pivot.y; this.aim.z = system.currentLookAt.z - this.pivot.z;
    this.resumeAim = 1; this.velocity.x = this.velocity.y = this.velocity.z = 0;
  }
  snapshot() {
    const state = {};
    for (const key of Object.keys(this)) if (key !== 'collision') state[key] = typeof this[key] === 'object' && this[key] !== this.entity ? { ...this[key] } : this[key];
    return state;
  }
  restore(state) { for (const [key, value] of Object.entries(state)) { if (value && typeof value === 'object' && key !== 'entity') copy(this[key], value); else this[key] = value; } }
}

// A separate authored shot. All world geometry/collision proxies are resident in this
// city (distance culling is visibility, not tile loading), so validation can precede
// a cut. Never alter the interactive rig to manufacture the two-shot.
class TorontoCameraDirector {
  constructor(system) {
    this.system = system; this.time = 0; this.ready = false; this.reason = null;
    this.side = 1; this.distanceScale = 1; this.nextCheck = 0; this.validationCount = 0;
    this.eye = point(); this.look = point(); this.head = point(); this.landmark = point();
    this.top = point(); this.base = point(); this.axis = point(); this.direction = point();
    this.landmarkSight = point(); this.topSight = point();
    this.forward = point(); this.right = point(); this.up = point(); this.testPoint = point();
    this.projected = { x: 0, y: 0, z: 0 }; this.fov = 25; this.maxSlope = 0;
    this.report = { valid: false, reason: 'pending', aspect: system.camera.aspect, checks: [] };
    this.visit = system.directorVisits || 0; system.directorVisits = this.visit + 1;
  }
  actorHeight(entity) { return entity.type === 'car' ? 1.5 : entity.type === 'streetcar' ? 3.6 : 1.9; }
  compose(t, entity) {
    const T = CAMERA_TUNING.toronto, site = C.LANDMARK_SITES?.cnTower;
    if (!site || !Number.isFinite(site.h)) { this.reason = 'CN Tower model unavailable'; return false; }
    const p = entity.position, h = this.actorHeight(entity);
    const ground = C.terrainHeightAt?.(site.x, site.z) || 0;
    this.landmark.x = site.x; this.landmark.y = ground + Math.min(110, site.h * .45); this.landmark.z = site.z;
    this.top.x = site.x; this.top.y = ground + site.h; this.top.z = site.z;
    this.base.x = site.x; this.base.y = ground; this.base.z = site.z;
    let ax = site.x - p.x, az = site.z - p.z;
    const distance = Math.hypot(ax, az);
    if (distance < 80 || distance > T.directorLosMax - 20) { this.reason = 'landmark outside supported two-shot range'; return false; }
    ax /= distance; az /= distance;
    const R = CAMERA_TUNING.reference;
    const smooth = t * t * (3 - 2 * t), back = (R.directorBackStart + (R.directorBackEnd - R.directorBackStart) * smooth) * this.distanceScale;
    this.eye.x = p.x - ax * back + az * R.directorSide * this.side;
    this.eye.y = p.y + h * .82 + .25;
    this.eye.z = p.z - az * back - ax * R.directorSide * this.side;
    this.head.x = p.x; this.head.y = p.y + h * .72; this.head.z = p.z;
    let hx = this.head.x - this.eye.x, hy = this.head.y - this.eye.y, hz = this.head.z - this.eye.z;
    let lx = this.landmark.x - this.eye.x, ly = this.landmark.y - this.eye.y, lz = this.landmark.z - this.eye.z;
    const hl = Math.hypot(hx, hy, hz), ll = Math.hypot(lx, ly, lz);
    // Mix UNIT directions from this eye. Mixing positions would let a far landmark
    // completely overwhelm the subject, despite the nominal 58/42 weighting.
    hx /= hl; hy /= hl; hz /= hl; lx /= ll; ly /= ll; lz /= ll;
    const w = T.directorActorWeight, d = this.direction;
    d.x = hx * w + lx * (1 - w); d.y = hy * w + ly * (1 - w); d.z = hz * w + lz * (1 - w);
    const dl = Math.hypot(d.x, d.y, d.z); d.x /= dl; d.y /= dl; d.z /= dl;
    this.look.x = this.eye.x + d.x * 10; this.look.y = this.eye.y + d.y * 10; this.look.z = this.eye.z + d.z * 10;
    copy(this.forward, d);
    const rl = Math.hypot(d.x, d.z);
    this.right.x = -d.z / rl; this.right.y = 0; this.right.z = d.x / rl;
    this.up.x = -this.right.z * d.y; this.up.y = this.right.z * d.x - this.right.x * d.z; this.up.z = this.right.x * d.y;
    // Toronto's 553 m tower and a full-sized rider require more than the nominal
    // COO lens on some aspects. Fit both silhouettes before displaying a candidate.
    this.maxSlope = 0;
    const halfWidth = entity.type === 'car' ? 1 : .65, halfLength = entity.type === 'car' ? 2.25 : 1.25;
    const cs = Math.cos(entity.heading), sn = Math.sin(entity.heading);
    for (let i = 0; i < 8; i++) {
      const lx = i & 1 ? halfWidth : -halfWidth, lz = i & 4 ? halfLength : -halfLength;
      const q = this.testPoint; q.x = p.x + lx * cs + lz * sn; q.y = p.y + (i & 2 ? h : 0); q.z = p.z - lx * sn + lz * cs;
      this.include(q);
    }
    this.include(this.top); this.include(this.base);
    this.fov = Math.max(T.directorFov, 2 * Math.atan(this.maxSlope * 1.14) * 180 / Math.PI);
    if (!Number.isFinite(this.fov) || this.fov > 95) { this.reason = 'subject and tower do not fit this aspect'; return false; }
    return true;
  }
  coordinates(p) {
    const x = p.x - this.eye.x, y = p.y - this.eye.y, z = p.z - this.eye.z, o = this.projected;
    o.z = x * this.forward.x + y * this.forward.y + z * this.forward.z;
    o.x = x * this.right.x + y * this.right.y + z * this.right.z;
    o.y = x * this.up.x + y * this.up.y + z * this.up.z;
    return o;
  }
  include(p) {
    const q = this.coordinates(p);
    if (q.z <= .1) { this.maxSlope = Infinity; return; }
    this.maxSlope = Math.max(this.maxSlope, Math.abs(q.x) / (q.z * this.system.camera.aspect), Math.abs(q.y) / q.z);
  }
  validate(t, entity, los = true) {
    this.validationCount++;
    if (!this.compose(t, entity)) return false;
    const system = this.system, p = entity.position;
    const head = this.head, q = this.coordinates(head), half = Math.tan(this.fov * Math.PI / 360);
    const subjectHeight = this.actorHeight(entity) / (2 * q.z * half);
    if (!(subjectHeight >= .08 && subjectHeight <= .48)) { this.reason = 'subject size outside frame limits'; return false; }
    // Use the actual candidate lens for its near-plane sphere before accepting the cut.
    const previousFov = system.camera.fov; system.camera.fov = this.fov;
    const radius = system.collision.radius(system.camera); system.camera.fov = previousFov;
    const start = this.testPoint; start.x = p.x; start.y = p.y + this.actorHeight(entity) * .82 + .25; start.z = p.z;
    if (system.collision.sweep(start, this.eye, radius) < .98) { this.reason = 'local camera obstruction'; return false; }
    // End LOS at the near face of the landmark envelope, rather than rejecting the
    // tower for occluding its own interior aim point. Other buildings still obstruct.
    const site = C.LANDMARK_SITES.cnTower, clearance = Math.max(site.w || 0, site.d || 0) * .72 + 2;
    for (let i = 0; i < 2; i++) {
      const target = i ? this.top : this.landmark, end = i ? this.topSight : this.landmarkSight;
      const length = Math.hypot(target.x - this.eye.x, target.y - this.eye.y, target.z - this.eye.z), ratio = Math.max(0, 1 - clearance / length);
      end.x = this.eye.x + (target.x - this.eye.x) * ratio; end.y = this.eye.y + (target.y - this.eye.y) * ratio; end.z = this.eye.z + (target.z - this.eye.z) * ratio;
    }
    if (los && (!system.collision.lineClear(this.eye, head) || !system.collision.lineClear(this.eye, this.landmarkSight) || !system.collision.lineClear(this.eye, this.topSight))) {
      this.reason = 'subject or landmark line of sight obstructed'; return false;
    }
    return true;
  }
  prepare(entity) {
    if (entity.type !== 'cyclist' && entity.type !== 'car') { this.reason = 'two-shot requires a cyclist or car'; this.report.reason = this.reason; return false; }
    // Stable, repeatable alternatives: switch side/distance if the first composition
    // is obstructed. Each is checked at start/mid/end against the current viewport.
    for (let variant = 0; variant < 4; variant++) {
      const choice = (variant + this.visit) % 4;
      this.side = choice & 1 ? -1 : 1; this.distanceScale = (choice < 2 ? 1.6 : 2.0) * (entity.type === 'car' ? CAMERA_TUNING.toronto.directorCarScale : 1);
      this.report.checks.length = 0;
      let valid = true;
      for (let sample = 0; sample < 3; sample++) {
        const t = sample / 2, okay = this.validate(t, entity);
        this.report.checks.push({ t, valid: okay, fov: this.fov, reason: okay ? null : this.reason });
        if (!okay) { valid = false; break; }
      }
      if (valid) { this.ready = true; this.reason = null; this.report.valid = true; this.report.reason = null; return true; }
    }
    this.report.reason = this.reason; return false;
  }
  update(dt, elapsed, entity) {
    if (!this.ready && !this.prepare(entity)) return false;
    this.time = Math.min(CAMERA_TUNING.toronto.directorDuration, this.time + dt);
    const t = this.time / CAMERA_TUNING.toronto.directorDuration;
    const los = this.time >= this.nextCheck;
    if (!this.validate(t, entity, los)) { this.report.valid = false; this.report.reason = this.reason; return false; }
    if (los) this.nextCheck = this.time + .2;
    const system = this.system;
    if (!this.displayed) system.onDiscontinuity?.('director-cut');
    system.currentPos.set(this.eye.x, this.eye.y, this.eye.z);
    system.currentLookAt.set(this.look.x, this.look.y, this.look.z);
    system.camera.fov = this.fov; system.camera.updateProjectionMatrix();
    system.camera.position.copy(system.currentPos);
    if (system.camera.up) system.camera.up.set(0, 1, 0);
    system.camera.lookAt(system.currentLookAt); system.initialized = true;
    this.displayed = true;
    return true;
  }
}

Object.assign(C, { CAMERA_TUNING, CameraCollision, FollowCameraRig, TorontoCameraDirector, cameraWrapAngle: wrap, cameraPrismEntry: prismEntry });
})();
