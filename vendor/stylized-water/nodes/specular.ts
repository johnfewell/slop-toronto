// Copied from three-stylized-water (norio/three-stylized-water 47cc902), MIT MatrixRex/norio;
// notice in src/render/water/LICENSE. The WebGPU water (stylized; colours per kind from kits/water.json). Change: the scene's shared sun shadow node replaces the directional-light lookup.
import { cameraPosition, exp2, float, mix, positionWorld, pow, reflect, saturate, vec3 } from 'three/tsl';
import type { WaterCtx } from './types';

export interface LightingData {
  specular: any;
  /**
   * Shadow-layer composition factor = (1 - shadowAtten) x _ShadowColor.a.
   * The canonical application is `mix(rgb, _ShadowColor.rgb, shadowFactor)`.
   */
  shadowFactor: any;
}

export function buildSpecular(ctx: WaterCtx, waterNormal: any): LightingData {
  const { u } = ctx;

  // This Phong scalar intentionally excludes light color, shadow, and intensity.
  const L = ctx.sunDirection.normalize();
  const V = cameraPosition.sub(positionWorld).normalize();
  const exponent = exp2(u.Specular_Spread.oneMinus().mul(10.0).add(1.0)); // 2^(10(1-spread)+1)
  const mainSpec = pow(saturate(reflect(L.negate(), waterNormal).dot(V)), exponent);

  const specSum = vec3(mainSpec);
  const lo = u.Specular_Size.oneMinus();
  const hard = specSum.smoothstep(lo, lo.add(0.15)); // 0.15 is a hard-coded constant, applied per component.
  const specular = mix(specSum, hard, u.Specular_Hardness).mul(u.Specular_Color.rgb); // HDR: do not clamp.

  // MeshBasicNodeMaterial uses a no-op BasicLightingModel.direct(), so light-driven shadow reception is not generated
  // and material.receivedShadowNode (a hook inside ShadowNode.setup) is never reached.
  // Instead, sample PCF attenuation directly with three's official standalone shadow() node.
  let shadowFactor: any = float(0);
  if (ctx.shadow) {
    // The scene's one sun shadow node, shared with the lit materials so the shadow map renders once.
    shadowFactor = ctx.shadow.oneMinus().mul(u.ShadowColor.a); // PCF already yields [0,1], so saturate is unnecessary.
  }

  return { specular, shadowFactor };
}
