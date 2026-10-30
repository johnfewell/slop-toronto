import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
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
