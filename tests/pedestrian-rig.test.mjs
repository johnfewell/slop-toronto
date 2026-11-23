// PersonRig's gait (js/pedestrians.js), ported with mrdoob/slop-newyork's 536a907: its tests/pedestrians.test.cjs rig
// cases, adapted to the classic-script loader and the real three.js maths, plus Toronto's own checks: the ragdoll's
// jointAt / blendFrom, getting up into the new gait, and the hidden-pedestrian pose skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.core.js';

const { Vector3, Quaternion } = THREE;
const source = fs.readFileSync(new URL('../js/pedestrians.js', import.meta.url), 'utf8');
const window = { CITY: { THREE, TSL: {}, Addons: {} } };
vm.runInNewContext(source, { window, Math });
const { PersonRig, PERSON_BONES } = window.CITY;
const flat = () => 0;
const BONES = Object.values(PERSON_BONES);

function boneWorldPos(rig, bone, localPos = rig.bind[bone]) {
  const o = bone * 8;
  const q = new Quaternion(rig.pose[o], rig.pose[o + 1], rig.pose[o + 2], rig.pose[o + 3]);
  const s = rig.pose[o + 7];
  const p = localPos.clone().applyQuaternion(q).multiplyScalar(s);
  p.x += rig.pose[o + 4];
  p.y += rig.pose[o + 5];
  p.z += rig.pose[o + 6];
  return p;
}

function legKneeBendDeg(rig, legIndex) {
  const thigh = legIndex === 0 ? PERSON_BONES.THIGH_L : PERSON_BONES.THIGH_R;
  const shin = legIndex === 0 ? PERSON_BONES.SHIN_L : PERSON_BONES.SHIN_R;
  const foot = legIndex === 0 ? PERSON_BONES.FOOT_L : PERSON_BONES.FOOT_R;
  const hip = boneWorldPos(rig, thigh);
  const knee = boneWorldPos(rig, shin);
  const ankle = boneWorldPos(rig, foot);
  const u1 = hip.sub(knee).normalize();
  const u2 = ankle.sub(knee).normalize();
  return 180 - Math.acos(Math.max(-1, Math.min(1, u1.dot(u2)))) * 180 / Math.PI;
}

test('PersonRig walk and full-speed run keep smooth kneecushion, bounded swing stride, and springy flight', () => {
  const dt = 1 / 60;
  for (const speed of [1.45, 3.5, 8.2]) {
    const rig = new PersonRig({ seed: 4.2, scale: 1.0, girth: 1.02, hair: 0.18, armSwing: 1.0 });
    let z = 0;
    rig.reset(0, 0, 0, () => 0);
    let minPelvisY = Infinity, maxPelvisY = -Infinity;
    let minKneeDeg = 180, maxKneeDeg = 0;
    let minRelZ = Infinity, maxRelZ = -Infinity;
    let minSoleY = Infinity;

    for (let f = 0; f < 180; f++) {
      z += speed * dt;
      rig.update(dt, 0, z, 0, () => 0);
      if (f < 60) continue;
      minPelvisY = Math.min(minPelvisY, rig.pelvisY);
      maxPelvisY = Math.max(maxPelvisY, rig.pelvisY);
      for (let i = 0; i < 2; i++) {
        const foot = rig.feet[i];
        const bend = legKneeBendDeg(rig, i);
        minKneeDeg = Math.min(minKneeDeg, bend);
        maxKneeDeg = Math.max(maxKneeDeg, bend);
        minRelZ = Math.min(minRelZ, foot.az - z);
        maxRelZ = Math.max(maxRelZ, foot.az - z);
        const heel = boneWorldPos(rig, i === 0 ? PERSON_BONES.FOOT_L : PERSON_BONES.FOOT_R, new Vector3(foot.side * 0.09, 0, -0.078));
        const toe = boneWorldPos(rig, i === 0 ? PERSON_BONES.TOE_L : PERSON_BONES.TOE_R, new Vector3(foot.side * 0.09, 0.005, 0.208));
        minSoleY = Math.min(minSoleY, heel.y, toe.y);
      }
    }
    assert.ok(minKneeDeg > 6.5, `speed ${speed}: soft IK extension avoids locked-knee snap (got ${minKneeDeg.toFixed(1)}°)`);
    const maxVerticalAmp = speed >= 8 ? 0.032 : 0.055;
    assert.ok(minPelvisY > 0.85 && maxPelvisY - minPelvisY < maxVerticalAmp,
      `speed ${speed}: pelvis vertical arc stays smooth and shake-free [${minPelvisY.toFixed(3)}, ${maxPelvisY.toFixed(3)}]`);
    assert.ok(minRelZ > -0.58 && maxRelZ < 0.48, `speed ${speed}: body-carried swing prevents world-space overshoot [${minRelZ.toFixed(2)}, ${maxRelZ.toFixed(2)}]`);
    assert.ok(minSoleY > -0.005, `speed ${speed}: shoe soles stay above pavement (${(minSoleY * 100).toFixed(2)} cm)`);
  }
});

