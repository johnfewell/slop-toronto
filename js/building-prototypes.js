// js/building-prototypes.js — the building prototype catalogue (st-ndw9.10, docs/building-prototypes-spec.md §7.9).
// Plain data, no three.js: one entry per preset, houses first, plus the outbuilding `garage` (not in the spec's table)
// and a `fallback` (today's look) for any building the assignment rules cannot place. The assignment script
// tools/build-building-presets.mjs reads it; the page imports it only under ?presets (js/main.js), so the default page
// and ?massing=1 alone never fetch it. A preset that is drawn (?massing=1&presets=draw, js/building-draw.js) also
// carries its drawing parameters, `draw` (DRAW below: storeys by facade variant, palettes, roof, parts, each with a
// range and a probability); every other preset has `draw: null` and keeps today's look.
//
// Exports: PROTOTYPES (the list, in catalogue order), byId (id -> entry), FALLBACK_ID, ERAS (era key -> period), the
// family hue table, DRAW, FACADE_VARIANTS and presetOf(id). A prototype entry is:
//   { id, name, family, era, color, draw }   era null where the type has no period; color a 0xRRGGBB debug colour.

export const ERAS = [
  { key: 'victorian', name: 'Victorian', years: 'before 1900', from: null, to: 1899 },
  { key: 'edwardian', name: 'Edwardian', years: '1900 to 1919', from: 1900, to: 1919 },
  { key: 'interwar', name: 'Interwar', years: '1920 to 1939', from: 1920, to: 1939 },
  { key: 'postwar', name: 'Postwar', years: '1940 to 1979', from: 1940, to: 1979 },
  { key: 'recent', name: 'Recent', years: '1980 on', from: 1980, to: null }
];

// The era of a construction year, or null.
export function eraOfYear(year) {
  if (year == null || !Number.isFinite(year)) return null;
  for (const e of ERAS) if ((e.from == null || year >= e.from) && (e.to == null || year <= e.to)) return e.key;
  return null;
}

