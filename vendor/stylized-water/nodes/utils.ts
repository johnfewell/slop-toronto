// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Change: the frame UV replaces worldUV() for every sampled layer; paralaxUV takes the frame view direction.
import { cameraPosition, mix, positionWorld, vec2, vec3, float } from 'three/tsl';
import type { WaterCtx } from './types';

/**
 * WorldSpaceYProjectUV: one tile per 10 world meters (0.1 is constant).
 *
 * Unity-to-three conversion flips Z, so Unity's (X,Z)*0.1 becomes (x,-z)*0.1.
 * This correction affects every worldUV feature.
 */
export function worldUV(posWS: any = positionWorld) {
  return vec2(posWS.x, posWS.z.negate()).mul(0.1);
}

/** The donor's tangent-space view direction in a general surface basis; still water gives viewDirTS() exactly. */
export function frameViewDirTS(ctx: WaterCtx) {
  const V = cameraPosition.sub(positionWorld).normalize();
  const N = ctx.frame.T.cross(ctx.frame.B).normalize();
  return vec3(V.dot(ctx.frame.T), V.dot(ctx.frame.B), V.dot(N));
}

/** UVPanner: uv * (tile*scale) + speed * 0.1 * t (0.1 is constant). */
export function uvPanner(uv: any, speed: any, tile: any, scale: any, t: any) {
  return uv.mul(vec2(tile).mul(scale)).add(vec2(speed).mul(0.1).mul(t));
}

/** UVPannerDistorted: add the distortion value (x0.1) after panning. */
export function uvPannerDistorted(
  baseUV: any, tile: any, scale: any, pan: any, distStrength: any, distValue: any, t: any,
) {
  const uv = uvPanner(baseUV, pan, tile, scale, t);
  return uv.add(distValue.mul(distStrength.mul(0.1)).xy);
}

export function smoothMask(edge: any, smoothness: any, x: any) {
  return x.smoothstep(edge, edge.add(smoothness));
}

/** RemapPosetiveToFull: [0,1] → [-1,1] */
export function remapPositiveToFull(v: any) {
  return v.mul(2).sub(1);
}

/** DistanceFromCamera: o=1 far away / inverted=1 nearby. */
export function distanceFromCamera(posWS: any, start: any, fade: any) {
  const d = cameraPosition.distance(posWS);
  const o = d.sub(start).div(fade).saturate();
  return { o, inverted: o.oneMinus() };
}

/**
 * The FBX uses calculated Mikktspace tangents. Measurements give:
 *   FBX vertices x∈[0,20] / z∈[-20,0], UV0 = (0.05·x_fbx, -0.05·z_fbx) (residual 3e-7)
 *   Unity's imported FBX has localBounds.x∈[-20,0], so X is flipped.
 *   ⇒ u = -0.05·x_unity, v = -0.05·z_unity ⇒ T = -X_unity / B = -Z_unity / N = +Y_unity
 * Thus three's tangent-space view direction is vec3(-V.x, +V.z, V.y).
 *
 * Unity intentionally sign-flips these axes relative to worldUV. Reversing the sign
 * makes the parallax-offset gradient cancel the worldUV gradient, folding UVs along the shore and
 * producing vertical smears and stair-step blocks.
 */
export function viewDirTS() {
  const V = cameraPosition.sub(positionWorld).normalize();
  return vec3(V.x.negate(), V.z, V.y);
}

/** ParalaxUV fully reduced for a constant black Heightmap. paralaxDepth is expected to be negative. */
export function paralaxUV(baseUV: any, paralaxDepth: any, viewTS: any) {
  const amplitude = paralaxDepth.mul(0.1);
  const v = viewTS.normalize();
  const offsetScale = amplitude.mul(-0.5);
  const offset = v.xy.div(v.z.add(0.42)).mul(offsetScale);
  return baseUV.add(offset);
}

export function surfDistortValue(ctx: WaterCtx) {
  const { u } = ctx;
  const uv = uvPanner(ctx.frame.uv, u.SurfaceDistortion_Pan, vec2(u.SurfaceDistortion_Scale, u.SurfaceDistortion_Scale), float(1), ctx.time);
  const d = ctx.tex('SurfaceDistortion_Map').sample(uv).r;
  return vec3(d.mul(2).sub(1));
}

/** ColorLayerAlpha: mix(base, layer, mask * layer.a), for every rgba component. */
export function colorLayerAlpha(base: any, layer: any, layerMask: any) {
  return mix(base, layer, layerMask.mul(layer.a));
}

/** Screen blend (scalar). */
export function blendScreen(base: any, blend: any, opacity: any) {
  const o = float(1).sub(float(1).sub(blend).mul(float(1).sub(base)));
  return mix(base, o, opacity);
}

/** LayerAlpha: accumulate layer alpha with Screen composition (blend=1 disables it). */
export function layerAlpha(layer: any, baseAlpha: any, mask: any, blend: any) {
  return mix(blendScreen(baseAlpha, layer.a, mask), baseAlpha, blend);
}

export const EPS = float(1e-5);
