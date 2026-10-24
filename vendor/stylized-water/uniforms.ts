// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Change: local publicAsset.
// Uniform definitions that mirror every property in Unity's UberStylizedWater.shader 1:1.
// Key names omit the leading "_" from Unity property names to preserve the presets.json mapping.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
// slop-toronto: the textures are served from ./assets/water/ next to explore.html
const publicAsset = (path: string) => `./assets/${path.replace(/^\/+/, '').replace(/^textures\//, '')}`;

export type WaterUniforms = ReturnType<typeof createWaterUniforms>;

/**
 * Measured Unity color-space rules: `[HDR]` properties store linear values, while plain `Color`
 * properties store sRGB and convert only RGB during GPU upload. Alpha is never converted.
 * Treating plain colors as linear produces large shifts, such as pale cream foam in murky.
 */
export const HDR_COLOR_KEYS = new Set(['Color_Shallow', 'Color_Deep', 'Specular_Color']);

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Convert non-HDR Color .mat values (gamma) to GPU values (linear), preserving alpha. */
export function gammaColorToLinear(r: number, g: number, b: number, a: number) {
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a] as const;
}

const v2 = (x: number, y: number) => uniform(new THREE.Vector2(x, y));
const v3 = (x: number, y: number, z: number) => uniform(new THREE.Vector3(x, y, z));
const v4 = (x: number, y: number, z: number, w: number) => uniform(new THREE.Vector4(x, y, z, w));
/** For non-HDR Color properties: convert shader defaults from gamma to linear uniforms. */
const c4 = (x: number, y: number, z: number, w: number) =>
  uniform(new THREE.Vector4(...gammaColorToLinear(x, y, z, w)));
const f = (x: number) => uniform(x);

export function createWaterUniforms() {
  return {
    // Base
    Color_Shallow: v4(0.2269659, 0.822786, 0.4507858, 0),
    Color_Deep: v4(0, 0.2541522, 0.4507858, 1),
    Water_Depth: f(0.3),
    WorldSpaceDepth: f(1),
    DistanceMask_Start: f(5),
    DistanceMask_Fade: f(10),
    ShoreFade: f(1),
    ShoreFade_Smoothness: f(0.2),

    // Surface foam
    Enable_SurfaceFoam: f(1),
    SurfFoam_Color: c4(1, 1, 1, 1),
    SurfFoam_AlphaBlend: f(0),
    Invert_SurfFoam: f(0),
    SurfFoam_Pan: v2(0.1, 0.1),
    SurfFoam_Scale: f(3),
    SurfFoam_Tile: v2(1, 1),
    SurfFoam_Edge: f(0.1),
    SurfFoam_EdgeSmooth: f(0.2),
    SurfaceDistortion_Scale: f(1),
    SurfaceDistortion_Strength: f(0.1),
    SurfaceDistortion_Pan: v2(1, 1),

    // Intersection foam
    Enable_Intersection: f(0),
    InterSec_Color: c4(1, 1, 1, 1),
    InterSec_Width: f(0.5),
    InterSec_Dissolve: f(1.6),
    InterSec_Foam_Invert: f(0),
    InterSec_Foam_Scale: f(4),
    InterSec_Foam_Tile: v2(1, 1),
    InterSec_Foam_Pan: v2(0, 0),
    InterSec_Foam_Distortion: f(3),
    InterSec_Foam_Smooth: f(0.01),
    InterSec_GradientDissolve: f(0),
    InterSec_Edge_Fade: f(0),

    // Shoreline
    ENABLESHORELINE: f(0),
    SL_Color: c4(1, 1, 1, 1),
    SL_WaterDepth: f(0.3),
    SL_Speed: f(0.05),
    SL_Ammount: f(5),
    SL_Thickness: f(0.3),
    SL_CenterMask: f(0.5),
    SL_CenterMaskFade: f(0),
    SL_Dissolve: f(0.7),
    SL_GradientDissolve: f(0),
    SL_MaskPan: v2(0.01, 0),
    SL_MaskScale: f(4),
    SL_MaskTile: v2(1, 1),
    SL_EnableTrail: f(0),
    SL_Trail_Fade: f(1),

    // Underwater layer
    ENABLE_UNDERWATERLAYER: f(0),
    UnderWater_Depth: f(-4),
    ConformToGeometry: f(1),
    Underwater_Color: c4(0, 0, 0, 0.5019608),
    UnderWater_ScaleModifier: f(0),
    UnderWater_Start: f(5),
    Underwater_Fade: f(15),

    // Normal map
    ENABLENORMAL: f(0),
    Normal_Strength: f(0.1),
    Normal_Pan: f(0.1),
    Normal_Scale: f(5),
    Normal_DistanceStrength: f(0.01),

    // Lighting
    ShadowColor: c4(0, 0, 0, 0.6),
    Specular_Color: v4(1, 1, 1, 1),
    Specular_Spread: f(0),
    Specular_Hardness: f(0),
    Specular_Size: f(1),

    // Reflection
    ENABLEPLANERREFLECTION: f(0),
    Reflection_Strength: f(1),
    Reflection_Fresnel: f(1),
    Reflection_Distortion: f(0),

    // Refraction
    ENABLEREFRACTION: f(0),
    Refraction_Strength: f(0.5),
    Refraction_Distance_Strength: f(0.1),
    Refraction_Distance_Fade: f(0.5),

    // Caustics
    ENABLECAUSTICS: f(0),
    Caustics_Depth: f(-4),
    Caustics_Pan: f(0.1),
    Caustics_Scale: f(1),
    Caustics_Strength: f(1),
    Caustics_Distortion_Strength: f(3),
    Caustics_Distortion_Scale: f(2),
    Caustics_Start: f(5),
    Caustics_Fade: f(5),

    // Waves
    ENABLEWAVE: f(0),
    Wave_Top_Color: c4(0.2982912, 0.9207434, 0.9245283, 1),
    Wave1_Length: f(3),
    Wave1_Height: f(0.01),
    Wave1_Speed: f(1),
    Wave1_Direction: v3(1, 0, 0),
    Wave1_Sharpness: f(0.3),
    Wave2_Length: f(5),
    Wave2_Height: f(0.015),
    Wave2_Speed: f(1.3),
    Wave2_Sharpness: f(0.3),
    Wave2_Direction: v3(-1, 0, 1),
  };
}