// One hue family per building family; the debug view's colour is that family's band, a preset's own hue inside it,
// and a lightness by era (older darker), so a street of Victorian semis next to Edwardian ones can be told apart and
// two presets of one family (a slab tower beside a glass one) are still different. `HUE_SPREAD` is the band's half
// width in degrees; a preset with no era takes DEFAULT_LIGHT.
export const FAMILY_HUES = {
  house: 22, garage: 50, 'main-street': 5, apartment: 280, tower: 210,
  office: 175, industrial: 120, civic: 90, worship: 320, fallback: 0
};
export const ERA_LIGHT = { victorian: 0.27, edwardian: 0.39, interwar: 0.51, postwar: 0.63, recent: 0.75 };
const DEFAULT_LIGHT = 0.52;
const SATURATION = 0.7;
const HUE_SPREAD = 16;

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round((v + m) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

/** The debug colour of a preset: its family's hue band (offset inside it), at a lightness by era (older darker). */
export function debugColor(family, era, hueOffset = 0) {
  const base = FAMILY_HUES[family] ?? FAMILY_HUES.fallback;
  const sat = family === 'fallback' ? 0 : SATURATION;
  return hslToHex((base + hueOffset + 360) % 360, sat, era ? ERA_LIGHT[era] : DEFAULT_LIGHT);
}

// The catalogue, in order: houses first (the largest family), then garage, then the blocks, offices, civic, worship
// and industry. `color` is computed from the family hue and era (debugColor above), so the palette is one rule.
const DEF = [
  // --- House, detached ---
  ['victorian-detached', 'Victorian detached house', 'house', 'victorian'],
  ['edwardian-detached', 'Edwardian detached house', 'house', 'edwardian'],
  ['interwar-detached', 'Interwar detached house', 'house', 'interwar'],
  ['postwar-detached', 'Postwar detached house', 'house', 'postwar'],
  ['recent-detached', 'Recent detached house', 'house', 'recent'],
  // --- House, semi ---
  ['victorian-semi', 'Victorian bay-and-gable semi', 'house', 'victorian'],
  ['edwardian-semi', 'Edwardian semi', 'house', 'edwardian'],
  ['interwar-semi', 'Interwar semi', 'house', 'interwar'],
  ['postwar-semi', 'Postwar semi', 'house', 'postwar'],
  ['recent-semi', 'Recent semi', 'house', 'recent'],
  // --- House, row ---
  ['victorian-row', 'Victorian row house', 'house', 'victorian'],
  ['edwardian-row', 'Edwardian row house', 'house', 'edwardian'],
  ['modern-townhouse-row', 'Modern townhouse row', 'house', 'recent'],
  // --- Outbuilding ---
  ['garage', 'Lane garage or outbuilding', 'garage', null],
  // --- Apartments ---
  ['walk-up-apartment', 'Interwar walk-up apartment', 'apartment', null],
  ['mid-rise-block', 'Mid-rise apartment block', 'apartment', null],
  ['slab-tower', 'Postwar slab tower', 'tower', null],
  ['glass-tower-podium', 'Glass condo tower on a podium', 'tower', null],
  // --- Business (office and commercial) ---
  ['low-masonry-block', 'Low masonry commercial block', 'office', null],
  ['dark-curtain-wall-tower', 'Dark curtain-wall office tower', 'tower', null],
  ['contemporary-glass', 'Contemporary glass office', 'office', null],
  // --- Untagged block ---
  ['main-street-shop-early', 'Victorian & Edwardian main-street shop', 'main-street', null],
  ['main-street-shop-later', 'Interwar-on main-street shop', 'main-street', null],
  ['plain-low-block', 'Plain low block', 'office', null],
  ['tower', 'Untagged tower', 'tower', null],
  // --- Civic ---
  ['school', 'School', 'civic', null],
  ['small-civic', 'Small civic building', 'civic', null],
  ['institutional-block', 'Institutional block', 'civic', null],
  // --- Worship (st-ndw9.16: six looks, assigned by religion, tradition, construction year and size); drawing them is
  // the next phase, so each has `draw: null` and the normal view is unchanged ---
  ['church-gothic', 'Gothic church with a tower', 'worship', null],
  ['church-chapel', 'Plain brick chapel', 'worship', null],
  ['church-modern', 'Modern church', 'worship', null],
  ['mosque', 'Mosque', 'worship', null],
  ['synagogue', 'Synagogue', 'worship', null],
  ['temple', 'Temple (Buddhist, Hindu or Sikh)', 'worship', null],
  // --- Industrial and sheds ---
  ['brick-warehouse', 'Brick warehouse', 'industrial', null],
  ['low-shed', 'Low shed', 'industrial', null],
  // --- Fallback (today's look) ---
  ['fallback', 'Unassigned (today\u2019s look)', 'fallback', null]
];

// ---- drawing parameters (st-ndw9.13) --------------------------------------------------------------------------------
// The facade styles the drawn presets add to the rendered-wall material (one vertex attribute names the style; no new
// material or draw call). Indices here are offsets from FIRST_DRAW_VARIANT (the two plain rendered styles are 0 and 1;
// the material takes up to 8). `floorHeight` is the storey: a drawn house's walls are a whole number of them, so the
// window rows land on the wall. Tall narrow windows for the Victorian, wide squarer ones (in pairs) for the Edwardian.
export const FIRST_DRAW_VARIANT = 2;
export const FACADE_VARIANTS = [
  { name: 'victorian-tall', windowWidth: 1.4, floorHeight: 3.4, windowRatioX: 0.62, windowRatioY: 0.56, litProbability: 0.42, warmth: 0.9, seed: 101.0, cornerPier: 0.12 },
  { name: 'victorian-tall-b', windowWidth: 1.5, floorHeight: 3.6, windowRatioX: 0.6, windowRatioY: 0.54, litProbability: 0.42, warmth: 0.9, seed: 103.0, cornerPier: 0.14 },
  { name: 'edwardian-pair', windowWidth: 2.7, floorHeight: 3.1, windowRatioX: 0.66, windowRatioY: 0.5, litProbability: 0.42, warmth: 0.86, seed: 107.0, cornerPier: 0.55 },
  { name: 'edwardian-wide', windowWidth: 2.4, floorHeight: 3.3, windowRatioX: 0.6, windowRatioY: 0.52, litProbability: 0.42, warmth: 0.86, seed: 109.0, cornerPier: 0.5 },
  // (st-ndw9.15) the early main-street shop's upper storeys: tall narrow windows in a close regular rhythm. Its storey (3.4),
  // seed (13.0) and corner pier (1.2) are the plain style 0's, so the shop fronts the page already draws on the ground
  // floor (createStorefront reads the storey, the seed and the wall's ends, not the window width) come out as before.
  { name: 'shop-early-tall', windowWidth: 1.5, floorHeight: 3.4, windowRatioX: 0.56, windowRatioY: 0.64, seed: 13.0, cornerPier: 1.2 },
  // the recent houses and townhouses: wide floor-to-ceiling glazing in a grey or black frame
  { name: 'modern-glazed', windowWidth: 3.2, floorHeight: 3.1, windowRatioX: 0.82, windowRatioY: 0.68, litProbability: 0.5, warmth: 0.7, seed: 113.0, cornerPier: 0.35 },
  // (st-ndw9.20) the apartments, the low blocks and the churches. The merged rendered material takes up to MAX_VARIANTS (16) styles: these
  // five make 13 (the two plain styles, the six houses' and the shop's, the five here). 6: the walk-up's punched windows; 7: the mid-rise's regular
  // grid; 8: the slab tower's wide ribbon windows between its balcony bands; 9: a podium's large glazed storeys; 10: a church's tall storeys
  // (one row of tall pointed windows to a storey of 5.5 m)
  { name: 'walkup-punched', windowWidth: 2.0, floorHeight: 3.1, windowRatioX: 0.5, windowRatioY: 0.56, litProbability: 0.42, warmth: 0.88, seed: 117.0, cornerPier: 0.8 },
  { name: 'midrise-regular', windowWidth: 2.5, floorHeight: 3.0, windowRatioX: 0.56, windowRatioY: 0.58, litProbability: 0.45, warmth: 0.8, seed: 119.0, cornerPier: 0.6 },
  { name: 'slab-ribbon', windowWidth: 3.4, floorHeight: 2.9, windowRatioX: 0.8, windowRatioY: 0.46, litProbability: 0.45, warmth: 0.8, seed: 121.0, cornerPier: 0.4 },
  { name: 'podium-glazed', windowWidth: 3.2, floorHeight: 4.2, windowRatioX: 0.74, windowRatioY: 0.62, litProbability: 0.5, warmth: 0.7, seed: 123.0, cornerPier: 0.5 },
  { name: 'church-tall', windowWidth: 1.9, floorHeight: 5.5, windowRatioX: 0.42, windowRatioY: 0.68, litProbability: 0.3, warmth: 0.95, seed: 127.0, cornerPier: 1.1 }
];
// (st-ndw9.20) the curtain-wall styles the drawn towers add to the merged curtain-wall material, after the page's three (blue-grey,
// dark and silver-blue: variants 0 to 2, 3.8 m storeys). The material shares its mullions and spandrels, so a style here is a
// glass, a frame, a window width, a storey and a seed only. CURTAIN_FLOORS lists the storey of every style, the page's three first.
export const CURTAIN_FIRST_EXTRA = 3;
export const CURTAIN_VARIANTS = [
  { name: 'dark-steel', glassTint: 0x161b1e, frameTint: 0x2d3133, windowWidth: 1.5, floorHeight: 3.9, litProbability: 0.5, warmth: 0.6, reflectivity: 0.9, seed: 131.0, boxLocal: true },
  { name: 'dark-bronze', glassTint: 0x211c18, frameTint: 0x4a4034, windowWidth: 1.5, floorHeight: 4.0, litProbability: 0.5, warmth: 0.6, reflectivity: 0.88, seed: 133.0, boxLocal: true },
  { name: 'light-office', glassTint: 0x5f7684, frameTint: 0xc9cdd0, windowWidth: 1.5, floorHeight: 3.7, litProbability: 0.5, warmth: 0.5, reflectivity: 0.9, seed: 137.0, boxLocal: true },
  { name: 'condo-blue', glassTint: 0x2e4559, frameTint: 0xdfe3e6, windowWidth: 1.8, floorHeight: 3.0, litProbability: 0.5, warmth: 0.55, reflectivity: 0.92, seed: 139.0, boxLocal: true },
  { name: 'condo-green', glassTint: 0x2d4a45, frameTint: 0xd8dcda, windowWidth: 1.8, floorHeight: 3.0, litProbability: 0.5, warmth: 0.5, reflectivity: 0.92, seed: 141.0, boxLocal: true }
];
export const CURTAIN_FLOORS = [3.8, 3.8, 3.8, ...CURTAIN_VARIANTS.map((v) => v.floorHeight)];

// Weighted colour tables are [hex, weight]; a range is [min, max]; a part's `p` is its probability. Every random
// choice a house makes comes from the hash of its building's durable id (js/building-draw.js), in a fixed order whatever
// the branches, so the same house is the same on every load and editing one preset moves no other.
const VICTORIAN_BRICK = [[0xa24a37, 34], [0x8e4333, 18], [0xb35c3e, 10], [0xcdb78c, 24], [0xbfa77a, 10], [0x7a3b30, 4]];
const EDWARDIAN_BRICK = [[0x8a4a3a, 30], [0x7a4538, 24], [0x9b5a41, 16], [0x6c3d33, 10], [0xb4673f, 8], [0xc0aa82, 6], [0x5f3b32, 6]];
// roofs, lighter and wider than before (weathered slate greys, brown and red-brown asphalt shingle, a little green) so the
// gables, hips and mansards tell apart from the air; one per preset, since a real street's roofs differ by house type
// the face of a front gable: painted shingle or board in a tone that contrasts with the brick below it
const GABLE_TONES = [[0xc8a45a, 4], [0x6f8a6a, 3], [0x5d6f80, 3], [0xd7c394, 4], [0x8a5a3c, 3], [0x4f6b58, 2], [0x9aa0a3, 2]];
const ROOF_SEMI = [[0x6f757b, 5], [0x858a8f, 4], [0x5d6368, 3], [0x7a5a46, 4], [0x8e5f4a, 3], [0x9a4d3d, 2], [0x587463, 2], [0xa09a8e, 2]];
const ROOF_EDW = [[0x7a5c48, 5], [0x6b4c3a, 4], [0x8a6a52, 3], [0x7c8185, 4], [0x666b70, 3], [0x8f4b3b, 3], [0x5f7a66, 1], [0x9a9488, 2]];
const ROOF_ROW = [[0x6a7075, 5], [0x80858a, 4], [0x555c62, 3], [0x7f5f4c, 3], [0x934f40, 3], [0x5a7566, 2], [0x9b958a, 2], [0x73706a, 3]];
// (st-ndw9.15) the later eras' walls and roofs
const INTERWAR_BRICK = [[0x7a4a38, 24], [0x8b5a42, 20], [0x6b3f32, 14], [0x9a6a4a, 12], [0xb08a62, 10], [0x5c4033, 10], [0xa5543f, 10]];
const POSTWAR_WALL = [[0xc9b48a, 26], [0xd6c8a8, 18], [0xb9a37a, 12], [0xcdbfa4, 10], [0x9a5c45, 14], [0xe0dccf, 10], [0x8f9a8e, 5], [0xb0a898, 5]];
const RECENT_WALL = [[0x3a3b3e, 24], [0x2c2e31, 16], [0x53555a, 14], [0x6a4a3d, 14], [0x8a8d90, 12], [0xe4e2dc, 10], [0x1f2023, 10]];
const SHOP_BRICK = [[0xa24a37, 30], [0x8e4333, 20], [0xb35c3e, 10], [0xcdb78c, 16], [0xbfa77a, 8], [0x7a3b30, 8], [0x6c3d33, 8]];
const ROOF_INT = [[0x7a6454, 5], [0x6e7276, 4], [0x8a4b3c, 3], [0x58745f, 2], [0x8a8d8f, 3], [0x8f7b66, 2]];
const ROOF_POST = [[0x80858a, 5], [0x6a6e72, 4], [0x8f7b66, 3], [0x7a6552, 3], [0x9a9da0, 2]];
// tar and gravel: a flat roof, or a rear wing's, of a drawn building (js/building-draw.js draws it as a slab in the roof batch)
export const ROOF_TAR = [[0xa6a298, 4], [0xaeb3a2, 4], [0x96938a, 3], [0xb4b0a6, 3], [0xc4c0b6, 2], [0xd8dad4, 1], [0x8e9890, 2], [0xada08e, 2]];
const ROOF_FLAT = ROOF_TAR;
const TRIM_LIGHT = [[0xe9e0c8, 5], [0xf0ede4, 4], [0xd7cdb4, 2], [0x4a3426, 1]];
const TRIM_DARK = [[0x1f2023, 5], [0x3a3b3e, 3], [0xe4e2dc, 3], [0x8a8d90, 2]];
// (st-ndw9.20) walls of the apartments, offices and low blocks
const WALKUP_BRICK = [[0x8a4a3a, 26], [0x9b5a41, 18], [0x7a4538, 14], [0xb4673f, 8], [0xc0aa82, 16], [0xb08a62, 10], [0x6c3d33, 8]];
const MIDRISE_WALL = [[0x9b5a41, 16], [0x8a4a3a, 14], [0xc9b48a, 16], [0xd6c8a8, 14], [0xb0a898, 14], [0xcfcac0, 12], [0x9a9690, 8], [0xe0dccf, 6]];
const SLAB_WALL = [[0xb7b3aa, 22], [0xa9a59c, 14], [0xc9c4b8, 12], [0x9b5a41, 14], [0xa86a48, 10], [0xb5a07a, 10], [0x8a4a3a, 8], [0xd8d2c2, 10]];
const PODIUM_WALL = [[0x8a4a3a, 14], [0xb7b3aa, 20], [0x6f7478, 16], [0x3a3b3e, 10], [0xc9b48a, 10], [0x9a9690, 12], [0x7a5a46, 8]];
const LOW_MASONRY = [[0xa24a37, 24], [0x8e4333, 14], [0xcdb78c, 14], [0xbfa77a, 10], [0x7a3b30, 10], [0x9b5a41, 10], [0xb0a898, 8], [0x8f8a82, 10]];
const PLAIN_LOW = [[0xa24a37, 16], [0xcdb78c, 14], [0xb0a898, 18], [0x9a9690, 14], [0xd6c8a8, 12], [0xe0dccf, 10], [0x8e4333, 8], [0x8f8a82, 8]];
// (st-ndw9.20) the churches' and the other places of worship's walls
const GOTHIC_STONE = [[0x9a968c, 22], [0xa8a294, 16], [0x8a8780, 14], [0xb5a88a, 14], [0x6f6a62, 6], [0xc2b79a, 10]];
const GOTHIC_BRICK = [[0x9b5a41, 24], [0x8a4a3a, 20], [0xa24a37, 14], [0x7a4538, 12], [0xb4673f, 10], [0xc0aa82, 6]];
const CHAPEL_BRICK = [[0xa24a37, 22], [0x8a4a3a, 20], [0xb35c3e, 10], [0xc0aa82, 12], [0xcdb78c, 10], [0x7a4538, 10]];
const MODERN_WALL = [[0xc9b48a, 20], [0xd6c8a8, 16], [0xb7b3aa, 18], [0x8a4a3a, 10], [0xe0dccf, 14], [0x9a9690, 10], [0x6a4a3d, 8]];
const MOSQUE_WALL = [[0xe2dccf, 24], [0xd6c8a8, 18], [0xcdbfa4, 14], [0xd9d2c0, 14], [0xb7b3aa, 10]];
const SYN_WALL = [[0xa24a37, 20], [0xcdb78c, 16], [0xb0a898, 12], [0xc2b79a, 12], [0x8a4a3a, 14]];
const TEMPLE_WALL = [[0xe2dccf, 20], [0xd6c8a8, 14], [0xc9b48a, 10], [0xb7403a, 6], [0xe4d9bd, 12], [0xcdbfa4, 10]];
const TIMBER_FACE = [[0xe4d9bd, 5], [0xd9cdb0, 3], [0xcbbf9f, 2]];
// (st-ndw9.18) the fascia boards of a drawn shop: the board colours, and the ink of a name plate on them, of the page's own sign styles
// (js/storefront-signs.js STYLES: fascia, fasciaSerif, lightbox, colour), as [board, ink, weight]; no lettering is drawn, so no name is invented
export const SHOP_SIGN_BOARDS = [
  [0x1d1d1f, 0xe8d9a8, 1], [0x23302b, 0xf2efe6, 2], [0x2a2f3a, 0xf2efe6, 1], [0x3b2a24, 0xe8d9a8, 2],
  [0x20372c, 0xd9b863, 3], [0x4a1c1c, 0xefe6cc, 3], [0x233147, 0xd9b863, 3],
  [0xf3f1ea, 0x8f1f1f, 4], [0xfbfaf6, 0x1e3a6b, 4], [0xf5e9c9, 0x1d1d1d, 3],
  [0x8c2a22, 0xfaf7f0, 4], [0x1f5a5a, 0xfaf7f0, 4], [0xb8862b, 0xfaf7f0, 4], [0x2f5d3a, 0xfaf7f0, 3], [0x5d2a6e, 0xfaf7f0, 2]
];
export const SHOP_SIGN = { boardH: 0.55, top: 0.12, unit: 7.5 }; // (m: the fascia board's height and its gap under the floor above, one storefront a unit of frontage: tsl-materials.js createStorefront)
export const DRAW = {
  // the Toronto bay-and-gable semi: two mirrored halves, a steep front gable over each, a two-storey bay under it
  'victorian-semi': {
    kind: 'semi', storeys: 2, variants: [0, 1], fillMin: 0.8,
    wall: VICTORIAN_BRICK,
    trim: [[0xe9e0c8, 5], [0xf0ede4, 2], [0x2f4a3c, 2], [0x4a3426, 1], [0xc8a45a, 1]],
    roof: { forms: [['frontGable', 1]], pitch: [45, 55], eave: [0.3, 0.42], colors: ROOF_SEMI, patch: 0.12 },
    parts: { windowTrim: { sill: true, lintel: true },
      bay: { p: 0.96, width: [2.2, 2.8], depth: [0.75, 1.0], cant: [0.4, 0.5], roof: [0.9, 1.3], minRoad: 6.5 },
      bargeboard: { p: 0.9, width: [0.2, 0.3] },
      gableAccent: { p: 0.85 }, gableBands: 5, gableTones: GABLE_TONES,
      atticWindow: { p: 0.9, width: [0.7, 0.9], height: [0.95, 1.3] }
    }
  },
  // the Edwardian detached house: squarer, a hip or a front gable of moderate pitch, a full-width porch on brick piers
  'edwardian-detached': {
    kind: 'detached', storeys: 2, variants: [2, 3], fillMin: 0.8,
    wall: EDWARDIAN_BRICK,
    trim: [[0xe9e0c8, 6], [0xf0ede4, 4], [0x3b4a3a, 1], [0x4a3426, 1]],
    roof: { forms: [['hip', 0.6], ['frontGable', 0.4]], pitch: [28, 36], eave: [0.5, 0.7], colors: ROOF_EDW, patch: 0.12 },
    parts: { windowTrim: { sill: true, lintel: true },
      porch: { p: 0.85, depth: [1.9, 2.4], slab: [2.5, 2.75], pier: [0.42, 0.52], minRoad: 8.0, columns: true },
      dormer: { p: 0.5, width: [1.5, 2.0], wall: [1.0, 1.3] },
      bargeboard: { p: 0.5, width: [0.16, 0.22] }
    }
  },
  // the Victorian row: a run of narrow houses under one cornice line and one roof, mansard with dormers or small gables
  'victorian-row': {
    kind: 'row', storeys: 2, variants: [0, 1], fillMin: 0.78,
    wall: VICTORIAN_BRICK,
    trim: [[0xe9e0c8, 5], [0xf0ede4, 2], [0x2f4a3c, 2], [0x4a3426, 1]],
    roof: { forms: [['mansard', 0.4], ['frontGable', 0.6]], pitch: [38, 46], eave: [0.22, 0.32], colors: ROOF_ROW, patch: 0.1, ridge: [2.5, 3.1],
      mansard: { steep: [66, 72], deck: [14, 20], rise: [2.0, 2.5], deckRise: [0.5, 0.7] } },
    parts: { windowTrim: { sill: true, lintel: true },
      bay: { p: 0.5, width: [2.0, 2.5], depth: [0.6, 0.85], cant: [0.35, 0.45], roof: [0.5, 0.8], minRoad: 6.5 },
      bargeboard: { p: 0.8, width: [0.16, 0.24] },
      gableAccent: { p: 0.7 }, gableBands: 4, gableTones: GABLE_TONES,
      atticWindow: { p: 0.85, width: [0.6, 0.8], height: [0.8, 1.1] },
      dormer: { p: 1, width: [0.9, 1.1], wall: [1.0, 1.2] }
    }
  }
  ,
  // ---- the rest of the houses (st-ndw9.15) ----
  // a Victorian house standing alone: one half of a bay-and-gable, or a wider villa under a hip
  'victorian-detached': {
    kind: 'detached', storeys: 2, variants: [0, 1], fillMin: 0.8,
    wall: VICTORIAN_BRICK,
    trim: [[0xe9e0c8, 5], [0xf0ede4, 2], [0x2f4a3c, 2], [0x4a3426, 1], [0xc8a45a, 1]],
    roof: { forms: [['frontGable', 0.78], ['hip', 0.22]], pitch: [45, 55], eave: [0.3, 0.42], colors: ROOF_SEMI, patch: 0.12 },
    parts: { windowTrim: { sill: true, lintel: true },
      bay: { p: 0.72, width: [2.2, 2.8], depth: [0.75, 1.0], cant: [0.4, 0.5], roof: [0.9, 1.3], minRoad: 6.5 },
      bargeboard: { p: 0.9, width: [0.2, 0.3] },
      gableAccent: { p: 0.8 }, gableBands: 5, gableTones: GABLE_TONES,
      atticWindow: { p: 0.9, width: [0.7, 0.9], height: [0.95, 1.3] },
      dormer: { p: 0.5, width: [1.4, 1.8], wall: [1.0, 1.3] }
    }
  },
  // the Edwardian pair: squarer, one hip over both halves (or a side gable with a dormer each), a shared full-width porch
  'edwardian-semi': {
    kind: 'semi', storeys: 2, variants: [2, 3], fillMin: 0.8,
    wall: EDWARDIAN_BRICK,
    trim: [[0xe9e0c8, 6], [0xf0ede4, 4], [0x3b4a3a, 1], [0x4a3426, 1]],
    roof: { forms: [['hip', 0.55], ['sideGable', 0.3], ['frontGable', 0.15]], pitch: [28, 36], eave: [0.5, 0.7], colors: ROOF_EDW, patch: 0.12 },
    parts: { windowTrim: { sill: true, lintel: true },
      porch: { p: 0.8, depth: [1.9, 2.4], slab: [2.5, 2.75], pier: [0.42, 0.52], minRoad: 8.0, roof: true, columns: true },
      dormer: { p: 0.55, width: [1.4, 1.9], wall: [1.0, 1.3] },
      bargeboard: { p: 0.5, width: [0.16, 0.22] }
    }
  },
  // the Edwardian run: one roof along the whole row (a side gable or a flat roof behind a parapet), a porch the full width
  'edwardian-row': {
    kind: 'row', storeys: 2, variants: [2, 3], fillMin: 0.78,
    wall: EDWARDIAN_BRICK,
    trim: [[0xe9e0c8, 6], [0xf0ede4, 4], [0x3b4a3a, 1], [0x4a3426, 1]],
    roof: { forms: [['sideGable', 0.42], ['flat', 0.33], ['mansard', 0.25]], pitch: [28, 34], eave: [0.45, 0.6], colors: ROOF_ROW, patch: 0.08, parapet: [0.45, 0.7], ridge: [2.2, 2.7],
      mansard: { steep: [64, 70], deck: [12, 18], rise: [1.9, 2.3], deckRise: [0.45, 0.6] } },
    parts: { windowTrim: { sill: true, lintel: true },
      porch: { p: 0.8, depth: [1.8, 2.2], slab: [2.5, 2.75], pier: [0.4, 0.5], minRoad: 7.5, roof: true, columns: true },
      bay: { p: 0.3, width: [2.0, 2.5], depth: [0.6, 0.8], cant: [0.35, 0.45], roof: [0.5, 0.8], minRoad: 6.5 },
      dormer: { p: 0.6, width: [1.0, 1.3], wall: [1.0, 1.2] }, cornice: { depth: [0.25, 0.35], height: [0.4, 0.55] }
    }
  },
  // 1920s and 30s: lower and broader, brown and red brick, steeper cross gables, half-timbered gable ends, a small vestibule
  'interwar-detached': {
    kind: 'detached', storeys: [[2, 0.58], [1, 0.42]], variants: [3], fillMin: 0.8,
    wall: INTERWAR_BRICK,
    trim: TIMBER_FACE.concat([[0xe9e0c8, 2]]),
    roof: { forms: [['crossGable', 0.5], ['sideGable', 0.28], ['hip', 0.22]], pitch: [38, 50], eave: [0.35, 0.55], colors: ROOF_INT, patch: 0.1 },
    parts: { windowTrim: { sill: true, lintel: false },
      vestibule: { p: 0.7, width: [1.9, 2.4], depth: [1.0, 1.4], wall: [2.5, 2.8] },
      timber: { p: 0.35 }, gableAccent: { p: 0.0 },
      dormer: { p: 0.45, width: [1.3, 1.7], wall: [1.0, 1.2] },
      bargeboard: { p: 0.6, width: [0.14, 0.2] }
    }
  },
  // the pair is lower and broader than the Victorian one: a storey and a half or two, a shallow-pitched hip or one shared cross
  // gable (a small gable each where the halves are separate outlines), a small gabled vestibule each
  'interwar-semi': {
    kind: 'semi', storeys: [[1, 0.5], [2, 0.5]], variants: [3], fillMin: 0.8,
    wall: INTERWAR_BRICK,
    trim: TIMBER_FACE.concat([[0xe9e0c8, 2]]),
    roof: { forms: [['crossGable', 0.55], ['hipGable', 0.45]], pitch: [30, 40], eave: [0.45, 0.65], colors: ROOF_INT, patch: 0.1, sharedGable: true, smallGable: true, ridge: [2.0, 2.6] },
    parts: { windowTrim: { sill: true, lintel: false },
      vestibule: { p: 0.9, width: [1.8, 2.2], depth: [1.0, 1.3], wall: [2.5, 2.8] },
      timber: { p: 0.3 }, gableAccent: { p: 0.0 },
      dormer: { p: 0.5, width: [1.2, 1.5], wall: [1.0, 1.2] },
      bargeboard: { p: 0.6, width: [0.14, 0.2] }
    }
  },
  // 1940 to 1979: a bungalow or a plain two-storey box, a shallow hip or side gable, buff brick or siding, a stoop, a picture window
  'postwar-detached': {
    kind: 'detached', storeys: [[1, 0.55], [2, 0.45]], variants: [2], fillMin: 0.8, brickShare: 0.6,
    wall: POSTWAR_WALL,
    trim: [[0xf0ede4, 5], [0xd7cdb4, 3], [0x4a4c4f, 2]],
    roof: { forms: [['hip', 0.45], ['sideGable', 0.55]], pitch: [17, 24], eave: [0.5, 0.75], colors: ROOF_POST, patch: 0.08 },
    parts: { stoop: { p: 0.85, width: [1.4, 1.8], depth: [1.0, 1.3] }, pictureWindow: { p: 0.7, width: [2.2, 3.0], height: [1.2, 1.5] }, dormer: { p: 0.0, width: [1.2, 1.5], wall: [1.0, 1.2] } }
  },
  'postwar-semi': {
    kind: 'semi', storeys: [[1, 0.45], [2, 0.55]], variants: [2], fillMin: 0.8, brickShare: 0.6,
    wall: POSTWAR_WALL,
    trim: [[0xf0ede4, 5], [0xd7cdb4, 3], [0x4a4c4f, 2]],
    roof: { forms: [['hip', 0.4], ['sideGable', 0.6]], pitch: [17, 24], eave: [0.5, 0.75], colors: ROOF_POST, patch: 0.08 },
    parts: { stoop: { p: 0.85, width: [1.4, 1.8], depth: [1.0, 1.3] }, pictureWindow: { p: 0.7, width: [2.0, 2.7], height: [1.2, 1.5] } }
  },
  // 1980 on: flat or very shallow roofs, large glazing, dark brick, panel or stucco in greys, black and white, three storeys, a garage
  'recent-detached': {
    kind: 'detached', storeys: [[3, 0.6], [2, 0.4]], variants: [5], fillMin: 0.8, brickShare: 0.35,
    wall: RECENT_WALL,
    trim: TRIM_DARK,
    roof: { forms: [['flat', 1]], pitch: [4, 6], eave: [0.3, 0.5], colors: ROOF_FLAT, parapet: [0.35, 0.55] },
    parts: { garage: { p: 0.5, width: [2.4, 2.8], height: [2.1, 2.3] }, stoop: { p: 0.6, width: [1.4, 1.8], depth: [0.9, 1.2] } }
  },
  'recent-semi': {
    kind: 'semi', storeys: [[3, 0.6], [2, 0.4]], variants: [5], fillMin: 0.8, brickShare: 0.35,
    wall: RECENT_WALL,
    trim: TRIM_DARK,
    roof: { forms: [['flat', 1]], pitch: [4, 6], eave: [0.3, 0.5], colors: ROOF_FLAT, parapet: [0.35, 0.55] },
    parts: { garage: { p: 0.5, width: [2.4, 2.8], height: [2.1, 2.3] }, stoop: { p: 0.6, width: [1.4, 1.8], depth: [0.9, 1.2] } }
  },
  'modern-townhouse-row': {
    kind: 'row', storeys: 3, variants: [5], fillMin: 0.78, brickShare: 0.4,
    wall: RECENT_WALL,
    trim: TRIM_DARK,
    roof: { forms: [['flat', 1]], pitch: [4, 6], eave: [0.3, 0.45], colors: ROOF_FLAT, parapet: [0.4, 0.6] },
    parts: { garage: { p: 0.45, width: [2.4, 2.8], height: [2.1, 2.3] }, stoop: { p: 0.7, width: [1.3, 1.6], depth: [0.9, 1.1] } }
  },
  // ---- the main-street shops (st-ndw9.15): the page's shop fronts stay as they are; the storeys above, the cornice and the parapet are drawn ----
  'main-street-shop-early': {
    kind: 'shop', storeys: [2, 4], variantEarly: 4, fillMin: 0, brickShare: 1,
    wall: SHOP_BRICK,
    trim: [[0xe9e0c8, 5], [0xd7cdb4, 3], [0x3b4a3a, 1], [0x4a3426, 1]],
    roof: { forms: [['flat', 1]], pitch: [0, 0], eave: [0, 0], colors: ROOF_FLAT, parapet: [0.7, 1.1] },
    parts: { cornice: { p: 0.9, depth: [0.28, 0.42], height: [0.5, 0.75] }, signBand: { p: 0.95 } }
  },
  'main-street-shop-later': {
    kind: 'shop', storeys: [2, 4], variantEarly: null, fillMin: 0, brickShare: 0,
    wall: [[0xcdbfa4, 1]],
    trim: [[0xe9e0c8, 3], [0xd7cdb4, 3], [0x8a8d90, 2]],
    roof: { forms: [['flat', 1]], pitch: [0, 0], eave: [0, 0], colors: ROOF_FLAT, parapet: [0.3, 0.5] },
    parts: { cornice: { p: 0.3, depth: [0.15, 0.22], height: [0.3, 0.45] }, signBand: { p: 0.9 } }
  },
  // ---- the apartments, towers, offices and low blocks (st-ndw9.20, js/building-draw-tall.js) --------------------------------
  // kind 'block': a massing part's walls to a whole number of storeys in the facade style the preset names (`material`: the
  // rendered facade or a curtain wall; `variants`: indices into FACADE_VARIANTS or CURTAIN_VARIANTS), its colour, and in the roof
  // batch (flat-coloured triangles, always drawn) a tar roof, a parapet, a mechanical penthouse and balcony bands. Every part of a
  // group takes the group's colour and style.
  'walk-up-apartment': {
    kind: 'block', material: 'rendered', variants: [6], storeys: [2, 6], wall: WALKUP_BRICK, brickShare: 0.85, trim: [[0xe9e0c8, 4], [0xd7cdb4, 3], [0x8a8d90, 2]],
    parapet: [0.5, 0.9], roofCol: ROOF_FLAT,
    parts: { cornice: { p: 0.5, depth: [0.2, 0.3], height: [0.35, 0.5] }, balcony: { p: 0.25, depth: [1.2, 1.5], mode: 'stagger', minLen: 8 } }
  },
  'mid-rise-block': {
    kind: 'block', material: 'rendered', variants: [7], storeys: [4, 14], wall: MIDRISE_WALL, brickShare: 0.55, trim: [[0xe4e2dc, 4], [0xd7cdb4, 2], [0x8a8d90, 3]],
    parapet: [0.5, 0.8], roofCol: ROOF_FLAT, smallGroup: 300,
    parts: { penthouse: { p: 0.85, size: [0.3, 0.45], height: [2.8, 4.2] }, balcony: { p: 0.4, depth: [1.3, 1.6], mode: 'stagger', minLen: 10 } }
  },
  'slab-tower': {
    kind: 'block', material: 'rendered', variants: [8], storeys: [6, 40], wall: SLAB_WALL, brickShare: 0.4, trim: [[0xd8d2c2, 4], [0xe4e2dc, 3], [0x8a8d90, 2]],
    parapet: [0.6, 0.9], roofCol: ROOF_FLAT, slab: true,
    parts: { penthouse: { p: 1, size: [0.25, 0.4], height: [3.2, 4.8], end: true }, balcony: { p: 0.9, depth: [1.5, 1.9], mode: 'bands', minLen: 14, long: true } }
  },
  'glass-tower-podium': {
    kind: 'block', material: 'curtain', variants: [6, 7, 0], wall: SLAB_WALL, brickShare: 0, trim: [[0xdfe3e6, 4], [0x8a8d90, 2]], roofCol: ROOF_FLAT,
    podium: { variants: [9], wall: PODIUM_WALL, brickShare: 0.4, parapet: [0.7, 1.1], cornice: { depth: [0.35, 0.5], height: [0.5, 0.8] }, shops: true },
    parts: { crown: { p: 0.9, inset: [0.12, 0.22], height: [4, 9] }, balcony: { p: 0.7, depth: [1.3, 1.7], mode: 'stagger', minLen: 12, railing: 'glass' } }
  },
  'dark-curtain-wall-tower': {
    kind: 'block', material: 'curtain', variants: [1, 3, 4], wall: SLAB_WALL, brickShare: 0, trim: [[0x3a3e40, 4]], roofCol: ROOF_FLAT, crownDark: true,
    podium: { variants: [9], wall: PODIUM_WALL, brickShare: 0.3, parapet: [0.6, 0.9], shops: true },
    parts: { crown: { p: 0.6, inset: [0.15, 0.3], height: [3, 8] } }
  },
  'contemporary-glass': {
    kind: 'block', material: 'curtain', variants: [5, 2, 0], wall: SLAB_WALL, brickShare: 0, trim: [[0xc9cdd0, 4]], roofCol: ROOF_FLAT, groundGlass: true,
    podium: { variants: [9], wall: PODIUM_WALL, brickShare: 0.3, parapet: [0.6, 0.9], shops: true },
    parts: { penthouse: { p: 0.8, size: [0.3, 0.45], height: [2.8, 4.0] } }
  },
  tower: {
    kind: 'block', material: 'mixed', variants: [6, 7, 0, 2], wall: SLAB_WALL, brickShare: 0.3, trim: [[0xdfe3e6, 4], [0x8a8d90, 2]], roofCol: ROOF_FLAT, slabByPlan: true,
    slabLook: { material: 'rendered', variants: [8], wall: SLAB_WALL, brickShare: 0.4 },
    podium: { variants: [9], wall: PODIUM_WALL, brickShare: 0.4, parapet: [0.7, 1.1], cornice: { depth: [0.35, 0.5], height: [0.5, 0.8] }, shops: true },
    parts: { penthouse: { p: 0.9, size: [0.25, 0.4], height: [3, 4.5] }, crown: { p: 0.5, inset: [0.12, 0.22], height: [3, 7] }, balcony: { p: 0.8, depth: [1.4, 1.8], mode: 'bands', minLen: 14, long: true } }
  },
  'low-masonry-block': {
    kind: 'block', material: 'rendered', variants: [1], storeys: [2, 5], wall: LOW_MASONRY, brickShare: 1, trim: [[0xe9e0c8, 3], [0xd7cdb4, 3], [0x8a8d90, 2]],
    parapet: [0.5, 0.9], roofCol: ROOF_FLAT,
    parts: { cornice: { p: 0.6, depth: [0.2, 0.32], height: [0.4, 0.6] } }
  },
  'plain-low-block': {
    kind: 'block', material: 'rendered', variants: [1, 0], storeys: [2, 5], wall: PLAIN_LOW, brickShare: 0.55, trim: [[0xe4e2dc, 3], [0xd7cdb4, 2], [0x8a8d90, 3]],
    parapet: [0.4, 0.8], roofCol: ROOF_FLAT, parts: {}
  },
  // ---- places of worship (st-ndw9.20, js/building-draw-worship.js): a nave and its parts in the roof batch and the cell walls ----
  'church-gothic': {
    kind: 'worship', form: 'gothic', variants: [10], stone: GOTHIC_STONE, brickWall: GOTHIC_BRICK, highChurch: ['roman catholic', 'anglican', 'presbyterian', 'orthodox', 'united'],
    stoneShare: [0.78, 0.22], roof: [[0x4a4f55, 4], [0x5d6368, 3], [0x6b4c3a, 2], [0x3f5a4a, 1], [0x7a6552, 1]], pitch: [46, 58], tower: { width: [4.2, 6.4], extra: [5, 9], spire: 0.8, spireRise: [1.3, 2.3] }
  },
  'church-chapel': {
    kind: 'worship', form: 'chapel', variants: [3], stone: CHAPEL_BRICK, brickWall: CHAPEL_BRICK, highChurch: [], stoneShare: [0, 0],
    roof: [[0x6a6e72, 4], [0x7a5c48, 3], [0x555c62, 2], [0x8a4b3c, 1]], pitch: [30, 40], porch: 0.8, bellcote: 0.35
  },
  'church-modern': {
    kind: 'worship', form: 'modern', variants: [5], stone: MODERN_WALL, brickWall: MODERN_WALL, highChurch: [], stoneShare: [0, 0],
    roof: [[0x7a7d80, 4], [0x5d6368, 3], [0x9a9da0, 2]], pitch: [34, 48], forms: [['aframe', 0.5], ['gable', 0.3], ['mono', 0.2]], tower: 0.8
  },
  mosque: {
    kind: 'worship', form: 'mosque', variants: [10], stone: MOSQUE_WALL, brickWall: MOSQUE_WALL, highChurch: [], stoneShare: [0, 0],
    roof: [[0xb4b0a6, 3], [0x9a9890, 2]], dome: [[0x3f7a74, 4], [0xc8c3b6, 4], [0x2f5d8a, 2], [0xd8d2c2, 3], [0x7a8f6a, 1]]
  },
  synagogue: {
    kind: 'worship', form: 'synagogue', variants: [10], stone: SYN_WALL, brickWall: SYN_WALL, highChurch: [], stoneShare: [0, 0],
    roof: [[0x6a6e72, 3], [0x7a5c48, 2], [0x555c62, 2]], pitch: [24, 32]
  },
  temple: {
    kind: 'worship', form: 'temple', variants: [10], stone: TEMPLE_WALL, brickWall: TEMPLE_WALL, highChurch: [], stoneShare: [0, 0],
    roof: [[0x7a2f2a, 5], [0x2f6a4a, 3], [0x3a3a3c, 2], [0x9a6a2a, 2]], white: [[0xf1efe9, 5], [0xe4d9bd, 2]], sandstone: [[0xd8cdb4, 4], [0xc9a46a, 3], [0xd9b9a2, 2]]
  }
};

export const PROTOTYPES = (() => {
  const n = new Map(), k = new Map();
  for (const [, , family] of DEF) n.set(family, (n.get(family) || 0) + 1);
  return DEF.map(([id, name, family, era]) => {
    const i = k.get(family) || 0; k.set(family, i + 1);
    const count = n.get(family);
    const offset = count > 1 ? -HUE_SPREAD + i * (2 * HUE_SPREAD / (count - 1)) : 0;
    return { id, name, family, era, color: debugColor(family, era, offset), draw: DRAW[id] || null };
  });
})();

export const byId = Object.fromEntries(PROTOTYPES.map((p) => [p.id, p]));
export const FALLBACK_ID = 'fallback';

/** The catalogue entry for an id, or the fallback entry (never undefined). */
export function presetOf(id) {
  return byId[id] || byId[FALLBACK_ID];
}

export default { PROTOTYPES, byId, FALLBACK_ID, ERAS, FAMILY_HUES, ERA_LIGHT, DRAW, FACADE_VARIANTS, CURTAIN_VARIANTS, CURTAIN_FLOORS, FIRST_DRAW_VARIANT, debugColor, eraOfYear, presetOf };
