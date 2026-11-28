import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import {tennisCourts} from '../tools/build-tennis.mjs';
const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ctx={window:{CITY:{}}};
for(const f of ['toronto-geodata','toronto-city-facilities','world-collision','tennis','sports-terrain'])vm.runInNewContext(read(`js/${f}.js`),ctx);
const C=ctx.window.CITY,snapshot=JSON.parse(read('tools/data/sports-footprints-20261023.json')),review=JSON.parse(read('tools/data/tennis-review-20261028.json'));
test('reviewed City facilities use individual court geometry without summing access listings or enclosures',()=>{
  const data=tennisCourts(snapshot,review,C.GEO,C.CITY_FACILITIES);
  assert.equal(data.records.length,43);assert.equal(new Set(data.records.map((r)=>r.id)).size,43);
  assert.equal(data.records.filter((r)=>r.cityLocationId==='77').length,10);
  assert.ok(!data.records.some((r)=>review.excludedEnclosures.includes(Number(r.id.split(':')[1]))));
  assert.equal(data.records.find((r)=>r.cityLocationId==='77').listingIds.length,2);
  assert.equal(data.audit.find((r)=>r.cityLocationId==='177').mappedCourts,2);
  assert.equal(data.audit.find((r)=>r.cityLocationId==='177').sourceListings[0].courts,1);
  assert.ok(data.records.every((r)=>r.length===23.77&&r.width===10.97&&Number.isFinite(r.yaw)));
  assert.equal(data.pads.length,15);
  for(const court of data.records) {
    const points=[[-5.485,-11.885],[5.485,-11.885],[5.485,11.885],[-5.485,11.885],[-6.399,0],[6.399,0]].map(([u,v])=>C.courtPoint(court,u,v));
    assert.ok(data.pads.some((p)=>p.cityLocationId===court.cityLocationId&&points.every((q)=>C.inTennisPad(p,q.x,q.z))),`Court ${court.id} exceeds reviewed paving`);
  }
  assert.throws(()=>tennisCourts(snapshot,{...review,groups:[review.groups[0],review.groups[0]]},C.GEO,C.CITY_FACILITIES),/Duplicate/);
  const privateSource=structuredClone(snapshot);privateSource.elements.find((e)=>e.id===review.groups[0].ways[0]).tags.access='private';
  assert.throws(()=>tennisCourts(privateSource,review,C.GEO,C.CITY_FACILITIES),/Unverified/);
  assert.throws(()=>tennisCourts(snapshot,{...review,groups:[{...review.groups[0],ways:[146992756]}]},C.GEO,C.CITY_FACILITIES),/dimensions/);
});
test('terrain clipping removes only a rotated sports footprint and interpolates the original hill',()=>{
  const area=(p)=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[2]-b[0]*a[2];},0))/2;
  for(const yaw of [0,.7,Math.PI/2]) {
    const s={x:0,z:0,yaw},size=50,vertices=[[-size,-size],[size,-size],[size,size],[-size,size]].map(([x,z])=>[x,2+x/10+z/5,z]);
    const triangles=[[vertices[0],vertices[1],vertices[2]],[vertices[0],vertices[2],vertices[3]]];
    const pieces=triangles.flatMap((p)=>C.subtractCourtTriangle(p,s));
    assert.ok(Math.abs(pieces.reduce((sum,p)=>sum+area(p),0)-(10000-2*6.454*2*11.92))<1e-6);
    for(const p of pieces) {
      const cx=p.reduce((sum,v)=>sum+v[0],0)/p.length,cz=p.reduce((sum,v)=>sum+v[2],0)/p.length;
      assert.ok(!C.onCourt(s,cx,cz));
      for(const [x,y,z]of p)assert.ok(Math.abs(y-(2+x/10+z/5))<1e-9);
    }
    const far=[[100,3,100],[110,4,100],[110,5,110]];
    assert.equal(C.subtractCourtTriangle(far,s).reduce((sum,p)=>sum+area(p),0),area(far));
  }
  const triangle=[[-50,0,-50],[50,10,-50],[0,5,50]],ring=[[-5,-5],[5,-5],[5,5],[-5,5]];
  for(const points of [ring,ring.slice().reverse()])assert.ok(Math.abs(C.subtractCourtTriangle(triangle,{ring:points}).reduce((sum,p)=>sum+area(p),0)-(area(triangle)-100))<1e-6);
});
test('court clearance uses the rotated full play/net footprint, rejects roads and grade, and never relocates',()=>{
  const block={},site={id:'court',x:50,z:100,yaw:Math.PI/2};
  const options={blockAt:()=>block,groundAt:()=>.22,blocked:()=>false};
  const valid=C.tennisSites([site],options);assert.equal(valid.sites.length,1);assert.equal(valid.sites[0].x,50);assert.equal(valid.sites[0].z,100);
  const endpoint=C.courtPoint(site,0,23.77/2);assert.ok(Math.abs(endpoint.x-(50+23.77/2))<1e-8);assert.equal(endpoint.z,100);
  assert.equal(C.tennisSites([site],{...options,blockAt:(x)=>x>60?null:block}).rejected[0].reason,'road');
  assert.equal(C.tennisSites([site],{...options,groundAt:(x)=>x>60?NaN:.22}).rejected[0].reason,'grade');
  assert.equal(C.tennisSites([site],{...options,blocked:()=>true}).rejected[0].reason,'obstruction');
  assert.ok(C.onCourt(site,61,100));assert.ok(!C.onCourt(site,63,100));
  const shape=C.courtShape(site,C.WorldCollision);
  assert.ok(C.WorldCollision.contact(shape,{minX:60,maxX:62,minZ:99,maxZ:101}));
  assert.equal(C.WorldCollision.contact(shape,{minX:64,maxX:66,minZ:99,maxZ:101}),null);
});

