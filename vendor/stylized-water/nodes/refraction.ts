// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Unchanged.
import {
  cameraPosition,
  float,
  mix,
  positionWorld,
  screenUV,
  step,
  viewportSharedTexture,
} from 'three/tsl';
import type { WaterCtx, DepthData } from './types';
import { sceneEyeDepthAt } from './depth';
import { buildUnscaledNormalMapSample } from './normals';

export interface RefractionData {
  uv: any;
  sceneColor: any;
}

/** ENABLEREFRACTION=0 must return screenUV and the unmodified scene color. */
export function buildRefraction(ctx: WaterCtx, depthS: DepthData): RefractionData {
  const { u } = ctx;

  // Unity refraction uses the unscaled two-sample normal, unaffected by Normal_Strength or DistanceMask.
  const N = buildUnscaledNormalMapSample(ctx);

  // Spread 5 is hard-coded in the compiled HLSL (L1378).
  const far01 = cameraPosition
    .distance(positionWorld)
    .sub(u.Refraction_Distance_Fade)
    .div(5)
    .saturate();
  const strength = mix(
    depthS.shoreFadeMask.mul(u.Refraction_Strength),
    u.Refraction_Distance_Strength,
    far01,
  );

  // The 0.1 UV-offset scale is hard-coded in the compiled HLSL (L1382).
  const offset = N.xy.mul(strength.mul(0.1));
  const uvOff = screenUV.add(offset);

  // Cancel the offset when its destination is in front of the water surface.
  // step(eyeDepth - sceneEyeDepth(uvOff), 0) is 1 when eyeDepth <= sceneEyeDepth.
  const keep = step(depthS.eyeDepth.sub(sceneEyeDepthAt(uvOff)), float(0));

  const uv = screenUV.add(offset.mul(keep).mul(u.ENABLEREFRACTION));

  return {
    uv,
    sceneColor: viewportSharedTexture(uv).rgb,
  };
}
