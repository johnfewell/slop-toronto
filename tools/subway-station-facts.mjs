// Authored, sourced facts about the subway stations a passenger can ride between, and the rides the game supports.
// tools/subway-topology.mjs joins them to the OpenStreetMap track and the TTC's GTFS; docs/subway-topology.md explains
// the contract. Nothing here is measured from drawings: where a number is an assumption it says so (basis 'assumed')
// and gives the range it may lie in; where it is derived from measurements (basis 'derived') it gives the derivation.
// No published source gives these stations' depths below the street.
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

// Castle Frank and Broadview in the Don Valley pilot (?donvalley=1): their platforms below the street. No published
// source gives either depth (TTC station pages, Transit Toronto, OpenStreetMap: no ele or step_count tags), so each is
// derived from the 2023 lidar (Ontario Elevation Mapping Program, GTA 2023: the bare-earth DTM and the surface model,
// CGVD2013 metres) and the viaduct's design drawing, and checked against the TTC's design maximum grade. Retrieved
// 2026-10-31:
//   Prince Edward Viaduct: top of rail 21'-6 3/4" (6.57 m) below the road surface at the kerb, 16'-3" (4.95 m) clear
//     to the steelwork, the road "nearly level" (T. Taylor, "The Bloor Street Viaduct", Journal of the Engineering
//     Institute of Canada, July 1919, Fig. 2: https://historicbridges.org/ontario/bloorstreetprinceedwardviaduct/articles.pdf)
//   TTC Design Manual vertical alignment: at most 3.5% on running structure, at least 0.3% at stations (as quoted in
//     Metrolinx's Relief Line EPR Appendix 2-3, "Subway Design Standards and Construction Methods"; a secondary copy)
//   Levels: Castle Frank street, concourse, platforms, elevators street to platform; Broadview street (with the bus and
//     streetcar platforms), concourse, subway platforms (TTC pages); Broadview's platforms are layer -2 under a
//     layer -1 concourse in OpenStreetMap (ways 745459353, 745459354)
// The lidar, from tools/fetch-don-valley-dtm.mjs's tiles (DTM) and the same project's surface model:
//   the viaduct's road deck 113.3 m (west end), 114.1 m (mid-span: its camber) and 113.6 m (east end): rail top on the
//   lower deck about 106.7 m and 107.0 m at its ends
//   the roof of the covered Rosedale Valley bridge, just west of Castle Frank (its platforms start at the bridge's east
//     end): 108.4 m; rail top inside it assumed 5.4 m lower (4.95 m clear plus a 0.45 m roof; range 5.1 to 5.8): 103.0
//   the street at the stations (the DTM's 10 m cell mean): Castle Frank 112.9 m, Broadview 114.5 m
// Rail top is the platform floor less the passenger model's 1.1 m platform height (js/subway-service.js; not sourced).
export const DON_VALLEY_EVIDENCE = {
  viaductRailBelowRoad: 6.57, roadDeck: { west: 113.3, middle: 114.1, east: 113.6 }, rosedaleBridgeRoof: 108.4, roofToRail: { value: 5.4, range: [5.1, 5.8] },
  street: { 'castle-frank': 112.9, broadview: 114.5 }, ttcMaxGrade: 0.035, platformHeight: 1.1
};
const valley = (value, range, confidence, derivation) => ({
  worldDatum: 'donvalley-pilot',
  platformFloor: { value, range, basis: 'derived', confidence },
  railTop: +(value - DON_VALLEY_EVIDENCE.platformHeight).toFixed(2),
  note: derivation
});
// Castle Frank: rail level with the Rosedale Valley bridge's (103.0 m), 9.9 m under the street; the platform floor
// 8.8 m down. The climb to the viaduct's rail (106.8 m) over the ~150 m from the platform's east end to the west
// abutment is 2.5%, within the TTC's 3.5%; a rail deeper than 101.5 m would break it. Range: the roof-to-rail
// assumption and a station grade of up to 0.3% either way.
const CASTLE_FRANK_VALLEY = valley(-8.8, [-9.6, -8.0], 'medium',
  'Derived: rail top level with the covered Rosedale Valley bridge (lidar roof 108.4 m less 5.4 m), 9.9 m under the street (112.9 m); the 2.5% climb to the viaduct\'s lower deck is within the TTC\'s 3.5%');
// Broadview: nothing measures its rail. Two levels under the street (concourse, platforms), as shallow as the
// concourse allows (two storeys, about 7.5 m to the platform floor), the track falling 1.1 m (0.6%) from the viaduct's
// east abutment (107.0 m) over the ~185 m to the platform's west end. Bounds: two storeys at least (-6.5 m); the
// TTC's 3.5% at most (rail no deeper than ~100.5 m: -12.9 m), narrowed to -9.5 m as a deeper box has no reason here.
const BROADVIEW_VALLEY = valley(-7.5, [-9.5, -6.5], 'low',
  'Derived: two levels below the street (TTC; OpenStreetMap layer -2 platforms under a layer -1 concourse), as shallow as a concourse allows, the track falling 0.6% from the viaduct\'s lower deck (rail about 107.0 m) to 105.9 m');

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
    // The Don Valley terrain pilot (?donvalley=1, docs/don-valley-terrain.md) digs the valley out: the road deck is
    // level with the street and the lower deck 5.8 m under it, so the platforms go below the street (donValley,
    // derived from the lidar above).
    depth: { worldDatum: 'viaduct', note: 'Platforms at the viaduct deck level; the flat city cannot hold their real depth below the street',
      donValley: CASTLE_FRANK_VALLEY },
    entrances: []
  },
  broadview: {
    levels: 3, platformType: 'side', sources: [TTC('broadview')],
    depth: { worldDatum: 'viaduct', note: 'Platforms at the viaduct deck level; the flat city cannot hold their real depth below the street',
      donValley: BROADVIEW_VALLEY },
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
