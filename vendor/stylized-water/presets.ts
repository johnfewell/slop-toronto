// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Change: local publicAsset; one non-null assertion for strict index access; presets.json is the extracted preset subset.
import * as THREE from 'three/webgpu';
import presetsJson from './presets.json';
// slop-toronto: the textures are served from ./assets/water/ next to explore.html
const publicAsset = (path: string) => `./assets/${path.replace(/^\/+/, '').replace(/^textures\//, '')}`;
import { unityPropToKey, TEXTURE_SLOTS, HDR_COLOR_KEYS, gammaColorToLinear } from './uniforms';
import type { WaterUniforms, TextureSlot } from './uniforms';

export interface PresetsFile {
  _demoDefault?: string;
  presets: Record<string, {
    keywords?: string[];
    floats?: Record<string, number>;
    vectors?: Record<string, number[]>;
    colors?: Record<string, number[]>;
    textures?: Record<string, string | null>;
  }>;
}

export const PRESETS: PresetsFile = presetsJson as any;
export const PRESET_NAMES = Object.keys(PRESETS.presets ?? {});
export const DEFAULT_PRESET = PRESETS._demoDefault && PRESETS.presets[PRESETS._demoDefault]
  ? PRESETS._demoDefault
  : (PRESET_NAMES[0] ?? '');

const TEX_URL: Record<string, string> = {
  'Caustic 1.png': publicAsset('textures/water/caustic1.png'),
  'Caustic 2.png': publicAsset('textures/water/caustic2.png'),
  'Caustic 3.png': publicAsset('textures/water/caustic3.png'),
  'Foam 1.png': publicAsset('textures/water/foam1.png'),
  'Foam2.psd': publicAsset('textures/water/foam2.png'),
  'Noise 1.png': publicAsset('textures/water/noise1.png'),
  'Noise 2.png': publicAsset('textures/water/noise2.png'),
  'Noise 3.png': publicAsset('textures/water/noise3.png'),
  'Noise 4.png': publicAsset('textures/water/noise4.png'),
  'Noise 5.png': publicAsset('textures/water/noise5.png'),
  'Noise 6.png': publicAsset('textures/water/noise6.png'),
  'Noise 7.png': publicAsset('textures/water/noise7.png'),
  'Noise 8.png': publicAsset('textures/water/noise8.png'),
  'Normal 1.png': publicAsset('textures/water/normal1.png'),
  'Normal 2.png': publicAsset('textures/water/normal2.png'),
  'Normal 3.png': publicAsset('textures/water/normal3.png'),
};

export function applyPreset(
  u: WaterUniforms,
  setTexture: (slot: TextureSlot, url: string) => void,
  name: string,
) {
  const p = PRESETS.presets?.[name];
  if (!p) return false;

  for (const [prop, value] of Object.entries(p.floats ?? {})) {
    const key = unityPropToKey(prop);
    const un = (u as any)[key];
    if (un && typeof un.value === 'number') un.value = value;
  }
  for (const [prop, vec] of Object.entries(p.vectors ?? {})) {
    const key = unityPropToKey(prop);
    const un = (u as any)[key];
    if (!un) continue;
    if (un.value instanceof THREE.Vector2) un.value.set(vec[0], vec[1]);
    else if (un.value instanceof THREE.Vector3) un.value.set(vec[0], vec[1], vec[2]);
    else if (un.value instanceof THREE.Vector4) un.value.set(vec[0], vec[1], vec[2], vec[3] ?? 0);
  }
  for (const [prop, c] of Object.entries(p.colors ?? {})) {
    const key = unityPropToKey(prop);
    const un = (u as any)[key];
    if (!(un?.value instanceof THREE.Vector4)) continue;
    // HDR values are already linear; plain Color RGB is sRGB while alpha stays linear.
    const rgba = HDR_COLOR_KEYS.has(key)
      ? [c[0], c[1], c[2], c[3] ?? 1]
      : gammaColorToLinear(c[0]!, c[1]!, c[2]!, c[3] ?? 1);
    un.value.set(rgba[0], rgba[1], rgba[2], rgba[3]);
  }
  for (const [prop, file] of Object.entries(p.textures ?? {})) {
    const slot = unityPropToKey(prop) as TextureSlot;
    if (!(TEXTURE_SLOTS as readonly string[]).includes(slot)) continue;
    if (file && TEX_URL[file]) {
      setTexture(slot, TEX_URL[file]);
    } else {
      // Unity defaults for unassigned textures: "bump" (flat normal) for normals, "white" otherwise.
      setTexture(
        slot,
        publicAsset(slot === 'Normal_Map' ? 'textures/water/_flatnormal.png' : 'textures/water/_white.png'),
      );
    }
  }
  return true;
}
