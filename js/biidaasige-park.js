(function () {
'use strict';
// Integration owner for the independently reviewed park layers. All coordinates are projected
// from source geometry in the active frame. Unplaced factory previews never enter the world.
const C = window.CITY;
const CONFIG = Object.freeze({ groundY: 0.224, // Toronto ground overlay, metres; not a measured park elevation
  modelFacing: 'OSM footprint axis / documented map estimate; not surveyed', surfaceCellM: 4, youngTreeScale: .45 });
// Each obsolete massing row was checked in the 2025 City ortho at its own
// georeferenced centre; see tools/fixtures/biidaasige-native-identities.json.
const REVIEWED_OLD_MASSING = [[2677.7,630.1,26.1],[2848.2,624.4,12.6],[2887,755.6,12.1],
  [1780.9,757.5,11.3],[2189,884.9,10.4],[2486.6,687.1,4.3],[2422.4,608.3,3.6]];
let active = null;
const enabled = () => new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('biidaasige') !== '0';
function axisYaw(feature) {
  if (!Number.isFinite(feature?.orientationDeg)) return 0;
  const a = feature.orientationDeg * Math.PI / 180;
  const p = C.worldFromLatLon(feature.lat, feature.lon);
  const q = C.worldFromLatLon(feature.lat + Math.cos(a) * .00001,
    feature.lon + Math.sin(a) * .00001 / Math.cos(feature.lat * Math.PI / 180));
  return Math.atan2(q.x - p.x, q.z - p.z);
}
function transformPoint(x, z, pose) {
  const cs = Math.cos(pose.yaw), sn = Math.sin(pose.yaw);
  return { x: pose.x + x * cs + z * sn, z: pose.z - x * sn + z * cs };
}
function transformCollider(c, pose) {
  const cx = c.obb?.cx ?? (c.minX + c.maxX) / 2, cz = c.obb?.cz ?? (c.minZ + c.maxZ) / 2;
  const p = transformPoint(cx, cz, pose);
  const hx = c.obb?.hx ?? (c.maxX - c.minX) / 2, hz = c.obb?.hz ?? (c.maxZ - c.minZ) / 2;
  const yaw = pose.yaw + (c.obb ? Math.atan2(c.obb.sn,c.obb.cs) : 0);
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  return { ...c, minX: p.x - ex, maxX: p.x + ex, minZ: p.z - ez, maxZ: p.z + ez,
    minY: (c.minY ?? 0) + pose.y, maxY: c.maxY + pose.y,
    obb: { cx: p.x, cz: p.z, hx, hz, cs, sn }, prop: true };
}
function addModel(result, model, pose, id) {
  if (!model?.group || !Number.isFinite(pose?.x) || !Number.isFinite(pose?.z)) return false;
  pose = { y: CONFIG.groundY, yaw: 0, ...pose };
  model.group.position.set(pose.x, pose.y, pose.z);
  model.group.rotation.y = pose.yaw;
  model.group.updateMatrixWorld(true);
  result.group.add(model.group);
  result.colliders.push(...(model.colliders || []).map(c => transformCollider(c, pose)));
  const box = new C.THREE.Box3().setFromObject(model.group);
  result.clearings.push({ id, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
  for (const s of model.surfaces || []) {
    const t = s.triangle;
    if (!Array.isArray(t) || t.length !== 9) continue;
    const out=[];
    for(let i=0;i<9;i+=3){const p=transformPoint(t[i],t[i+2],pose);out.push(p.x,t[i+1]+pose.y,p.z);}
    result.surfaceTriangles.push({id, t:out});
  }
  result.models.push({ id, pose, triangles: model.triangles || 0, bounds: box });
  return true;
}
function biidaasigeParkArrival() {
  const a=C.biidaasigeMapAnchor?.('snowy-owl');
  return a ? {x:a.x-24,z:a.z+12,heading:Math.atan2(24,-12),road:'Biidaasige Park Main Path'} : null;
}
function createBiidaasigePark(THREE = C.THREE, scene) {
  active = null;
  C.biidaasigeParkStats = null;
  if (!enabled() || !THREE || !C.biidaasigeParkProjectionAvailable?.()) return null;
  const parkRing=C.BIIDAASIGE_PARK.park.polygon.map(([lat,lon])=>C.worldFromLatLon(lat,lon));
  const frame=C.GEO?.frame;
  if(frame && ['x0','x1','z0','z1'].every(k=>Number.isFinite(frame[k])) &&
    !parkRing.every(p=>p.x>=frame.x0&&p.x<=frame.x1&&p.z>=frame.z0&&p.z<=frame.z1))return null;
  const result = { parkRing, group: new THREE.Group(), colliders: [], models: [], clearings: [], layers: [], surfaceTriangles: [],
    unplaced: C.BIIDAASIGE_PARK.unverifiedFeatures.map(f => f.id) };
  result.group.name = 'BiidaasigePark';
  const pads=C.buildBiidaasigePlayPads?.();
  if(pads?.group){
    result.group.add(pads.group);result.pads=pads;
    for(const surface of pads.surfaces || [])result.surfaceTriangles.push({id:surface.kind||'play-pad',t:surface.triangle});
  }
  const woodchip=C.buildBiidaasigeWoodchipIsland?.();
  if(woodchip?.group&&woodchip.ringWorld?.length>=3&&woodchip.surfaces?.length){
    result.group.add(woodchip.group);result.woodchipIsland=woodchip;
    for(const surface of woodchip.surfaces)result.surfaceTriangles.push({id:'inverted-oak-woodchip-island',t:surface.triangle});
    result.colliders.push(...(woodchip.colliders||[]));
  }
  const threeIsland=C.buildBiidaasigeDodemThreeIsland?.();
  if(threeIsland?.group&&threeIsland.ringWorld?.length>=3&&threeIsland.surfaces?.length){
    result.group.add(threeIsland.group);result.threeIsland=threeIsland;
    for(const surface of threeIsland.surfaces)result.surfaceTriangles.push({id:'dodem-three-animal-island',t:surface.triangle});
    result.colliders.push(...(threeIsland.colliders||[]));
  }
  const dogs=C.buildBiidaasigeDogSurfaces?.();
  if(dogs?.group&&dogs.sites?.length){
    result.group.add(dogs.group);result.dogSurfaces=dogs;
    for(const surface of dogs.surfaces || [])result.surfaceTriangles.push({id:surface.siteId||'dog-surface',t:surface.triangle});
  }
  for(const pose of C.biidaasigeDodemSourcePoses?.()||[]){
    const model=C.buildBiidaasigeDodemAnimal?.(pose.kind);
    if(model)addModel(result,model,pose,pose.id);
  }
  const feature = C.biidaasigeParkFeature('reaching-raccoon');
  const point = C.biidaasigeParkWorld(feature);
  if (point && C.buildReachingRaccoon) addModel(result, C.buildReachingRaccoon(),
    { ...point, yaw: axisYaw(feature) }, feature.id);
  // City diagram registration supplies bounded estimates for structures without OSM points.
  for(const [id,factory,yaw] of [['snowy-owl',C.buildOwlPlayTheatre,-Math.PI/2],['the-drum',C.buildTheDrum,0]]){
    const anchor=C.biidaasigeMapAnchor?.(id);
    if(anchor&&factory)addModel(result,factory(),{...anchor,yaw},id);
  }
  for(const length of [20,40]){
    const a=C.biidaasigeMapAnchor?.('cableway-'+length);
    if(a&&C.buildBiidaasigeCableway){
      const ends=a.endpointsLatLon?.map(p=>C.worldFromLatLon(...p));
      const yaw=ends?.length===2 ? -Math.atan2(ends[1].z-ends[0].z,ends[1].x-ends[0].x) : 0;
      addModel(result,C.buildBiidaasigeCableway(length),{...a,yaw},a.id);
    }
  }
  for(const pad of ['north','south']){
    const a=C.biidaasigeMapAnchor?.('swing-hill-'+pad);
    if(a&&C.buildBiidaasigeSwingSet)addModel(result,C.buildBiidaasigeSwingSet({pad,seats:pad==='north'?['flat','flat']:['basket']}),
      {...a,yaw:.25},a.id);
  }
  const timber=C.biidaasigeMapAnchor?.('inverted-timber-cluster');
  if(timber&&C.buildBiidaasigeInvertedTrees)addModel(result,C.buildBiidaasigeInvertedTrees({groundFinish:false}),
    {...timber,yaw:.1},'inverted-timber-cluster');
  const fireFeature = C.biidaasigeParkFeature('old-fire-hall-30');
  const firePoint = C.biidaasigeParkWorld(fireFeature);
  const ring = C.biidaasigeParkRingWorld(fireFeature);
  if (firePoint && ring?.length > 3 && C.buildFireHall30) {
    let longest = 0, yaw = 0;
    for (let i = 1; i < ring.length; i++) {
      const dx = ring[i].x-ring[i-1].x, dz = ring[i].z-ring[i-1].z;
      if (Math.hypot(dx,dz)>longest) { longest=Math.hypot(dx,dz); yaw=-Math.atan2(dz,dx); }
    }
    const north = C.worldFromLatLon(fireFeature.lat+.00001,fireFeature.lon);
    if (Math.sin(yaw)*(north.x-firePoint.x)+Math.cos(yaw)*(north.z-firePoint.z)<0) yaw+=Math.PI;
    const cs=Math.cos(yaw),sn=Math.sin(yaw);
    const local=ring.map(p=>({x:(p.x-firePoint.x)*cs-(p.z-firePoint.z)*sn,z:(p.x-firePoint.x)*sn+(p.z-firePoint.z)*cs}));
    const loX=Math.min(...local.map(p=>p.x)),hiX=Math.max(...local.map(p=>p.x));
    const loZ=Math.min(...local.map(p=>p.z)),hiZ=Math.max(...local.map(p=>p.z));
    const centre=transformPoint((loX+hiX)/2,(loZ+hiZ)/2,{...firePoint,yaw});
    if (addModel(result,C.buildFireHall30({width:hiX-loX,depth:hiZ-loZ}),{...centre,yaw},fireFeature.id)) {
      const geo=C.GEO;
      const native=(geo?.buildings || []).map((b,i)=>({b,i})).filter(({b})=>Math.hypot(b[0]-2384,b[1]-622)<1.5&&Math.abs(b[4]-8.4)<.15);
      result.nativeFireHallRows=new Set(native.map(r=>r.i));
      result.nativeGeo=geo;
    }
  }
  const atlas=C.biidaasigeParkWorld('atlas-crane');
  if(atlas&&C.buildAtlasCrane) addModel(result,C.buildAtlasCrane(),{...atlas,yaw:Math.atan2(-11.8,-21.6)},'atlas-crane');
  // Child builders are called only by this owner; their local-origin aggregate previews are deliberately unused.
  if (C.buildBadlandsScramble) {
    const badlands = C.buildBadlandsScramble({baseY:CONFIG.groundY+.008});
    if (badlands?.group) {
      result.group.add(badlands.group);
      result.colliders.push(...(badlands.colliders || []));
      result.layers.push({ id: 'badlands-scramble', result: badlands });
    }
  }
  if(C.buildBiidaasigePaths){
    const paths=C.buildBiidaasigePaths();
    if(paths?.group){
      result.group.add(paths.group);
      // Path ribbons are thin ground overlays, not solid wall boxes.
      const pathTriangles=C.biidaasigePathsTriangles?.() || [];
      for(const t of pathTriangles)result.surfaceTriangles.push({id:t.pathId,
        t:[t.x0,t.y0,t.z0,t.x1,t.y1,t.z1,t.x2,t.y2,t.z2]});
      result.paths=paths;
      result.pathSurfaceIds=new Set(pathTriangles.map(t=>t.pathId));
    }
  }
  const river=C.buildBiidaasigeRiverAccess?.();
  if(river?.group){
    result.group.add(river.group);result.river=river;
    for(const surface of river.surfaces || [])result.surfaceTriangles.push({id:surface.siteId,t:surface.triangle});
  }
  result.nativeGeo=C.GEO;
  result.excludedNativeRows=new Set(result.nativeFireHallRows || []);
  for(let i=0;i<(C.GEO?.buildings?.length || 0);i++){
    const b=C.GEO.buildings[i];
    if(REVIEWED_OLD_MASSING.some(([x,z,h])=>Math.hypot(b[0]-x,b[1]-z)<1 && Math.abs(b[4]-h)<.15))result.excludedNativeRows.add(i);
    if(result.models.some(m=>m.id==='atlas-crane')&&Math.hypot(b[0]-1998.2,b[1]-782.4)<1&&Math.abs(b[4]-3.1)<.15)result.excludedNativeRows.add(i);
  }
  result.surfaceCells=new Map();
  // (the triangles' plan box, so a query away from the park skips the cell key and its string; st-s1y8)
  result.surfaceBox={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
  const size=CONFIG.surfaceCellM;
  for(const item of result.surfaceTriangles){const t=item.t;
    const sb=result.surfaceBox;sb.minX=Math.min(sb.minX,t[0],t[3],t[6]);sb.maxX=Math.max(sb.maxX,t[0],t[3],t[6]);
    sb.minZ=Math.min(sb.minZ,t[2],t[5],t[8]);sb.maxZ=Math.max(sb.maxZ,t[2],t[5],t[8]);
    const minX=Math.floor(Math.min(t[0],t[3],t[6])/size),maxX=Math.floor(Math.max(t[0],t[3],t[6])/size);
    const minZ=Math.floor(Math.min(t[2],t[5],t[8])/size),maxZ=Math.floor(Math.max(t[2],t[5],t[8])/size);
    for(let ix=minX;ix<=maxX;ix++)for(let iz=minZ;iz<=maxZ;iz++){const k=ix+','+iz;
      if(!result.surfaceCells.has(k))result.surfaceCells.set(k,[]);result.surfaceCells.get(k).push(item);}
  }
  const owlSite=result.models.find(m=>m.id==='snowy-owl')?.pose;
  if(owlSite&&C.TELEPORT_LOCATIONS)C.TELEPORT_LOCATIONS.biidaasige=biidaasigeParkArrival();
  result.dodemUnplaced=['bear','beaver','eagle','turtle','otter','wolf','musky'].filter(kind=>!result.models.some(m=>m.id==='dodem-'+kind));
  if(!result.dodemUnplaced.length)result.unplaced=result.unplaced.filter(id=>id!=='dodem-animal-sculptures');
  active = result;
  if (scene) scene.add(result.group);
  C.biidaasigeParkStats = { models: result.models.map(m => m.id), layers: result.layers.map(l => l.id),
    unplaced: result.unplaced, dodemPlaced: result.models.filter(m=>m.id.startsWith('dodem-')).map(m=>m.id), dodemUnplaced: result.dodemUnplaced, colliders: result.colliders.length };
  return result;
}
function biidaasigeParkInside(x,z){
  if(!active)return false;
  const ring=active.parkRing;let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return inside;
}
function biidaasigeParkClearAt(x, z) {
  if (!active) return false;
  if (active.clearings.some(b => x >= b.minX - .5 && x <= b.maxX + .5 && z >= b.minZ - .5 && z <= b.maxZ + .5)) return true;
  return !!C.biidaasigePlayPadAt?.(x,z) || !!biidaasigeParkSurfaceAt(x,z);
}
function biidaasigeParkSurfaceAt(x, z, opts = {}) {
  if (!active) return null;
  let best = null, bestPath = null, islandHit = false;
  const sb = active.surfaceBox;
  const inTris = !sb || (x >= sb.minX && x <= sb.maxX && z >= sb.minZ && z <= sb.maxZ);
  if (inTris) for(const {id,t} of active.surfaceCells.get(Math.floor(x/CONFIG.surfaceCellM)+','+Math.floor(z/CONFIG.surfaceCellM)) || []){
    const [ax,ay,az,bx,by,bz,cx,cy,cz]=t;
    const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
    if(Math.abs(d)<1e-9)continue;
    const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d;
    const v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d;
    if(u < -1e-7 || v < -1e-7 || u+v>1+1e-7)continue;
    const h=u*ay+v*by+(1-u-v)*cy;
    if(id==='inverted-oak-woodchip-island'||id==='dodem-three-animal-island')islandHit=true;
    if(Number.isFinite(opts.baseY)&&Number.isFinite(opts.maxRise)&&h>opts.baseY+opts.maxRise)continue;
    if(active.pathSurfaceIds?.has(id)){if(!bestPath||h>bestPath.h)bestPath={h,id};}
    else if(!best||h>best.h)best={h,id};
  }
  if(!islandHit&&bestPath&&(!best||bestPath.h>best.h))best=bestPath;
  for (const layer of active.layers) {
    const s = layer.result.surfaceHeightAt?.(x, z, opts);
    if (s && Number.isFinite(s.h) && (!best || s.h > best.h)) best = s;
  }
  return best;
}
// This one historical inventory trunk falls inside the actual dog turf (City asset989014).
// Both independently reviewed ortho and current turf asset show no internal tree; preserve every other mapped row.
function biidaasigeParkExcludesTree(x,z,model,heightDm){
 return !!active&&active.nativeGeo===C.GEO&&model===6&&heightDm===104
  &&Math.hypot(x-2180.9,z-679.9)<.15&&C.biidaasigeDogSurfaceAt?.(x,z)?.kind==='turf';
}
const biidaasigeParkExcludesBuilding = i => !!active && active.nativeGeo === C.GEO && active.excludedNativeRows?.has(i) === true;
Object.assign(C, { biidaasigeParkExcludesTree, biidaasigeParkArrival, biidaasigeParkExcludesBuilding, BIIDAASIGE_PARK_CONFIG: CONFIG, createBiidaasigePark, biidaasigeParkClearAt,
  biidaasigeParkSurfaceAt, biidaasigeParkInside, biidaasigeTransformCollider: transformCollider, biidaasigeAddModel: addModel });
})();
