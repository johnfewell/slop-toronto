// tools/build-building-inputs.mjs (st-ndw9.5 fix 1): the committed input file is compact — one array per column in
// sidecar order, lengths and heights in tenths, strings as enums, no derived sidecarId — and carries the shared
// buildings/4 dataset's fields (and the two worship columns and the school-grounds flag it adds); every record joined; the pin matches the file and the dataset; the join handles the
// multi-part convention; and the script refuses to rebuild without the shared cache. Reads committed data only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingId } from '../js/massing-data.js';
import { COLUMNS, OSM_CLASS_NAMES, FORM_NAMES, SCALE, joinRows, derivedSidecarId } from '../tools/build-building-inputs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = path.join(ROOT, 'tools/data/building-inputs.json');
const inputs = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const pin = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/shared-toronto-data-pin.json'), 'utf8')).datasets['buildings/4'];
const D = inputs.data;

async function geodata() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8'), ctx);
  return ctx.window.CITY.GEO;
}
function fids() {
  const out = new Array(inputs.records);
  let f = 0;
  for (let i = 0; i < inputs.records; i++) { f += D.fidDelta[i]; out[i] = f; }
  return out;
}

test('the header names the shared buildings/4 dataset, the columns, the enums and the parameters', () => {
  assert.equal(inputs.generatedBy, 'tools/build-building-inputs.mjs');
  assert.ok(inputs.since);
  assert.deepEqual(inputs.columns, COLUMNS);
  const ds = inputs.sources.dataset;
  assert.equal(ds.dataset, 'buildings/4');
  for (const key of ['manifestCommit', 'manifestGenerated', 'indexSha256', 'cellsDigest']) assert.ok(ds[key], `dataset.${key}`);
  assert.ok(ds.cells > 0 && ds.rows >= inputs.records);
  assert.deepEqual(inputs.enums.use, OSM_CLASS_NAMES);
  assert.deepEqual(inputs.enums.form, FORM_NAMES);
  for (const key of ['houseMaxPerDwellingM2', 'houseMaxAreaM2', 'houseMaxHeightM', 'excludeOsm', 'storeyM']) assert.ok(inputs.parameters[key] != null, `parameters.${key}`);
  assert.equal(inputs.parameters.houseMaxPerDwellingM2, 250);
  assert.equal(inputs.parameters.houseMaxAreaM2, 800);
  assert.equal(inputs.parameters.houseMaxHeightM, 11);
  assert.ok(!JSON.stringify(inputs).includes(['', 'Users', ''].join('/')), 'no home-folder path in the file');
});

test('the file is compact: under 2.5 MB, one array per column, no object per record', () => {
  // (st-ndw9.16: buildings/4 adds four columns - religion, tradition, worshipSource as small integers and the
  // school-grounds 0/1 flag - which take the file from 1.70 MB to 2.07 MB; the columns stay parallel arrays)
  const bytes = fs.statSync(FILE).size;
  assert.ok(bytes < 2.5 * 1024 * 1024, `${(bytes / 1024 / 1024).toFixed(2)} MB`);
  for (const c of COLUMNS) {
    assert.ok(Array.isArray(D[c]), `data.${c} is an array`);
    assert.equal(D[c].length, inputs.records, `data.${c} length`);
  }
  assert.ok(!Array.isArray(inputs.records), 'no row objects');
});

