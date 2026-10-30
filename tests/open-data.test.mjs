import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { furniture } from '../tools/build-open-data.mjs';
import { cityFacilities } from '../tools/build-city-facilities.mjs';
const context = {window:{CITY:{}}};
context.window.CITY.TSL={};
for (const file of ['toronto-geodata','bench-layout','wayfinding']) vm.runInNewContext(fs.readFileSync(new URL(`../js/${file}.js`,import.meta.url),'utf8'),context);
const C = context.window.CITY;
test('City benches preserve Existing IDs/frontage, reject duplicates and clip to detail frame',()=>{
  const snapshot = JSON.parse(fs.readFileSync(new URL('../tools/data/benches-20261028.json',import.meta.url),'utf8'));
  const data = furniture(snapshot,C.GEO.frame);
  assert.equal(data.records.length,315);
  assert.equal(new Set(data.records.map((r)=>r.id)).size,315);
  assert.ok(data.records.every((r)=>r.id&&r.frontage&&r.type));
  assert.throws(()=>furniture({...snapshot,features:[snapshot.features[0],snapshot.features[0]]},C.GEO.frame),/duplicate/);
});
test('wayfinding keeps the two City asset families distinct',()=>{
  const data=furniture(load('wayfinding'),C.GEO.frame);
  assert.equal(data.records.length,272);
  assert.equal(data.records.filter((r)=>r.type==='TO360').length,228);
  assert.equal(data.records.filter((r)=>r.type==='Info Pillar').length,44);
  assert.equal(data.records.find((r)=>r.id==='IP-00839').frontage,'Dundas St W');
});
test('nearby map pool is bounded, stable and rejects invalid camera positions',()=>{
  const records=Array.from({length:12},(_,i)=>({id:String(i),x:i,z:0}));
  assert.equal(C.nearbyWayfinding(records,{x:0,z:0}).length,4);
  assert.equal(C.nearbyWayfinding(records,{x:1000,z:0}).length,0);
  assert.equal(C.nearbyWayfinding(records,{x:NaN,z:0}).length,0);
  assert.equal(C.nearbyWayfinding([{id:'b',x:1,z:0},{id:'a',x:-1,z:0}],{x:0,z:0})[0].id,'a');
});
test('shipped wayfinding assets stay within their reviewed triangle/material budgets',()=>{
  for(const [name,tris,maxBytes] of [['wayfinding',40,140000],['info-pillar',444,10000]]) {
    const bytes=fs.readFileSync(new URL(`../assets/props/${name}.glb`,import.meta.url));
    const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
    assert.ok(bytes.length<maxBytes);assert.equal(gltf.materials.length,1);
    assert.equal(gltf.meshes.reduce((n,m)=>n+m.primitives.reduce((n,p)=>n+gltf.accessors[p.indices].count/3,0),0),tris);
    assert.ok(gltf.extensionsRequired.includes('EXT_meshopt_compression'));
  }
});
const load=(slug)=>JSON.parse(fs.readFileSync(new URL(`../tools/data/${slug}-20261028.json`,import.meta.url),'utf8'));
test('complete City facility snapshots retain dated status and match existing geography',()=>{
  const snapshots={washroom:load('washroom-facilities'),facility:load('parks-and-recreation-facilities')};
  const data=cityFacilities(snapshots,C.GEO);
  assert.equal(data.records.filter((r)=>r.kind==='washroom').length,78);
  assert.equal(data.records.filter((r)=>r.kind==='facility').length,276);
  assert.equal(data.audit.duplicate.length,1);
  assert.equal(data.records.find((r)=>r.id==='city-washroom:2006').match.name,'Trinity Community Recreation Centre');
  const park=data.records.find((r)=>r.id==='city-facility:1058');
  assert.equal(park.match.evidence,'name-and-point-in-outline');assert.match(park.amenities,/Tennis Court/);
  const seasonal=data.records.find((r)=>r.name.includes('Sunnyside Park Pavillion West'));
  assert.equal(seasonal.status,'0');assert.equal(seasonal.reason,'Closed for the Season');assert.ok(seasonal.statusAt);
  assert.throws(()=>cityFacilities({...snapshots,washroom:{...snapshots.washroom,records:[]}},C.GEO),/Incomplete/);
});
test('facility search finds washrooms and park amenities without replacing the existing city',()=>{
  const ctx={window:{CITY:{}}};
  for(const file of ['toronto-geodata','toronto-city-facilities','city-config','navigation'])vm.runInNewContext(fs.readFileSync(new URL(`../js/${file}.js`,import.meta.url),'utf8'),ctx);
  const N=ctx.window.CITY.Navigation;
  assert.ok(N.searchPlaces('washroom').some((p)=>p.city?.kind==='washroom'));
  assert.ok(N.searchPlaces('pickleball',{limit:50}).some((p)=>p.city?.amenities.includes('Pickleball')));
  assert.equal(N.searchPlaces('CN Tower')[0].kind,'landmark');
  assert.equal(N.buildIndex().filter((p)=>p.city?.kind==='washroom').length,78);
});
test('dedicated park layers preserve water types, access variants and feet-to-metres conversion',()=>{
  const snapshots={water:load('parks-drinking-fountains'),rink:load('outdoor-artificial-ice-rinks'),tennis:load('tennis-courts-facilities'),facility:load('parks-and-recreation-facilities')};
  const data=cityFacilities(snapshots,C.GEO),byKind=(kind)=>data.records.filter((r)=>r.kind===kind);
  assert.equal(byKind('water').length,248);assert.equal(byKind('rink').length,17);assert.equal(byKind('tennis').length,11);
  assert.equal(new Set(byKind('tennis').map((r)=>r.assetId)).size,10);
  const highPark=byKind('tennis').filter((r)=>r.assetId==='77');
  assert.equal(highPark.length,2);assert.ok(highPark.every((r)=>r.facts.Courts===7));assert.notEqual(highPark[0].id,highPark[1].id);
  assert.equal(byKind('rink').find((r)=>r.assetId==='43607').dimensions.lengthM,180*.3048);
  assert.equal(byKind('rink').find((r)=>r.assetId==='43574').dimensions.widthM,null);
  assert.equal(data.audit.reusedWaterAssetIds[0].assetId,'989056');assert.equal(data.audit.reusedWaterAssetIds[0].records.length,2);
  const links=data.records.filter((r)=>r.locationId==='241');
  for(const kind of ['water','rink','tennis'])assert.ok(links.some((r)=>r.kind===kind));
  assert.ok(byKind('water').every((r)=>r.statusAt));
  const invalid=structuredClone(snapshots);invalid.water.records[0].TYPE='Washroom Building';
  assert.throws(()=>cityFacilities(invalid,C.GEO),/Non-water type/);
});
test('bench keeps its entire seat and walking clearance on the curb island',()=>{
  const block = {};
  const deps = {nearestRoads:()=>[{road:{name:'Queen St'},px:0,pz:0,dx:1,dz:0}],blockAt:(x,z)=>z>=1&&z<=7?block:null,blocked:()=>false};
  const r={id:'BE-test',x:0,z:2,frontage:'Queen Street'};
  let layout=C.benchSites([r],deps);
  assert.equal(layout.sites.length,1); assert.equal(Math.abs(layout.sites[0].yaw),Math.PI);
  assert.equal(C.benchSites([r],{...deps,blocked:()=>true}).sites.length,0);
  assert.equal(C.benchSites([r],{...deps,blockAt:(x,z)=>z>=1&&z<2.5?block:null}).sites.length,0);
  assert.equal(C.benchSites([r,r],deps).sites.length,1);
  assert.equal(C.benchSites([r],{...deps,bikeShareAt:()=>true}).sites.length,0);
  assert.equal(C.benchSites([r],{...deps,blockAt:()=>block,headingFor:()=>.7}).sites[0].yaw,.7);
});
