// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Change: one float opaque-depth copy for a reversed depth buffer; logarithmic depth on ?depth=log.
import { DepthTexture, FloatType } from 'three';
import {
  cameraFar,
  cameraNear,
  cameraPosition,
  logarithmicDepthToViewZ,
  mix,
  perspectiveDepthToViewZ,
  positionView,
  positionWorld,
  screenUV,
  viewportDepthTexture,
} from 'three/tsl';
import type { WaterCtx, DepthData } from './types';

// Each viewportDepthTexture call clones a texture and framebuffer copy. Sampling one base node makes
// all UV variants share ViewportTextureNode's _cacheTextures; immutable depth keeps this bit-identical.
// A reversed depth buffer is float32 (ra-dt0v): its copy needs a float target, as the delivered WebGPU water did.
let _depthBase: any = null;
let _depth: WaterCtx['depth'] = { reversed: false, logarithmic: false };
const depthBase = () => {
  if (_depthBase) return _depthBase;
  let target: DepthTexture | null = null;
  if (_depth.reversed) { target = new DepthTexture(); target.type = FloatType; }
  return (_depthBase = (viewportDepthTexture as unknown as (uv: any, level: null, t: DepthTexture | null) => any)(screenUV, null, target));
};
export function useDepthConvention(depth: WaterCtx['depth']) { _depth = depth; }

/** Scene depth -> positive view-space depth [m] (three's helper handles the depth convention). */
export function sceneEyeDepthAt(uv: any) {
  const d = depthBase().sample(uv);
  return (_depth.logarithmic ? logarithmicDepthToViewZ(d, cameraNear, cameraFar) : perspectiveDepthToViewZ(d, cameraNear, cameraFar)).negate();
}

/** Positive view-space depth of the fragment itself [m] (equivalent to Unity ScreenPosition.w). */
export function fragEyeDepth() {
  return positionView.z.negate();
}

/**
 * Passing a refracted UV creates the refracted variant.
 * - ws: World Space shallow mask saturate(exp(-(waterY-sceneY)/D)). 1=shoreline, 0=deep
 * - cs: View Space shallow mask 1-saturate(Δeye/(D*10))
 * - depthColorMask: _WorldSpaceDepth ? ws : cs
 * - shoreFadeMask: smoothstep(_ShoreFade-1, +Smoothness, 1-ws) (use the screenUV variant)
 * - distanceMask: saturate((dist-Start)/Fade) for normal distance blending
 */
export function buildDepth(ctx: WaterCtx, uvNode: any = screenUV): DepthData {
  const { u } = ctx;

  const eyeDepth = fragEyeDepth();
  const sceneEye = sceneEyeDepthAt(uvNode);

  // ScenePositionWS: reconstruct the scene point along the fragment's own ray
  const rayDir = positionWorld.sub(cameraPosition).div(eyeDepth);
  const scenePosWS = cameraPosition.add(rayDir.mul(sceneEye));

  const vertical = positionWorld.y.sub(scenePosWS.y);
  const ws = vertical.negate().div(u.Water_Depth).exp().saturate();
  const cs = sceneEye.sub(eyeDepth).div(u.Water_Depth.mul(10)).saturate().oneMinus();

  const depthColorMask = mix(cs, ws, u.WorldSpaceDepth);

  const depth01 = ws.oneMinus().saturate();
  const edge = u.ShoreFade.sub(1);
  const shoreFadeMask = depth01.smoothstep(edge, edge.add(u.ShoreFade_Smoothness));

  const distanceMask = cameraPosition
    .distance(positionWorld)
    .sub(u.DistanceMask_Start)
    .div(u.DistanceMask_Fade)
    .saturate();

  return { eyeDepth, sceneEyeDepth: sceneEye, scenePosWS, ws, cs, depthColorMask, shoreFadeMask, distanceMask };
}