test('winter rink footprints replace overlapping courts only when ice is placed',()=>{
  const sandbox={window:{CITY:{}},URLSearchParams};
  for(const f of ['toronto-rinks','frames/eglinton/toronto-rinks','toronto-tennis','frames/eglinton/toronto-tennis','tennis','rinks'])vm.runInNewContext(read(`js/${f}.js`),sandbox);
  const city=sandbox.window.CITY, records=city.RINKS.records;
  const ice=records.map((r)=>({...r,surface:'ice'}));
  const hidden=city.TENNIS.records.filter((court)=>city.frozenCourt(court,ice)).map((court)=>court.id).sort();
  assert.deepEqual(Array.from(hidden),['osm-way:25670072','osm-way:975858244']);
  assert.equal(city.TENNIS.records.some((court)=>city.frozenCourt(court,records.map((r)=>({...r,surface:'pad'})))),false);
  assert.equal(city.frozenCourt(city.TENNIS.records.find((court)=>court.id==='osm-way:975858244'),ice.filter((r)=>r.assetId!=='43728')),false);
});

test('freezing an accepted court hides its meshes and removes its net collider',()=>{
  const sandbox={window:{CITY:{}},URLSearchParams,console};
  for(const f of ['world-collision','tennis','rinks'])vm.runInNewContext(read(`js/${f}.js`),sandbox);
  const city=sandbox.window.CITY,block={};
  Object.assign(city,{THREE,CITY_BOUNDS:{sidewalkHeight:.22},blockAt:()=>block,TENNIS:{records:[{id:'court',x:0,z:0,yaw:0}],pads:[]}});
  const rink={surface:'ice',polygons:[{outer:[[-20,-20],[20,-20],[20,20],[-20,20]],holes:[]}]};
  const built=city.buildTennis(new THREE.Scene());
  const removed=built.clearFrozenCourts([rink]);
  assert.equal(removed.length,1);assert.equal(removed[0],built.colliders[0]);
  for(const name of ['TennisLinesAndNets','TennisSurfaces']) {
    const matrix=new THREE.Matrix4();built.group.getObjectByName(name).getMatrixAt(0,matrix);
    assert.equal(matrix.elements[0],0);assert.equal(matrix.elements[5],0);assert.equal(matrix.elements[10],0);
  }
});

// buildTennis tests each court against the city's colliders through a grid of them: the same answer as testing every collider
test('the collider grid answers as the whole list does, for boxes, circles, outlines, and colliders with no box',()=>{
  let seed=99;const rnd=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  const colliders=[];
  for(let i=0;i<4000;i++){
    const x=(rnd()-.5)*2000,z=(rnd()-.5)*2000,w=1+rnd()*(i%50===0?150:12),d=1+rnd()*12,y0=rnd()*2-.5;
    colliders.push({minX:x,maxX:x+w,minZ:z,maxZ:z+d,minY:y0,maxY:y0+rnd()*8,obb:{cx:x+w/2,cz:z+d/2,hx:w/2,hz:d/2,cs:1,sn:0}});
  }
  colliders.push({minX:NaN,maxX:NaN,minZ:NaN,maxZ:NaN,minY:0,maxY:5,circle:{x:5,z:5,r:2}});
  const index=C.WorldCollision.colliderGrid(colliders);
  let hits=0;
  for(let i=0;i<600;i++){
    const site={x:(rnd()-.5)*2000,z:(rnd()-.5)*2000,yaw:rnd()*Math.PI};
    const shape=C.courtShape(site,C.WorldCollision),y=rnd()*.5;
    const test=(c)=>(c.maxY??Infinity)>y+.08&&(c.minY??-Infinity)<y+1.1&&C.WorldCollision.contact(shape,c);
    const expected=colliders.some(test),got=index.some(shape,test);
    assert.equal(got,expected,`court ${i}`);
    if(expected)hits++;
  }
  assert.ok(hits>20&&hits<580,`the sample has both answers (${hits} of 600 touch)`);
});