test('PersonRig backward locomotion rolls forefoot-to-heel and keeps torso upright instead of leaning forward', () => {
  const rig = new PersonRig({ seed: 4.2, scale: 1.0 });
  const dt = 1 / 60;
  let z = 0;
  rig.reset(0, 0, 0, () => 0);
  let maxFrontStancePitch = -Infinity;
  let maxTouchdownPitch = -Infinity;

  for (let f = 0; f < 180; f++) {
    z -= 2.8 * dt;
    rig.update(dt, 0, z, 0, () => 0);
    if (f < 60) continue;
    for (const foot of rig.feet) {
      const relZ = foot.az - z;
      if (!foot.swing && relZ > 0.2) maxFrontStancePitch = Math.max(maxFrontStancePitch, foot.pitch);
      if (!foot.swing && relZ < -0.05) maxTouchdownPitch = Math.max(maxTouchdownPitch, foot.pitch);
    }
  }
  assert.ok(rig.back > 0.95, 'backward gait blend engages');
  assert.ok(rig.pelvisTilt < 0.05, `pelvis stays upright when backing up (${rig.pelvisTilt.toFixed(3)} rad)`);
  assert.ok(maxTouchdownPitch > 0.05, 'backward touchdown lands forefoot-first behind the hip');
  assert.ok(maxFrontStancePitch <= 0.02, `planted foot ahead of backward-moving hip never pitches onto tiptoe (${maxFrontStancePitch.toFixed(3)} rad)`);
});

test('PersonRig continuous Walk-mode turns activate head lead, banking, and turn-in-place stepping', () => {
  const rig = new PersonRig({ seed: 4.2, scale: 1.0 });
  const dt = 1 / 60;
  let heading = 0;
  rig.reset(0, 0, 0, () => 0);
  const startPhase = rig.phase;
  let totalPhase = 0, prevPhase = startPhase;

  // Continuous 2.6 rad/s turn in place (matches Walk mode A/D turnRate)
  for (let f = 0; f < 60; f++) {
    heading += 2.6 * dt;
    rig.update(dt, 0, 0, heading, () => 0);
    let dp = rig.phase - prevPhase;
    if (dp < 0) dp += 1;
    totalPhase += dp;
    prevPhase = rig.phase;
  }
  assert.ok(rig.yawRate > 2.2, `smoothed yawRate tracks continuous turn (${rig.yawRate.toFixed(2)} rad/s)`);
  assert.ok(rig.headTurn > 0.25, `head leads into continuous turn (${rig.headTurn.toFixed(2)} rad)`);
  assert.ok(totalPhase > 0.8, `feet step to turn in place (${totalPhase.toFixed(2)} cycles)`);

  // Running turn banks into the curve
  let x = 0, z = 0;
  for (let f = 0; f < 90; f++) {
    heading += 2.6 * dt;
    x += Math.sin(heading) * 6.0 * dt;
    z += Math.cos(heading) * 6.0 * dt;
    rig.update(dt, x, z, heading, () => 0);
  }
  assert.ok(rig.bank < -0.06, `body banks inward during running left turn (${rig.bank.toFixed(3)} rad)`);
});

