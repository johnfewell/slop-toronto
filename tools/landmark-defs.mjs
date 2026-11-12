// tools/landmark-defs.mjs — the places the city is known by (tools/geo-features.mjs finds their outlines; landmarks.js
// models some of them; js/city-config.js labels them and arrives at them). Shared with tools/fetch-osm.mjs, which keeps
// the elements carrying these Wikidata IDs in osm_landmarks.json.
//
// [OSM name, id in the sim, how, Wikidata ID]
//   how: 'self' (the feature's own outline) | 'building' (the building of that name) | 'largest' (the largest building
//   inside it) | 'point' (a mapped place node)
//   The Wikidata ID finds a place whose name or shape OpenStreetMap carries differently (st-bz1o.8; until 2026-11-10
//   these four were "landmark not found" in every frame): Centre Island is a place=island multipolygon; Kensington
//   Market a neighbourhood boundary (admin_level 10) with a place node; Ontario Place, closed for its redevelopment, a
//   node only (its tourism=attraction now disused:tourism); Sugar Beach is mapped as "Sugar Beach" (this list asked for
//   "Canada's Sugar Beach"). Its largest outline wins, else its node stands for it.
export const LANDMARK_DEFS = [
  ['CN Tower', 'cnTower', 'self'],
  ['Rogers Centre', 'rogersCentre', 'self'],
  ['Union Station', 'unionStation', 'building'],
  ['Toronto City Hall', 'cityHall', 'building'],
  ['Nathan Phillips Square', 'nathanPhillips', 'self'],
  ['Royal Ontario Museum', 'rom', 'building'],
  ['Ontario Place', 'ontarioPlace', 'self', 'Q935388'],
  ['Ontario Place Cinesphere', 'cinesphere', 'building'],
  ['St. Lawrence Market South', 'stLawrence', 'building'],
  ['Distillery District', 'distillery', 'self'],
  ['Sugar Beach', 'sugarBeach', 'self', 'Q1032021'],
  ['Harbourfront Centre', 'harbourfront', 'self'],
  ['Toronto Music Garden', 'musicGarden', 'self'],
  ['Scotiabank Arena', 'scotiabankArena', 'building'],
  ['Ontario Legislative Building', 'legislature', 'building'],
  ['Centre Island', 'centreIsland', 'self', 'Q22456780'],
  ['Trinity Bellwoods Park', 'trinityBellwoods', 'self'],
  ['High Park', 'highPark', 'self'],
  ['Kensington Market', 'kensington', 'self', 'Q3195260'],
  ['Exhibition Place', 'exhibitionPlace', 'self'],
  ['Fairmont Royal York Hotel', 'royalYork', 'building'],
  ['Gooderham Building', 'flatiron', 'building'],
  ["Princes' Gates", 'princesGates', 'building']
];
/** The Wikidata IDs fetch-osm.mjs keeps in osm_landmarks.json */
export const LANDMARK_WIKIDATA = new Set(LANDMARK_DEFS.map((d) => d[3]).filter(Boolean));
