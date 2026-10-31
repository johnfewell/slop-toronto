// Authored, sourced facts about the subway stations a passenger can ride between, and the rides the game supports.
// tools/subway-topology.mjs joins them to the OpenStreetMap track and the TTC's GTFS; docs/subway-topology.md explains
// the contract. Nothing here is measured from drawings: where a number is an assumption it says so (basis 'assumed')
// and gives the range it may lie in. No published source gives these stations' depths below the street.
//
// Retrieved 2026-10-29:
//   TTC station pages (levels, platform type, accessibility):
//     https://www.ttc.ca/subway-stations/king-station
//     https://www.ttc.ca/subway-stations/queen-station
//     https://www.ttc.ca/subway-stations/castle-frank-station
//     https://www.ttc.ca/subway-stations/broadview-station
//   Construction of the 1954 Yonge subway (cut-and-cover under Yonge Street, King's single mezzanine fare area, Queen's
//   main entrance directly under the intersection; no depths given): https://transittoronto.ca/subway/5102.shtml

const TTC = (slug) => `https://www.ttc.ca/subway-stations/${slug}-station`;
const YONGE_1954 = 'https://transittoronto.ca/subway/5102.shtml';

// The Yonge line's downtown stations: a cut-and-cover box under the street, a concourse (fare) level over the
// platforms. Assumed: about one storey (3 m clear) plus slab and street cover to the concourse floor, a second storey
// with the platform ceiling and concourse slab to the platform floor. Rail top is the platform floor less the platform
// height the passenger model uses (1.1 m, js/subway-service.js; also not sourced).
const YONGE_BOX = {
  concourseFloor: { value: -4.5, range: [-6, -3.5], basis: 'assumed' },
  platformFloor: { value: -9.5, range: [-12, -8], basis: 'assumed' },
  note: 'Cut-and-cover box under Yonge Street (transittoronto.ca); depths assumed from its two levels below the street, not measured'
};

export const STATION_FACTS = {
  king: {
    levels: 3, levelNames: ['Street', 'Concourses (north: King Street; south: Commerce Court)', 'Platforms'],
    platformType: 'side', accessible: false, sources: [TTC('king'), YONGE_1954],
    depth: YONGE_BOX,
    // The walkable connection: the first of these OpenStreetMap street entrances that js/subway.js gives a stairway.
    // A1, the south-west corner (js/subway.js places no stairway there), then B2 (south-east, the one walked) and
    // A2 (north-east)
    entrances: [3697981902, 3698860822, 3705565840]
  },
  queen: {
    levels: 4, levelNames: ['Street', 'Concourses', 'Platforms', 'Underpass (paid and unpaid parts, below the platforms)'],
    platformType: 'side', accessible: true, sources: [TTC('queen'), YONGE_1954],
    depth: YONGE_BOX,
    // Yonge / Queen south-west corner, then the north-west corner
    entrances: [3555231357, 293309464]
  },
  'castle-frank': {
    levels: 3, platformType: 'side', sources: [TTC('castle-frank')],
    // The game's city is flat at street level; the Don Valley is not dug out, so the Prince Edward Viaduct's lower deck
    // stands 16.3 m above the street (js/subway.js railY). In Toronto the lower deck is a few metres under the road,
    // about level with these stations. The ride keeps the platforms on the deck's level (worldDatum 'viaduct'): a real
    // depth below the flat street would need a 24 m climb in the ~160 m to the viaduct, an impossible 15% grade.
    depth: { worldDatum: 'viaduct', note: 'Platforms at the viaduct deck level; the flat city cannot hold their real depth below the street' },
    entrances: []
  },
  broadview: {
    levels: 3, platformType: 'side', sources: [TTC('broadview')],
    depth: { worldDatum: 'viaduct', note: 'Platforms at the viaduct deck level; the flat city cannot hold their real depth below the street' },
    entrances: []
  }
};

// GTFS names the two Bloor-Yonge platforms after their own streets
export const GTFS_STATION_ALIASES = { bloor: 'bloor-yonge', yonge: 'bloor-yonge' };

// The rides a passenger can take. A ride is two consecutive stations of one line, ridden both ways; its boundaries are
// these stations (the trains hold there for alighting; they are not the line's termini).
//   geometry 'viaduct': js/subway-service.js buildSubwayRidePaths joins the stations to the viaduct (unchanged)
//   geometry 'track': the OpenStreetMap track itself, with the depth profile below
export const SUPPORTED_RIDES = [
  { id: 'l2-castle-frank-broadview', line: 'L2', stations: ['castle-frank', 'broadview'], geometry: 'viaduct' },
  { id: 'l1-queen-king', line: 'L1', stations: ['queen', 'king'], geometry: 'track', connection: 'walk' }
];

// Game limits for a ride's vertical profile (not TTC design values)
export const PROFILE_LIMITS = { maxGrade: 0.04, platformHalf: 80, approach: 400, runOut: 220 };