test('PersonRig jump prepares with countermovement, evolves continuously across the arc without sprint foot lag, and absorbs landings', () => {
  const dt = 1 / 60;

  // 1. Standing jump: countermovement crouch + arm backswing -> launch punch -> heel-back tuck -> downward landing reach -> deep squat
  const standRig = new PersonRig({ seed: 4.2, scale: 1.0 });
  standRig.reset(0, 0, 0, () => 0);
  const standPelvis0 = standRig.pelvisY;
  const handOffset = new Vector3(0.24, 0.92, 0);
  let minPrepPelvisY = Infinity;
  let minPrepHandRelZ = Infinity;
  for (let p = 1; p <= 5; p++) {
    standRig.update(dt, 0, 0, 0, () => 0, null, -p / 5);
    minPrepPelvisY = Math.min(minPrepPelvisY, standRig.pelvisY);
    const shL = boneWorldPos(standRig, PERSON_BONES.UPPER_ARM_L);
    const handL = boneWorldPos(standRig, PERSON_BONES.FOREARM_L, handOffset);
    minPrepHandRelZ = Math.min(minPrepHandRelZ, handL.z - shL.z);
  }
  assert.ok(standPelvis0 - minPrepPelvisY > 0.05, `standing jump prep crouches pelvis (${((standPelvis0 - minPrepPelvisY) * 100).toFixed(1)} cm)`);
  assert.ok(minPrepHandRelZ < -0.05, `standing jump prep swings arms back before launch (${minPrepHandRelZ.toFixed(2)} m)`);

  let sy = 0, svy = 5.2;
  let apexAnkleClearance = 0;
  let preLandAnkleClearance = Infinity;
  let maxStandLandDrop = 0;
  let minStandSoleY = Infinity;
  for (let f = 0; f < 65; f++) {
    if (svy !== 0 || sy > 0) {
      svy -= 14.5 * dt;
      sy += svy * dt;
      if (sy <= 0) { sy = 0; svy = 0; }
    }
    standRig.update(dt, 0, 0, 0, () => 0, null, sy > 0 ? Math.max(0.006, sy) : 0);
    if (Math.abs(svy) < 0.35 && sy > 0.8) {
      apexAnkleClearance = Math.max(apexAnkleClearance, standRig.feet[0].ay - sy);
    }
    if (svy < -4.2 && sy > 0.05 && sy < 0.25) {
      preLandAnkleClearance = Math.min(preLandAnkleClearance, standRig.feet[0].ay - sy);
    }
    if (f > 15 && sy === 0) {
      maxStandLandDrop = Math.max(maxStandLandDrop, standRig.landDrop);
    }
    for (let i = 0; i < 2; i++) {
      const foot = standRig.feet[i];
      const heel = boneWorldPos(standRig, i === 0 ? PERSON_BONES.FOOT_L : PERSON_BONES.FOOT_R, new Vector3(foot.side * 0.09, 0, -0.078));
      const toe = boneWorldPos(standRig, i === 0 ? PERSON_BONES.TOE_L : PERSON_BONES.TOE_R, new Vector3(foot.side * 0.09, 0.005, 0.208));
      minStandSoleY = Math.min(minStandSoleY, heel.y, toe.y);
    }
  }
  assert.ok(apexAnkleClearance - preLandAnkleClearance > 0.1,
    `standing jump extends legs downward before touchdown instead of freezing at apex (${apexAnkleClearance.toFixed(3)} -> ${preLandAnkleClearance.toFixed(3)} m)`);
  assert.ok(maxStandLandDrop > 0.07, `standing landing compresses into weighty absorption squat (${(maxStandLandDrop * 100).toFixed(1)} cm)`);
  assert.ok(minStandSoleY > -0.005, `standing jump & landing never clip shoe soles below pavement (${(minStandSoleY * 100).toFixed(2)} cm)`);

  // 2. Full-speed sprint jump (8.2 m/s): body-relative split-leap with zero world-space backward foot drag
  const rig = new PersonRig({ seed: 4.2, scale: 1.0 });
  let z = 0, y = 0, vy = 0;
  rig.reset(0, 0, 0, () => 0);
  for (let f = 0; f < 90; f++) {
    z += 8.2 * dt;
    rig.update(dt, 0, z, 0, () => 0, null, 0);
  }

  vy = 5.2;
  let apexKneeBend = 0;
  let maxLeadFootRelZ = -Infinity;
  let minTrailFootRelZ = Infinity;
  let landed = false;
  let maxLandDrop = 0;
  for (let f = 0; f < 60; f++) {
    z += 8.2 * dt;
    if (vy !== 0 || y > 0) {
      vy -= 14.5 * dt;
      y = Math.max(0, y + vy * dt);
      if (y === 0) vy = 0;
    }
    rig.update(dt, 0, z, 0, () => 0, null, y > 0 ? Math.max(0.006, y) : 0);
    if (y > 0.4) {
      const r0 = rig.feet[0].az - z;
      const r1 = rig.feet[1].az - z;
      maxLeadFootRelZ = Math.max(maxLeadFootRelZ, Math.max(r0, r1));
      minTrailFootRelZ = Math.min(minTrailFootRelZ, Math.min(r0, r1));
    }
    if (y > 0.8) apexKneeBend = Math.max(apexKneeBend, legKneeBendDeg(rig, 0), legKneeBendDeg(rig, 1));
    if (f > 10 && y === 0) {
      landed = true;
      maxLandDrop = Math.max(maxLandDrop, rig.landDrop);
    }
  }
  assert.ok(apexKneeBend > 45, `sprint jump apex folds knees into split-leap (${apexKneeBend.toFixed(1)}°)`);
  assert.ok(maxLeadFootRelZ > 0.18, `sprint jump keeps lead foot ahead of hip instead of lagging behind (${maxLeadFootRelZ.toFixed(2)} m)`);
  assert.ok(minTrailFootRelZ > -0.52, `sprint jump trail foot sweeps cleanly without world-space drag (${minTrailFootRelZ.toFixed(2)} m)`);
  assert.ok(landed && maxLandDrop > 0.025, `sprint landing cushions smoothly into next stride (${(maxLandDrop * 100).toFixed(2)} cm)`);

  // 3. High heel-kick above knee height must keep shin lateral axis aligned with thigh (no 180° flip)
  rig.reset(0, 0, 0, () => 0);
  const hip = new Vector3(0.09, 0.92, 0);
  const highHeel = new Vector3(0.09, 0.62, -0.32); // forces knee forward/down and ankle higher than knee
  rig.solveLeg(0, hip, highHeel, 0);
  const oThigh = PERSON_BONES.THIGH_L * 8;
  const oShin = PERSON_BONES.SHIN_L * 8;
  const qThigh = new Quaternion(rig.pose[oThigh], rig.pose[oThigh + 1], rig.pose[oThigh + 2], rig.pose[oThigh + 3]);
  const qShin = new Quaternion(rig.pose[oShin], rig.pose[oShin + 1], rig.pose[oShin + 2], rig.pose[oShin + 3]);
  const xThigh = new Vector3(1, 0, 0).applyQuaternion(qThigh);
  const xShin = new Vector3(1, 0, 0).applyQuaternion(qShin);
  assert.ok(xThigh.dot(xShin) > 0.98, `shin shares thigh hinge axis without twisting (dot=${xThigh.dot(xShin).toFixed(4)})`);
});

