// jf-qw7 part 3 (docs/rosedale-streetscape.md): a yard's lot line stands where the City's parcel puts it (Rosedale: the houses file's lotYd), or 5 m behind the kerb the page draws,
// never at the kerb: the houses file carries a lot line for every house, they are the City's depths, and planHouse takes them
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { mergeRosedaleHouses, decodeHouses } from '../js/rosedale-houses.js';
import { rosedaleYardStyle } from '../js/front-yards.js';
import * as Draw from '../js/building-draw.js';

const file = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const lin = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const load = async () => {
  const { GEO } = await unpackGeo(file('data/frames/eglinton/toronto-geodata.bin'));
  const { ROSEDALE_HOUSES: H } = await unpackGeo(file('data/frames/eglinton/rosedale-houses.bin'));
  const { MASSING } = await unpackGeo(file('data/toronto-massing.bin'));
  const massing = massingRows(MASSING, GEO);
  mergeRosedaleHouses(massing, GEO.buildings, H);
  return { GEO, H, recs: [...massing.rows.values()].filter((r) => r.rosedale) };
};

test('every Rosedale house has a lot line depth from the City parcel (or its kerb distance), and they are the City\'s depths', async () => {
  const { GEO, H } = await load();
  const houses = decodeHouses(H, GEO.buildings).houses;
  const known = houses.filter((h) => h.lotYd > 0);
  assert.ok(known.length > houses.length * 0.75, `${known.length} of ${houses.length} houses have a lot line`);
  const d = known.map((h) => h.lotYd).sort((a, b) => a - b), med = d[d.length >> 1];
  assert.ok(med > 4 && med < 7.5, `median front yard ${med} m`);
  assert.ok(d[d.length - 1] <= 60);
});

const planFor = (rec, over) => {
  const ring = rec.rings[0], n = ring.length;
  let best = -1, bl = 0;
  const edges = ring.map((a, i) => {
    const b = ring[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), street = rec.street.has(i);
    if (street && len > bl) { bl = len; best = i; }
    return { ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: dz / len, nz: -dx / len, len, kind: rec.hidden.has(i) ? -1 : rec.covered.has(i) ? Draw.WALL.lotLine : Draw.WALL.rear, street };
  });
  if (best < 0) return null;
  edges[best].kind = Draw.WALL.entry;
  const yard = { lotW: rec.rosedale.lotW, park: 0, style: rosedaleYardStyle(rec.rosedale), canopy: -1, veg: null, ...(over.yard || {}) };
  return Draw.planHouse({ preset: rec.preset, id: rec.id, groupId: rec.id, dwellings: rec.drawFacts.dwellings, ring, edges, covered: rec.covered, y0: 0, lin, roadDist: () => 14, nearRoad: null, hint: rec.rosedale.hint, yard, ...over });
};

test('planHouse puts the lot line where the parcel is, or 5 m behind the curb island\'s edge, and never from the road centreline when either is known', async () => {
  const { recs } = await load();
  let checked = 0;
  for (const rec of recs.filter((r) => r.rosedale.house)) {
    const base = planFor(rec, {});
    if (!base || !base.ok || !base.yardStats) continue;
    // the parcel's depth wins over the road
    const withLot = planFor(rec, { yard: { lotYd: 7.5 }, roadDist: () => 9 });
    assert.ok(withLot.yardStats, `${rec.id}: a yard at 7.5 m`);
    assert.equal(withLot.yardStats.site.yd, 7.5);
    // no parcel: the page walks out from the front wall to the island's edge, here 13 m out, and the lot line is 5.8 m behind it
    const frame = planFor(rec, { frameOnly: true });
    if (!frame || !frame.frame) continue;
    const { A, t, u0, u1 } = frame.frame;
    const mid = (u0 + u1) / 2;
    const curbAt = 13;
    // (the plan walks out from the middle of the front wall: a point is on the island while it is within 13 m of that middle)
    const onIsland = (x, z) => Math.hypot(x - (A[0] + t[0] * mid), z - (A[1] + t[1] * mid)) <= curbAt;
    const walked = planFor(rec, { onIsland, roadDist: () => 9 });
    if (walked && walked.yardStats) {
      const yd = walked.yardStats.site.yd;
      assert.ok(yd > 6.2 && yd < 8.6, `${rec.id}: lot line ${yd} m from a curb 13 m out`);
    }
    if (++checked >= 6) break;
  }
  assert.ok(checked >= 3, `${checked} houses checked`);
});
