import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import {rinkFootprints} from '../tools/build-rinks.mjs';
const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ctx={window:{CITY:{THREE}},URLSearchParams};
for(const f of ['toronto-geodata','toronto-city-facilities','toronto-rinks','world-collision','sports-terrain','rinks'])vm.runInNewContext(read(`js/${f}.js`),ctx);
const C=ctx.window.CITY,snapshot=JSON.parse(read('tools/data/rink-footprints-20261028.json')),review=JSON.parse(read('tools/data/rink-review-20261028.json'));
const area=(ring)=>Math.abs(ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a[0]*b[1]-b[0]*a[1];},0))/2;
const byAsset=(id)=>C.RINKS.records.find((r)=>r.assetId===id);
const triangulate=(outer,holes)=>THREE.ShapeUtils.triangulateShape(outer.map(([x,z])=>new THREE.Vector2(x,z)),holes.map((h)=>h.map(([x,z])=>new THREE.Vector2(x,z))));

test('all 17 City rink identities keep their mapped polygons, provenance and reviewed board overrides',()=>{
  const data=rinkFootprints(snapshot,review,C.GEO,C.CITY_FACILITIES);
  assert.equal(data.records.length,17);assert.equal(new Set(data.records.map((r)=>r.assetId)).size,17);
  assert.deepEqual(JSON.parse(JSON.stringify(data)),JSON.parse(JSON.stringify(C.RINKS)),'generated layer matches the builder');
  assert.match(data.source.url,/gis\.toronto\.ca/);assert.ok(data.source.fetchedAt&&data.source.note.includes('attribution'));
  // High Park: the source flags are swapped against the 2025 aerial; the rendered arrangement follows the review
  assert.deepEqual(data.audit.map((a)=>[a.id,a.source,a.rendered]).sort(),[['14282','Yes',false],['43587','No',true]]);
  assert.equal(byAsset('14282').sourceFacts.Boards,'Yes','source facts are kept for the card');
  // Dufferin Grove: one long boarded hockey rink (not split at the slab seam) and the unboarded western pleasure pad
  const hockey=byAsset('970547'),pad=byAsset('970567');
  assert.equal(hockey.polygons.length,1);assert.ok(hockey.boards&&!pad.boards);
  const rect=C.outlineRectangle(hockey.polygons[0].outer);assert.ok(rect.length>50&&rect.length<62,`hockey length ${rect.length}`);
  // Feet to metres stays the inventory's; trails get no invented rectangle
  assert.equal(byAsset('43607').sourceDimensions.lengthM,180*.3048);
  assert.ok(data.records.filter((r)=>r.type==='Skate Trail').every((r)=>r.sourceDimensions.lengthM===null));
  // Holes (trail islands) survive
  assert.equal(byAsset('74082').polygons[0].holes.length,1);assert.equal(byAsset('59902').polygons[0].holes.length,1);
  assert.throws(()=>rinkFootprints({...snapshot,features:[...snapshot.features,snapshot.features[0]]},review,C.GEO,C.CITY_FACILITIES),/duplicate/i);
  assert.throws(()=>rinkFootprints({...snapshot,features:snapshot.features.slice(1)},review,C.GEO,C.CITY_FACILITIES),/Incomplete/);
  const expired=structuredClone(snapshot);expired.features[0].properties.EXPIRY_DATE=Date.parse('2020-01-01');
  assert.throws(()=>rinkFootprints(expired,review,C.GEO,C.CITY_FACILITIES),/Expired/);
});

test('the season follows the scene date, with an explicit preview override',()=>{
  assert.equal(C.rinkSeason({month:8,day:22}),'off');
  for(const [month,day,season]of [[11,30,'off'],[12,1,'ice'],[1,15,'ice'],[2,28,'ice'],[3,15,'ice'],[3,16,'off'],[6,1,'off']])assert.equal(C.rinkSeason({month,day}),season,`${month}/${day}`);
  assert.throws(()=>C.rinkSeason(null));
  assert.deepEqual({...C.sceneSeason('',{month:8,day:22})},{season:'off',forced:false});
  assert.deepEqual({...C.sceneSeason('?rinks=ice',{month:8,day:22})},{season:'ice',forced:true});
  assert.deepEqual({...C.sceneSeason('?rinks=bogus',{month:1,day:5})},{season:'ice',forced:false});
  assert.equal(C.surfaceKind(byAsset('43599'),'off'),'water','Nathan Phillips Square is a reflecting pool out of season');
  assert.equal(C.surfaceKind(byAsset('71803'),'off'),'path');assert.equal(C.surfaceKind(byAsset('43607'),'off'),'pad');
  assert.ok(C.RINKS.records.every((r)=>C.surfaceKind(r,'ice')==='ice'));
});