test('PersonRig full-speed sprint stays vertically smooth even under uneven browser frame times', () => {
  const rig = new PersonRig({ seed: 4.2, scale: 1.0, girth: 1.02, hair: 0.18, armSwing: 1.0 });
  const dtSeq = [0.0142, 0.0189, 0.0155, 0.0208, 0.0138, 0.0174, 0.0166];
  let z = 0;
  rig.reset(0, 0, 0, () => 0);
  let minPelvisY = Infinity, maxPelvisY = -Infinity;
  let maxFrameStep = 0;
  let prevPelvisY = rig.pelvisY;

  for (let f = 0; f < 220; f++) {
    const dt = dtSeq[f % dtSeq.length];
    z += 8.2 * dt;
    rig.update(dt, 0, z, 0, () => 0);
    if (f >= 90) {
      minPelvisY = Math.min(minPelvisY, rig.pelvisY);
      maxPelvisY = Math.max(maxPelvisY, rig.pelvisY);
      maxFrameStep = Math.max(maxFrameStep, Math.abs(rig.pelvisY - prevPelvisY));
    }
    prevPelvisY = rig.pelvisY;
  }
  assert.ok(maxPelvisY - minPelvisY < 0.03, `uneven dt sprint keeps subtle vertical bob (${((maxPelvisY - minPelvisY) * 100).toFixed(2)} cm)`);
  assert.ok(maxFrameStep < 0.006, `uneven dt sprint avoids frame-to-frame pelvis jumps (${(maxFrameStep * 100).toFixed(2)} cm/frame)`);
});

