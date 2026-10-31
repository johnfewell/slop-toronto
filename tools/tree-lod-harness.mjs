// Runs js/ez-trees.js (or another revision of it) in node, without WebGPU or the tree models: three.js's math and
// object classes are the real ones (vendor/three/three.core.js), the glTF loader hands back a small box per model, and
// TSL is a stand-in (only the materials use it). Shared by tests/tree-lod.test.mjs and tools/benchmark-tree-lod.mjs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';

// A TSL node stand-in: every property and call gives back another node
function tslNode() {
  const node = new Proxy(function () {}, { get: (_, key) => (key === 'value' ? undefined : node), apply: () => node });
  return node;
}
const TSL = new Proxy({}, { get: (_, key) => (key === 'uniform' ? (value) => ({ value, setGroup() { return this; } }) : () => tslNode()) });

class MeshStandardNodeMaterial extends CORE.Material {
  constructor(params = {}) {
    super();
    Object.assign(this, params);
  }
}

class GLTFLoader {
  setMeshoptDecoder() { return this; }
  async loadAsync(url) {
    const id = url.split('/').pop().replace('.glb', '');
    const scene = new CORE.Group();
    const material = { name: id, map: null, color: new CORE.Color(1, 1, 1) };
    const near = new CORE.Mesh(new CORE.BoxGeometry(4, 10, 4), material);
    near.name = 'near';
    const mid = new CORE.Mesh(new CORE.BoxGeometry(4, 10, 4, 1, 1, 1), material);
    mid.name = 'mid';
    scene.add(near, mid);
    return { scene };
  }
}

export const QUALITY_TIERS = {
  high: { treeNear: 55, treeMid: 320, treeMidShadow: 130, treeFar: 1 },
  medium: { treeNear: 45, treeMid: 250, treeMidShadow: 90, treeFar: 0.85 },
  low: { treeNear: 35, treeMid: 180, treeMidShadow: 50, treeFar: 0.7 }
};

/**
 * Builds the EZ-Tree field from `source` (the text of an ez-trees.js) over `streetTrees` (GEO.streetTrees layout:
 * x, z, model, height x 10) plus `generated` ({ x, y, z, scale, species, tier }). Returns { field, scene, trees }.
 */
export async function buildField({ source, quality = QUALITY_TIERS.high, streetTrees, treeModels, generated = [], search = '' }) {
  const THREE = { ...CORE, MeshStandardNodeMaterial };
  const box = () => {
    const g = new CORE.BoxGeometry(6, 12, 6);
    g.computeBoundingBox();
    return g;
  };
  const CITY = {
    THREE,
    TSL,
    Addons: { GLTFLoader, MeshoptDecoder: {} },
    QUALITY: quality,
    GEO: { streetTrees, treeModels },
    CITY_BOUNDS: { sidewalkHeight: 0.15 },
    blockAt: () => null,
    treeOffRail: () => true,
    ROAD_CUTS: [],
    TELEPORT_LOCATIONS: { start: { x: 0, z: 0 } },
    createLeafAtlas: () => ({ texture: {}, tileMeters: 1 }),
    buildTreeGeometries: () => [box(), box(), box()],
    TREE_SPECIES: [0, 1, 2].map((s) => ({ name: `species${s}`, tints: [0x406030, 0x507040, 0x305020] })),
    createTreeMaterial: () => new MeshStandardNodeMaterial()
  };
  const window = { CITY };
  const quiet = { info() {}, warn: console.warn, log: console.log, error: console.error };
  // (a plain function in this realm, not a vm context: a contextified global makes every `Math.` lookup slow, which
  // would skew the timings)
  new Function('window', 'location', 'console', source)(window, { search }, quiet);
  const scene = new CORE.Scene();
  const field = await CITY.buildEzTrees(scene, generated);
  return { field, scene, THREE };
}

/** The instances each tree mesh draws, as sorted record strings (order-free: the regrouping order may differ). */
export function snapshot(field) {
  const out = new Map();
  for (const mesh of field.group.children) {
    const a = mesh.geometry.attributes;
    const extra = a.aTreeData || mesh.instanceColor;
    const rows = [];
    for (let c = 0; c < mesh.count; c++) {
      rows.push([
        Array.from(mesh.instanceMatrix.array.subarray(c * 16, c * 16 + 16)),
        Array.from(extra.array.subarray(c * extra.itemSize, (c + 1) * extra.itemSize)),
        Array.from(a.aLodOrigin.array.subarray(c * 3, c * 3 + 3)),
        Array.from(a.aLodFade.array.subarray(c * 4, c * 4 + 4))
      ].join('|'));
    }
    rows.sort();
    out.set(mesh.name, { visible: mesh.visible, count: mesh.count, rows });
  }
  return out;
}

/** Instances drawn per level kind (near, mid, mid without shadow, far crowns). */
export function levelTotals(field) {
  const t = { near: 0, mid: 0, midNoShadow: 0, far: 0 };
  for (const mesh of field.group.children) {
    if (!mesh.visible) continue;
    if (mesh.name.endsWith('_near')) t.near += mesh.count;
    else if (mesh.name.endsWith('_mid_noshadow')) t.midNoShadow += mesh.count;
    else if (mesh.name.endsWith('_mid')) t.mid += mesh.count;
    else t.far += mesh.count;
  }
  return t;
}

/** Toronto's committed geodata (the City's street trees and the EZ-Tree models) */
export function torontoTrees() {
  const ctx = { window: { CITY: {} } };
  vm.runInNewContext(readFileSync(new URL('../js/toronto-geodata.js', import.meta.url), 'utf8'), ctx);
  const { streetTrees, treeModels } = ctx.window.CITY.GEO;
  return { streetTrees: Array.from(streetTrees), treeModels };
}

/**
 * Stand-ins for street-details.js's invented trees (it needs the whole city to run): parkland (tier 0) and yard
 * (tier 2) trees scattered round every third and fourth street tree, so every tree class is present across the city.
 */
export function inventedTrees(streetTrees) {
  const out = [];
  const h = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0, k = 0; i < streetTrees.length; i += 4, k++) {
    const x = streetTrees[i], z = streetTrees[i + 1];
    if (k % 3 === 0) out.push({ x: x + (h(x, z) - 0.5) * 80, y: 0.15, z: z + (h(z, x) - 0.5) * 80, scale: 0.75 + h(x, 3) * 0.4, species: k % 3, tier: 0 });
    if (k % 4 === 1) out.push({ x: x + (h(x, 9) - 0.5) * 50, y: 0.15, z: z + (h(9, z) - 0.5) * 50, scale: 0.5 + h(z, 3) * 0.35, species: k % 2 ? 2 : 0, tier: 2 });
  }
  return out;
}
