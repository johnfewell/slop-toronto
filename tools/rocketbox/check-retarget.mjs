// Checks js/rocketbox-pedestrians.js's Retarget against a synthetic rig, without a renderer: builds the GLB's node
// tree as plain Object3Ds (names sanitised the way GLTFLoader does), then poses it. `node tools/rocketbox/check-retarget.mjs [file.glb]`
// (default assets/people/rocketbox/male-adult-01_lod2.glb; any of the avatars in that folder works)
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

const file = process.argv[2] ? path.resolve(process.argv[2]) : new URL('../../assets/people/rocketbox/male-adult-01_lod2.glb', import.meta.url).pathname;
console.log(`avatar ${path.basename(file)}`);
const glb = fs.readFileSync(file);
const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
const nodes = gltf.nodes.map((n) => {
  const o = new THREE.Object3D();
  o.name = (n.name || '').replace(/\s/g, '_');
  if (n.translation) o.position.fromArray(n.translation);
  if (n.rotation) o.quaternion.fromArray(n.rotation);
  if (n.scale) o.scale.fromArray(n.scale);
  return o;
});
gltf.nodes.forEach((n, i) => (n.children || []).forEach((c) => nodes[i].add(nodes[c])));
const scene = new THREE.Group();
for (const r of gltf.scenes[0].nodes) scene.add(nodes[r]);

globalThis.window = { CITY: { THREE } };
(0, eval)(fs.readFileSync(new URL('../../js/rocketbox-pedestrians.js', import.meta.url), 'utf8'));
const Retarget = window.CITY.makeRocketboxRetarget(THREE);

// our bind pose, copied from js/pedestrians.js (bindJoints, male)
const B = { PELVIS: 0, CHEST: 1, HEAD: 2, UPPER_ARM_L: 3, FOREARM_L: 4, UPPER_ARM_R: 5, FOREARM_R: 6, THIGH_L: 7,
  SHIN_L: 8, FOOT_L: 9, TOE_L: 10, THIGH_R: 11, SHIN_R: 12, FOOT_R: 13, TOE_R: 14 };
const bind = [];
bind[B.PELVIS] = new THREE.Vector3(0, 0.96, 0);
bind[B.CHEST] = new THREE.Vector3(0, 1.12, -0.01);
bind[B.HEAD] = new THREE.Vector3(0, 1.52, -0.012);
[1, -1].forEach((side, k) => {
  const ax = Math.sin(0.14) * 0.3, ay = -Math.cos(0.14) * 0.3;
  bind[[B.UPPER_ARM_L, B.UPPER_ARM_R][k]] = new THREE.Vector3(side * 0.185, 1.43, -0.015);
  bind[[B.FOREARM_L, B.FOREARM_R][k]] = new THREE.Vector3(side * (0.185 + ax), 1.43 + ay, -0.015);
  bind[[B.THIGH_L, B.THIGH_R][k]] = new THREE.Vector3(side * 0.09, 0.92, 0);
  bind[[B.SHIN_L, B.SHIN_R][k]] = new THREE.Vector3(side * 0.09, 0.5, 0);
  bind[[B.FOOT_L, B.FOOT_R][k]] = new THREE.Vector3(side * 0.09, 0.08, 0);
  bind[[B.TOE_L, B.TOE_R][k]] = new THREE.Vector3(side * 0.09, 0.02, 0.135);
});

// A rig whose every bone carries the same world rotation `q` about the origin, moved by `offset`; `thighL`
// optionally swings the left leg (thigh, shin, foot and toe) about its hip
function makeRig(q, offset = new THREE.Vector3(), swing = null, s = 1) {
  const pose = new Float32Array(31 * 4);
  const rig = {
    bind, pose, s, x: offset.x, z: offset.z, yaw: 0,
    jointAt(b, out) {
      const o = b * 8;
      const bq = new THREE.Quaternion(pose[o], pose[o + 1], pose[o + 2], pose[o + 3]);
      return out.copy(bind[b]).applyQuaternion(bq).multiplyScalar(s).add(new THREE.Vector3(pose[o + 4], pose[o + 5], pose[o + 6]));
    }
  };
  const write = (b, bq, joint) => {
    const v = bind[b].clone().applyQuaternion(bq).multiplyScalar(s);
    pose.set([bq.x, bq.y, bq.z, bq.w, joint.x - v.x, joint.y - v.y, joint.z - v.z, s], b * 8);
  };
  const place = (b) => bind[b].clone().applyQuaternion(q).multiplyScalar(s).add(offset);
  for (let b = 0; b < 15; b++) write(b, q, place(b));
  if (swing) {
    const hip = place(B.THIGH_L);
    const lq = q.clone().multiply(swing);
    for (const b of [B.THIGH_L, B.SHIN_L, B.FOOT_L, B.TOE_L]) {
      write(b, lq, bind[b].clone().sub(bind[B.THIGH_L]).applyQuaternion(lq).multiplyScalar(s).add(hip));
    }
  }
  return rig;
}

