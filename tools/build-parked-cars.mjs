// tools/build-parked-cars.mjs: the cars parked at Toronto's curbs (docs/parked-cars.md), js/toronto-parked-cars.js
// (window.CITY.PARKED_CARS, packed). js/parking-layout.js finds the legal stalls from the committed data scripts (the
// streets & curbs, the City's by-laws and permit areas, pay stations, hydrants, stops, crossings, bikeways, streetcar
// tracks, Bike Share, the prebuilt CaféTO platforms) and the road graph's traffic lanes; then each stall is filled or
// left empty, and a car chosen and painted, from a seed of its own position, so the same inputs give the same bytes and
// every visitor sees the same street. The page audits the cars against the lanes it actually builds (js/parked-cars.js).
// The site does not load the script: its layer ships packed in data/toronto-geodata.bin beside GEO and POLES
// (tools/geo-bin.mjs). It holds the stalls, not the cars: js/parked-cars.js draws the cars again from the same seeds
// (drawParkedCar, the very function used here) and decodeParkedCars turns the layer back into exactly the rows placed
// here (packParkedCars checks that before it writes). Writing the committed script also repacks that file
// (tools/pack-geodata.mjs) and sets its hash in explore.html, as tools/build-poles.mjs does.
// usage: node tools/build-parked-cars.mjs [--out js/toronto-parked-cars.js]   (--out elsewhere leaves the binary alone)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadReplayWorld } from './patio-replay.mjs';
import { packGeodata } from './pack-geodata.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PARKED_JS = 'js/toronto-parked-cars.js';

// How full the curbs are, by why parking is allowed there (a share of the legal stalls holding a car)
export const OCCUPANCY = { paid: 0.72, restricted: 0.7, permit: 0.82, local: 0.62 };

/** The world with every placement input, in node */
export function loadParkingWorld(root = ROOT) {
  const world = loadReplayWorld(root);
  const { CITY } = world;
  const context = vm.createContext({ window: { CITY }, console: { ...console, info() {}, warn() {} } });
  for (const file of ['js/toronto-patios.js', 'js/toronto-parking.js', 'js/parking-layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  // the bikeways as the page builds them: routed round the prebuilt CaféTO platforms in their place (cycling.js)
  CITY.routeRoundPatios(CITY.patioRows(CITY.PATIOS));
  return world;
}

/** parkingStalls' inputs from the city (the same in the build and the tests) */
export function parkingDeps(CITY) {
  const { GEO } = CITY;
  const pd = CITY.patioDeps(CITY, {});
  const hydrants = [];
  const H = GEO.props.hydrant || [];
  for (let i = 0; i + 1 < H.length; i += 2) hydrants.push({ x: H[i], z: H[i + 1] });
  // driveways & laneways: where an unnamed service road crosses a curb (OpenStreetMap's driveways and alleys)
  const driveways = [];
  for (const [name, w, , , , raised, flat, cls] of GEO.roads) {
    if (name || raised || cls !== 'service') continue;
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const ax = flat[i], az = flat[i + 1], bx = flat[i + 2], bz = flat[i + 3], L = Math.hypot(bx - ax, bz - az);
      let prev = !!CITY.blockAt(ax, az);
      for (let s = 0.5; s <= L; s += 0.5) {
        const x = ax + ((bx - ax) * s) / L, z = az + ((bz - az) * s) / L, on = !!CITY.blockAt(x, z);
        if (on !== prev) driveways.push({ x, z, w: Math.max(3, Math.min(6, w || 3)) });
        prev = on;
      }
    }
  }
  const patios = (CITY.PATIOS?.sites || []).map((row) => Object.fromEntries(CITY.PATIO_SITE_FIELDS.map((k, i) => [k, row[i]])))
    .filter((s) => s.kind === 'curb');
  return {
    roads: CITY.ROADS, blockAt: CITY.blockAt, lanes: CITY.parkingLaneSegments(GEO), hydrants, stops: pd.stops,
    crossings: pd.crossings, junctions: pd.junctions, driveways, railDist: pd.railDist,
    bikewayAt: (x, z) => CITY.routedBikewayIntrusion(x, z, 0.05) > 0, trackAt: (x, z) => CITY.routedBikewayIntrusion(x, z, 0.05, true) > 0,
    bikeShareAt: CITY.bikeShareAt, patios,
    payStations: (CITY.PARKING_METERS?.records || []).map((r) => ({ x: r.x, z: r.z, zone: r.zone })), parking: CITY.PARKING,
    inFrame: (x, z) => CITY.isOnLand(x, z, 10), heightAt: (x, z) => CITY.cutAt(x, z),
    nearestRoad: (x, z) => CITY.nearestRoads(x, z, 30).filter((r) => !r.road.raised)[0]?.road.name || null
  };
}

/** js/parked-cars.js's codec (the draw of a car from its stall's seeds, and decodeParkedCars), run in node */
export function loadParkedCodec(root = ROOT) {
  const context = vm.createContext({ window: { CITY: {} }, performance, console });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/parked-cars.js'), 'utf8'), context, { filename: 'js/parked-cars.js' });
  return context.window.CITY.parkedCarCodec;
}

/** The PARKED object: the stalls laid out, filled and the cars chosen (`sites`: each car's stall, for packParkedCars) */
export function buildParkedCars(world = loadParkingWorld(), codec = loadParkedCodec()) {
  const { CITY } = world;
  const { KINDS, CATS, FIELDS } = codec;
  const t0 = performance.now();
  const out = CITY.parkingStalls(parkingDeps(CITY));
  const ms = performance.now() - t0;
  const cars = [], sites = [];
  for (const s of out.stalls) {
    const X = Math.round(s.x * 100), Z = Math.round(s.z * 100); // (the stall's seeds: its position in cm)
    if (codec.stallSeed(X, Z, 1) >= OCCUPANCY[s.cat]) continue;
    const cat = CATS.indexOf(s.cat), c = codec.drawParkedCar(X, Z, cat);
    const x = s.x + s.nx * c.across + s.tx * c.along, z = s.z + s.nz * c.across + s.tz * c.along;
    const heading = Math.atan2(s.tx, s.tz), yaw = heading + c.skew;
    cars.push([Math.round(x * 100) / 100, Math.round(z * 100) / 100, Math.round(yaw * 10000) / 10000, c.kind, c.paint, c.style, cat, c.order]);
    sites.push({ X, Z, heading: Math.round(heading * 10000), side: s.nx * s.tz - s.nz * s.tx > 0 ? 0 : 1 });
  }
  const byCat = Object.fromEntries(CATS.map((c) => [c, 0]));
  const byKind = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const c of cars) { byCat[CATS[c[6]]]++; byKind[KINDS[c[3]]]++; }
  return {
    PARKED: {
      generator: 'tools/build-parked-cars.mjs (js/parking-layout.js)',
      counts: { stalls: out.stalls.length, cars: cars.length, stallsBy: out.stats.cats, carsBy: byCat, kinds: byKind, rejected: out.rejected },
      occupancy: OCCUPANCY, kinds: KINDS, cats: CATS, fields: FIELDS, cars
    },
    sites, stalls: out.stalls, ms
  };
}

