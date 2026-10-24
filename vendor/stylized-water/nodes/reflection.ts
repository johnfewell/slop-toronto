// Adapted from three-stylized-water src/water/nodes/reflection.ts (norio/three-stylized-water
// 47cc902), MIT MatrixRex/norio; notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json).
// The donor reflects a planar reflector inside a fixed demo-scene volume and a baked, box-projected cube probe outside it.
// An open world has neither volume nor bounds, so this keeps the donor's outside-the-volume path: its probe perturbation
// and Fresnel, with the scene's atmosphere environment (sky only, no terrain) in place of the baked probe, at infinite
// distance (no box projection). No second scene render. The planar keyword (ENABLEPLANERREFLECTION) has no effect here.
import { cameraPosition, positionWorld, reflect, vec3 } from 'three/tsl';
import type { WaterCtx } from './types';
import { buildWaves } from './waves';
import { buildNormalTS } from './normals';

export interface ReflectionData {
  color: any;
  /** Final composition factor 0..1 (Strength x Fresnel). */
  factor: any;
}

const cache = new WeakMap<WaterCtx, ReflectionData>();

export function buildReflection(ctx: WaterCtx, _waterNormal: any): ReflectionData {
  let data = cache.get(ctx);
  if (data === undefined) cache.set(ctx, (data = build(ctx)));
  return data;
}

function build(ctx: WaterCtx): ReflectionData {
  const { u } = ctx;
  const nTS = buildNormalTS(ctx);
  // Reusing buildWaves preserves TSL's shared vWaveNormal interpolator.
  const Ngeo = buildWaves(ctx).normal.normalize();
  const V = cameraPosition.sub(positionWorld).normalize();
  // The donor probe's scalar-x normal perturbation, without normalization.
  const perturbedN = Ngeo.add(vec3(nTS.x.mul(u.Reflection_Distortion)));
  const color = ctx.sky(reflect(V.negate(), perturbedN));
  const fresnel = Ngeo.dot(V).saturate().oneMinus().max(1e-5).pow(u.Reflection_Fresnel);
  return { color, factor: fresnel.mul(u.Reflection_Strength) };
}
