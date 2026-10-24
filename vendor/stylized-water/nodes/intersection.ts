// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Change: frame UV.
import { float, mix } from 'three/tsl';
import type { WaterCtx, DepthData } from './types';
import { smoothMask, surfDistortValue, uvPannerDistorted } from './utils';

export interface IntersectionData {
  /** 0..1 mask with the _Enable_Intersection gate applied. Composition uses u.InterSec_Color. */
  mask: any;
}

// TSL does not deduplicate equivalent texture nodes. Keep the cache here to avoid a circular import
// while sharing one SurfaceDistortion_Map sample with surfaceFoam.ts.
const distCache = new WeakMap<WaterCtx, any>();
export function sharedSurfDistortValue(ctx: WaterCtx): any {
  let v = distCache.get(ctx);
  if (!v) distCache.set(ctx, (v = surfDistortValue(ctx)));
  return v;
}

/**
 * Core IntersectionFoamGenerator mask.
 * Shared by the surface and underwater-layer variants imported from surfaceFoam.ts.
 *
 * @param waterDepth World Space `_Water_Depth` fade (depthS.ws; 1=shoreline, 0=deep).
 *                   Use the raw screenUV variant, unaffected by refracted UV or `_WorldSpaceDepth`.
 * @param baseUV     Base UV before panning. Surface=worldUV / underwater layer=paralaxUV.
 *                   This function applies uvPannerDistorted (Tile/Scale/Pan/Distortion) internally.
 * @param distValue  Shared distortion value, recomputed when omitted.
 */
export function intersectionFoamMask(
  ctx: WaterCtx,
  waterDepth: any,
  baseUV: any,
  distValue: any = sharedSurfDistortValue(ctx),
): any {
  const { u } = ctx;

  const g = mix(float(0.1), float(1.0), u.InterSec_GradientDissolve);

  const w = u.InterSec_Width.mul(mix(float(0.7), float(1.0), g));
  const edge = w.oneMinus();

  const band = smoothMask(edge, g, waterDepth);

  const foamUV = uvPannerDistorted(
    baseUV,
    u.InterSec_Foam_Tile,
    u.InterSec_Foam_Scale,
    u.InterSec_Foam_Pan,
    u.InterSec_Foam_Distortion,
    distValue,
    ctx.time,
  );
  const r = ctx.tex('InterSec_Foam_Mask').sample(foamUV).r;
  const m = mix(r.oneMinus(), r, u.InterSec_Foam_Invert);
  const d = u.InterSec_Dissolve.mul(mix(float(2.5), float(1.0), g));
  const dm = m.mul(d).oneMinus(); // May be negative; intermediate clamping changes HLSL extrapolation.

  // Avoid NaN when smoothness is zero while preserving HLSL smoothstep's collapsed result.
  const x = band.mul(band.add(dm));
  const foam = smoothMask(float(0.1), u.InterSec_Foam_Smooth.max(1e-6), x);

  const wideBand = smoothMask(edge, float(1.0), waterDepth);
  const result = mix(foam, wideBand.mul(foam), u.InterSec_Edge_Fade);

  // Clamp only the final result; earlier values intentionally extrapolate.
  return result.saturate();
}

/** depthS is the screenUV DepthData (uses ws as the WaterDepth input). */
export function buildIntersection(ctx: WaterCtx, depthS: DepthData): IntersectionData {
  const mask = intersectionFoamMask(ctx, depthS.ws, ctx.frame.uv);
  return { mask: mask.mul(ctx.u.Enable_Intersection) };
}