test('convex pieces cover each footprint exactly (curves and holes) for the terrain clipper',()=>{
  for(const r of C.RINKS.records)for(const p of r.polygons) {
    const pieces=C.convexPieces(p.outer,p.holes,triangulate),want=area(p.outer)-p.holes.reduce((s,h)=>s+area(h),0);
    assert.ok(Math.abs(pieces.reduce((s,q)=>s+area(q),0)-want)<1e-6*want+1e-6,`${r.id} area`);
    assert.ok(pieces.length<=Math.max(1,p.outer.length+p.holes.flat().length-2),`${r.id} merged ${pieces.length} pieces`);
    for(const q of pieces) {
      const signs=new Set(q.map((a,i)=>{const b=q[(i+1)%q.length],c=q[(i+2)%q.length],x=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);return Math.abs(x)<1e-9?0:Math.sign(x);}));
      signs.delete(0);assert.ok(signs.size<=1,`${r.id} piece is convex`);
    }
  }
  const square=[[0,0],[10,0],[10,10],[0,10]];
  assert.deepEqual(JSON.parse(JSON.stringify(C.convexPieces(square,[],triangulate))),[square]);
  const holed=C.convexPieces([[0,0],[30,0],[30,30],[0,30]],[[[10,10],[20,10],[20,20],[10,20]]],triangulate);
  assert.ok(Math.abs(holed.reduce((s,q)=>s+area(q),0)-800)<1e-9);
});