/**
 * The cars placed & their stalls -> the packed layer, window.CITY.PARKED_CARS (js/parked-cars.js says what its columns
 * are; decodeParkedCars reads it back exactly: checked here). data/toronto-geodata.bin stores each column at its smallest
 * (tools/geo-pack.mjs).
 */
export function packParkedCars({ PARKED, sites }, codec = loadParkedCodec()) {
  const { generator, counts: { stalls, cars: count }, cars } = PARKED;
  const P = { generator, counts: { stalls, cars: count }, cat: [], heading: [], side: [], major: [], minor: [], cx: [], cz: [], cy: [] };
  let X0 = 0, Z0 = 0;
  for (const [i, { X, Z, heading, side }] of sites.entries()) {
    const [x, z, yaw, , , , cat] = cars[i];
    const frame = codec.curbFrame(heading);
    const dx = X - X0, dz = Z - Z0, major = frame.zMajor ? dz : dx;
    const c = codec.drawParkedCar(X, Z, cat);
    P.cat.push(cat);
    P.heading.push(heading);
    P.side.push(side);
    P.major.push(major);
    P.minor.push((frame.zMajor ? dx : dz) - Math.round(major * frame.slope));
    P.cx.push(Math.round(x * 100) - codec.placedX(X, c, frame, side));
    P.cz.push(Math.round(z * 100) - codec.placedZ(Z, c, frame, side));
    P.cy.push(Math.round(yaw * 10000) - codec.placedYaw(c, frame));
    X0 = X; Z0 = Z;
  }
  const back = codec.decodeParkedCars(P);
  const bad = cars.findIndex((c, i) => JSON.stringify(c) !== JSON.stringify(back[i]));
  if (bad >= 0 || back.length !== cars.length) throw new Error(`parked cars: car ${bad} decodes to ${JSON.stringify(back[bad])}, not ${JSON.stringify(cars[bad])}`);
  return P;
}

export function parkedCarsJs(PACKED) {
  return '// js/toronto-parked-cars.js — GENERATED by tools/build-parked-cars.mjs, do not edit by hand. The cars parked at\n' +
    '// Toronto\'s curbs (docs/parked-cars.md), placed by js/parking-layout.js from the City\'s by-laws, permit areas & pay\n' +
    '// stations (js/toronto-parking.js, js/toronto-parking-meters.js) and the city\'s curbs & furniture: their stalls, from\n' +
    '// which js/parked-cars.js decodeParkedCars draws the cars. The site loads this from data/toronto-geodata.bin.\n' +
    `(function () {\nwindow.CITY = window.CITY || {};\nwindow.CITY.PARKED_CARS = ${JSON.stringify(PACKED)};\n})();\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outArg = process.argv.indexOf('--out');
  const out = path.resolve(outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, PARKED_JS));
  const built = buildParkedCars();
  const { PARKED, ms } = built;
  const js = parkedCarsJs(packParkedCars(built));
  fs.writeFileSync(out, js);
  console.log(`[parked] ${path.relative(ROOT, out)}: ${JSON.stringify(PARKED.counts)} (${js.length} bytes, layout ${Math.round(ms)} ms)`);
  if (out === path.join(ROOT, PARKED_JS)) {
    const packed = packGeodata();
    console.log(`[parked] repacked data/toronto-geodata.bin (${packed.file.length} bytes, hash ${packed.hash})`);
  }
}
