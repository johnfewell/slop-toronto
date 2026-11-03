// The bikeways routed round the CaféTO curb lane platforms that stand in their place (js/cycling.js routeRoundPatios,
// js/patio-layout.js, docs/cafeto-patios.md): on a synthetic street, then on the real city's Danforth and Bloor with the
// committed prebuilt layout. The track stays continuous round each platform, never over it, its separator and posts
// with it, at least CaféTO's 1.2 m wide, and clear of the traffic lanes; the parked cars float beyond the cycle track
// and never stand in it (tests/parked-cars.test.mjs covers the rest of their rules).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadParkingWorld, buildParkedCars, parkingDeps } from '../tools/build-parked-cars.mjs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
class Any { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? t[k] : () => new Any()) }); } }
const THREE = new Proxy({}, { get: () => Any });

// cycling.js on a street of its own: one cycle track along the z = 7 curb of a street along +x, the road at z < 7
function cycling(bands) {
  const c = vm.createContext({ window: { CITY: { THREE, CITY_BOUNDS: { sidewalkHeight: 0.22 }, blockAt: () => null,
    GEO: { cycling: { kinds: ['lane', 'buffered', 'contraflow', 'track', 'track2', 'sharrow', 'trail', 'parkRoad', 'signed'], bands, trails: [], map: [] } } } },
  console: { ...console, info() {} } });
  vm.runInContext(read('js/cycling.js'), c);
  return c.window.CITY;
}
const TRACK = 3;
const line = (x0, x1, z, step = 20) => { const f = []; for (let x = x0; x <= x1; x += step) f.push(x, z); return f; };
// a curb lane platform against the z = 7 curb (the gutter 0.1 m), 1.8 m deep, centred at x
const platform = (x, length = 7, bikeway = 2.4) => ({ kind: 'curb', cx: x, cz: 7 - 0.1 - 0.9, tx: 1, tz: 0, nx: 0, nz: 1, length, depth: 1.8, bikeway });
// the bent band's curb line at x (its z), and its squeeze there
function along(P, x) {
  for (let i = 0; i + 1 < P.length; i++) {
    const p = P[i], q = P[i + 1];
    if ((p.x - x) * (q.x - x) <= 0) { const t = (x - p.x) / (q.x - p.x || 1); return { z: p.z + (q.z - p.z) * t, sq: p.sq + (q.sq - p.sq) * t }; }
  }
  return null;
}

test('a cycle track bends out round a platform in its place, past its barrier, with smooth tapers, and back', () => {
  const C = cycling([[TRACK, 0, line(-100, 100, 7)]]);
  const { gap, margin, taper } = C.BIKE_DETOUR;
  const st = C.routeRoundPatios([platform(0)]);
  assert.deepEqual({ platforms: st.platforms, detours: st.detours, bands: st.bands, narrowed: st.narrowed }, { platforms: 1, detours: 1, bands: 1, narrowed: 0 });
  const b = C.CYCLING_BANDS[0], P = b.P;
  // its ends where they were; the line continuous (no step longer than a resampled one near the platform)
  assert.deepEqual([P[0].x, P[0].z, P[P.length - 1].x, P[P.length - 1].z], [-100, 7, 100, 7]);
  for (let i = 1; i < P.length; i++) {
    const d = Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
    if (Math.abs(P[i].z - 7) > 0.01 || Math.abs(P[i - 1].z - 7) > 0.01) assert.ok(d < 0.6, `a step of ${d.toFixed(2)} m in the detour`);
  }
  // beside the platform and its margin: the track's curb side `gap` beyond the barrier's road side (z = 5.1)
  for (let x = -3.5 - margin; x <= 3.5 + margin; x += 0.25) assert.ok(Math.abs(along(P, x).z - (5.1 - gap)) < 0.01, `at x ${x}`);
  // the tapers: monotonic, out within `taper` of the full stretch, the mapped line beyond
  let prev = 7;
  for (let x = -3.5 - margin - taper - 2; x <= -3.5 - margin; x += 0.25) { const z = along(P, x).z; assert.ok(z <= prev + 1e-9); prev = z; }
  assert.equal(along(P, -3.5 - margin - taper - 0.6).z, 7);
  assert.equal(along(P, 3.5 + margin + taper + 0.6).z, 7);
  // (no kink: the line turns gently, a smooth S at most 1.5 times its average slope)
  for (let i = 1; i < P.length; i++) assert.ok(Math.abs(P[i].z - P[i - 1].z) <= (1.5 * 2.1 / taper) * Math.abs(P[i].x - P[i - 1].x) + 1e-3);
  // the separator runs with it, whole, the posts' line on it
  const runs = C.bikeSeparatorRuns();
  assert.equal(runs.length, 1);
  const R = runs[0];
  for (const p of R.P) {
    const z = along(P, p.x).z;
    assert.ok(Math.abs(p.z - z) < 0.02, 'on the bent line');
    assert.ok(Math.abs(R.a(p) - 1.85) < 1e-9 && Math.abs(R.b(p) - 2.3) < 1e-9, 'the track its full width');
  }
  // the bikeway as mapped still covers the platform (the layout's input); as built, it no longer does, and runs beside it
  assert.ok(C.bikewayIntrusion(0, 6, 0.05) > 0);
  assert.equal(C.routedBikewayIntrusion(0, 6, 0.05), 0);
  assert.ok(C.routedBikewayIntrusion(0, 4.0, 0.05) > 0 && C.routedBikewayIntrusion(0, 2.9, 0.05) > 0 && C.routedBikewayIntrusion(0, 2.4, 0.05) === 0);
  // idempotent, and undone without platforms
  C.routeRoundPatios([platform(0)]);
  assert.equal(C.CYCLING_BANDS[0].P.length, P.length);
  C.routeRoundPatios([]);
  assert.equal(C.CYCLING_BANDS[0].P, C.CYCLING_BANDS[0].mapped);
});

