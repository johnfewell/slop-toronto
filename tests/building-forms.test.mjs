// tools/report-building-forms.mjs (st-ndw9.5 fix 1): the recount runs on the compact committed inputs alone (no raw
// cache), every record lands in exactly one building, the building sums agree, the forms rank with shares that add up,
// the address histogram over the kind 0 records is within 1%, Kensington Market splits, the seeded examples carry
// durable IDs and six-decimal lat/lon, the buildings/3 house test is re-derived from the inputs file's parameters, the
// three runs are present, and two runs give identical bytes. It changes nothing the page loads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  run, isHouseScale, houseRule, nonHouseFamily, suggestPreset, FORM_FAMILIES, HOUSE_FORMS
} from '../tools/report-building-forms.mjs';
import { OSM_CLASS } from '../tools/build-building-inputs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = await run({ examples: 12 });
const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/building-forms.json'), 'utf8'));
const rule = houseRule(out.parameters);

test('every massing record is in exactly one building, and the sums agree', () => {
  assert.equal(out.city.records, 35254, 'the detailed city\'s massing records');
  assert.equal(out.checks.recordSum, out.city.records, 'records in the buildings');
  assert.equal(out.checks.everyRecordOnce, true, 'every record once');
  assert.equal(out.checks.houseBuildings + out.checks.nonHouseBuildings, out.city.buildings);
  assert.equal(out.checks.houseRecords + out.checks.nonHouseRecords, out.city.records);
  assert.ok(Math.abs(out.checks.buildingShareSum - 1) < 1e-6, 'count shares sum to 1');
  assert.ok(Math.abs(out.checks.areaShareSum - 1) < 1e-6, 'area shares sum to 1');
  assert.equal(out.city.buildings, 22737, 'the joined buildings');
  assert.equal(out.city.houseBuildings, 18409);
  assert.equal(out.city.nonHouseBuildings, 4328);
});

test('house-scale, dwellings, form and the group come from the inputs file', () => {
  // (the dataset's own flag is the headline; the re-derived rule is the sensitivity control, within the 0.1 rounding)
  assert.equal(out.checks.houseScaleRecords, 22530);
  assert.ok(out.checks.datasetFlagDisagrees <= 20, `${out.checks.datasetFlagDisagrees} disagree by 0.1 rounding`);
  assert.ok(out.checks.datasetFlagAgrees > 35230);
  assert.equal(out.checks.formInconsistent, 0, 'one form per group');
  // (a house building is a joined group whose form is detached, semi or row)
  assert.deepEqual(HOUSE_FORMS, ['detached', 'semi', 'row']);
  const formCount = (f) => out.forms.filter((x) => x.family === f).reduce((s, x) => s + x.count, 0);
  assert.equal(formCount('detached') + formCount('semi') + formCount('row'), out.checks.houseBuildings);
  assert.equal(formCount('detached'), 9168);
  assert.equal(formCount('semi'), 6291);
  assert.equal(formCount('row'), 2950);
  // (the dataset's own outbuilding form; the report's wider 'outbuilding' family also takes OSM sheds)
  assert.equal(out.forms.filter((x) => x.id === 'outbuilding').reduce((s, x) => s + x.count, 0), 95);
  for (const g of out.forms.slice(0, 25)) {
    if (g.family === 'detached' || g.family === 'semi' || g.family === 'row') assert.equal(g.id, `house ${g.family}`);
  }
});

test('the inputs file is compact and its house thresholds are recorded', () => {
  // (st-ndw9.16: buildings/4's four new columns take the inputs file from 1.70 MB to 2.07 MB)
  assert.ok(out.inputs.bytes < 2.5 * 1024 * 1024, `${(out.inputs.bytes / 1024 / 1024).toFixed(2)} MB`);
  assert.equal(out.parameters.houseMaxPerDwellingM2, 250);
  assert.equal(out.parameters.houseMaxAreaM2, 800);
  assert.equal(out.parameters.houseMaxHeightM, 11);
  assert.deepEqual(out.parameters.excludeOsm, ['business', 'worship', 'civic', 'industrial', 'shed', 'apartments']);
  assert.equal(out.inputs.checks.everySidecarRecordMatched, true);
  assert.equal(out.inputs.checks.rowsUnique, true);
  assert.equal(out.inputs.checks.unmatched, 0);
  assert.equal(out.inputs.checks.matchedByFidK, 35250);
  assert.equal(out.inputs.checks.matchedByFidSinglePart, 4);
});

test('the cross-table of old kind against new form covers every record', () => {
  const total = Object.values(out.crossTotals).reduce((s, v) => s + v, 0);
  assert.equal(total, out.city.records, 'every record lands in a form family');
  assert.equal(out.crossTotals['mid-rise'], 9503);
  assert.equal(out.crossTotals['low-rise'], 3672);
  assert.equal(out.houseScaleByKind['mid-rise'], 5169);
  assert.equal(out.houseScaleByKind['low-rise'], 1788);
  assert.ok(out.houseScaleByKind['mid-rise'] > 0 && out.houseScaleByKind['low-rise'] > 0, 'mid-rise and low-rise records are house-scale');
  for (const f of FORM_FAMILIES) assert.ok(f in out.crossTable.house, `family ${f}`);
});