test('PersonRig running uses spring-mass vertical phase, shin-aligned swing feet, and zero-lag contralateral arm pump', () => {
  const dt = 1 / 60;

  // 1. Walking vs running vertical phase: walking peaks near single-leg passing; running peaks in aerial flight above mid-stance
  const walkRig = new PersonRig({ seed: 1, scale: 1.0 });
  walkRig.reset(0, 0, 0, () => 0);
  let wz = 0;
  let walkContactY = 0, walkContactN = 0, walkPassY = 0, walkPassN = 0;
  for (let f = 0; f < 240; f++) {
    wz += 1.5 * dt;
    walkRig.update(dt, 0, wz, 0, () => 0);
    if (f < 90) continue;
    const p = walkRig.phase % 0.5;
    if (p > 0.08 && p < 0.16) { walkContactY += walkRig.pelvisY; walkContactN++; }
    if (p > 0.28 && p < 0.38) { walkPassY += walkRig.pelvisY; walkPassN++; }
  }
  assert.ok(walkPassY / walkPassN > walkContactY / walkContactN + 0.012,
    'walk vaults higher at single-leg passing than weight-acceptance');

  const runRig = new PersonRig({ seed: 1, scale: 1.0 });
  runRig.reset(0, 0, 0, () => 0);
  let rz = 0;
  let midStanceY = 0, midStanceN = 0, midFlightY = 0, midFlightN = 0;
  let maxDorsiflexRad = -Infinity;
  let maxRightHandRelZAtLeftPushOff = -Infinity;
  let minLeftHandRelZAtLeftPushOff = Infinity;

  for (let f = 0; f < 240; f++) {
    rz += 6.5 * dt;
    runRig.update(dt, 0, rz, 0, () => 0);
    if (f < 90) continue;

    const bothSwing = runRig.feet[0].swing && runRig.feet[1].swing;
    const p = runRig.phase % 0.5;
    if (!bothSwing && p > 0.08 && p < 0.16) { midStanceY += runRig.pelvisY; midStanceN++; }
    if (bothSwing && p > 0.33 && p < 0.43) { midFlightY += runRig.pelvisY; midFlightN++; }

    // 2. Swing foot follows shin angle without "magnetic hoverboot" hyper-dorsiflexion during high heel recovery
    for (let i = 0; i < 2; i++) {
      if (!runRig.feet[i].swing) continue;
      const shinBone = i === 0 ? PERSON_BONES.SHIN_L : PERSON_BONES.SHIN_R;
      const footBone = i === 0 ? PERSON_BONES.FOOT_L : PERSON_BONES.FOOT_R;
      const knee = boneWorldPos(runRig, shinBone);
      const ankle = boneWorldPos(runRig, footBone);
      const shinPitch = Math.atan2(knee.z - ankle.z, knee.y - ankle.y);
      const oFoot = footBone * 8;
      const qFoot = new Quaternion(runRig.pose[oFoot], runRig.pose[oFoot + 1], runRig.pose[oFoot + 2], runRig.pose[oFoot + 3]);
      const footFwd = new Vector3(0, 0, 1).applyQuaternion(qFoot);
      const footPitch = Math.atan2(-footFwd.y, footFwd.z);
      maxDorsiflexRad = Math.max(maxDorsiflexRad, shinPitch - footPitch);
    }

    // 3. At left push-off / right high-knee drive (phase ~0.24..0.30), left hand drives forward while right elbow/hand drives back
    if (runRig.phase > 0.24 && runRig.phase < 0.30) {
      const shL = boneWorldPos(runRig, PERSON_BONES.UPPER_ARM_L);
      const shR = boneWorldPos(runRig, PERSON_BONES.UPPER_ARM_R);
      const handL = boneWorldPos(runRig, PERSON_BONES.FOREARM_L, new Vector3(0.24, 0.92, 0));
      const handR = boneWorldPos(runRig, PERSON_BONES.FOREARM_R, new Vector3(-0.24, 0.92, 0));
      // Left leg is trailing behind hip & right knee is driving forward -> left arm pumps forward (+Z), right arm pumps back (-Z)
      minLeftHandRelZAtLeftPushOff = Math.min(minLeftHandRelZAtLeftPushOff, handL.z - shL.z);
      maxRightHandRelZAtLeftPushOff = Math.max(maxRightHandRelZAtLeftPushOff, handR.z - shR.z);
    }
  }

  assert.ok(midFlightY / midFlightN > midStanceY / midStanceN + 0.01,
    `running spring-mass lifts pelvis higher in aerial flight (${(midFlightY / midFlightN).toFixed(3)}) than mid-stance (${(midStanceY / midStanceN).toFixed(3)})`);
  assert.ok(maxDorsiflexRad < 0.5,
    `swing foot stays aligned with shin without horizontal hoverboot hyper-dorsiflexion (${(maxDorsiflexRad * 180 / Math.PI).toFixed(1)}°)`);
  assert.ok(minLeftHandRelZAtLeftPushOff > 0.12 && maxRightHandRelZAtLeftPushOff < 0.05,
    `contralateral arms oppose thigh scissor at push-off (L=${minLeftHandRelZAtLeftPushOff.toFixed(2)}m, R=${maxRightHandRelZAtLeftPushOff.toFixed(2)}m)`);
});