test('a squeezed site narrows the track beside it (never under 1.2 m), and platforms end to end share one detour', () => {
  const C = cycling([[TRACK, 0, line(-100, 100, 7)]]);
  // 5 m apart end to end: one detour, no dip between them; the tighter one narrows the whole stretch
  const st = C.routeRoundPatios([platform(-6, 7, 2.4), platform(6, 5, 1.95)]);
  assert.equal(st.detours, 1);
  assert.equal(st.narrowed, 1);
  const P = C.CYCLING_BANDS[0].P;
  for (let x = -9.5; x <= 8.5; x += 0.25) {
    const q = along(P, x);
    assert.ok(Math.abs(q.z - 4.9) < 0.01, `straight across the gap at x ${x}`);
    assert.ok(Math.abs(q.sq - 0.45) < 0.01, 'narrowed by the squeeze');
  }
  const R = C.bikeSeparatorRuns()[0];
  for (const p of R.P) assert.ok(R.a(p) >= 1.2 && R.a(p) <= 1.85 + 1e-9);
  // the routed reserve's road side: the platform's edge, the gap and the site's reserve
  assert.ok(C.routedBikewayIntrusion(0, 4.9 - 1.95 + 0.1, 0.05) > 0 && C.routedBikewayIntrusion(0, 4.9 - 1.95 - 0.2, 0.05) === 0);
  // farther apart, two detours
  assert.equal(C.routeRoundPatios([platform(-20), platform(20)]).detours, 2);
  // the threshold: a pair just under `bridge` apart shares one (it could not bend back to the curb between them); one
  // just over it bends back all the way, out of both detours' reach, and out again
  const { bridge, margin, taper } = C.BIKE_DETOUR;
  assert.ok(Math.abs(bridge - 2 * (margin + taper)) < 1e-9);
  assert.equal(C.routeRoundPatios([platform(-3.5 - (bridge - 0.2) / 2), platform(3.5 + (bridge - 0.2) / 2)]).detours, 1);
  assert.ok(Math.abs(along(C.CYCLING_BANDS[0].P, 0).z - 4.9) < 0.01, 'straight across');
  assert.equal(C.routeRoundPatios([platform(-3.5 - (bridge + 0.4) / 2), platform(3.5 + (bridge + 0.4) / 2)]).detours, 2);
  assert.equal(along(C.CYCLING_BANDS[0].P, 0).z, 7, 'back at the curb between them');
  // a platform on the far curb (z < 0) leaves this curb's track alone
  assert.equal(C.routeRoundPatios([{ ...platform(0), cz: -6, nz: -1 }]).bands, 0);
});