test('the forms rank by buildings with share, cumulative share and area share', () => {
  const forms = out.forms;
  assert.ok(forms.length > 100, `a long tail of forms: ${forms.length}`);
  for (let i = 1; i < forms.length; i++) assert.ok(forms[i - 1].count >= forms[i].count, `form ${i} ranked`);
  assert.ok(Math.abs(forms.reduce((s, f) => s + f.share, 0) - 1) < 1e-9, 'count shares sum to 1');
  assert.ok(Math.abs(forms.reduce((s, f) => s + f.areaShare, 0) - 1) < 1e-9, 'area shares sum to 1');
  assert.ok(Math.abs(forms[forms.length - 1].cumShare - 1) < 1e-9, 'cumulative share reaches 1');
  assert.equal(forms[0].family, 'detached', 'the largest form is a house form');
  assert.ok(forms.slice(0, 25).every((f) => f.suggestion), 'the top 25 carry a worker\'s suggestion');
});

test('the house table covers every house building, with width and area quantiles', () => {
  let buildings = 0;
  for (const form of ['detached', 'semi', 'row']) for (const band of ['1', '1.5', '2', '2.5', '3+']) {
    const h = out.houseTable[form][band];
    buildings += h.buildings;
    if (h.buildings) {
      assert.ok(h.width.median > 0 && h.area.median > 0, `${form} ${band}: quantiles`);
      if (h.buildings > 1) {
        assert.ok(h.width.p10 <= h.width.median && h.width.median <= h.width.p90, `${form} ${band}: width order`);
        assert.ok(h.area.p10 <= h.area.median && h.area.median <= h.area.p90, `${form} ${band}: area order`);
      }
    }
  }
  assert.equal(buildings, out.checks.houseBuildings, 'every house building is in one storey band');
});

test('the threshold sensitivity re-derives buildings/3\'s three thresholds, with the base at the inputs parameters', () => {
  const by = Object.fromEntries(out.sensitivity.map((s) => [s.change, s]));
  assert.equal(by.base.maxPerDwelling, 250);
  assert.equal(by.base.maxArea, 800);
  assert.equal(by.base.maxHeight, 11);
  assert.ok(Math.abs(by.base.houseScaleRecords - out.checks.houseScaleRecords) <= 20, 'the base re-derives the dataset flag (0.1 rounding)');
  assert.equal(by.base.detached + by.base.semi + by.base.row, by.base.houseBuildings - out.checks.houseScaleGroupsNotHouseForm);
  assert.ok(by['per-dwelling +20%'].houseScaleRecords > by.base.houseScaleRecords);
  assert.ok(by['per-dwelling −20%'].houseScaleRecords < by.base.houseScaleRecords);
  assert.ok(by['total area +20%'].houseScaleRecords > by.base.houseScaleRecords);
  assert.ok(by['total area −20%'].houseScaleRecords < by.base.houseScaleRecords);
  assert.ok(by['canopy height +20%'].houseScaleRecords > by.base.houseScaleRecords);
  assert.ok(by['canopy height −20%'].houseScaleRecords < by.base.houseScaleRecords);
  assert.ok(by['all three +20%'].nonHouseBuildings < by.base.nonHouseBuildings);
  assert.ok(by['all three −20%'].nonHouseBuildings > by.base.nonHouseBuildings);
});

test('the address-point distribution over the 16,073 kind 0 records is within 1%', () => {
  assert.equal(out.addressCheck.kind0Records, 16073);
  assert.equal(out.addressCheck.within1pct, true);
  assert.equal(out.addressCheck.total, 16073);
  for (const b of out.addressCheck.buckets) assert.ok(b.within1pct, `bucket ${b.bucket}: ${b.actual} vs ${b.expected}`);
});

test('Kensington Market\'s split sums to its records and buildings', () => {
  const k = out.kensington;
  assert.equal(k.records, 647);
  assert.equal(k.buildings, 392);
  assert.equal(Object.values(k.byFamily).reduce((s, v) => s + v, 0), k.buildings);
  assert.equal(Object.values(k.byKind).reduce((s, v) => s + v, 0), k.records);
  assert.ok(k.byHouseForm.semi > 0 && k.byHouseForm.row > 0, 'Kensington reads as pairs and rows');
});

