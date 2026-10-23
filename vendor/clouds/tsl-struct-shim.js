// vendor/clouds/tsl-struct-shim.js — three/tsl for the bundled takram packages (@takram/three-atmosphere 0.19.1,
// @takram/three-geospatial 0.9.1), with the struct().layout they read restored. three 0.185 removed it, so the
// published takram builds throw at import on three's dev build (takram three-geospatial#111, fix PR #118). Same adapter as
// concept-3d's scripts/patch-three-clouds.mjs, applied at the import instead of by patching three on disk; three itself
// is untouched. tools/build-clouds.mjs routes every three/tsl import of the bundle here. Drop it when takram ships the fix.
export * from 'three/tsl';
import { nodeObject } from 'three/tsl';
import { StructNode, StructTypeNode } from 'three/webgpu';

// three.tsl.js isArrayAsParameter: several arguments, or one that is a node, are member values in layout order
const isArrayAsParameter = (params) => params.length > 1 || (params[0] !== null && typeof params[0] === 'object' && params[0].isNode === true);

export const struct = (membersLayout, name = null) => {
  const structType = new StructTypeNode(membersLayout, name);
  const make = (...params) => {
    let values = null;
    if (params.length > 0) {
      if (isArrayAsParameter(params)) {
        values = {};
        const names = Object.keys(membersLayout);
        for (let i = 0; i < params.length; i++) values[names[i]] = nodeObject(params[i]);
      } else values = params[0];
    }
    return new StructNode(structType, values);
  };
  return new Proxy(make, {
    get(target, prop, receiver) {
      if (prop === 'layout') return structType;
      if (prop === 'isStruct') return true;
      return Reflect.get(structType, prop, receiver);
    },
    set(target, prop, value) { return Reflect.set(structType, prop, value); },
    has(target, prop) { return prop === 'layout' || prop === 'isStruct' || Reflect.has(structType, prop); }
  });
};