test('at load the bands bend round the prebuilt platforms only on a day the patios are built (seasons.js CITY.SITE_DATE)', () => {
  const p = platform(0);
  const PATIOS = { fields: Object.keys(p).concat('id'), sites: [[...Object.values(p), 'x']] };
  const load = (date, search = '') => {
    const c = vm.createContext({ window: { CITY: { THREE, CITY_BOUNDS: { sidewalkHeight: 0.22 }, blockAt: () => null, PATIOS,
      ...(date ? { SITE_DATE: date } : {}), SCENE_DATE: { month: 8, day: 22 },
      GEO: { cycling: { kinds: ['lane', 'buffered', 'contraflow', 'track', 'track2', 'sharrow', 'trail', 'parkRoad', 'signed'], bands: [[TRACK, 0, line(-100, 100, 7)]], trails: [], map: [] } } } },
    location: { search }, URLSearchParams, console: { ...console, info() {} } });
    vm.runInContext(read('js/cycling.js'), c);
    const C = c.window.CITY, b = C.CYCLING_BANDS[0];
    return { bent: b.P !== b.mapped, platforms: C.bikeDetourStats.platforms, mapped: C.bikewayIntrusion(0, 6, 0.05) > 0, routed: C.routedBikewayIntrusion(0, 6, 0.05) > 0 };
  };
  // July (live): bent, the platform's place clear of the bikeway as built
  assert.deepEqual(load({ month: 7, day: 15, source: 'liveDate' }), { bent: true, platforms: 1, mapped: true, routed: false });
  // November (live): no platforms tonight, so the track keeps its mapped line, over the empty curb lane
  assert.deepEqual(load({ month: 11, day: 15, source: 'live' }), { bent: false, platforms: 0, mapped: true, routed: true });
  // the season's edges, as cafeto-patios.js patioSeason
  assert.equal(load({ month: 6, day: 1 }).bent, true);
  assert.equal(load({ month: 9, day: 30 }).bent, true);
  assert.equal(load({ month: 5, day: 31 }).bent, false);
  assert.equal(load({ month: 10, day: 1 }).bent, false);
  // no SITE_DATE (node tools): the scene's 22 August, as before; ?patios=0 never bends
  assert.equal(load(null).bent, true);
  assert.equal(load({ month: 7, day: 15 }, '?patios=0').bent, false);
});

// The real city with the committed prebuilt layout (js/toronto-patios.js) and the parked cars' build
let built = null;
const city = () => (built ||= (() => {
  const world = loadParkingWorld();
  const placed = buildParkedCars(world);
  return { CITY: world.CITY, placed, deps: parkingDeps(world.CITY) };
})());

test('on the real city: the Danforth\'s and Bloor\'s tracks run round every platform in their place, whole and clear of the traffic', () => {
  const { CITY } = city();
  const sites = CITY.patioRows(CITY.PATIOS).filter((s) => s.bikeway > 0);
  assert.ok(sites.length >= 10, `${sites.length} platforms in a bikeway's place`);
  assert.ok(CITY.bikeDetourStats.bands >= 7);
  const { gap } = CITY.BIKE_DETOUR;
  const lanes = CITY.parkingLaneSegments(CITY.GEO);
  const runs = CITY.bikeSeparatorRuns();
  for (const s of sites) {
    const hl = s.length / 2, hd = s.depth / 2;
    const frame = (p) => ({ u: (p.x - s.cx) * s.tx + (p.z - s.cz) * s.tz, v: (p.x - s.cx) * s.nx + (p.z - s.cz) * s.nz });
    // the band beside it, bent
    const band = CITY.CYCLING_BANDS.find((b) => b.P !== b.mapped && b.P.some((p) => { const f = frame(p); return Math.abs(f.u) < hl && Math.abs(f.v) < 6; }));
    assert.ok(band, `${s.id}: a bikeway routed round it`);
    // continuous beside it (no step over 0.6 m), never on it: every point's curb side beyond the barrier
    const beside = band.P.filter((p) => Math.abs(frame(p).u) <= hl + 1);
    assert.ok(beside.length >= 2 * hl, `${s.id}: resampled beside it`);
    for (let i = 1; i < beside.length; i++) assert.ok(Math.hypot(beside[i].x - beside[i - 1].x, beside[i].z - beside[i - 1].z) < 0.6, `${s.id}: a gap`);
    for (const p of beside) {
      const { u, v } = frame(p);
      if (Math.abs(u) <= hl) assert.ok(-v - hd >= gap - 0.06, `${s.id}: the track ${(-v - hd).toFixed(2)} m off the platform`);
    }
    // its separator alongside, the track at least CaféTO's 1.2 m wide, and the reserve's road side clear of the lanes
    const run = runs.find((r) => r.P.some((p) => Math.abs(frame(p).u) < hl && Math.abs(frame(p).v) < 6));
    assert.ok(run, `${s.id}: the separator runs past it`);
    for (const p of run.P.filter((q) => Math.abs(frame(q).u) <= hl)) {
      assert.ok(run.a(p) >= 1.2, `${s.id}: the track ${run.a(p).toFixed(2)} m wide`);
      const res = CITY.BIKE_WIDTHS.RESERVE[band.kind] - (p.sq || 0);
      const x = p.x + p.nx * res, z = p.z + p.nz * res;
      for (const l of lanes) {
        if (Math.abs(l[0] - x) > 80 && Math.abs(l[2] - x) > 80) continue;
        const ex = l[2] - l[0], ez = l[3] - l[1], t = Math.max(0, Math.min(1, ((x - l[0]) * ex + (z - l[1]) * ez) / (ex * ex + ez * ez || 1)));
        const d = Math.hypot(l[0] + ex * t - x, l[1] + ez * t - z);
        // (a lane centre on the far side of the reserve's edge, by the CaféTO platforms' and the bikeways' 1.5 m)
        if (((l[0] + ex * t - x) * p.nx + (l[1] + ez * t - z) * p.nz) > 0) assert.ok(d >= 1.5 - 0.05, `${s.id}: a lane ${d.toFixed(2)} m from the detour`);
      }
    }
  }
});

