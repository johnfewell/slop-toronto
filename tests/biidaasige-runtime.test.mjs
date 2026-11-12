import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { unpackGeo } from '../js/geodata-loader.js';
async function city(frame='detail', search='') {
 const file=frame==='detail'?'data/toronto-geodata.bin':'data/frames/eglinton/toronto-geodata.bin';
 const layers=await unpackGeo(fs.readFileSync(new URL('../'+file,import.meta.url)));
 const ctx=vm.createContext({window:{CITY:{...layers,THREE,Addons:{mergeGeometries}}},console,location:{search},URLSearchParams,performance,Buffer,atob:s=>Buffer.from(s,'base64').toString('binary')});
 for(const name of ['high-park-data','don-valley','city-config','biidaasige-park-data','biidaasige-map-anchors','biidaasige-path-network-data','biidaasige-play-landmarks','biidaasige-play-infrastructure','biidaasige-play-pads','biidaasige-dog-surfaces','biidaasige-woodchip-island','biidaasige-dodem-three-island','biidaasige-adventure-play','biidaasige-dodem','biidaasige-dodem-placements','biidaasige-heritage','biidaasige-paths','biidaasige-river-access','biidaasige-ground-mask','biidaasige-park'])vm.runInContext(fs.readFileSync(new URL('../js/'+name+'.js',import.meta.url),'utf8'),ctx,{filename:name});
 return ctx.window.CITY;
}
for(const frame of ['detail','eglinton']) test('park uses active '+frame+' projection and only identified native replacement',async()=>{
 const C=await city(frame);const scene=new THREE.Scene();const r=C.createBiidaasigePark(THREE,scene);
 assert.ok(r&&r.models.some(m=>m.id==='reaching-raccoon'));
 assert.ok(r.models.some(m=>m.id==='old-fire-hall-30'));
 assert.ok(r.models.some(m=>m.id==='cableway-20')&&r.models.some(m=>m.id==='cableway-40'),'both photographed cableways enter runtime');
 assert.ok(r.models.some(m=>m.id==='swing-hill-north')&&r.models.some(m=>m.id==='swing-hill-south'),'both source-positioned swing pads enter runtime');
 assert.equal(C.biidaasigeParkExcludesTree(2180.9,679.9,6,104),true,'source-verified historical trunk inside turf is excluded');
 assert.equal(C.biidaasigeParkExcludesTree(2180.9,679.9,7,104),false,'a different inventory fingerprint is retained');
 assert.equal(C.biidaasigeParkExcludesTree(2182,679.9,6,104),false,'nearby mapped trees are retained');
 assert.equal(r.dogSurfaces.sites.length,2,'both source-corrected dog areas are assembled');
 assert.ok(r.woodchipIsland?.ringWorld.length>40,'source-traced oak play island is assembled');
 C.TSL=TSL;
 const nativeGround=new THREE.Group();nativeGround.name='CityGround';
 const lawn=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshStandardNodeMaterial());lawn.name='Lawns';nativeGround.add(lawn);scene.add(nativeGround);
 assert.equal(C.maskBiidaasigeParkGround(scene,r.river,r.dogSurfaces,r.woodchipIsland,r.threeIsland),1,'actual array and object ring contracts both mask native ground');
 assert.ok(lawn.material.maskNode,'mask is composed on the actual node material');
 assert.equal(C.maskBiidaasigeParkGround(scene,r.river,r.dogSurfaces,r.woodchipIsland,r.threeIsland),0,'repeated setup does not stack the material mask');

 const wt=r.woodchipIsland.surfaces.find(s=>s.kind==='woodchip').triangle;
 const wx=(wt[0]+wt[3]+wt[6])/3,wz=(wt[2]+wt[5]+wt[8])/3;
 assert.ok(Math.abs(C.biidaasigeParkSurfaceAt(wx,wz).h-.232)<1e-5,'rendered woodchip finish enters shared footing grid');
 assert.ok(C.biidaasigeParkClearAt(wx,wz),'procedural trees clear only actual rendered play surface');
 const dodem=r.models.filter(m=>m.id.startsWith('dodem-'));
 assert.equal(dodem.length,7,'all seven individually registered finished-site animals enter the runtime');
 assert.ok(dodem.every(m=>[3,4].includes(m.pose.errorM)&&Math.abs(m.pose.y-.232)<1e-5),'photo uncertainty and actual rendered footing accompany every placed animal');
 assert.deepEqual(Array.from(r.dodemUnplaced),[],'all seven source poses have successful geometry and footing');
 assert.ok(dodem.every(m=>m.bounds.min.y>.22&&m.bounds.max.y<3.5),'rotated source models keep their finite vertical datum');
 const pathMaterials=new Map(r.paths.group.children.filter(m=>m.isMesh).map(m=>[m,m.material]));
 assert.ok(C.maskBiidaasigePlayIslandPaths(r.paths.group,[r.woodchipIsland,r.threeIsland])>0,'coarse local path ribbons are masked at the actual play-island boundary');
 for(const [mesh,original] of pathMaterials){
  if(mesh.userData.biidaasigePlayIslandMask){assert.notEqual(mesh.material,original);assert.ok(mesh.material.maskNode);}
  else assert.equal(mesh.material,original,'distant path materials are preserved');
 }
 assert.equal(C.maskBiidaasigePlayIslandPaths(r.paths.group,[r.woodchipIsland,r.threeIsland]),0,'path mask is idempotent');
 const px=2310.27718,pz=652.26870;
 assert.ok(C.biidaasigePathsSurfaceAt(px,pz).onPath,'source regression point is on the coarse ribbon');
 assert.ok(C.biidaasigeDodemThreeIslandAt(px,pz)?.kind==='woodchip','aerial curb independently places the regression point inside woodchips');
 assert.ok(Math.abs(C.biidaasigeParkSurfaceAt(px,pz).h-.232)<1e-5,'hidden path footing cannot float the rider above the visible woodchips: '+JSON.stringify(C.biidaasigeParkSurfaceAt(px,pz)));



 const turf=r.dogSurfaces.surfaces.find(s=>s.kind==='turf');
 assert.ok(turf,'source turf triangles are present');
 const t=turf.triangle,x=(t[0]+t[3]+t[6])/3,z=(t[2]+t[5]+t[8])/3;
 assert.ok(Math.abs(C.biidaasigeParkSurfaceAt(x,z).h-.228)<1e-5,'real turf top enters the shared footing index');
 assert.ok(r.river.sites.length===4,'source beaches, slipway and pier enter runtime');
 const defaultNames=[];r.river.group.traverse(o=>defaultNames.push(o.name));
 assert.ok(r.river.candidates.sites.every(s=>!defaultNames.some(n=>n.includes(s.id))),'point-only candidate pads stay out of default scene');
 assert.equal(r.pads.areas.length,2,'both source-footprinted play ground surfaces enter runtime');
 assert.ok(C.TELEPORT_LOCATIONS.biidaasige,'Sights jump is wired after successful park build');
 assert.ok(r.models.some(m=>m.id==='snowy-owl'),'registered approximate Owl is placed');
 assert.ok(r.models.find(m=>m.id==='snowy-owl').pose.errorM===3,'source ortho interpretation error stays explicit');
 assert.ok(r.layers.some(l=>l.id==='badlands-scramble'),'real data helper builds Badlands');
 assert.ok(r.paths.surfaces.length>100,'full source path network replaces the three-path subset');
 assert.ok(r.paths.stats.batchCellM===120,'path geometry uses bounded spatial material batches');
 for(const mesh of r.paths.group.children){const b=mesh.geometry.boundingBox;assert.ok(b.max.x-b.min.x<130&&b.max.z-b.min.z<130,'path batches stay local');}
 const ids=C.GEO.buildings.map((_,i)=>i).filter(i=>C.biidaasigeParkExcludesBuilding(i));
 assert.equal(ids.length,9,'seven individually ortho-reviewed obsolete rows plus successful Fire Hall and crane replacements');
 const source=JSON.parse(fs.readFileSync(new URL('../tools/fixtures/biidaasige-native-identities.json',import.meta.url)));
 for(const i of ids){const b=C.GEO.buildings[i];assert.ok(source.rows.some(r=>Math.hypot(b[0]-r.x,b[1]-r.z)<1.5&&Math.abs(b[4]-r.height)<.15));}
 assert.ok(r.models.every(m=>m.bounds.min.x>1650&&m.bounds.max.x<3050&&m.bounds.min.z>250&&m.bounds.max.z<1000));
 assert.ok(r.colliders.every(c=>[c.minX,c.maxX,c.minY,c.maxY,c.minZ,c.maxZ].every(Number.isFinite)));
 assert.equal(C.biidaasigeParkSurfaceAt(0,0),null,'no world-spanning footing');
 assert.equal(C.biidaasigeParkClearAt(0,0),false);
 const previous=C.GEO;C.GEO={...previous};assert.ok(!C.biidaasigeParkExcludesBuilding(ids[0]),'frame replacement invalidates identity hook');
});
test('A/B disable leaves no geometry, clearings or building exclusions',async()=>{
 const C=await city('detail','?biidaasige=0');const scene=new THREE.Scene();assert.equal(C.createBiidaasigePark(THREE,scene),null);assert.equal(scene.children.length,0);assert.equal(C.biidaasigeParkExcludesBuilding(0),false);assert.equal(C.biidaasigeParkClearAt(2400,650),false);
});
test('rotated local collider keeps its box frame and vertical datum',async()=>{
 const C=await city();const p={x:100,z:200,y:3,yaw:Math.PI/3};const c=C.biidaasigeTransformCollider({minX:-2,maxX:2,minZ:-1,maxZ:1,minY:0,maxY:4},p);
 assert.equal(c.minY,3);assert.equal(c.maxY,7);assert.equal(c.obb.hx,2);assert.equal(c.obb.hz,1);
 for(const x of [-2,2])for(const z of [-1,1]){const wx=100+x*Math.cos(p.yaw)+z*Math.sin(p.yaw),wz=200-x*Math.sin(p.yaw)+z*Math.cos(p.yaw);assert.ok(wx>=c.minX-1e-8&&wx<=c.maxX+1e-8&&wz>=c.minZ-1e-8&&wz<=c.maxZ+1e-8);}
});
