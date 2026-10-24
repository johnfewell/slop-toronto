// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Change: frame UV and frame view direction.
// Pseudo-project caustics by offsetting worldUV before tile scaling; this is not depth reconstruction.
// The numeric factors below come from the compiled HLSL and are part of the port contract.
import { cameraPosition, float, positionWorld, vec2, vec3 } from 'three/tsl';
import type { WaterCtx, DepthData } from './types';
import { frameViewDirTS, paralaxUV, uvPanner } from './utils';

export interface CausticsData {
  /** mask for colorLayerAlpha(base, vec4(4,4,4,1), mask), equal to the final caustics.r. */
  mask: any;
}

/** depthS is the screenUV DepthData (uses ws = shallowMask). */
export function buildCaustics(ctx: WaterCtx, depthS: DepthData): CausticsData {
  const { u, time } = ctx;

  const shallowMask = depthS.ws; // Must use the screenUV depth variant, not refracted depth.
  const paralaxDepth = shallowMask.oneMinus().mul(u.Caustics_Depth);

  // Uses the mesh's Mikktspace basis through paralaxUV; see viewDirTS in utils.ts.
  const pUV = paralaxUV(ctx.frame.uv, paralaxDepth, frameViewDirTS(ctx));

  const dUV = uvPanner(
    pUV,
    vec2(u.Caustics_Pan.negate(), float(0)),
    vec2(u.Caustics_Distortion_Scale, u.Caustics_Distortion_Scale),
    float(1),
    time,
  );
  const dR = ctx.tex('Caustics_Distortion_Map').sample(dUV).r;
  const distStrength = u.Caustics_Distortion_Strength.mul(0.01);
  const distortion = vec3(dR.mul(2).sub(1)).mul(vec3(0.01, 2.0, 2.0)).mul(distStrength).xy;

  const uvA = uvPanner(
    pUV,
    vec2(u.Caustics_Pan, u.Caustics_Pan),
    vec2(u.Caustics_Scale, u.Caustics_Scale),
    float(1),
    time,
  ).add(distortion);
  const uvB = uvPanner(
    pUV,
    vec2(u.Caustics_Pan.negate(), u.Caustics_Pan.negate()),
    vec2(u.Caustics_Scale, u.Caustics_Scale),
    float(1.3),
    time,
  ).add(distortion);

  const tex = ctx.tex('Caustics_Map');
  // The compiled HLSL combines both samples with a component-wise minimum.
  const dual = tex.sample(uvA).min(tex.sample(uvB));
  const caustics = dual.mul(u.Caustics_Strength);

  const distFade = cameraPosition
    .distance(positionWorld)
    .sub(u.Caustics_Start)
    .div(u.Caustics_Fade)
    .saturate()
    .oneMinus();

  const mask = caustics.r.mul(shallowMask).mul(distFade).mul(u.ENABLECAUSTICS);

  return { mask };
}
