// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Unchanged.
// Evaluate the wave field in world space so vertex displacement and fragment crest color share a phase.
// positionWorld is circular inside positionNode, so derive the undisplaced world position manually.
// Unity-to-three conversion flips Direction.z exactly once; flipping both position and direction cancels it.
import {
  dot,
  float,
  mix,
  modelWorldMatrix,
  normalWorld,
  positionGeometry,
  positionWorld,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import type { WaterCtx, WavesData } from './types';

/** Clamp magnitude without changing sign; zero becomes positive epsilon. */
function safeDenom(x: any) {
  const sgn = x.step(0).mul(2).sub(1);
  return sgn.mul(x.abs().max(1e-6));
}

/**
 * Literal port of SG_GersterWaveGenerator.
 * P: three world position, dir: travel direction in Unity space, t: seconds.
 * Return normal unnormalized; normalize once after adding the two waves.
 */
function gerstnerWave(len: any, height: any, speed: any, dir: any, sharp: any, P: any, t: any) {
  const D = vec3(dir.x, dir.y, dir.z.negate());
  const Dn = D.div(D.length().max(1e-6));
  const k = float(6.283185).div(safeDenom(len)); // Required HLSL constants: 2π approximation and g=9.8.
  const w = k.mul(9.8).sqrt();
  const phase = dot(P, Dn.mul(k)).sub(w.mul(t.mul(speed)));
  const c = phase.cos();
  const s = phase.sin();
  const kA = k.mul(height);
  const Q = sharp.div(safeDenom(kA));
  // Horizontal displacement subtracts Q·H·sinθ·Dn in the source.
  const displacement = vec3(0, 1, 0).mul(c.mul(height)).sub(Dn.mul(s.mul(Q.mul(height))));
  // The analytic normal intentionally uses a positive XZ term and remains unnormalized here.
  const nxz = Dn.mul(s.mul(kA));
  const normal = vec3(nxz.x, float(1).sub(Q.mul(c.mul(kA))), nxz.z);
  return { displacement, normal };
}

export function buildWaves(ctx: WaterCtx): WavesData {
  const { u, time } = ctx;
  const wave1 = (P: any) =>
    gerstnerWave(u.Wave1_Length, u.Wave1_Height, u.Wave1_Speed, u.Wave1_Direction, u.Wave1_Sharpness, P, time);
  const wave2 = (P: any) =>
    gerstnerWave(u.Wave2_Length, u.Wave2_Height, u.Wave2_Speed, u.Wave2_Direction, u.Wave2_Sharpness, P, time);

  const posWSUndisplaced = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz;

  const w1 = wave1(posWSUndisplaced);
  const w2 = wave2(posWSUndisplaced);

  const dispSum = w1.displacement.add(w2.displacement);
  const offset = dispSum.mul(u.ENABLEWAVE);

  // Normalize after summing, then renormalize after varying interpolation as URP does.
  const nSum = w1.normal.add(w2.normal);
  const nInterp = varying(nSum.normalize(), 'vWaveNormal');
  const normal = mix(normalWorld, nInterp.normalize(), u.ENABLEWAVE);

  // Recompute in the fragment stage. The HLSL x10 mask must remain unclamped so troughs extrapolate.
  const dispYFrag = wave1(positionWorld).displacement.y.add(wave2(positionWorld).displacement.y);
  const height01 = dispYFrag.mul(10).mul(u.ENABLEWAVE);

  return { offset, normal, height01 };
}