test('the two st-ndw9.10 columns: a valid neighbourhood or null, and a construction year or null', () => {
  assert.ok(COLUMNS.includes('neighbourhood') && COLUMNS.includes('yearBuilt'), 'the new columns are in the file');
  let withNb = 0, withYear = 0;
  const nbs = new Set();
  for (let i = 0; i < inputs.records; i++) {
    const nb = D.neighbourhood[i];
    if (nb != null) { assert.ok(Number.isInteger(nb) && nb > 0, `${i}: neighbourhood ${nb}`); withNb++; nbs.add(nb); }
    const y = D.yearBuilt[i];
    if (y != null) { assert.ok(Number.isInteger(y) && y >= 1600 && y <= 2100, `${i}: year ${y}`); withYear++; }
  }
  assert.equal(withNb, inputs.records, 'every record sits in a neighbourhood');
  assert.ok(nbs.size >= 30, `${nbs.size} neighbourhoods`);
  assert.ok(withYear > 2000, `${withYear} dated records`);
  assert.equal(withNb, inputs.checks.neighbourhoodRecords);
  assert.equal(withYear, inputs.checks.yearBuiltRecords);
  assert.deepEqual([...nbs].sort((a, b) => a - b), inputs.checks.neighbourhoodsUsed);
  assert.equal(inputs.checks.recordsWithoutNeighbourhood, inputs.records - withNb);
  assert.equal(inputs.sources.neighbourhoods.dataset, 'neighbourhood-era/1');
  assert.match(inputs.sources.neighbourhoods.sha256, /^[0-9a-f]{64}$/);
});

test('one record per sidecar record, in sidecar record order; fid rebuilt from fidFirst and fidDelta', async () => {
  const { MASSING: M } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
  assert.equal(inputs.records, M.fid.length);
  assert.equal(inputs.records, 35254);
  const fid = fids();
  assert.equal(inputs.fidFirst, M.fid[0]);
  for (let i = 0; i < M.fid.length; i++) {
    assert.equal(fid[i], M.fid[i], `record ${i}: fid`);
    assert.equal(D.k[i], M.part[i] ? M.part[i] - 1 : 0, `record ${i}: k`);
  }
});

test('the four buildings/4 columns: a religion, tradition and worship source or the -1 none, and the school-grounds flag', () => {
  assert.ok(COLUMNS.slice(-4).join() === 'religion,tradition,worshipSource,schoolGround', 'the new columns are last');
  assert.deepEqual(inputs.worshipEnums.religion, ['christian', 'muslim', 'jewish', 'buddhist', 'hindu', 'sikh', 'other', 'unknown']);
  assert.deepEqual(inputs.worshipEnums.tradition, ['roman catholic', 'anglican', 'united', 'presbyterian', 'baptist', 'lutheran', 'orthodox', 'pentecostal and evangelical', 'other', 'unknown']);
  assert.deepEqual(inputs.worshipEnums.worshipSource, ['osm', 'city', 'osm-name', 'city-name']);
  let religion = 0, tradition = 0, source = 0, school = 0;
  for (let i = 0; i < inputs.records; i++) {
    assert.ok(D.religion[i] === -1 || (D.religion[i] >= 0 && D.religion[i] < 8), `${i}: religion`);
    assert.ok(D.tradition[i] === -1 || (D.tradition[i] >= 0 && D.tradition[i] < 10), `${i}: tradition`);
    assert.ok(D.worshipSource[i] === -1 || (D.worshipSource[i] >= 0 && D.worshipSource[i] < 4), `${i}: worship source`);
    assert.ok(D.schoolGround[i] === 0 || D.schoolGround[i] === 1, `${i}: school ground`);
    if (D.religion[i] >= 0) religion++;
    if (D.tradition[i] >= 0) tradition++;
    if (D.worshipSource[i] >= 0) source++;
    if (D.schoolGround[i] === 1) school++;
  }
  assert.equal(religion, inputs.checks.religionRecords);
  assert.equal(tradition, inputs.checks.traditionRecords);
  assert.equal(source, inputs.checks.worshipSourceRecords);
  assert.equal(school, inputs.checks.schoolGroundRecords);
  // (every group's parts carry the same religion: the field is per place of worship, not per part)
  assert.ok(religion > 0 && school > 0);
});