// ---------------------------------------------------------------------------------------------------------------
// Toronto's own checks
// ---------------------------------------------------------------------------------------------------------------
const DT = 1 / 60;
const joints = (rig) => BONES.map((b) => rig.jointAt(b, new Vector3()));
const maxJointStep = (a, b) => a.reduce((m, p, i) => Math.max(m, p.distanceTo(b[i])), 0);
const walked = (rig, seconds, speed = 1.4, x0 = 0, z0 = 0, heading = 0) => {
  let x = x0, z = z0;
  for (let f = 0; f < Math.round(seconds / DT); f++) {
    x += Math.sin(heading) * speed * DT;
    z += Math.cos(heading) * speed * DT;
    rig.update(DT, x, z, heading, flat);
  }
  return { x, z };
};
const quatClose = (pose, other, o, eps) => {
  const d = pose[o] * other[o] + pose[o + 1] * other[o + 1] + pose[o + 2] * other[o + 2] + pose[o + 3] * other[o + 3];
  return Math.abs(Math.abs(d) - 1) < eps;
};

test('jointAt gives finite positions for every bone, on a fresh rig and a standing one', () => {
  const rig = new PersonRig({ seed: 2.5, female: true });
  for (const p of joints(rig)) assert.ok(Number.isFinite(p.x + p.y + p.z), 'fresh rig');
  rig.reset(4, -2, 1.2, flat);
  assert.equal(joints(rig).length, 15);
  for (const p of joints(rig)) assert.ok(Number.isFinite(p.x + p.y + p.z), 'standing rig');
  // the pelvis joint is where the pelvis bone says it is: about PELVIS_Y above the ground, over the body
  const pelvis = rig.jointAt(PERSON_BONES.PELVIS, new Vector3());
  assert.ok(Math.abs(pelvis.y - rig.pelvisY) < 1e-4, `pelvis joint at pelvisY (${pelvis.y} vs ${rig.pelvisY})`);
});

test('blendFrom(saved, 1) reproduces the saved pose and blendFrom(saved, 0) leaves the live pose', () => {
  for (const female of [false, true]) {
    const donor = new PersonRig({ seed: 7.1, female, scale: 1.05 });
    donor.reset(0, 0, 0.4, flat);
    walked(donor, 1, 1.6, 0, 0, 0.4);
    const saved = Float32Array.from(donor.pose);

    const rig = new PersonRig({ seed: 7.1, female, scale: 1.05 });
    rig.reset(0, 0, 0, flat);
    walked(rig, 0.5, 1.0, 0, 0, 0);
    const live = Float32Array.from(rig.pose);

    rig.blendFrom(saved, 0);
    for (let b = 0; b < 15; b++) {
      const o = b * 8;
      assert.ok(quatClose(rig.pose, live, o, 1e-6), `w=0 keeps bone ${b} rotation`);
      for (let k = 4; k < 8; k++) assert.ok(Math.abs(rig.pose[o + k] - live[o + k]) < 1e-5, `w=0 keeps bone ${b} slot ${k}`);
    }
    assert.deepEqual(Array.from(rig.pose.subarray(15 * 8)), Array.from(live.subarray(15 * 8)), 'appearance info untouched');

    rig.blendFrom(saved, 1);
    for (let b = 0; b < 15; b++) {
      const o = b * 8;
      assert.ok(quatClose(rig.pose, saved, o, 1e-6), `w=1 matches bone ${b} rotation`);
      for (let k = 4; k < 8; k++) assert.ok(Math.abs(rig.pose[o + k] - saved[o + k]) < 1e-5, `w=1 matches bone ${b} slot ${k} (${rig.pose[o + k]} vs ${saved[o + k]})`);
    }
  }
});