test('terrain clipping keeps a trail island and the surrounding hill',()=>{
  // a 100 m sloped terrain square, clipped by a 30 m pad with a 10 m island
  const pos=[],uv=[];
  for(const [x,z]of [[-50,-50],[50,-50],[50,50],[-50,-50],[50,50],[-50,50]]){pos.push(x,1+x/50,z);uv.push(0,0);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();
  const mesh=new THREE.Mesh(g);mesh.name='TerrainNear';const scene=new THREE.Scene();scene.add(mesh);
  const outer=[[-15,-15],[15,-15],[15,15],[-15,15]],hole=[[-5,-5],[5,-5],[5,5],[-5,5]];
  const pieces=C.convexPieces(outer,[hole],triangulate).map((ring)=>({ring,y:.22}));
  const result=C.clearSportsTerrain(scene,pieces);assert.ok(result.cutTriangles>0);
  const p=mesh.geometry.attributes.position,idx=mesh.geometry.index;let kept=0,island=0;
  for(let i=0;i<idx.count;i+=3) {
    const v=[0,1,2].map((j)=>{const k=idx.getX(i+j);return [p.getX(k),p.getY(k),p.getZ(k)];});
    const a=Math.abs((v[1][0]-v[0][0])*(v[2][2]-v[0][2])-(v[2][0]-v[0][0])*(v[1][2]-v[0][2]))/2;kept+=a;
    const cx=(v[0][0]+v[1][0]+v[2][0])/3,cz=(v[0][2]+v[1][2]+v[2][2])/3;
    if(a<1e-9)continue; // (zero-area slivers along piece seams draw nothing)
    if(Math.abs(cx)<5&&Math.abs(cz)<5)island+=a;
    else assert.ok(!(Math.abs(cx)<15&&Math.abs(cz)<15),'nothing left on the pad');
    for(const [x,y]of v)assert.ok(Math.abs(y-(1+x/50))<1e-6,'original height interpolated');
  }
  assert.ok(Math.abs(kept-(10000-800))<1e-6);assert.ok(Math.abs(island-100)<1e-6);
});

test('boards follow the outline with one reviewed gate opening; hockey lines use the long axis',()=>{
  const ring=[[0,0],[60,0],[60,25],[0,25]];
  const runs=C.boardRuns(ring,{x:30,z:25.3});
  const length=runs.segments.reduce((s,[a,b])=>s+Math.hypot(b[0]-a[0],b[1]-a[1]),0);
  assert.ok(Math.abs(length-(170-2))<1e-9);assert.equal(runs.gateGap,2);
  assert.ok(!runs.segments.some(([a,b])=>a[1]===25&&b[1]===25&&Math.min(a[0],b[0])<30.9&&Math.max(a[0],b[0])>29.1),'gate is open');
  // a gate exactly on a corner wraps across the ring's start
  const corner=C.boardRuns(ring,{x:0,z:0});
  assert.ok(Math.abs(corner.segments.reduce((s,[a,b])=>s+Math.hypot(b[0]-a[0],b[1]-a[1]),0)-168)<1e-9);
  assert.equal(C.boardRuns(ring,null).segments.length,4);
  const yaw=.6,rot=ring.map(([x,z])=>[x*Math.cos(yaw)-z*Math.sin(yaw),x*Math.sin(yaw)+z*Math.cos(yaw)]),rect=C.outlineRectangle(rot);
  assert.ok(Math.abs(rect.length-60)<1e-9&&Math.abs(rect.width-25)<1e-9);
  assert.ok(Math.abs(Math.abs(rect.ax*Math.cos(yaw)+rect.az*Math.sin(yaw))-1)<1e-9);
  const curve=Array.from({length:40},(_,i)=>[Math.cos(i/40*Math.PI*2)*10,Math.sin(i/40*Math.PI*2)*10]);
  const simple=C.simplifyRing([...ring.flatMap(([x,z],i)=>{const [u,w]=ring[(i+1)%4];return [[x,z],[(x+u)/2,(z+w)/2]];})],.05);
  assert.equal(simple.length,4,'collinear midpoints removed');assert.ok(C.simplifyRing(curve,.05).length>=20,'curves kept');
});

test('placement keeps each footprint where mapped, rejecting roads, grade and obstructions',()=>{
  const block={},r=byAsset('43607');
  const ok=C.rinkSites([r],{blockAt:()=>block,groundAt:()=>.22,overlapArea:()=>0});
  assert.equal(ok.sites.length,1);assert.equal(ok.sites[0].y,.22);assert.deepEqual(ok.sites[0].polygons,r.polygons);
  const cx=ok.sites[0].bounds.x0;
  assert.equal(C.rinkSites([r],{blockAt:(x)=>x<cx+1?null:block,groundAt:()=>.22,overlapArea:()=>0}).rejected[0].reason,'road');
  assert.equal(C.rinkSites([r],{blockAt:()=>block,groundAt:(x)=>x<cx+1?.6:.22,overlapArea:()=>0}).rejected[0].reason,'grade');
  assert.equal(C.rinkSites([r],{blockAt:()=>block,groundAt:()=>.22,overlapArea:()=>.75}).sites.length,1,'sub-metre edge contact tolerated');
  const blocked=C.rinkSites([r],{blockAt:()=>block,groundAt:()=>.22,overlapArea:()=>4}).rejected[0];
  assert.equal(blocked.reason,'obstruction');assert.equal(blocked.overlap,4);
  // holes are not rink floor; margins reach just outside the outline
  const trail=byAsset('74082'),hole=trail.polygons[0].holes[0],hx=hole.reduce((s,p)=>s+p[0],0)/hole.length,hz=hole.reduce((s,p)=>s+p[1],0)/hole.length;
  assert.ok(!C.inRecord(trail,hx,hz));
  const [vx,vz]=r.polygons[0].outer[0];assert.ok(C.inRinkFootprint(vx+.01,vz+.01,1));
});

test('place cards say what the city draws, with the dated scene and the aerial board review',()=>{
  C.rinkStats={season:'off',forced:false,sceneDate:{month:8,day:22},sites:[{id:'city-rink:43587',surface:'pad',boards:true}],rejected:[{id:'city-rink:43574',reason:'obstruction'}],sourceAudit:C.RINKS.audit};
  const facts=C.rinkCardFacts({kind:'rink',id:'city-rink:43587'});
  assert.match(facts['In the city'],/off-season concrete pad \(scene date August 22\)/);
  assert.match(facts['Boards in the city'],/2025 City aerial review/);assert.match(facts.Season,/no live status/);
  assert.match(C.rinkCardFacts({kind:'rink',id:'city-rink:43574'})['In the city'],/not drawn \(obstruction\)/i);
  assert.equal(C.rinkCardFacts({kind:'tennis',id:'x'}),null);
  delete C.rinkStats;
});
