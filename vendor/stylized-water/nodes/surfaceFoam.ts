// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Change: frame UV and frame view direction; buildSurfaceFoam takes an optional gate in place of _Enable_SurfaceFoam (rapid whitening).
import { mix, positionWorld } from 'three/tsl';
import type { WaterCtx, DepthData } from './types';
import { intersectionFoamMask, sharedSurfDistortValue } from './intersection';
import {
  distanceFromCamera,
  frameViewDirTS,
  paralaxUV,
  smoothMask,
  uvPannerDistorted,
} from './utils';

export interface SurfaceFoamData {
  /** 0..1 foam mask with _Enable_SurfaceFoam / _Invert_SurfFoam applied. */
  mask: any;
}

export interface UnderwaterLayerData {
  /** mask for colorLayerAlpha(prev, _Underwater_Color, mask), with distance fade and gate applied. */
  mask: any;
}

/** Inversion applies after smoothstep, matching SG_SampleMaskTextureDistorted. */
function surfFoamMaskAt(ctx: WaterCtx, baseUV: any, scale: any, distValue: any): any {
  const { u } = ctx;
  const uv = uvPannerDistorted(
    baseUV,
    u.SurfFoam_Tile,
    scale,
    u.SurfFoam_Pan,
    u.SurfaceDistortion_Strength,
    distValue,
    ctx.time,
  );
  const r = ctx.tex('SurfFoam_Map').sample(uv).r;
  const m = smoothMask(u.SurfFoam_Edge, u.SurfFoam_EdgeSmooth, r);
  return mix(m, m.oneMinus(), u.Invert_SurfFoam);
}

export function buildSurfaceFoam(ctx: WaterCtx, gate: any = ctx.u.Enable_SurfaceFoam): SurfaceFoamData {
  const { u } = ctx;
  const mask = surfFoamMaskAt(ctx, ctx.frame.uv, u.SurfFoam_Scale, sharedSurfDistortValue(ctx));
  // ride-anywhere: the gate is _Enable_SurfaceFoam unless the kit's rapid whitening raises it on steep reaches.
  return { mask: mask.mul(gate) };
}

/**
 * Underwater layer. Resample surface/intersection foam at the parallax UV and lay it down as a shadow.
 * depthR = refracted-UV variant (uses depthColorMask for ConformToGeometry)
 * depthS = screenUV variant (uses ws as the intersection foam WaterDepth)
 */
export function buildUnderwaterLayer(ctx: WaterCtx, depthR: DepthData, depthS: DepthData): UnderwaterLayerData {
  const { u } = ctx;
  const dist = sharedSurfDistortValue(ctx);

  // ConformToGeometry scales parallax by the refracted depth mask.
  const uwDepth = mix(
    u.UnderWater_Depth,
    u.UnderWater_Depth.mul(depthR.depthColorMask.oneMinus()),
    u.ConformToGeometry,
  );
  const uwUV = paralaxUV(ctx.frame.uv, uwDepth, frameViewDirTS(ctx));

  // Parallax changes only the base UV; intersection depth remains the screenUV variant.
  const uwInter = intersectionFoamMask(ctx, depthS.ws, uwUV, dist).mul(u.Enable_Intersection);

  const uwFoam = surfFoamMaskAt(
    ctx,
    uwUV,
    u.SurfFoam_Scale.add(u.UnderWater_ScaleModifier),
    dist,
  ).mul(u.Enable_SurfaceFoam);

  const uwDistFade = distanceFromCamera(positionWorld, u.UnderWater_Start, u.Underwater_Fade).inverted;

  const mask = uwInter.add(uwFoam).saturate().mul(uwDistFade);
  return { mask: mask.mul(u.ENABLE_UNDERWATERLAYER) };
}
