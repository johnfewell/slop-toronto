(function () {
// js/front-yard-material.js (jf-ugq, docs/front-yards.md): the one material every front-yard shape is drawn with (js/front-yards.js writes the triangles; js/buildings.js puts
// them in a mesh a 500 m cell and shows it within the roofs' near distance). The page's season (tsl-materials.js cityUniforms: uLeaf, uAutumn, uSpring, uDormant, uSnow) decides
// what each kind looks like, so a date change is uniform writes only:
//   0 solid       stone and brick walls, piers, rails, the walk and drive: snow on what faces up
//   1 evergreen   cedar hedges and clipped shrubs: green all year, a snow cap in winter, fresher in spring
//   2 deciduous   privet, lilac, a Japanese maple: summer green, autumn's colours, then bare (twigs: a brown cut-out), a thin snow cap
//   3 lawn        a front lawn, in the season's grass colour; gone under snow (no green sheet on a snowy yard)
//   4 bed         mulch with flower dots in spring and summer, snow in winter
//   5 iron, 6 picket, 7 chain-link   an alpha-tested strip of bars, boards or mesh (one quad a run); thinner than a pixel it becomes a stippled share of itself
// Vertex attributes: position, normal, color (linear rgb), uv = (kind, random 0..1), aux = (metres along the run, height over its foot).

const { THREE } = window.CITY;
const { Fn, float, vec2, vec3, vec4, color, attribute, floor, fract, smoothstep, mix, select, abs, step, sin, dot, max, positionWorld, normalWorldGeometry, fwidth, If } = window.CITY.TSL;

const hash3 = Fn(([p]) => fract(sin(dot(vec3(p), vec3(12.9898, 78.233, 37.719))).mul(43758.5453)));
const hash2 = Fn(([p]) => fract(sin(dot(vec2(p), vec2(127.1, 311.7))).mul(43758.5453)));

function createFrontYardMaterial() {
  const U = window.CITY.cityUniforms;
  const { snowOver, autumnLeaf, leafStays, seasonalGrass } = window.CITY;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
  mat.alphaTest = 0.5;
  const kindUv = attribute('uv', 'vec2'), aux = attribute('aux', 'vec2'), vcol = attribute('color', 'vec3');
  const kind = kindUv.x, rnd = kindUv.y;
  const TWIG = color(0x4a3b2c);

  const shaded = Fn(() => {
    const wp = positionWorld;
    const up = smoothstep(0.45, 0.8, normalWorldGeometry.y); // (1 on what faces up)
    const clump = hash3(floor(wp.mul(5.0)).add(rnd.mul(17.0))); // (a patch of leaves: a clump of a hedge)
    const fine = hash3(floor(wp.mul(16.0)).add(rnd.mul(5.0)));
    const out = vec4(vcol, 1.0).toVar();
    const k = kind.add(0.5);
    // the shaded foliage colour: a clump's lighter or darker tone, darker toward the foot
    const grad = mix(float(0.78), float(1.0), smoothstep(0.0, 1.3, aux.y));
    const tone = clump.mul(0.5).add(1.0).mul(grad);

    // 0 solid: the colour with a little grain; snow on what faces up
    If(k.lessThan(1.0), () => {
      const c = vcol.mul(fine.mul(0.16).add(0.92));
      out.assign(vec4(snowOver(c, wp.xz, up.mul(0.95)), 1.0));
    });
    // 1 evergreen
    If(k.greaterThan(1.0).and(k.lessThan(2.0)), () => {
      const c = mix(vcol.mul(tone), vcol.mul(tone).mul(vec3(1.1, 1.14, 0.8)), U.uSpring.mul(0.5));
      out.assign(vec4(snowOver(c, wp.xz, up.mul(1.7)), 1.0));
    });
    // 2 deciduous: leaves while the clump's key is under the leaf share, else bare twigs (a cut-out of the twig colour)
    If(k.greaterThan(2.0).and(k.lessThan(3.0)), () => {
      const summer = vcol.mul(tone);
      const leaf = autumnLeaf(summer, rnd, clump);
      const has = leafStays(clump);
      const twig = TWIG.mul(fine.mul(0.5).add(1.0));
      const bare = fine.greaterThan(0.5);
      const c = select(has, leaf, twig);
      const a = select(has, float(1.0), select(bare, float(1.0), float(0.0)));
      out.assign(vec4(snowOver(c, wp.xz, up.mul(select(has, float(0.7), float(0.35)))), a));
    });
    // 3 lawn: the season's grass; none where snow lies
    If(k.greaterThan(3.0).and(k.lessThan(4.0)), () => {
      const g = seasonalGrass(vcol.mul(fine.mul(0.2).add(0.9)));
      out.assign(vec4(g, float(1.0).sub(smoothstep(0.0, 0.1, U.uSnow))));
    });
    // 4 bed: mulch; in the growing season perennials (green) and flowers (dots), then snow
    If(k.greaterThan(4.0).and(k.lessThan(5.0)), () => {
      const cell = wp.xz.mul(5.5);
      const id = floor(cell);
      const r = hash2(id), r2 = hash2(id.add(vec2(7.3, 1.9)));
      const d = fract(cell).sub(0.5).length();
      const grow = U.uLeaf.mul(float(1.0).sub(smoothstep(0.35, 0.9, U.uAutumn))).mul(float(1.0).sub(smoothstep(0.0, 0.3, U.uSnow)));
      const blob = step(d, r.mul(0.2).add(0.1)).mul(step(r2, 0.55)); // (a plant in about half the cells)
      const flower = step(0.55, r2).mul(step(r, 0.45)).mul(step(d, 0.13)); // (a flower in some of the others)
      const pick = hash2(id.add(vec2(3.1, 9.7)));
      const petals = select(pick.lessThan(0.25), color(0xd9608c), select(pick.lessThan(0.5), color(0xc0302f), select(pick.lessThan(0.75), color(0x7a4fb0), color(0xeee8dc))));
      const mulch = vcol.mul(fine.mul(0.3).add(0.85));
      const withPlants = mix(mulch, color(0x4e7a3a).mul(r.mul(0.4).add(0.8)), blob.mul(grow));
      const withFlowers = mix(withPlants, petals, flower.mul(grow));
      out.assign(vec4(snowOver(withFlowers, wp.xz, float(1.0)), 1.0));
    });
    // 5 iron bars, 6 pickets, 7 chain-link: one alpha-tested strip
    If(k.greaterThan(5.0), () => {
      const s = aux.x, t = aux.y;
      const iron = k.lessThan(6.0), picket = k.greaterThan(6.0).and(k.lessThan(7.0));
      const pitch = select(iron, float(0.13), float(0.14));
      const x = fract(s.div(pitch));
      const half = select(iron, float(0.085), float(0.33)); // (a bar's or a board's half width in pitches)
      const bars = step(abs(x.sub(0.5)), half);
      const u1 = fract(s.add(t).div(0.075)), u2 = fract(s.sub(t).div(0.075));
      const mesh = max(step(0.9, u1), step(0.9, u2));
      const cover = select(iron, float(0.17), select(picket, float(0.66), float(0.2))); // (the share of the strip a bar or a board covers)
      const hit = select(iron.or(picket), bars, mesh);
      // (thinner than a pixel the bars would shimmer: a stippled share of the strip stands in, by the same hash on the world position)
      const px = fwidth(s.div(pitch));
      const far = smoothstep(0.3, 0.8, px);
      const stip = step(hash3(floor(wp.mul(40.0))), cover);
      const a = mix(hit, stip, far);
      const c = vcol.mul(fine.mul(0.1).add(0.95));
      out.assign(vec4(snowOver(c, wp.xz, float(0.0)), a));
    });
    return out;
  });
  const node = shaded();
  mat.colorNode = node.xyz;
  mat.opacityNode = node.w;
  mat.name = 'FrontYards';
  return mat;
}

window.CITY.createFrontYardMaterial = createFrontYardMaterial;
})();
