(function () {
// js/rocketbox-pedestrians.js
// The crowd near the camera is drawn as Microsoft Rocketbox avatars (assets/people/rocketbox/<id>_lod2.glb, MIT, its
// LICENSES.md beside it; see CREDITS.md) in place of the procedural instanced body, driven by the same PersonRig.
// ?rocketbox=0 leaves this file out. First a trial (st-jfzf); the full set of people is st-8p1p.
// - Who: every walker gets a fixed person from its stable id (assignIdentities): the eighteen civilians (ten men, eight women) of
//   its own gender, dealt out by a hash of the walker's id, and about 1 walker in 100 is the police officer (male
//   walkers only). Never from distance.
// - When: a walker within the switch distance (tier: ?rocketboxNear=<m>, off at 1.2x that) is drawn as its avatar, at
//   most ?rocketboxMax=<n> at once (selectNear: avatars already drawn keep their place, then the nearest). Beyond that
//   it stays the procedural body. The choice made at the end of a frame takes effect on the next one.
// - Files: a person's GLB is fetched the first time one of its walkers comes within the switch distance; until it
//   is ready, and if it fails, those walkers stay procedural. Geometry, materials and textures are shared by every
//   clone of a person; each drawn walker has its own skeleton, pooled per person and reused.
// - PersonRig's pose holds, per bone, a WORLD rotation q relative to our bind pose (identity at bind; a bind-space
//   point v goes to q * (v * s) + t, see writeBone in pedestrians.js). So a Rocketbox bone's world rotation is
//   q * C * (its rest world rotation), where C is a fixed turn that takes the limb's rest direction onto our bind
//   direction (the Rocketbox arms rest held out, ours hang). Only rotations are written, plus the pelvis position;
//   every bone keeps its own length.
// - The body is scaled so its leg (thigh + calf) is as long as ours, so the ankles land where the rig plants them.
const BONE = { PELVIS: 0, CHEST: 1, HEAD: 2, UPPER_ARM_L: 3, FOREARM_L: 4, UPPER_ARM_R: 5, FOREARM_R: 6,
  THIGH_L: 7, SHIN_L: 8, FOOT_L: 9, TOE_L: 10, THIGH_R: 11, SHIN_R: 12, FOOT_R: 13, TOE_R: 14 };
// our bone, the Bip01 bone it drives, and (limbs only) the Bip01 joint and our joint the bone points at
const MAP = [
  { our: BONE.PELVIS, name: 'Pelvis' },
  { our: BONE.CHEST, name: 'Spine1' },
  { our: BONE.HEAD, name: 'Head' },
  { our: BONE.UPPER_ARM_L, name: 'L UpperArm', child: 'L Forearm', ourChild: BONE.FOREARM_L },
  { our: BONE.FOREARM_L, name: 'L Forearm', child: 'L Hand', ourFrom: BONE.UPPER_ARM_L, ourChild: BONE.FOREARM_L },
  { our: BONE.UPPER_ARM_R, name: 'R UpperArm', child: 'R Forearm', ourChild: BONE.FOREARM_R },
  { our: BONE.FOREARM_R, name: 'R Forearm', child: 'R Hand', ourFrom: BONE.UPPER_ARM_R, ourChild: BONE.FOREARM_R },
  { our: BONE.THIGH_L, name: 'L Thigh', child: 'L Calf', ourChild: BONE.SHIN_L },
  { our: BONE.SHIN_L, name: 'L Calf', child: 'L Foot', ourChild: BONE.FOOT_L },
  { our: BONE.FOOT_L, name: 'L Foot', child: 'L Toe0', ourChild: BONE.TOE_L },
  { our: BONE.TOE_L, name: 'L Toe0' },
  { our: BONE.THIGH_R, name: 'R Thigh', child: 'R Calf', ourChild: BONE.SHIN_R },
  { our: BONE.SHIN_R, name: 'R Calf', child: 'R Foot', ourChild: BONE.FOOT_R },
  { our: BONE.FOOT_R, name: 'R Foot', child: 'R Toe0', ourChild: BONE.TOE_R },
  { our: BONE.TOE_R, name: 'R Toe0' }
];
// (three's loader keeps no spaces in a node name: "Bip01 L Thigh" loads as Bip01_L_Thigh)
const key = (name) => name.replace(/^Bip01[ _]/, '').replace(/[\s.]+/g, '_');

// Drives one loaded Rocketbox skeleton from a PersonRig. `root` is a Group holding the model (the loaded scene or a
// clone); nothing here needs a renderer, so tools/rocketbox/check-retarget.mjs runs it in Node.
function makeRetarget(THREE) {
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _qi = new THREE.Quaternion();

  return class Retarget {
    constructor(root, model) {
      this.root = root;
      this.model = model;
      this.rig = null;
      this.named = new Map();
      model.traverse((o) => { if (/^Bip01[ _]/.test(o.name)) this.named.set(key(o.name), o); });
      const pelvis = this.bone('Pelvis');
      this.armature = pelvis.parent;
      // every node under the pelvis, parents before children
      this.chain = [];
      pelvis.traverse((o) => this.chain.push(o));
      this.index = new Map(this.chain.map((b, i) => [b, i]));
      this.parentIndex = this.chain.map((b) => (this.index.has(b.parent) ? this.index.get(b.parent) : -1));

      root.position.set(0, 0, 0);
      root.quaternion.identity();
      root.scale.setScalar(1);
      root.updateMatrixWorld(true);
      // Facing: we face +Z with +X on the person's left. Turn the model about +Y until the line through its hips runs
      // along +X (right hip to left hip) with its toes ahead of its ankles.
      const heading = () => {
        const left = this.worldPos('L Thigh', _v).sub(this.worldPos('R Thigh', _v2));
        const fx = -left.z, fz = left.x; // forward, a quarter turn from the hip line
        const toe = this.worldPos('L Toe0', _v).sub(this.worldPos('L Foot', _v2));
        const back = toe.x * fx + toe.z * fz < 0;
        return Math.atan2(back ? -fx : fx, back ? -fz : fz);
      };
      model.rotation.y -= heading();
      root.updateMatrixWorld(true);
      this.facingError = heading();
      this.leftIsPlusX = this.worldPos('L Thigh', _v).x > this.worldPos('R Thigh', _v2).x;

      this.armatureQ = this.armature.getWorldQuaternion(new THREE.Quaternion());
      this.restLocalQ = this.chain.map((b) => b.quaternion.clone());
      this.worldQ = this.chain.map(() => new THREE.Quaternion());
      this.map = MAP.map((m) => {
        const bone = this.bone(m.name);
        return {
          ...m,
          bone,
          i: this.index.get(bone),
          restWorldQ: bone.getWorldQuaternion(new THREE.Quaternion()),
          restPos: this.worldPos(m.name, new THREE.Vector3()),
          restChildPos: m.child ? this.worldPos(m.child, new THREE.Vector3()) : null,
          targetRestQ: new THREE.Quaternion()
        };
      });
      this.byIndex = new Map(this.map.map((m) => [m.i, m]));
      const at = (our) => this.map.find((m) => m.our === our);
      const hipL = at(BONE.THIGH_L), hipR = at(BONE.THIGH_R);
      this.restHipMid = hipL.restPos.clone().add(hipR.restPos).multiplyScalar(0.5);
      this.pelvisFromHips = at(BONE.PELVIS).restPos.clone().sub(this.restHipMid);
      // its leg, hip to ankle, at scale 1
      this.legLength = hipL.restPos.distanceTo(hipL.restChildPos) + at(BONE.SHIN_L).restPos.distanceTo(at(BONE.SHIN_L).restChildPos);
      this.restAnkleY = at(BONE.FOOT_L).restPos.y;
    }

    bone(name) {
      const b = this.named.get(key(name));
      if (!b) throw new Error(`[rocketbox] the model has no bone "Bip01 ${name}"`);
      return b;
    }

    worldPos(name, out) {
      return out.setFromMatrixPosition(this.bone(name).matrixWorld);
    }

    // The fixed turns for this walker's bind pose, and the scale that makes its leg as long as ours
    bind(rig) {
      this.rig = rig;
      const j = rig.bind;
      for (const m of this.map) {
        m.targetRestQ.copy(m.restWorldQ);
        if (!m.child) continue;
        _v.subVectors(m.restChildPos, m.restPos).normalize();
        _v2.subVectors(j[m.ourChild], j[m.ourFrom ?? m.our]).normalize();
        m.targetRestQ.premultiply(_q.setFromUnitVectors(_v, _v2));
      }
      const ourLeg = j[BONE.THIGH_L].distanceTo(j[BONE.SHIN_L]) + j[BONE.SHIN_L].distanceTo(j[BONE.FOOT_L]);
      this.unitScale = ourLeg / this.legLength;
    }

    // One frame
    apply() {
      const rig = this.rig, a = rig.pose;
      const scale = rig.s * this.unitScale;
      this.root.scale.setScalar(scale);
      for (let i = 0; i < this.chain.length; i++) {
        const p = this.parentIndex[i];
        const parentQ = p < 0 ? this.armatureQ : this.worldQ[p];
        const m = this.byIndex.get(i);
        const b = this.chain[i];
        if (m) {
          const o = m.our * 8;
          this.worldQ[i].set(a[o], a[o + 1], a[o + 2], a[o + 3]).multiply(m.targetRestQ);
          b.quaternion.copy(_qi.copy(parentQ).invert()).multiply(this.worldQ[i]);
        } else {
          b.quaternion.copy(this.restLocalQ[i]);
          this.worldQ[i].copy(parentQ).multiply(b.quaternion);
        }
      }
      // the pelvis, so that the middle of its hips sits on the middle of the rig's hips
      this.armature.updateWorldMatrix(true, false);
      rig.jointAt(BONE.THIGH_L, _v).add(rig.jointAt(BONE.THIGH_R, _v2)).multiplyScalar(0.5);
      _q.set(a[0], a[1], a[2], a[3]);
      _v.add(_v2.copy(this.pelvisFromHips).multiplyScalar(scale).applyQuaternion(_q));
      this.chain[0].position.copy(this.armature.worldToLocal(_v));
      this.root.updateMatrixWorld(true);
    }
  };
}
window.CITY.makeRocketboxRetarget = makeRetarget;

// --- Who is which person, and who is drawn: pure, so tests/rocketbox-crowd.test.mjs runs them in Node -----------------
const CIVILIANS = {
  male: ['male-adult-01', 'male-adult-03', 'male-adult-10', 'male-adult-12', 'male-adult-17', 'male-adult-04', 'male-adult-15',
    'business-male-02', 'male-adult-08', 'business-male-04'],
  female: ['female-adult-06', 'female-adult-08', 'female-adult-09', 'female-adult-11', 'business-female-03', 'business-female-01',
    'sports-female-02', 'female-adult-17']
};
const COP = 'police-male-03';
const ALL_IDS = [...CIVILIANS.male, ...CIVILIANS.female, COP];

// A stable [0, 1) from a walker's id (an integer hash, so neighbouring ids are unrelated)
function hashId(n) {
  n = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  n ^= n >>> 13;
  n = Math.imul(n, 0xc2b2ae35);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

// One person for each walker (`{ id, female }`, id the walker's stable number), from a hash of its id. Each gender's
// walkers are ranked by that hash and dealt out to its civilians in turn, so the spread is exactly even (+-1) while
// neighbouring ids get unrelated people, and the same walker is always the same person whatever order the list comes in.
// The first copRate x (all walkers) of the men, by the same ranking, are the police officer. Returns { id: person }.
function assignIdentities(walkers, copRate = 0.01) {
  const cops = Math.round(walkers.length * copRate);
  const result = new Map();
  for (const female of [false, true]) {
    const group = walkers.filter((w) => !!w.female === female).sort((a, b) => hashId(a.id) - hashId(b.id) || a.id - b.id);
    const list = CIVILIANS[female ? 'female' : 'male'];
    let turn = 0;
    group.forEach((w, rank) => result.set(w.id, !female && rank < cops ? COP : list[turn++ % list.length]));
  }
  return result;
}

// Which walkers are drawn as avatars this frame. `cands`: { key, dist, active (drawn as an avatar last frame), ok
// (its file is loaded) }. A walker drawn already stays until it is past `off`; a new one starts within `on`. At the cap,
// walkers already drawn and still inside `on` keep their places (nearest first), then the rest by distance, so nobody
// swaps bodies because another walker came a little nearer. Returns the set of keys.
function selectNear(cands, on, off, max) {
  const eligible = cands.filter((c) => c.ok && c.dist < (c.active ? off : on));
  eligible.sort((a, b) => {
    const ka = a.active && a.dist <= on ? 0 : 1, kb = b.active && b.dist <= on ? 0 : 1;
    return ka - kb || a.dist - b.dist;
  });
  return new Set(eligible.slice(0, Math.max(0, max)).map((c) => c.key));
}

// A walker about to be shown as its person for the first time (its far body is dressed as it, or it becomes an avatar): if
// another walker within `radius` m already shown is the same person, a different civilian of its gender that none of the
// walkers within that radius is, picked by `r` in [0, 1); otherwise its own person. Pure.
function dodgeTwin(person, female, neighbourPeople, r) {
  if (person === COP || !neighbourPeople.includes(person)) return person;
  const free = CIVILIANS[female ? 'female' : 'male'].filter((id) => !neighbourPeople.includes(id));
  return free.length ? free[Math.min(free.length - 1, Math.floor(r * free.length))] : person;
}
window.CITY.rocketboxCrowd = { ALL_IDS, CIVILIANS, COP, assignIdentities, selectNear, dodgeTwin, hashId };

if (typeof location !== 'undefined' && window.CITY.TSL) init();

function init() {
  const { THREE } = window.CITY;
  const params = new URLSearchParams(location.search);
  const Retarget = makeRetarget(THREE);
  const Q = window.CITY.QUALITY || {};
  // (js/pedestrians.js: what each person wears, and its hair value; the order is ALL_IDS)
  const LOOK_HAIR = window.CITY.PERSON_LOOKS?.hairLength || ALL_IDS.map(() => 0.3);
  const num = (name, dflt) => { const v = params.get(name); return v !== null && v !== '' && isFinite(Number(v)) ? Number(v) : dflt; };
  // the switch distance (m), its off distance (x1.2, so nobody flickers at the edge) and the most avatars drawn at once:
  // per quality tier (js/quality.js: rocketboxNear, rocketboxMax)
  const NEAR = Math.max(1, num('rocketboxNear', Q.rocketboxNear ?? 35));
  const FAR = NEAR * 1.2;
  const MAX = Math.max(0, Math.floor(num('rocketboxMax', Q.rocketboxMax ?? 24)));
  const CHECKS = params.get('rocketboxChecks') === '1';
  // the far procedural body is dressed as its avatar out to this distance (m), then goes back to its own hash look: the
  // crowd beyond is as varied as ever. (?rocketboxMatch=0 turns the matching off)
  const MATCH = Math.max(0, num('rocketboxMatch', NEAR * 2.3));
  // DEBUG ONLY, for captures: ?rocketboxForce=police-male-03,female-adult-08 makes the nearest walker of the right sex
  // (one per id, only while it is within the switch distance) that person
  const FORCE = (params.get('rocketboxForce') || '').split(',').filter((id) => ALL_IDS.includes(id));
  // two walkers of one person closer than this (m), when the later one is about to be shown, get a different person for
  // the later one (only then: nobody ever changes person once shown). ?rocketboxTwin=0 turns it off
  const TWIN_RADIUS = Math.max(0, num('rocketboxTwin', 6));
  const MAX_LOADS = 2; // files in flight at once
  const MAX_BUILDS = 2; // new skeletons made in one frame
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const url = (id) => `./assets/people/rocketbox/${id}_lod2.glb`;

  // (the 175 face shapes never move)
  function dropMorphs(gltf) {
    gltf.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      o.geometry.morphAttributes = {};
      o.geometry.morphTargetsRelative = false;
      o.morphTargetInfluences = undefined;
      o.morphTargetDictionary = undefined;
    });
    return gltf;
  }

  function describe(gltf) {
    let bones = 0, meshes = 0, tris = 0;
    gltf.scene.traverse((o) => {
      if (o.isBone) bones++;
      if (!o.isSkinnedMesh) return;
      meshes++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    return { bones, meshes, triangles: Math.round(tris) };
  }

  // the hair and lashes are an alpha-masked card: cut it, do not blend it
  function cutout(mat) {
    if (mat && (mat.transparent || mat.alphaTest > 0 || /opacity|hair|lash/i.test(mat.name || ''))) {
      mat.alphaTest = 0.5;
      mat.transparent = false;
      mat.depthWrite = true;
      mat.needsUpdate = true;
    }
    return mat;
  }

  // One skeleton of one person (the geometry, materials and textures are the person's, shared), bound to a walker's rig
  // while that walker is drawn here
  class Avatar {
    constructor(person) {
      this.person = person;
      this.on = false;
      this.drawn = false;
      this.model = window.CITY.Addons.SkeletonUtils.clone(person.scene);
      this.root = new THREE.Group();
      this.root.name = 'RocketboxPerson';
      this.root.visible = false;
      this.root.add(this.model);
      this.model.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      });
      this.retarget = new Retarget(this.root, this.model);
    }

    get rig() { return this.retarget.rig; }

    // (the skeleton's bone texture is all a skeleton owns; geometry and materials are shared)
    dispose() {
      this.root.removeFromParent();
      this.model.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); });
    }
  }

  const hook = {
    ready: false, // at least one file has loaded
    error: null,
    info: null,
    near: NEAR, off: FAR, max: MAX,
    avatars: [], // every skeleton made (the pools and the drawn)
    people: new Map(), // id -> { id, state: 'idle' | 'loading' | 'ready' | 'failed', scene, free: [], made, error }
    checks: { time: 0, people: new Map(), done: null }
  };
  let group = null;
  let ids = new Map(); // walker -> person id
  const home = new Map(); // walker -> the pose's own seed and hair, whether it is dressed as its person now, and whether it ever was (shown)
  const matchedNow = new Set(); // the walkers dressed as their person at the moment
  const index = new Map(); // walker -> its place in the list (its stable id)
  const forced = new Map(); // (debug) person id -> the walker forced to be it
  const active = new Map(); // walker -> Avatar drawn for it last frame
  const cands = [];
  let loader = null;
  let loading = 0;
  let totalFree = 0;
  const stats = { built: 0, released: 0, dodged: 0 };

  const personOf = (id) => {
    let p = hook.people.get(id);
    if (!p) hook.people.set(id, (p = { id, state: 'idle', scene: null, free: [], made: 0, error: null }));
    return p;
  };

  // Fetch a person's file the first time one of its walkers comes near, without stalling: a few at a time, nearest
  // walker first. Until it is ready, and if it fails, those walkers stay procedural.
  function load(person) {
    if (person.state !== 'idle' || loading >= MAX_LOADS) return;
    const app = window.__CITY_APP;
    if (!app?.renderer) return;
    if (!loader) {
      const A = window.CITY.Addons;
      loader = new A.GLTFLoader().setMeshoptDecoder(A.MeshoptDecoder);
      // (its textures are KTX2: the loader needs the renderer's compressed formats)
      loader.setKTX2Loader(new A.KTX2Loader().detectSupport(app.renderer));
    }
    person.state = 'loading';
    loading++;
    loader.loadAsync(url(person.id)).then((gltf) => {
      dropMorphs(gltf);
      gltf.scene.traverse((o) => { if (o.isSkinnedMesh) o.material = cutout(o.material); });
      person.scene = gltf.scene;
      person.info = describe(gltf);
      person.state = 'ready';
      hook.ready = true;
      hook.info = hook.info || person.info;
    }).catch((e) => {
      person.state = 'failed';
      person.error = e.message;
      hook.error = `${person.id}: ${e.message}`;
      console.warn(`[rocketbox] ${person.id} did not load:`, e);
    }).finally(() => { loading--; });
  }

  // traffic.js hands over its walkers and its crowd's group once both exist. Nothing is fetched until a walker is near.
  hook.attach = (g, peds) => {
    group = g;
    const list = assignIdentities(peds.map((p, i) => ({ id: i, female: !!p.rig.female })));
    ids = new Map(peds.map((p, i) => [p, list.get(i)]));
    peds.forEach((p, i) => index.set(p, i));
    for (const p of peds) {
      const o = p.rig.pose.length - 4;
      home.set(p, { seed: p.rig.pose[o], hair: p.rig.pose[o + 3], matched: false, shown: false });
    }
  };

  hook.begin = () => {
    if (!group) return null;
    cands.length = 0;
    for (const a of active.values()) a.drawn = false;
    return hook;
  };

  function acquire(person, rig) {
    let a = person.free.pop();
    if (a) totalFree--;
    else {
      a = new Avatar(person);
      person.made++;
      hook.avatars.push(a);
      group.add(a.root);
      stats.built++;
    }
    a.retarget.bind(rig);
    return a;
  }

  function release(a) {
    a.on = false;
    a.drawn = false;
    a.root.visible = false;
    a.person.free.push(a);
    totalFree++;
    stats.released++;
    // idle skeletons are kept up to the cap, then the oldest are dropped
    while (totalFree > MAX) {
      const owner = [...hook.people.values()].find((p) => p.free.length);
      const old = owner.free.shift();
      totalFree--;
      owner.made--;
      hook.avatars.splice(hook.avatars.indexOf(old), 1);
      old.dispose();
    }
  }

  // The crowd is about to draw this walker (its rig is posed for this frame), `dist` m from the camera. True: it is an
  // avatar and is drawn here. Newly near walkers are chosen in end() and become avatars from the next frame.
  hook.claim = (p, dist) => {
    let id = ids.get(p);
    if (id === undefined) return false;
    // the far body wears its person's colours inside the match band (with a margin, so the edge does not flicker)
    const h = home.get(p), o = p.rig.pose.length - 4, want = dist < (h.matched ? MATCH * 1.1 : MATCH);
    if (want !== h.matched) {
      if (want && !h.shown) {
        // the first time anybody sees this walker as its person: if a stranger within a few metres is already that
        // person, this one (the later) becomes somebody else, once, for good
        if (TWIN_RADIUS > 0) {
          const near = [];
          for (const q of matchedNow) if (Math.hypot(p.x - q.x, p.z - q.z) < TWIN_RADIUS) near.push(ids.get(q));
          const other = dodgeTwin(id, !!p.rig.female, near, hashId(index.get(p) ^ 0x5bd1e995));
          if (other !== id) { ids.set(p, other); id = other; stats.dodged++; }
        }
        h.shown = true;
      }
      h.matched = want;
      if (want) matchedNow.add(p); else matchedNow.delete(p);
      p.rig.pose[o] = want ? -(1 + ALL_IDS.indexOf(id)) : h.seed;
      p.rig.pose[o + 3] = want ? LOOK_HAIR[ALL_IDS.indexOf(id)] : h.hair;
    }
    if (dist >= FAR) return false;
    cands.push({ key: p, id, dist, active: active.has(p), ok: personOf(id).state === 'ready' });
    const a = active.get(p);
    if (!a) return false;
    a.retarget.apply();
    a.drawn = true;
    return true;
  };

  // Two walkers who stop to talk should not be the same person (traffic.js meet())
  hook.twins = (p, q) => ids.get(p) !== undefined && ids.get(p) === ids.get(q);

  // (debug) give the nearest walkers of the right sex the forced people
  function force() {
    for (const id of FORCE) {
      const female = CIVILIANS.female.includes(id);
      let w = forced.get(id);
      if (w && cands.some((c) => c.key === w && c.dist < NEAR * 0.9)) continue;
      const near = cands.find((c) => c.dist < NEAR * 0.8 && !!c.key.rig.female === female && ![...forced.values()].includes(c.key));
      if (!near) continue;
      if (w) { ids.set(w, home.get(w).person); home.get(w).matched = false; matchedNow.delete(w); }
      w = near.key;
      forced.set(id, w);
      home.get(w).person = ids.get(w);
      ids.set(w, id);
      home.get(w).matched = false;
      matchedNow.delete(w);
      if (active.has(w)) { release(active.get(w)); active.delete(w); }
    }
  }

  hook.end = (dt) => {
    cands.sort((a, b) => a.dist - b.dist);
    if (FORCE.length) force();
    // start the files of the nearest people first
    for (const c of cands) if (c.dist < NEAR && !c.ok) load(personOf(c.id));
    const chosen = selectNear(cands, NEAR, FAR, MAX);
    // walkers no longer chosen (or not claimed this frame) give their skeleton back
    for (const [p, a] of active) {
      if (chosen.has(p) && a.drawn) continue;
      active.delete(p);
      release(a);
    }
    let builds = 0;
    for (const c of cands) {
      if (!chosen.has(c.key) || active.has(c.key)) continue;
      const person = personOf(c.id);
      if (!person.free.length && builds >= MAX_BUILDS) continue; // a few new skeletons a frame
      if (!person.free.length) builds++;
      const a = acquire(person, c.key.rig);
      a.on = true;
      a.drawn = false; // drawn from the next frame
      active.set(c.key, a);
    }
    for (const a of active.values()) a.root.visible = a.drawn;
    if (CHECKS) sample(dt);
  };

  // --- ?rocketboxChecks=1: the avatars' joints against the rig's own, over six seconds with avatars drawn, per person ---------------------
  function sample(dt) {
    const c = hook.checks;
    if (c.done) return;
    let any = false;
    for (const a of active.values()) {
      if (!a.drawn) continue;
      any = true;
      const r = a.retarget, rig = a.rig, id = a.person.id;
      let w = c.people.get(id);
      if (!w) c.people.set(id, (w = { id, female: !!rig.female, ankle: 0, knee: 0, hips: 0, facing: 0, elbow: 0, samples: 0 }));
      for (const [name, our] of [['L Foot', BONE.FOOT_L], ['R Foot', BONE.FOOT_R]]) {
        w.ankle = Math.max(w.ankle, r.worldPos(name, _v).distanceTo(rig.jointAt(our, _v2)));
      }
      for (const [name, our] of [['L Calf', BONE.SHIN_L], ['R Calf', BONE.SHIN_R]]) {
        w.knee = Math.max(w.knee, r.worldPos(name, _v).distanceTo(rig.jointAt(our, _v2)));
      }
      for (const [name, our] of [['L Forearm', BONE.FOREARM_L], ['R Forearm', BONE.FOREARM_R]]) {
        w.elbow = Math.max(w.elbow, r.worldPos(name, _v).distanceTo(rig.jointAt(our, _v2)));
      }
      r.worldPos('L Thigh', _v).add(r.worldPos('R Thigh', _v2)).multiplyScalar(0.5);
      const mid = rig.jointAt(BONE.THIGH_L, new THREE.Vector3()).add(rig.jointAt(BONE.THIGH_R, _v2)).multiplyScalar(0.5);
      w.hips = Math.max(w.hips, _v.distanceTo(mid));
      const f = r.worldPos('L Toe0', _v).sub(r.worldPos('L Foot', _v2));
      const g = rig.jointAt(BONE.TOE_L, new THREE.Vector3()).sub(rig.jointAt(BONE.FOOT_L, _v2));
      const dh = Math.atan2(f.x, f.z) - Math.atan2(g.x, g.z);
      w.facing = Math.max(w.facing, Math.abs(Math.atan2(Math.sin(dh), Math.cos(dh))) * 180 / Math.PI);
      w.samples++;
    }
    if (any) c.time += dt; // (seconds with an avatar on screen)
    // (six seconds with avatars drawn, and until a man and a woman have both been sampled, at most 40 s)
    const genders = new Set([...c.people.values()].filter((w) => w.samples >= 60).map((w) => w.female));
    if (c.time < 6 || (genders.size < 2 && c.time < 40)) return;
    c.done = [...c.people.values()].map((w) => ({
      id: w.id,
      female: w.female,
      samples: w.samples,
      ankleGapMaxM: +w.ankle.toFixed(3),
      kneeGapMaxM: +w.knee.toFixed(3),
      elbowGapMaxM: +w.elbow.toFixed(3),
      hipGapMaxM: +w.hips.toFixed(3),
      footHeadingErrMaxDeg: +w.facing.toFixed(1)
    }));
    console.log('[rocketbox] self-checks (6 s)', JSON.stringify(c.done));
  }

  // (captures) is this walker drawn as an avatar right now
  hook.isAvatar = (p) => !!active.get(p)?.drawn;
  hook.idOf = (p) => (active.get(p)?.drawn ? active.get(p).person.id : null);

  hook.report = () => {
    const drawnIds = {};
    for (const a of active.values()) if (a.drawn) drawnIds[a.person.id] = (drawnIds[a.person.id] || 0) + 1;
    const files = {};
    for (const p of hook.people.values()) files[p.id] = p.state;
    return {
      ready: hook.ready,
      error: hook.error,
      info: hook.info,
      near: NEAR, off: FAR, max: MAX,
      drawn: [...active.values()].filter((a) => a.drawn).length,
      drawnByPerson: drawnIds,
      filesLoaded: [...hook.people.values()].filter((p) => p.state === 'ready').length,
      filesFailed: [...hook.people.values()].filter((p) => p.state === 'failed').length,
      files,
      skeletons: hook.avatars.length,
      candidatesLast: cands.length,
      built: stats.built, released: stats.released, twinsDodged: stats.dodged,
      checks: hook.checks.done
    };
  };

  window.CITY.rocketbox = hook;
}
})();