test('the three runs are beside each other', () => {
  const c = out.comparison;
  assert.equal(c.st103.buildings, 22855);
  assert.equal(c.st103.houseBuildings, 16095);
  assert.equal(c.st103.detached, 9050);
  assert.equal(c.buildings2.buildings, 22737);
  assert.equal(c.buildings2.houseBuildings, 15922);
  assert.equal(c.buildings2.detached, 8850);
  assert.equal(c.buildings3.buildings, out.city.buildings);
  assert.equal(c.buildings3.detached, 9168);
  assert.equal(c.buildings3.semi, 6291);
  assert.equal(c.buildings3.row, 2950);
  assert.equal(c.buildings3.houseScaleRecords, 22530);
  assert.equal(c.buildings3.label, 'buildings/4');
  assert.deepEqual(c.buildings3.crossTotals, out.crossTotals);
  // (within 1% of the coordinator's count over the dataset)
  const expected = { detached: 9174, semi: 6291, row: 2950, outbuilding: 95, other: 4236, total: 22746, houseScaleRecords: 22538 };
  const actual = { detached: 9168, semi: 6291, row: 2950, outbuilding: 95, other: 4328 - 95, total: out.city.buildings, houseScaleRecords: out.checks.houseScaleRecords };
  for (const k of Object.keys(expected)) assert.ok(Math.abs(actual[k] - expected[k]) <= 0.01 * expected[k], `${k}: ${actual[k]} vs ${expected[k]}`);
});

test('12 seeded examples per form for the top 15 forms, with durable IDs and six-decimal lat/lon', () => {
  assert.equal(out.exampleForms.length, 15);
  let all = 0;
  for (const f of out.exampleForms) {
    assert.equal(f.examples.length, 12, `${f.form}: twelve examples`);
    for (const e of f.examples) {
      all++;
      assert.ok(/^to-3dmassing-2025:\d+(\.\d+)?$/.test(e.id), `${e.id}: durable ID`);
      assert.equal(e.lat, +e.lat.toFixed(6), `${e.id}: lat six decimals`);
      assert.equal(e.lon, +e.lon.toFixed(6), `${e.id}: lon six decimals`);
      assert.ok(Math.abs(e.lat - 43.6453) < 0.3 && Math.abs(e.lon + 79.3806) < 0.4, `${e.id}: in the frame`);
      assert.ok(e.area > 0 && e.addressPoints >= 0 && e.records >= 1 && e.avgHeight > 0 && e.height > 0);
    }
  }
  assert.equal(all, 180, 'a positive control: 15 x 12');
});

test('the form helpers agree with the inputs file\'s rule', () => {
  const rec = (o) => ({ area: 100, addressPoints: 1, canopyHeight: 6, osmClass: OSM_CLASS.house, shop: false, outbuilding: false, ...o });
  assert.equal(isHouseScale(rec({}), rule), true);
  assert.equal(isHouseScale(rec({ area: 250 }), rule), false, 'per dwelling 250 is not under 250');
  assert.equal(isHouseScale(rec({ area: 249 }), rule), true);
  assert.equal(isHouseScale(rec({ area: 900 }), rule), false, 'the 800 m² total cap');
  assert.equal(isHouseScale(rec({ area: 700, addressPoints: 3 }), rule), true, 'a row drawn as one outline');
  assert.equal(isHouseScale(rec({ area: 700, addressPoints: 1 }), rule), false, 'per dwelling 700');
  assert.equal(isHouseScale(rec({ area: 700, addressPoints: 3, canopyHeight: 11 }), rule), false, 'canopy height');
  assert.equal(isHouseScale(rec({ area: 700, addressPoints: 3, canopyHeight: 10.9 }), rule), true);
  assert.equal(isHouseScale(rec({ shop: true }), rule), false, 'a shop');
  assert.equal(isHouseScale(rec({ outbuilding: true }), rule), false, 'an outbuilding');
  for (const cls of [OSM_CLASS.business, OSM_CLASS.worship, OSM_CLASS.civic, OSM_CLASS.apartments, OSM_CLASS.industrial, OSM_CLASS.shed]) {
    assert.equal(isHouseScale(rec({ osmClass: cls }), rule), false, `use class ${cls}`);
  }
  assert.equal(nonHouseFamily({ osmClass: OSM_CLASS.worship, heightBand: 'h2', streets: 1, totalArea: 100, maxHeight: 4 }), 'worship');
  assert.equal(nonHouseFamily({ osmClass: OSM_CLASS.civic, heightBand: 'h2', streets: 1, totalArea: 100, maxHeight: 4 }), 'civic');
  assert.equal(nonHouseFamily({ osmClass: OSM_CLASS.house, heightBand: 'h6', streets: 1, totalArea: 1000, maxHeight: 60 }), 'tower');
  assert.equal(suggestPreset({ family: 'worship', medianStoreys: 2 }), 'Church');
  assert.equal(suggestPreset({ family: 'detached', medianStoreys: 1.4, medianArea: 90 }), 'Postwar bungalow');
  assert.ok(FORM_FAMILIES.includes('detached') && FORM_FAMILIES.includes('tower'));
});

test('two runs give identical bytes, matching tools/building-forms.json', async () => {
  const again = await run({ examples: 12 });
  assert.equal(JSON.stringify(again), JSON.stringify(out));
  assert.equal(fs.readFileSync(path.join(ROOT, 'tools/building-forms.json'), 'utf8'), JSON.stringify(out, null, 2) + '\n');
  assert.equal(committed.generatedBy, 'tools/report-building-forms.mjs');
  assert.ok(Object.keys(committed).length > 0);
});