export const UNITY_PROP_MAP: Record<string, string> = {
  _1st_Wave_Length: 'Wave1_Length',
  _1st_Wave_Height: 'Wave1_Height',
  _1st_Wave_Speed: 'Wave1_Speed',
  _1st_Wave_Direction: 'Wave1_Direction',
  _1st_Wave_Sharpness: 'Wave1_Sharpness',
  _2nd_Wave_Length: 'Wave2_Length',
  _2nd_Wave_Height: 'Wave2_Height',
  _2nd_Wave_Speed: 'Wave2_Speed',
  _2nd_Wave_Direction: 'Wave2_Direction',
  _2nd_Wave_Sharpness: 'Wave2_Sharpness',
  _ENABLESHORELINE: 'ENABLESHORELINE',
  _ENABLE_UNDERWATERLAYER: 'ENABLE_UNDERWATERLAYER',
  _ENABLENORMAL: 'ENABLENORMAL',
  _ENABLEPLANERREFLECTION: 'ENABLEPLANERREFLECTION',
  _ENABLEREFRACTION: 'ENABLEREFRACTION',
  _ENABLECAUSTICS: 'ENABLECAUSTICS',
  _ENABLEWAVE: 'ENABLEWAVE',
};

export function unityPropToKey(prop: string): string {
  return UNITY_PROP_MAP[prop] ?? prop.replace(/^_/, '');
}

export const TEXTURE_SLOTS = [
  'SurfFoam_Map',
  'SurfaceDistortion_Map',
  'InterSec_Foam_Mask',
  'SL_Dissolve_Mask',
  'Normal_Map',
  'Caustics_Map',
  'Caustics_Distortion_Map',
] as const;
export type TextureSlot = (typeof TEXTURE_SLOTS)[number];

export const DEFAULT_TEXTURES: Record<TextureSlot, string> = {
  SurfFoam_Map: publicAsset('textures/water/foam1.png'),
  SurfaceDistortion_Map: publicAsset('textures/water/noise1.png'),
  InterSec_Foam_Mask: publicAsset('textures/water/noise2.png'),
  SL_Dissolve_Mask: publicAsset('textures/water/noise3.png'),
  Normal_Map: publicAsset('textures/water/normal1.png'),
  Caustics_Map: publicAsset('textures/water/caustic1.png'),
  Caustics_Distortion_Map: publicAsset('textures/water/noise4.png'),
};
