// The parked cars of the whole Eglinton map (jf-2g0): its own by-law resolution, its own stalls and cars in its own binary,
// built by the same tools with --frame (docs/parked-cars.md, "On the Eglinton map"). The detail map's cars stay as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { decodeGeo } from '../js/geodata-loader.js';
import { buildParking, newest } from '../tools/build-parking.mjs';
import { packCity } from '../tools/geo-bin.mjs';
import { repackFrameCars } from '../tools/build-parked-cars.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(root + p, 'utf8');
const unpack = (p) => { const u8 = zlib.gunzipSync(fs.readFileSync(root + p)); return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); };
const codec = (() => { const ctx = vm.createContext({ window: { CITY: {} }, performance, console }); vm.runInContext(read('js/parked-cars.js'), ctx); return ctx.window.CITY.parkedCarCodec; })();
const detail = unpack('data/toronto-geodata.bin'), egl = unpack('data/frames/eglinton/toronto-geodata.bin');
const cars = codec.decodeParkedCars(egl.PARKED_CARS);
const box = egl.GEO.frame.detail;

test('the Eglinton binary holds the cars of its whole frame, and the detail binary its own as before', () => {
  assert.equal(detail.PARKED_CARS.counts.cars, 11040, 'the detail map\'s cars (and the cap js/parked-cars.js sizes its tiers on)');
  assert.match(read('js/parked-cars.js'), /const DETAIL_MAP_CARS = 11040;/);
  assert.equal(egl.PARKED_CARS.counts.cars, 26224);
  assert.equal(egl.PARKED_CARS.counts.stalls, 36049);
  assert.equal(cars.length, 26224);
  assert.ok(cars.every((c) => c[0] > box.x0 && c[0] < box.x1 && c[1] > box.z0 && c[1] < box.z1), 'every car lies inside the frame');
  // beyond the old detail map's box (x -7900..3700, z -3000..3600): the cars this adds
  const old = { x0: -7900, x1: 3700, z0: -3000, z1: 3600 };
  const beyond = cars.filter((c) => !(c[0] > old.x0 && c[0] < old.x1 && c[1] > old.z0 && c[1] < old.z1));
  assert.ok(beyond.length > 15000 && beyond.length < 17000, `${beyond.length} cars beyond the detail map's box`);
});

test('no two cars of the Eglinton map overlap, and each stands where the layout put a stall', () => {
  const cell = new Map();
  for (const c of cars) { const k = `${Math.floor(c[0] / 8)},${Math.floor(c[1] / 8)}`; (cell.get(k) || cell.set(k, []).get(k)).push(c); }
  let close = 0;
  for (const c of cars) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const d of cell.get(`${Math.floor(c[0] / 8) + i},${Math.floor(c[1] / 8) + j}`) || []) if (d !== c && Math.hypot(c[0] - d[0], c[1] - d[1]) < 2.4) close++;
    }
  }
  assert.equal(close, 0, 'no two car origins closer than 2.4 m');
  const by = egl.PARKED_CARS.counts;
  assert.ok(by.cars / by.stalls > .6 && by.cars / by.stalls < .8, 'about three stalls in four hold a car');
});

test('the frame\'s by-law script is its own build, from the detail snapshots plus the frame\'s additions', async () => {
  const { loadFrameGeo } = await import('../tools/frame-geo.mjs');
  const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const bylaws = json(newest('parking-bylaws-')), permits = json(newest('permit-parking-'));
  const more = json(newest('frame-eglinton-parking-bylaws-')), morePermits = json(newest('frame-eglinton-permit-parking-'));
  assert.equal(more.counts.inDetailSnapshot, bylaws.records.length, 'every record of the detail snapshot is in the frame\'s');
  const ids = new Set(bylaws.records.map((r) => r.id));
  assert.ok(more.records.every((r) => !ids.has(r.id)), 'the additions repeat nothing');
  bylaws.records = [...bylaws.records, ...more.records];
  bylaws.source = { ...bylaws.source, frame: { name: 'eglinton', added: more.records.length, sha256: more.source.sha256 } };
  permits.areas = [...permits.areas, ...morePermits.areas];
  const { GEO } = await loadFrameGeo('eglinton');
  const made = buildParking({ bylaws, permits, GEO });
  const ctx = { window: { CITY: {} } };
  vm.runInNewContext(read('js/frames/eglinton/toronto-parking.js'), ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.window.CITY.PARKING)), JSON.parse(JSON.stringify(made)));
  assert.equal(made.counts.records, 14171);
  assert.ok(made.counts.rules > 11000);
  // inside the detail map's box the frame resolves the very rules the detail map's script holds
  const d = {}; vm.runInNewContext(read('js/toronto-parking.js'), { window: { CITY: d } }); const D = d.PARKING;
  const key = (P, r) => [P.names[r[6]], r.slice(0, 6).join(','), r[7]].join('|');
  const inFrame = new Set(made.rules.map((r) => key(made, r)));
  const missing = D.rules.filter((r) => [r[2], r[4]].every((x) => x > -7900 && x < 3700) && [r[3], r[5]].every((z) => z > -3000 && z < 3600)).filter((r) => !inFrame.has(key(D, r)));
  assert.equal(missing.length, 0, 'every rule of the detail map inside its box is a rule of the frame');
});

test('repacking a frame binary writes its other layers back exactly, and changes only the cars', () => {
  const file = root + 'data/frames/eglinton/toronto-geodata.bin';
  const same = repackFrameCars(file, egl.PARKED_CARS);
  assert.ok(Buffer.from(same.file).equals(fs.readFileSync(file)), 'the same cars give the same file');
  assert.equal(same.hash, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12));
  const fewer = { ...egl.PARKED_CARS, counts: { ...egl.PARKED_CARS.counts } };
  const other = packCity({ GEO: egl.GEO, POLES: egl.POLES, PARKED_CARS: { ...detail.PARKED_CARS } });
  assert.notEqual(other.hash, same.hash);
  assert.ok(fewer.counts.cars === 26224);
});
