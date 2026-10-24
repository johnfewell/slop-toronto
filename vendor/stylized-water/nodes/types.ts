// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Change: WaterCtx carries the surface frame, shadow, sky and radiance in place of mesh/scene/renderer/camera.
import type { WaterUniforms, TextureSlot } from '../uniforms';

export interface WaterCtx {
  u: WaterUniforms;
  /** App-defined, freezable time in seconds. Do not use TSL's built-in time. */
  time: any;
  /** Get a TSL texture node for a slot (presets switch it by replacing .value). */
  tex: (slot: TextureSlot) => any;
  sunDirection: any;
  /**
   * The surface frame (ride-anywhere adaptation). Still water: the donor's worldUV and its mesh basis
   * T = -X, B = +Z. Flowing water: the prepared station/lateral metres (waterCoords) at the same 0.1 per metre,
   * drifting downstream at the kit's flow speed, with T = -downstream so the donor's sign conventions hold.
   */
  frame: { uv: any; T: any; B: any };
  /** The scene's shared sun shadow node (visibility 1 lit, 0 shaded), or null: replaces the donor's light lookup. */
  shadow: any;
  /** Sky radiance along a world direction (the scene's atmosphere environment): replaces the donor's baked probe. */
  sky: (direction: any) => any;
  /** 1 / exposure: the donor's display-referred colours into the scene's radiance (not applied to scene or sky samples). */
  radiance: any;
  /** The renderer's depth convention, for the opaque-depth copy. */
  depth: { reversed: boolean; logarithmic: boolean };
}

/** Return value of buildDepth(ctx, uv). Two instances are created: screenUV and refracted UV. */
export interface DepthData {
  /** Positive view-space depth of the fragment itself [m]. */
  eyeDepth: any;
  /** Positive view-space scene depth at the sampled UV [m]. */
  sceneEyeDepth: any;
  scenePosWS: any;
  /** World Space shallow mask (exp). 1=shoreline, 0=deep. */
  ws: any;
  /** View Space shallow mask (linear). 1=shoreline. */
  cs: any;
  /** _WorldSpaceDepth ? ws : cs -- for water color and underwater-layer conformance. */
  depthColorMask: any;
  /** Final alpha and near-distance refraction mask (meaningful only for the screenUV variant). */
  shoreFadeMask: any;
  /** saturate((dist-Start)/Fade) for normal distance blending. Near 0 -> far 1. */
  distanceMask: any;
}

export interface WavesData {
  offset: any;
  normal: any;
  /** Wave_Top_Color mask (fragment-recomputed displacement y x 10, unclamped). */
  height01: any;
}