for (const [name, perFrame] of [
  ['updating the rig standing still', (rig, x, z, yaw) => rig.update(DT, x, z, yaw, flat)],
  ['resetting the rig each frame, as js/traffic.js does while a knocked-down person gets up', (rig, x, z, yaw) => rig.reset(x, z, yaw, flat)]
]) {
  test(`getting up: the blend from a ragdoll's last pose into the rig is finite and continuous (${name})`, () => {
    const rig = new PersonRig({ seed: 3.3 });
    rig.reset(0, 0, 0, flat);
    walked(rig, 2, 1.4);
    const saved = Float32Array.from(rig.pose); // what the ragdoll left (any pose will do)
    const yaw = 2.1;
    rig.reset(3 * Math.sin(1), 3 * Math.cos(1), yaw, flat); // 3 m away, another heading
    let prev = null;
    let worst = 0;
    const frames = Math.round(0.6 / DT);
    for (let f = 0; f <= frames; f++) {
      const t = f / frames;
      perFrame(rig, 3 * Math.sin(1), 3 * Math.cos(1), yaw);
      rig.blendFrom(saved, 1 - t * t * (3 - 2 * t));
      assert.ok(rig.pose.every(Number.isFinite), `finite pose at frame ${f}`);
      const now = joints(rig);
      for (const p of now) assert.ok(Number.isFinite(p.x + p.y + p.z));
      if (prev) worst = Math.max(worst, maxJointStep(prev, now));
      prev = now;
    }
    assert.ok(worst < 0.6, `no joint moves ${worst.toFixed(3)} m in one 1/60 s frame`);
    // and when the blend is over, the rig is standing under its own body, feet under it, at its heading
    for (const foot of rig.feet) assert.ok(Math.hypot(foot.px - rig.x, foot.pz - rig.z) < 0.3, 'feet under the body');
    assert.ok(Math.abs(rig.pelvisY - rig.standingHeight(0)) < 0.05, 'standing height');
  });
}

test('with updatePose false the pose buffer does not change, but the gait and planted feet go on', () => {
  const rig = new PersonRig({ seed: 5.5 });
  rig.reset(0, 0, 0, flat);
  let z = 0;
  for (let f = 0; f < 90; f++) { z += 1.4 * DT; rig.update(DT, 0, z, 0, flat); }
  const pose = Float32Array.from(rig.pose);
  const phase = rig.phase;
  const foot = rig.feet[0].px + rig.feet[0].pz + rig.feet[1].px + rig.feet[1].pz;
  for (let f = 0; f < 120; f++) { z += 1.4 * DT; rig.update(DT, 0, z, 0, flat, null, 0, false); }
  assert.deepEqual(Array.from(rig.pose), Array.from(pose), 'walking, hidden');
  assert.notEqual(rig.phase, phase, 'the gait advanced');
  assert.notEqual(rig.feet[0].px + rig.feet[0].pz + rig.feet[1].px + rig.feet[1].pz, foot, 'the feet were re-planted');
  // an evasive dive that nobody sees poses nothing either
  for (let f = 0; f < 60; f++) rig.update(DT, 0, z, 0, flat, null, 0, false, f * DT);
  assert.deepEqual(Array.from(rig.pose), Array.from(pose), 'diving, hidden');
  rig.update(DT, 0, z, 0, flat, null, 0, true, 1.0);
  assert.notDeepEqual(Array.from(rig.pose), Array.from(pose), 'the dive poses once drawn');
});

test('walking, a 90 degree turn and running: finite, pelvis near standing height, feet within reach of the hips', () => {
  const rig = new PersonRig({ seed: 1.9, scale: 1.0 });
  rig.reset(0, 0, 0, flat);
  const standing = rig.standingHeight(0);
  const reach = rig.legLength;
  let x = 0, z = 0, heading = 0, speed = 1.4;
  let minPelvis = Infinity, maxPelvis = -Infinity, longest = 0;
  const hip = new Vector3(), ankle = new Vector3();
  for (let f = 0; f < 600; f++) {
    if (f >= 200 && f < 260) heading += (Math.PI / 2) / 60; // the turn takes a second
    if (f >= 300) speed = 4;
    x += Math.sin(heading) * speed * DT;
    z += Math.cos(heading) * speed * DT;
    rig.update(DT, x, z, heading, flat);
    assert.ok(rig.pose.every(Number.isFinite), `finite pose at frame ${f}`);
    minPelvis = Math.min(minPelvis, rig.pelvisY);
    maxPelvis = Math.max(maxPelvis, rig.pelvisY);
    for (const [t, a] of [[PERSON_BONES.THIGH_L, PERSON_BONES.FOOT_L], [PERSON_BONES.THIGH_R, PERSON_BONES.FOOT_R]]) {
      longest = Math.max(longest, rig.jointAt(t, hip).distanceTo(rig.jointAt(a, ankle)));
    }
  }
  assert.ok(minPelvis > standing - 0.25 && maxPelvis < standing + 0.25, `pelvis ${minPelvis.toFixed(3)}..${maxPelvis.toFixed(3)} around standing ${standing.toFixed(3)}`);
  assert.ok(longest <= reach + 1e-3, `a foot is ${longest.toFixed(4)} m from its hip, leg is ${reach.toFixed(4)} m`);
  assert.ok(rig.run > 0.9, 'ends up running');
});

