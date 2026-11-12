(function(){
'use strict';
const C=window.CITY;
const asRing=ring=>ring.map(p=>Array.isArray(p)?{x:p[0],z:p[1]}:{x:p.x,z:p.z});
function insideNode(rings){
 const T=C.TSL;
 return T.Fn(()=>{
  const p=T.positionWorld.xz;let any=null;
  for(const ring of rings){
   let count=T.float(0);
   for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i];if(a.z===b.z)continue;
    const inZ=p.y.greaterThanEqual(T.float(Math.min(a.z,b.z))).and(p.y.lessThan(T.float(Math.max(a.z,b.z))));
    const x=T.float(a.x).add(T.float(b.x-a.x).mul(p.y.sub(T.float(a.z)).div(T.float(b.z-a.z))));
    count=count.add(T.select(inZ.and(p.x.lessThan(x)),T.float(1),T.float(0)));
   }
   const odd=count.mod(2).greaterThan(.5);any=any?any.or(odd):odd;
  }
  return any;
 })();
}
// Reveal successful source-footprinted beach, dog-area and woodchip surfaces through coarse native lawn and paving.
// Only those actual footprints qualify; source park paths and the water pass are retained. Called before shader compilation.
C.maskBiidaasigeParkGround=function(scene,river,dogs,woodchip,threeIsland){
 const T=C.TSL;
 if(!T||!scene||(!river?.sites?.length&&!dogs?.sites?.length&&!woodchip?.surfaces?.length&&!threeIsland?.surfaces?.length))return 0;
 const ids=new Set((river?.sites||[]).filter(s=>s.kind==='beach').map(s=>s.id));
 const rings=(C.BIIDAASIGE_RIVER_ACCESS?.features||[]).filter(f=>ids.has(f.id)&&f.geometryType==='polygon')
  .map(f=>f.geometry.map(p=>C.worldFromLatLon(...p)));
 for(const site of dogs?.sites||[])rings.push(site.outerRing.map(([x,z])=>({x,z})));
 for(const island of [woodchip,threeIsland])if(island?.surfaces?.length&&island.ringWorld?.length>=3)rings.push(asRing(island.ringWorld));
 if(!rings.length)return 0;
 const ground=scene.getObjectByName('CityGround');if(!ground)return 0;
 const names=new Set(['StreetLevel','Lawns','Yards','OpenLand','Forecourts','Walkways']);let changed=0;
 ground.traverse(o=>{
  if(!o.isMesh||!names.has(o.name))return;
  for(const m of Array.isArray(o.material)?o.material:[o.material]){
   if(!m?.isNodeMaterial||m.userData.biidaasigeParkGroundMask)continue;
   const inside=insideNode(rings);
   m.maskNode=m.maskNode?m.maskNode.and(inside.not()):inside.not();
   m.userData.biidaasigeParkGroundMask=true;m.needsUpdate=true;changed++;
  }
 });
 return changed;
};
// A few coarse OSM path-ribbon edges intrude into the photographed play islands.
// Clone only nearby path materials, retaining their original masks elsewhere.
C.maskBiidaasigePlayIslandPaths=function(group,islands){
 if(!C.TSL||!C.THREE||!group)return 0;
 const rings=(islands||[]).filter(i=>i?.surfaces?.length&&i.ringWorld?.length>=3).map(i=>asRing(i.ringWorld));
 if(!rings.length)return 0;
 const bounds=rings.map(r=>({x0:Math.min(...r.map(p=>p.x)),x1:Math.max(...r.map(p=>p.x)),z0:Math.min(...r.map(p=>p.z)),z1:Math.max(...r.map(p=>p.z))}));
 let changed=0;
 group.updateMatrixWorld(true);
 group.traverse(mesh=>{
  if(!mesh.isMesh||mesh.userData.biidaasigePlayIslandMask)return;
  const b=new C.THREE.Box3().setFromObject(mesh);
  const local=rings.filter((_,i)=>b.max.x>=bounds[i].x0&&b.min.x<=bounds[i].x1&&b.max.z>=bounds[i].z0&&b.min.z<=bounds[i].z1);
  if(!local.length)return;
  const inside=insideNode(local);
  const clone=mat=>{
   if(!mat?.isNodeMaterial)return mat;
   const m=mat.clone();m.maskNode=m.maskNode?m.maskNode.and(inside.not()):inside.not();m.needsUpdate=true;return m;
  };
  mesh.material=Array.isArray(mesh.material)?mesh.material.map(clone):clone(mesh.material);
  mesh.userData.biidaasigePlayIslandMask=true;changed++;
 });
 return changed;
};
})();
