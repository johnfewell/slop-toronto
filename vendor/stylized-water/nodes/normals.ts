// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Change: frame UV; the frame tangent replaces the fixed T = -X (identical for still water).
import { cameraPosition, cross, dFdx, dFdy, float, mix, positionWorld, saturate, vec2, vec3 } from 'three/tsl';
import type { WaterCtx, WavesData } from './types';

// Sampling uses Unity-projected world UVs (three Z is flipped), while the source mesh's Mikktspace
// basis points opposite those UV axes: T=-X_unity and B=-Z_unity. Keep these conventions distinct.

// TSL does not eliminate equivalent node objects, so share the fragment-only normal samples per context.
const unscaledCache = new WeakMap<WaterCtx, any>();
const nTSCache = new WeakMap<WaterCtx, any>();

/**
 * Two-way Normal Blend sample before strength is applied (= Unity Unscaled_Normal, tangent space [-1,1]).
 * Even when _ENABLENORMAL is off, refraction distortion always receives this value; exported for refraction.
 */
export function buildUnscaledNormalMapSample(ctx: WaterCtx) {
  let cached = unscaledCache.get(ctx);
  if (cached === undefined) unscaledCache.set(ctx, (cached = buildUnscaledNormalMapSampleImpl(ctx)));
  return cached;
}

function buildUnscaledNormalMapSampleImpl(ctx: WaterCtx) {
  const { u } = ctx;
  const t = float(ctx.time);
  const uvBase = ctx.frame.uv;

  const uvA = uvBase.mul(u.Normal_Scale.mul(0.5)).add(vec2(u.Normal_Pan.mul(-0.05).mul(t)));
  const uvB = uvBase.mul(u.Normal_Scale).add(vec2(u.Normal_Pan.mul(0.1).mul(t)));

  const nA = sampleNormalMap(ctx, uvA);
  const nB = sampleNormalMap(ctx, uvB);
  return mix(nA, nB, 0.5) as any; // The source uses an unnormalized average, not whiteout or UDN blending.
}

// These GT-calibrated limits preserve ripple detail after hardware anisotropy reaches its cap.
const ANISO_KNEE = 4;
const ANISO_MAX_BOOST = 16;

function sampleNormalMap(ctx: WaterCtx, uv: any) {
  const gx = dFdx(uv);
  const gy = dFdy(uv);
  const lx = gx.length();
  const ly = gy.length();
  const ratio = lx.max(ly).div(lx.min(ly).max(1e-8));
  const k = float(1).div(ratio.div(ANISO_KNEE).clamp(1, ANISO_MAX_BOOST));
  return ctx.tex('Normal_Map').sample(uv).grad(gx.mul(k), gy.mul(k)).rgb.mul(2).sub(1);
}

/**
 * Tangent-space normal passed to lighting/reflection/distortion, with strength and distance blending applied.
 * When _ENABLENORMAL is off, (0,0,1) means no perturbation.
 *
 * reflection.ts / refraction.ts must import and use this single implementation.
 * Duplicating the formula would diverge when only one copy receives a TBN-sign or UV-convention fix.
 */
export function buildNormalTS(ctx: WaterCtx) {
  let cached = nTSCache.get(ctx);
  if (cached === undefined) nTSCache.set(ctx, (cached = buildNormalTSImpl(ctx)));
  return cached;
}

function buildNormalTSImpl(ctx: WaterCtx) {
  const { u } = ctx;
  const nBlend = buildUnscaledNormalMapSample(ctx);

  const distMask = saturate(
    cameraPosition.distance(positionWorld).sub(u.DistanceMask_Start).div(u.DistanceMask_Fade),
  );
  const strength = mix(u.Normal_Strength, u.Normal_DistanceStrength, distMask);

  // Preserve negative strength as an xy flip; only the z blend saturates in Unity NormalStrength.
  const nScaled = vec3(nBlend.xy.mul(strength), mix(float(1), nBlend.z, saturate(strength)));

  return mix(vec3(0, 0, 1), nScaled, u.ENABLENORMAL) as any;
}

/**
 * Final world normal combining the wave normal and normal map, for specular.
 *
 * Build B from the displaced geometry normal so the perturbation rotates with waves. The Unity-to-three
 * handedness flip makes the required bitangent `cross(N, T)` with T=-X.
 */
export function buildWaterNormal(ctx: WaterCtx, waves: WavesData) {
  const nTS = buildNormalTS(ctx);
  const N = waves.normal.normalize();
  const T = ctx.frame.T;
  const B = cross(N, T);
  return T.mul(nTS.x).add(B.mul(nTS.y)).add(N.mul(nTS.z)).normalize();
}