test('the columns decode to finite lengths and heights, valid enums and 0/1 flags', () => {
  for (let i = 0; i < inputs.records; i++) {
    for (const c of ['area', 'depth', 'maxHeight', 'avgHeight', 'base', 'canopyHeight']) {
      assert.ok(Number.isFinite(D[c][i]) && D[c][i] >= 0, `${i}: ${c}`);
      assert.equal(D[c][i], Math.round(D[c][i]), `${i}: ${c} is a whole number of tenths`);
    }
    assert.ok(Number.isInteger(D.addressPoints[i]) && D.addressPoints[i] >= 0, `${i}: address points`);
    assert.ok(Number.isInteger(D.dwellings[i]) && D.dwellings[i] >= 0, `${i}: dwellings`);
    for (const c of ['shop', 'outbuilding', 'houseScale']) assert.ok(D[c][i] === 0 || D[c][i] === 1, `${i}: ${c}`);
    assert.ok(D.use[i] >= 0 && D.use[i] < OSM_CLASS_NAMES.length, `${i}: use`);
    assert.ok(D.form[i] >= 0 && D.form[i] < FORM_NAMES.length, `${i}: form`);
    assert.ok(D.group[i] === -1 || (Number.isInteger(D.group[i]) && D.group[i] >= 0), `${i}: group`);
  }
  assert.ok(Object.keys(SCALE).every((c) => COLUMNS.includes(c)), 'the scaled columns are in the file');
});

test('the join: every sidecar record matched a dataset row, and no row went to two records', () => {
  const c = inputs.checks;
  assert.equal(c.sidecarRecords, 35254);
  assert.equal(c.matchedByFidK + c.matchedByFidSinglePart + c.unmatched, c.sidecarRecords);
  assert.equal(c.matchedByFidK, 35250);
  assert.equal(c.matchedByFidSinglePart, 4);
  assert.equal(c.fallbackIds.length, c.matchedByFidSinglePart);
  assert.equal(c.unmatched, 0);
  assert.deepEqual(c.unmatchedIds, []);
  assert.equal(c.everySidecarRecordMatched, true);
  assert.equal(c.rowsUnique, true);
  assert.ok(c.datasetCells > 0 && c.datasetRowsRead >= c.sidecarRecords);
  // (the sidecar's durable id from fid and k, with the two source-ring-index exceptions named)
  assert.equal(c.idSuffixExceptions.length, 2);
  assert.deepEqual(c.idSuffixExceptions, ['to-3dmassing-2025:101713.0', 'to-3dmassing-2025:354892.0']);
  for (const id of c.fallbackIds) assert.match(id, /^to-3dmassing-2025:\d+\.\d+$/, id);
});

test('the pin matches the committed file and the dataset the file names', () => {
  assert.ok(pin, 'buildings/4 in data/shared-toronto-data-pin.json');
  assert.deepEqual(pin.bakedInto, ['tools/data/building-inputs.json']);
  assert.equal(pin.dataSha256, crypto.createHash('sha256').update(fs.readFileSync(FILE)).digest('hex'));
  assert.equal(pin.indexSha256, inputs.sources.dataset.indexSha256);
  assert.equal(pin.cellsDigest, inputs.sources.dataset.cellsDigest);
  assert.equal(pin.manifestCommit, inputs.sources.dataset.manifestCommit);
  assert.equal(pin.manifestGenerated, inputs.sources.dataset.manifestGenerated);
  assert.ok(!JSON.stringify(pin).includes(os.homedir()), 'no path in the pin');
});

