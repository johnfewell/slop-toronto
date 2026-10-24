// John's stylized water (his three.js WebGPU / TSL port of MatrixRex's Uber Stylized Water,
// three-stylized-water, MIT © 2025 MatrixRex, © 2026 norio; notice in ./LICENSE), as
// ride-anywhere adapted it for an open world (John Fewell's ride-anywhere, src/render/water/stylized: the
// reversed-depth copy, the scene's sky in place of the baked probe, the radiance scale, depth writes). This file is
// ride-anywhere's material.ts without its kit, frame and atmosphere dependencies: still water only, one kit entry per
// water, the sky handed in by the scene. Built into js/stylized-water.js by tools/build-water.mjs.
import * as THREE from 'three/webgpu';
import { cameraViewMatrix, cross, Fn, mix, normalWorld, positionLocal, screenUV, texture, uniform, vec3, vec4 } from 'three/tsl';
import type { WaterCtx } from './nodes/types';
import type { TextureSlot } from './uniforms';
import { createWaterUniforms, DEFAULT_TEXTURES, HDR_COLOR_KEYS, srgbToLinear } from './uniforms';
import { applyPreset, PRESETS, PRESET_NAMES } from './presets';
import { colorLayerAlpha, layerAlpha, worldUV } from './nodes/utils';
import { buildWaves } from './nodes/waves';
import { buildDepth, useDepthConvention } from './nodes/depth';
import { buildBaseColor } from './nodes/baseColor';
import { buildRefraction } from './nodes/refraction';
import { buildSurfaceFoam, buildUnderwaterLayer } from './nodes/surfaceFoam';
import { buildIntersection } from './nodes/intersection';
import { buildShoreline } from './nodes/shoreline';
import { buildCaustics } from './nodes/caustics';
import { buildWaterNormal } from './nodes/normals';
import { buildSpecular } from './nodes/specular';
import { buildReflection } from './nodes/reflection';

const loader = new THREE.TextureLoader();

/** Donor createTextureRegistry, unchanged. */
function createTextureRegistry() {
  const nodes = new Map<TextureSlot, any>();
  const load = (url: string) => {
    const t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace; // Treat masks, noise, and normals as linear data.
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 16;
    return t;
  };
  const get = (slot: TextureSlot) => {
    if (!nodes.has(slot)) nodes.set(slot, texture(load(DEFAULT_TEXTURES[slot])));
    return nodes.get(slot);
  };
  const set = (slot: TextureSlot, url: string) => {
    get(slot).value = load(url);
  };
  return { get, set };
}

/** ride-anywhere's buildWaterMaterial without the kit terms (cloud dimming, rapids). */
function buildWaterMaterial(ctx: WaterCtx) {
  const u = ctx.u;
  const mat = new THREE.MeshBasicNodeMaterial({ name: 'stylized-water' });
  // Render state: Blend SrcAlpha OneMinusSrcAlpha / Cull Back; the surface writes depth (ride-anywhere)
  mat.transparent = true;
  mat.depthWrite = true;
  mat.side = THREE.FrontSide;

  const waves = buildWaves(ctx);
  mat.positionNode = positionLocal.add(waves.offset);
  const N = buildWaterNormal(ctx, waves);
  mat.normalNode = cameraViewMatrix.mul(vec4(N, 0)).xyz.normalize();

  mat.colorNode = Fn(() => {
    const depthS = buildDepth(ctx, screenUV);
    const refr = buildRefraction(ctx, depthS);
    const depthR = buildDepth(ctx, refr.uv);

    const base: any = buildBaseColor(ctx, depthR);
    const caustics = buildCaustics(ctx, depthS);
    const under = buildUnderwaterLayer(ctx, depthR, depthS);
    const inter = buildIntersection(ctx, depthS);
    const shore = buildShoreline(ctx, depthS);
    const foam = buildSurfaceFoam(ctx);

    let c: any = base;
    c = colorLayerAlpha(c, vec4(4.0, 4.0, 4.0, 1.0), caustics.mask);
    c = colorLayerAlpha(c, u.Underwater_Color, under.mask);
    c = colorLayerAlpha(c, u.InterSec_Color, inter.mask);
    c = colorLayerAlpha(c, u.SL_Color, shore.mask);
    c = colorLayerAlpha(c, u.Wave_Top_Color, waves.height01);
    c = colorLayerAlpha(c, u.SurfFoam_Color, foam.mask);

    let a: any = base.a;
    a = layerAlpha(u.InterSec_Color, a, inter.mask, 0.0 as any);
    a = layerAlpha(u.SL_Color, a, shore.mask, 0.0 as any);
    a = layerAlpha(u.SurfFoam_Color, a, foam.mask, u.SurfFoam_AlphaBlend);
    const layeredAlpha = a;

    // The donor's colours are display-referred; the scene is radiance under an exposure (ride-anywhere)
    const own: any = c.rgb.mul(ctx.radiance);
    let rgb: any = mix(own, mix(refr.sceneColor, own, layeredAlpha), u.ENABLEREFRACTION);

    const refl = buildReflection(ctx, N);
    rgb = mix(rgb, refl.color, refl.factor);

    const lit = buildSpecular(ctx, N);
    rgb = rgb.add(lit.specular.mul(ctx.radiance));
    rgb = mix(rgb, u.ShadowColor.rgb.mul(ctx.radiance), lit.shadowFactor);

    const outAlpha = mix(depthS.shoreFadeMask.mul(layeredAlpha), depthS.shoreFadeMask, u.ENABLEREFRACTION);
    return vec4(rgb, outAlpha);
  })();

  return mat;
}

