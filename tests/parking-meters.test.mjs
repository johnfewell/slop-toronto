import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parkingMeters } from '../tools/build-parking-meters.mjs';

const context = { window: { CITY: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../js/toronto-geodata.js',import.meta.url),'utf8'),context);
const frame = context.window.CITY.GEO.frame;
const snapshot = JSON.parse(fs.readFileSync(new URL('../tools/data/parking-meters-20261028.json',import.meta.url),'utf8'));
vm.runInNewContext(fs.readFileSync(new URL('../js/parking-meter-layout.js',import.meta.url),'utf8'),context);
const sites = context.window.CITY.parkingMeterSites;

test('real TPA snapshot keeps hardware IDs distinct from shared payment zones', () => {
  const data = parkingMeters(snapshot,frame);
  assert.equal(data.records.length,776);
  assert.equal(new Set(data.records.map((r)=>r.id)).size,data.records.length);
  assert.ok(new Set(data.records.map((r)=>r.zone)).size<data.records.length);
  const photo = data.records.find((r)=>r.id==='5019-1022');
  assert.equal(photo.zone,'5008');
  assert.match(photo.address,/460 Roncesvalles/);
  assert.ok(data.records.every((r)=>Number.isFinite(r.x)&&Number.isFinite(r.z)));
  assert.equal(data.rejected.ambiguous,6);
  assert.equal(data.rejected.retired,1);
});

test('incomplete downloads and invalid coordinates cannot produce scenery', () => {
  const truncated = structuredClone(snapshot);
  truncated.installs.exceededTransferLimit=true;
  assert.throws(()=>parkingMeters(truncated,frame),/Incomplete/);
  const invalid=structuredClone(snapshot);
  invalid.installs.features[0].geometry.x=0;
  assert.throws(()=>parkingMeters(invalid,frame),/Invalid/);
});

test('placement moves a cabinet onto the same sidewalk without moving it arbitrarily', () => {
  const block={};
  const deps={nearestRoads:()=>[{px:0,pz:0,road:{raised:false}}],blockAt:(x,z)=>x>=1&&x<5?block:null,blocked:()=>false};
  const result=sites([{id:'a',x:1,z:0}],deps);
  assert.equal(result.sites.length,1);
  assert.equal(result.sites[0].shifted,0.5);
  assert.ok(result.sites[0].shifted<=1.25);
  assert.equal(sites([{id:'road',x:0,z:0}],deps).sites.length,0);
  assert.equal(sites([{id:'obstructed',x:1,z:0}],{...deps,blocked:()=>true}).sites.length,0);
  assert.equal(sites([{id:'docks',x:1,z:0}],{...deps,bikeShareAt:()=>true}).sites.length,0);
});

test('unplaceable, elevated and duplicate nearby machines are rejected', () => {
  const block={};
  const deps={nearestRoads:()=>[{px:0,pz:0,road:{raised:false}}],blockAt:()=>block,blocked:()=>false};
  assert.equal(sites([{id:'none',x:2,z:0}],{...deps,blockAt:()=>null}).sites.length,0);
  assert.equal(sites([{id:'deck',x:2,z:0}],{...deps,nearestRoads:()=>[{road:{raised:true}}]}).sites.length,0);
  assert.equal(sites([{id:'a',x:2,z:0},{id:'b',x:2,z:0}],{...deps,blocked:(x)=>x>2.5}).sites.length,1);
});
