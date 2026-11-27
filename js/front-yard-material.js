(function () {
// js/front-yard-material.js (jf-ugq, jf-aru; docs/front-yards.md): the one material every front-yard shape is drawn with (js/front-yards.js writes the triangles; js/buildings.js puts
// them in a mesh a 125 m sub-cell and shows it within 250 m of the camera). The page's season (tsl-materials.js cityUniforms: uLeaf, uAutumn, uSpring, uDormant, uSnow) decides
// what each kind looks like, so a date change is uniform writes only:
//   0 solid       stone and brick walls, piers, rails, the walk and drive: snow on what faces up
//   1 evergreen   cedar, yew and boxwood hedges and clipped shrubs: green all year, lighter new growth in spring and summer, a snow cap in winter. Leafy: the body's
//                 silhouette breaks up into leaf-sized bites where it turns away from the eye (alpha-cut, so a hedge is not a box)
//   2 deciduous   privet, lilac, a flowering shrub: summer green, autumn's colours, then bare: a sparse mesh of thin twigs (a cut-out), see-through
//   3 lawn        a front lawn, the plot ground's own grass (the same colour function as js/tsl-materials.js createPlotGroundMaterial), a ragged soft edge, gone under snow
//   4 bed         mulch with a ragged soft edge; flower dots in spring and summer, snow in winter
//   5 iron, 6 picket, 7 chain-link   an alpha-tested strip of bars, boards or mesh (one quad a run); thinner than a pixel it becomes a stippled share of itself
//   8 leaf card   a card of leaf discs (a fringe of a hedge or shrub, the crown of a small tree), evergreen: 9 the same, deciduous (bare in winter)
//   10 twig       a thin stem of a shrub or a branch of a small tree: bark, no snow
//   11 needle card  a tapering fan of needles (a dwarf conifer's whorl)
//   12 boulder    a rough rock at the curb (grey granite, reddish sandstone) with a snow cap in winter (jf-qw7)
// Vertex attributes: position, normal, color (linear rgb), uv = (kind, random 0..1), aux = (metres along the run, height over its foot). Cards: aux = the card's own (s, t) 0..1.
// A lawn or bed rectangle: aux = the metres from its centre, color = (half width, half depth, tone 0..1).

const { THREE } = window.CITY;
const { Fn, float, vec2, vec3, vec4, color, attribute, floor, fract, smoothstep, mix, select, abs, step, sin, dot, max, min, clamp, length, normalize, cameraPosition, positionWorld, normalWorldGeometry, fwidth, If, mx_noise_float } = window.CITY.TSL;

const hash3 = Fn(([p]) => fract(sin(dot(vec3(p), vec3(12.9898, 78.233, 37.719))).mul(43758.5453)));
const hash2 = Fn(([p]) => fract(sin(dot(vec2(p), vec2(127.1, 311.7))).mul(43758.5453)));
const n3 = (p) => clamp(mx_noise_float(p).mul(0.9).add(0.5), 0.0, 1.0); // (0..1, smooth; the raw noise sits within about +-0.5 of 0, so it is stretched)

function createFrontYardMaterial() {
  const U = window.CITY.cityUniforms;
  const { snowOver, autumnLeaf, leafStays, seasonalGrass, fbm2 } = window.CITY;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
  mat.alphaTest = 0.5;
  const kindUv = attribute('uv', 'vec2'), aux = attribute('aux', 'vec2'), vcol = attribute('color', 'vec3');
  const kind = kindUv.x, rnd = kindUv.y;
  const TWIG = color(0x7a6a58);

  // the thin-twig lattice of a bare deciduous mass: three families of curved lines in 3D (planes of a warped wave) with dropouts, so a shell is mostly sky and a few dark
  // lines. `pf` is the metres a pixel covers: the lines never get thinner than about a pixel, so far away they thicken into a hazy mass instead of shimmering
  const twigs = Fn(([wp, pf, seed]) => {
    const q = wp.add(vec3(n3(wp.mul(1.7).add(1.3)), n3(wp.mul(1.7).add(7.1)), n3(wp.mul(1.7).add(3.9))).sub(0.5).mul(0.3)).add(seed.mul(13.0));
    const freq = float(5.0);
    const clump = step(0.4, n3(wp.mul(2.3).add(seed.mul(5.0)))); // (twigs grow in clumps: the rest of the shell is open sky)
    const wid = max(float(0.006), pf.mul(0.5)).mul(freq); // (a line's half width in phases)
    const fam = (d, off) => {
      const ph = dot(q, d).mul(freq).add(off);
      const cell = floor(ph);
      const on = step(hash2(vec2(cell, off.add(seed.mul(7.0)))), 0.42).mul(clump);
      return step(abs(fract(ph).sub(0.5)), wid).mul(on);
    };
    return max(max(fam(vec3(0.83, 0.4, 0.38), float(0.0)), fam(vec3(-0.3, 0.9, 0.31), float(3.7))), fam(vec3(0.45, -0.35, 0.82), float(8.1)));
  });

  const shaded = Fn(() => {
    const wp = positionWorld;
    const pf = length(fwidth(wp)); // (metres a pixel covers here)
    const up = smoothstep(0.45, 0.8, normalWorldGeometry.y); // (1 on what faces up)
    const fine = hash3(floor(wp.mul(16.0)).add(rnd.mul(5.0))); // (grain of the solid kinds)
    const out = vec4(vcol, 1.0).toVar();
    const k = kind.add(0.5);
    const grad = mix(float(0.78), float(1.0), smoothstep(0.0, 1.3, aux.y)); // (darker toward a body's foot)
    const grow = U.uSpring.mul(0.9).add(U.uLeaf.mul(float(1.0).sub(U.uAutumn)).mul(float(1.0).sub(U.uDormant)).mul(0.5)); // (new growth: spring and summer)

    // 0 solid: the colour with a little grain; snow on what faces up
    If(k.lessThan(1.0), () => {
      const c = vcol.mul(fine.mul(0.16).add(0.92));
      out.assign(vec4(snowOver(c, wp.xz, up.mul(0.95)), 1.0));
    });

    // 1 evergreen and 2 deciduous bodies, 8 and 9 their leaf cards: leaf-sized speckle (fading to a smooth tone where a leaf is under a pixel), lighter new growth, dark gaps
    const isBody = k.greaterThan(1.0).and(k.lessThan(3.0));
    const isCard = k.greaterThan(8.0).and(k.lessThan(10.0));
    If(isBody.or(isCard), () => {
      const evergreen = k.lessThan(2.0).or(k.lessThan(9.0).and(k.greaterThan(8.0)));
      const gn = n3(wp.mul(2.6).add(rnd.mul(31.0)));
      const mid = n3(wp.mul(8.5).add(rnd.mul(7.0)));
      const fn = n3(wp.mul(24.0).add(3.3));
      const fadeMid = float(1.0).sub(smoothstep(0.05, 0.12, pf)), fadeFine = float(1.0).sub(smoothstep(0.014, 0.04, pf));
      const leaf = mix(float(0.5), mid, fadeMid).mul(0.55).add(mix(float(0.5), fn, fadeFine).mul(0.45)); // (0..1, mean 0.5)
      const lum = leaf.mul(1.7).add(0.15).mul(gn.mul(0.45).add(0.78));
      const tone = lum.mul(grad);
      const base = vcol.mul(tone);
      const tip = smoothstep(0.58, 0.78, mid.mul(fadeMid).add(float(0.5).mul(float(1.0).sub(fadeMid)))).mul(up.mul(0.6).add(0.4)).mul(grow); // (a light, new tuft)
      const lit = mix(base, base.mul(vec3(1.5, 1.7, 0.85)), tip);
      const patch = n3(wp.mul(3.5).add(rnd.mul(9.0))); // (a patch of the mass: it turns, and drops its leaves, together)
      const has = select(evergreen, float(1.0), select(leafStays(patch), float(1.0), float(0.0)));
      // alpha: a body breaks into leaf-sized bites where it turns away from the eye; a card is a cluster of leaf discs inside an oval
      const ndv = abs(dot(normalize(normalWorldGeometry), normalize(cameraPosition.sub(wp))));
      const edge = smoothstep(0.0, 0.22, ndv);
      const bodyA = step(leaf, edge.mul(1.15));
      const cell = aux.mul(4.0), id = floor(cell), lc = fract(cell).sub(0.5);
      const jit = vec2(hash2(id), hash2(id.add(vec2(5.3, 1.7)))).sub(0.5).mul(0.5);
      const disc = step(length(lc.sub(jit)), hash2(id.add(vec2(2.1, 8.3))).mul(0.14).add(0.34));
      const oval = step(length(aux.sub(0.5).mul(2.0)), 1.0);
      const stip = step(hash3(floor(wp.mul(48.0))), 0.6);
      const cardA = mix(disc.mul(oval), stip.mul(oval), smoothstep(0.03, 0.08, pf));
      const leafA = select(isCard, cardA, bodyA);
      const turned = autumnLeaf(lit, rnd, patch);
      const c = select(evergreen, lit, turned);
      const snowAmt = select(evergreen, up.mul(2.0), up.mul(0.7));
      If(has.greaterThan(0.5), () => {
        out.assign(vec4(snowOver(c, wp.xz, snowAmt), leafA));
      }).Else(() => {
        // bare: the twig lattice (a card has no twigs of its own: its stem is a twig kind)
        const twig = TWIG.mul(fn.mul(0.5).add(0.75));
        out.assign(vec4(snowOver(twig, wp.xz, up.mul(0.3)), select(isCard, float(0.0), twigs(wp, pf, rnd))));
      });
    });

    // 3 lawn: the plot ground's grass (the same function), a ragged soft edge, none where snow lies
    If(k.greaterThan(3.0).and(k.lessThan(4.0)), () => {
      const d = min(vcol.x.sub(abs(aux.x)), vcol.y.sub(abs(aux.y))); // (metres in from the rectangle's edge)
      const ragged = n3(vec3(wp.x.mul(1.9), wp.z.mul(1.9), rnd.mul(11.0))).sub(0.5).mul(1.3).add(n3(wp.mul(7.0)).sub(0.5).mul(0.35));
      const inside = smoothstep(0.0, 0.8, d.add(ragged));
      const p = wp.xz;
      const grass = mix(color(0x4f7a2c), color(0x6f8a38), fbm2(p.mul(0.031).add(5.0)));
      const g = seasonalGrass(grass.mul(n3(wp.mul(2.4)).mul(0.1).add(0.95)));
      out.assign(vec4(g, inside.mul(float(1.0).sub(smoothstep(0.0, 0.1, U.uSnow)))));
    });

    // 4 bed: mulch with a ragged edge; in the growing season perennials (green) and flowers (dots), then snow
    If(k.greaterThan(4.0).and(k.lessThan(5.0)), () => {
      const cell = wp.xz.mul(5.5);
      const id = floor(cell);
      const r = hash2(id), r2 = hash2(id.add(vec2(7.3, 1.9)));
      const d = fract(cell).sub(0.5).length();
      const grow2 = U.uLeaf.mul(float(1.0).sub(smoothstep(0.35, 0.9, U.uAutumn))).mul(float(1.0).sub(smoothstep(0.0, 0.3, U.uSnow)));
      const blob = step(d, r.mul(0.2).add(0.1)).mul(step(r2, 0.55)); // (a plant in about half the cells)
      const flower = step(0.55, r2).mul(step(r, 0.45)).mul(step(d, 0.13)); // (a flower in some of the others)
      const pick = hash2(id.add(vec2(3.1, 9.7)));
      const petals = select(pick.lessThan(0.25), color(0xd9608c), select(pick.lessThan(0.5), color(0xc0302f), select(pick.lessThan(0.75), color(0x7a4fb0), color(0xeee8dc))));
      const chips = n3(wp.mul(11.0)).mul(0.5).add(hash3(floor(wp.mul(30.0))).mul(0.5)); // (bark chips)
      const mulch = mix(color(0x4a3626), color(0x5e4631), vcol.z).mul(chips.mul(0.5).add(0.78));
      const withPlants = mix(mulch, color(0x4e7a3a).mul(r.mul(0.4).add(0.8)), blob.mul(grow2));
      const withFlowers = mix(withPlants, petals, flower.mul(grow2));
      const dd = min(vcol.x.sub(abs(aux.x)), vcol.y.sub(abs(aux.y)));
      const ragged = n3(vec3(wp.x.mul(2.3), wp.z.mul(2.3), rnd.mul(5.0))).sub(0.5).mul(0.9);
      const inside = smoothstep(0.0, 0.3, dd.add(ragged));
      out.assign(vec4(snowOver(withFlowers, wp.xz, float(1.0)), inside));
    });

    // 5 iron bars, 6 pickets, 7 chain-link: one alpha-tested strip
    If(k.greaterThan(5.0).and(k.lessThan(8.0)), () => {
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

    // 10 twig: bark
    If(k.greaterThan(10.0).and(k.lessThan(11.0)), () => {
      out.assign(vec4(vcol.mul(fine.mul(0.3).add(0.85)), 1.0));
    });

    // 12 boulder (jf-qw7): a flat-shaded rock, grey granite or reddish sandstone by its vertex colour, speckled and streaked, snow on its top in winter
    If(k.greaterThan(12.0).and(k.lessThan(13.0)), () => {
      const g1 = n3(wp.mul(7.0).add(rnd.mul(17.0))), g2 = n3(wp.mul(26.0).add(2.7)), spk = hash3(floor(wp.mul(55.0)));
      const streak = n3(vec3(wp.x.mul(2.0), wp.y.mul(9.0), wp.z.mul(2.0)).add(rnd.mul(9.0)));
      const tone = g1.mul(0.35).add(g2.mul(0.25)).add(streak.mul(0.2)).add(0.62).add(spk.sub(0.5).mul(0.1));
      out.assign(vec4(snowOver(vcol.mul(tone), wp.xz, up.mul(1.7)), 1.0));
    });

    // 11 needle card: a tapering fan of needles, dark blue-green, a snow cap in winter
    If(k.greaterThan(11.0).and(k.lessThan(12.0)), () => {
      const taper = step(abs(aux.x.sub(0.5)).mul(2.0), float(1.0).sub(aux.y.mul(0.85)));
      const needles = step(abs(fract(aux.x.mul(15.0)).sub(0.5)), float(0.3).add(aux.y.mul(0.15)).add(hash2(vec2(floor(aux.x.mul(15.0)), rnd.mul(19.0))).mul(0.12)));
      const stip = step(hash3(floor(wp.mul(48.0))), 0.6);
      const a = mix(taper.mul(needles), stip.mul(taper), smoothstep(0.03, 0.08, pf));
      const tone = n3(wp.mul(9.0)).mul(0.5).add(0.75).mul(mix(float(0.8), float(1.0), aux.y));
      const lit = vcol.mul(tone);
      out.assign(vec4(snowOver(lit, wp.xz, up.mul(1.6)), a));
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