test('on the real city: Danforth and Bloor park beyond the cycle track, and no car stands in a cycle track or its detours', () => {
  const { CITY, placed, deps } = city();
  const { stalls, PARKED } = placed;
  const on = (re) => stalls.filter((s) => re.test(s.road));
  for (const [re, min] of [[/^Danforth Avenue$/, 50], [/^Bloor Street West$/, 200]]) {
    const list = on(re);
    assert.ok(list.length >= min, `${re}: ${list.length} stalls`);
    assert.ok(list.filter((s) => s.track > 0).length >= 0.9 * list.length, `${re}: floating beyond the track`);
  }
  // only on the streets checked against the aerials (parking-layout.js FLOATING_STREETS); the other cycle tracks
  // (Shuter, Harbord, Hoskin...) keep their curbs clear
  const floating = new Set(CITY.PARKING_RULES.floatingStreets);
  const elsewhere = stalls.filter((s) => s.track > 0 && !floating.has(s.road));
  assert.equal(elsewhere.length, 0, `floating on ${[...new Set(elsewhere.map((s) => s.road))].join(', ')}`);
  for (const s of stalls.filter((q) => q.track > 0)) {
    // the cycle track between the stall and the curb, the stall itself clear of it
    const v = s.rect.hd + 0.6;
    assert.ok(deps.trackAt(s.x + s.nx * v, s.z + s.nz * v), `stall at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}: the track on its curb side`);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      const r = s.rect, x = r.cx + r.tx * a * r.hl + r.nx * b * r.hd, z = r.cz + r.tz * a * r.hl + r.nz * b * r.hd;
      assert.ok(!deps.bikewayAt(x, z), 'a floating stall clear of the bikeway');
    }
  }
  // every car's body clear of every bikeway as built, the detours round the platforms included (its footprint less 5 cm,
  // and 15 cm on its sides: a car stands 0.15-0.35 m off the curb, and a few bikeways run along it behind the curb)
  const F = Object.fromEntries(PARKED.fields.map((k, i) => [k, i]));
  const BODY = { sedan: [2.25, 0.95], suv: [2.34, 0.97], minivan: [2.59, 0.97], pickup: [2.84, 1.0], van: [2.94, 0.98] };
  let checked = 0;
  for (const c of PARKED.cars) {
    const [hl, hw] = BODY[PARKED.kinds[c[F.kind]]], yaw = c[F.yaw], tx = Math.sin(yaw), tz = Math.cos(yaw);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, -1], [0, 1]]) {
      const x = c[F.x] + tx * a * (hl - 0.05) + tz * b * (hw - 0.15), z = c[F.z] + tz * a * (hl - 0.05) - tx * b * (hw - 0.15);
      assert.equal(CITY.routedBikewayIntrusion(x, z, 0), 0, `a car at ${c[F.x]}, ${c[F.z]} in a bikeway`);
      // and as mapped: out of the CaféTO season (seasons.js CITY.SITE_DATE) the bands keep their mapped lines, and the
      // same prebuilt cars stand beside them
      assert.equal(CITY.bikewayIntrusion(x, z, 0), 0, `a car at ${c[F.x]}, ${c[F.z]} in a bikeway as mapped (no patios)`);
    }
    checked++;
  }
  assert.equal(checked, PARKED.cars.length);
  // none beside a platform in a bikeway's place: the detour takes that parking lane
  for (const p of CITY.patioRows(CITY.PATIOS).filter((s) => s.bikeway > 0)) {
    for (const s of stalls) {
      const u = (s.x - p.cx) * p.tx + (s.z - p.cz) * p.tz, v = (s.x - p.cx) * p.nx + (s.z - p.cz) * p.nz;
      if (Math.abs(v) < 8) assert.ok(Math.abs(u) - s.rect.hl > p.length / 2 + CITY.BIKE_DETOUR.margin, `a stall beside the platform ${p.id}`);
    }
  }
});