test('the pin carries the neighbourhood-era/1 entry (st-ndw9.10), in the same shape', () => {
  const nb = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/shared-toronto-data-pin.json'), 'utf8')).datasets['neighbourhood-era/1'];
  assert.ok(nb, 'neighbourhood-era/1 in the pin');
  assert.deepEqual(nb.bakedInto, ['tools/data/building-inputs.json']);
  assert.equal(nb.dataSha256, crypto.createHash('sha256').update(fs.readFileSync(FILE)).digest('hex'));
  assert.equal(nb.indexSha256, inputs.sources.neighbourhoods.sha256);
  assert.match(nb.manifestCommit, /^[0-9a-f]+$/);
  assert.match(nb.manifestGenerated, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(nb.features, 158);
  assert.ok(!JSON.stringify(nb).includes(os.homedir()), 'no path in the pin entry');
});

test('the address-point distribution over the 16,073 kind 0 records is within 1% of the brief', async () => {
  const GEO = await geodata();
  const { MASSING: M } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
  const expected = { '0': 1918, '1': 7983, '2': 4800, '3': 703, '4': 319, '5+': 350 };
  const actual = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5+': 0 };
  let kind0 = 0;
  for (let i = 0; i < inputs.records; i++) {
    if (GEO.buildings[M.row[i]][5] !== 0) continue;
    kind0++;
    const n = D.addressPoints[i];
    actual[n >= 5 ? '5+' : String(n)]++;
  }
  assert.equal(kind0, 16073, 'the kind 0 records');
  for (const b of Object.keys(expected)) {
    assert.ok(Math.abs(actual[b] - expected[b]) <= 0.01 * expected[b], `bucket ${b}: ${actual[b]} vs ${expected[b]}`);
  }
  assert.equal(Object.values(actual).reduce((s, v) => s + v, 0), kind0);
});

test('without the shared cache the script refuses to rebuild and says why', () => {
  const none = spawnSync(process.execPath, [path.join(ROOT, 'tools/build-building-inputs.mjs')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TORONTO_DATA_CACHE: '' } });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /TORONTO_DATA_CACHE/);
  assert.match(none.stderr, /buildings\/4/);
});

test('the join: exact (fid, k), the single-part fid fallback, an ambiguous fid left alone, and no row used twice', () => {
  const rows = [
    { fid: 1, k: 0 }, { fid: 2, k: 0 }, { fid: 2, k: 1 }, { fid: 3, k: 0 }, { fid: 4, k: 0 }, { fid: 4, k: 1 }, { fid: 6, k: 0 }
  ];
  const byFidK = new Map(rows.map((r) => [`${r.fid}:${r.k}`, r]));
  const byFid = new Map();
  for (const r of rows) (byFid.get(r.fid) || byFid.set(r.fid, []).get(r.fid)).push(r);
  const side = [
    { fid: 1, k: 0 }, // exact
    { fid: 2, k: 1 }, // exact, multi-part
    { fid: 3, k: 1 }, // the dataset wrote the one kept part as single-part (k 0)
    { fid: 4, k: 0 }, // exact
    { fid: 4, k: 1 }, // exact
    { fid: 7, k: 0 } // nothing for fid 7
  ];
  const j = joinRows(side, { byFidK, byFid });
  assert.equal(j.exact, 4);
  assert.equal(j.byFid, 1);
  assert.deepEqual(j.fallbackIds, ['to-3dmassing-2025:3.1']);
  assert.equal(j.unmatched, 1);
  assert.deepEqual(j.unmatchedIds, ['to-3dmassing-2025:7.0']);
  assert.deepEqual(j.joined[2], { fid: 3, k: 0 });
  assert.equal(new Set(j.joined.filter(Boolean).map((r) => `${r.fid}:${r.k}`)).size, 5);
  // (two sidecar records on one fid with no exact match: the fid's one row may not serve both)
  const j2 = joinRows([{ fid: 6, k: 0 }, { fid: 6, k: 1 }], { byFidK: new Map(), byFid: new Map([[6, [{ fid: 6, k: 0 }]]]) });
  assert.equal(j2.unmatched, 2);
  assert.equal(j2.byFid, 0);
  // (the durable id from fid, k and the multi-part fids; the one-row k=0 case takes the exception)
  const multi = new Set([2, 4, 6]);
  assert.equal(derivedSidecarId(2, 1, multi), 'to-3dmassing-2025:2.1');
  assert.equal(derivedSidecarId(4, 0, multi), 'to-3dmassing-2025:4.0');
  assert.equal(derivedSidecarId(1, 0, multi), 'to-3dmassing-2025:1');
});