const root = new THREE.Group();
root.add(scene);
const r = new Retarget(root, scene);
const PAIRS = [['L Thigh', B.THIGH_L], ['L Calf', B.SHIN_L], ['L Foot', B.FOOT_L], ['L Toe0', B.TOE_L],
  ['R Thigh', B.THIGH_R], ['R Calf', B.SHIN_R], ['R Foot', B.FOOT_R], ['R Toe0', B.TOE_R],
  ['L UpperArm', B.UPPER_ARM_L], ['L Forearm', B.FOREARM_L], ['R UpperArm', B.UPPER_ARM_R], ['R Forearm', B.FOREARM_R],
  ['Pelvis', B.PELVIS], ['Head', B.HEAD]];
const f = (v) => v.toArray().map((x) => x.toFixed(3).padStart(7)).join(' ');
let failed = 0;
const expect = (ok, label) => { if (!ok) failed++; console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}`); };

console.log(`rest: facing error ${(r.facingError * 180 / Math.PI).toFixed(2)} deg, left at +x ${r.leftIsPlusX}, leg ${r.legLength.toFixed(3)} m, ankle ${r.restAnkleY.toFixed(3)} m`);
expect(Math.abs(r.facingError) < 0.02 && r.leftIsPlusX, 'the model faces +Z with its left at +X');

function run(title, rig, tolerance) {
  console.log(`\n${title}`);
  r.bind(rig);
  r.apply();
  const p = new THREE.Vector3(), g = new THREE.Vector3();
  const gap = {};
  for (const [name, our] of PAIRS) {
    r.worldPos(name, p);
    rig.jointAt(our, g);
    gap[name] = p.distanceTo(g);
    console.log(`  ${name.padEnd(11)} avatar ${f(p)}   rig ${f(g)}   gap ${gap[name].toFixed(3)}`);
  }
  console.log(`  ${'L Hand'.padEnd(11)} avatar ${f(r.worldPos('L Hand', p))}`);
  console.log(`  root scale ${root.scale.x.toFixed(4)}`);
  for (const [names, limit] of tolerance) {
    for (const n of names) expect(gap[n] < limit, `${n} within ${limit * 100} cm of the rig's joint (${(gap[n] * 100).toFixed(1)} cm)`);
  }
  return gap;
}

const legs = ['L Thigh', 'L Calf', 'L Foot', 'R Thigh', 'R Calf', 'R Foot'];
// (its shoulders are wider and higher than ours, so the arms hang about 8 cm off the rig's)
const TOL = [[legs, 0.03], [['L Forearm', 'R Forearm'], 0.12]];
run('1. bind pose', makeRig(new THREE.Quaternion()), TOL);
const hand = r.worldPos('L Hand', new THREE.Vector3()), shoulder = r.worldPos('L UpperArm', new THREE.Vector3());
expect(hand.y < shoulder.y - 0.4, `the left hand hangs below the shoulder (${(shoulder.y - hand.y).toFixed(2)} m)`);
expect(r.worldPos('L Toe0', new THREE.Vector3()).z > r.worldPos('L Foot', new THREE.Vector3()).z + 0.05, 'toes ahead of the ankle');

const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
run('2. turned 90 degrees about +Y, standing at (10, 0, -5), 1.1 tall', makeRig(yaw, new THREE.Vector3(10, 0, -5), null, 1.1), TOL);
expect(r.worldPos('L Toe0', new THREE.Vector3()).x > r.worldPos('L Foot', new THREE.Vector3()).x + 0.05, 'toes point along +X');

const swing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.6);
run('3. left leg swung forward 34 degrees', makeRig(new THREE.Quaternion(), new THREE.Vector3(), swing), TOL);
expect(r.worldPos('L Foot', new THREE.Vector3()).z > 0.3, 'the left ankle is ahead of the body');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks pass');
process.exit(failed ? 1 : 0);
