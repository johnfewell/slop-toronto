// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Change: frame UV.
// The dissolve mask is linear data. The -0.5 thickness remap and smoothness 1 are HLSL constants.
import { float, mix, positionWorld } from 'three/tsl';
import type { WaterCtx, DepthData } from './types';
import { smoothMask, uvPanner } from './utils';

export interface ShorelineData {
  /** 0..1 mask with _ENABLESHORELINE applied. Composition uses u.SL_Color. */
  mask: any;
}

/** depthS is the screenUV DepthData. */
export function buildShoreline(ctx: WaterCtx, depthS: DepthData): ShorelineData {
  const { u } = ctx;
  const t = ctx.time;

  // Shoreline has its own depth scale; depthS.ws uses _Water_Depth and cannot be reused here.
  const vertical = positionWorld.y.sub(depthS.scenePosWS.y);
  const depth = vertical.negate().div(u.SL_WaterDepth.max(1e-6)).exp().saturate();

  const centerMask = smoothMask(u.SL_CenterMask, u.SL_CenterMaskFade, depth);

  const thickEdge = u.SL_Thickness.mul(-0.5);
  const x = depth.sub(u.SL_Speed.mul(0.1).mul(t)).mul(u.SL_Ammount);
  const fracNeg = x.negate().fract();
  const fracPos = x.fract();
  const smA = smoothMask(thickEdge, float(1), fracNeg);
  const smB = smoothMask(thickEdge, float(1), fracPos);
  const speedPos = u.SL_Speed.greaterThan(0).select(float(1), float(0));
  const dirBand = mix(smB, smA, speedPos);
  const lines = mix(smA.min(smB), dirBand, u.SL_EnableTrail);

  // worldUV corrects Unity's Z axis; sample the dissolve mask without color-space conversion.
  const dUV = uvPanner(ctx.frame.uv, u.SL_MaskPan, u.SL_MaskTile, u.SL_MaskScale, t);
  const dTex = ctx.tex('SL_Dissolve_Mask').sample(dUV).r;
  const dissolved = lines.mul(dTex.mul(u.SL_Dissolve).oneMinus());

  // SL_GradientDissolve may be negative; do not clamp the interpolation factor.
  const expanded = mix(dissolved, lines, depth.mul(u.SL_GradientDissolve));

  const stepped = expanded.step(0.5);

  // SL_Trail_Fade may exceed one and intentionally extrapolates.
  const fracSel = mix(fracNeg, fracPos, speedPos);
  const trail = fracSel.mul(stepped);
  const trailed = mix(stepped, trail, u.SL_Trail_Fade);

  // Clamp only after extrapolating parameters have been composed.
  const mask = centerMask.sub(trailed.oneMinus()).saturate();

  return { mask: mask.mul(u.ENABLESHORELINE) };
}