/** The colours that set the hue, as the kit names them, and the donor uniform each one drives. */
export const COLOUR_SLOTS = {
  shallow: 'Color_Shallow', deep: 'Color_Deep', crest: 'Wave_Top_Color', shoreFoam: 'SL_Color', edgeFoam: 'InterSec_Color',
  surfaceFoam: 'SurfFoam_Color', underwater: 'Underwater_Color', shadow: 'ShadowColor',
} as const;
export type ColourName = keyof typeof COLOUR_SLOTS;
export interface KitColour { colour: string; alpha: number }
export interface KindEntry { preset: string; detailFadeScale: number; colours: Record<ColourName, KitColour> }

const DISTANCE_KEYS = ['DistanceMask_Start', 'DistanceMask_Fade', 'Caustics_Start', 'Caustics_Fade', 'UnderWater_Start', 'Underwater_Fade'] as const;
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const hexOf = (rgb: readonly number[]) => `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;

/** A donor preset's hue colours as the kit writes them: sRGB hex and alpha (HDR colours are linear, encoded to sRGB). */
export function presetColours(preset: string): Record<ColourName, KitColour> {
  const colours = (PRESETS.presets[preset]?.colors ?? {}) as Record<string, number[]>;
  return Object.fromEntries(Object.entries(COLOUR_SLOTS).map(([name, key]) => {
    const c = colours[`_${key}`] ?? [1, 1, 1, 1];
    const rgb = HDR_COLOR_KEYS.has(key) ? c.slice(0, 3).map(linearToSrgb) : c.slice(0, 3);
    return [name, { colour: hexOf(rgb), alpha: Math.round((c[3] ?? 1) * 1000) / 1000 }];
  })) as Record<ColourName, KitColour>;
}

/** One water's donor uniforms and textures, set from its kit entry; colour changes are live uniform writes. */
export class KindWater {
  readonly u = createWaterUniforms();
  readonly registry = createTextureRegistry();
  private readonly distances = new Map<string, number>();
  constructor(readonly entry: KindEntry) { this.apply(); }
  setPreset(preset: string): void {
    if (!PRESETS.presets[preset]) return;
    this.entry.preset = preset;
    const fresh = presetColours(preset);
    for (const name of Object.keys(COLOUR_SLOTS) as ColourName[]) Object.assign(this.entry.colours[name], fresh[name]);
    this.apply();
  }
  apply(): void {
    applyPreset(this.u, this.registry.set, this.entry.preset);
    for (const key of DISTANCE_KEYS) this.distances.set(key, (this.u as any)[key].value);
    this.applyColours();
    this.applyChoices();
  }
  applyColours(): void {
    for (const [name, key] of Object.entries(COLOUR_SLOTS)) {
      const { colour, alpha } = this.entry.colours[name as ColourName];
      const n = Number.parseInt(colour.slice(1), 16);
      (this.u as any)[key].value.set(srgbToLinear((n >> 16 & 255) / 255), srgbToLinear((n >> 8 & 255) / 255), srgbToLinear((n & 255) / 255), alpha);
    }
  }
  applyChoices(): void {
    for (const key of DISTANCE_KEYS) (this.u as any)[key].value = this.distances.get(key)! * this.entry.detailFadeScale;
  }
}

export { PRESET_NAMES };

/**
 * One still water surface: its material, its uniforms (via `water`) and the frame-wide uniforms the scene updates.
 * sky(direction) returns the sky radiance along a world direction; reversedDepth matches the renderer.
 */
export function createStylizedWater(entry: KindEntry, options: { sky: (direction: any) => any; reversedDepth: boolean }) {
  useDepthConvention({ reversed: options.reversedDepth, logarithmic: false });
  const time = uniform(0);
  const sunDirection = uniform(new THREE.Vector3(0, 1, 0));
  const radiance = uniform(1);
  const water = new KindWater(structuredClone(entry));
  // Still water: the donor's world UV and its mesh basis (T = -X, B = N x T)
  const T = vec3(-1, 0, 0);
  const B = cross(normalWorld, T).normalize();
  const material = buildWaterMaterial({ u: water.u, time, tex: water.registry.get, sunDirection, frame: { uv: worldUV(), T, B },
    shadow: null, sky: options.sky, radiance, depth: { reversed: options.reversedDepth, logarithmic: false } } as WaterCtx);
  return { material, water, time, sunDirection, radiance };
}
