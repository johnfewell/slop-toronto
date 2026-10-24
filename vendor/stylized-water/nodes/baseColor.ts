// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Unchanged.
import { mix } from 'three/tsl';
import type { WaterCtx, DepthData } from './types';

/** Deep-to-shallow color; depthColorMask is 1 at the shoreline. */
export function buildBaseColor(ctx: WaterCtx, d: DepthData) {
  const { u } = ctx;
  return mix(u.Color_Deep, u.Color_Shallow, d.depthColorMask);
}