test("a walker's phase wraps as each foot lands, which is what js/audio-sources.js and js/audio-system.js listen for", () => {
  const rig = new PersonRig({ seed: 0.7 });
  rig.reset(0, 0, 0, flat);
  let z = 0, prev = rig.phase, steps = 0;
  for (let f = 0; f < 300; f++) {
    z += 1.4 * DT;
    rig.update(DT, 0, z, 0, flat);
    if (f < 60) { prev = rig.phase; continue; }
    for (let i = 0; i < 2; i++) {
      if ((rig.phase + i * 0.5) % 1 < (prev + i * 0.5) % 1) {
        steps++;
        const foot = rig.feet[i];
        assert.ok(!foot.swing, `foot ${i} is down when its phase wraps`);
        assert.ok(Math.hypot(foot.ax - foot.px, foot.az - foot.pz) < 0.35, `foot ${i}'s planted point is under its ankle`);
      }
    }
    prev = rig.phase;
  }
  assert.ok(steps >= 6 && steps <= 9, `a step every ~0.5 s at 1.4 m/s (${steps} in 4 s)`);
});

test("the on-foot player's jump call (air > 0.02 ? air : 0, never negative) gives a finite jump that leaves and meets the ground", () => {
  const rig = new PersonRig({ seed: 4.2 });
  rig.reset(0, 0, 0, flat);
  walked(rig, 1, 1.4);
  let y = 0, vy = 5.2, z = 1.4, apexPelvis = -Infinity, base = rig.pelvisY, landed = false, minPelvis = Infinity;
  for (let f = 0; f < 120; f++) {
    z += 1.4 * DT;
    if (vy !== 0 || y > 0) { vy -= 14.5 * DT; y = Math.max(0, y + vy * DT); if (y === 0) vy = 0; }
    rig.update(DT, 0, z, 0, flat, null, y > 0.02 ? y : 0);
    assert.ok(rig.pose.every(Number.isFinite), `finite pose at frame ${f}`);
    apexPelvis = Math.max(apexPelvis, rig.pelvisY);
    minPelvis = Math.min(minPelvis, rig.pelvisY);
    if (f > 30 && y === 0) landed = true;
  }
  assert.ok(apexPelvis > base + 0.5, `the pelvis rises with the jump (${(apexPelvis - base).toFixed(2)} m)`);
  assert.ok(landed && Math.abs(rig.pelvisY - rig.standingHeight(0)) < 0.1, 'and is back to standing height after it');
  assert.ok(minPelvis > 0.5, 'never sinks through the ground');
});

test('a rider on a bike frame, as js/controllers.js and js/multiplayer.js pose one, has a finite pose and a head to put the helmet on', () => {
  const rig = new PersonRig({ seed: 12.8, scale: 1.0, girth: 0.97, hair: 0.1 });
  const root = new THREE.Group();
  root.position.set(5, 0, -3);
  root.rotation.y = 0.8;
  const frame = { seat: new Vector3(0, 0.95, -0.2), bars: new Vector3(0, 1.05, 0.5), gripHalf: 0.22, bracket: new Vector3(0, 0.34, -0.145), crankLength: 0.17 };
  for (let f = 0; f < 120; f++) {
    rig.ride(root, f * 0.2, frame);
    assert.ok(rig.pose.every(Number.isFinite), `finite pose at frame ${f}`);
  }
  assert.ok(Number.isFinite(rig.headPosition.y) && rig.headPosition.y > 1.2 && rig.headPosition.y < 2.2, `head at ${rig.headPosition.y.toFixed(2)} m`);
  assert.ok(Math.abs(rig.headQuaternion.length() - 1) < 1e-6);
});
