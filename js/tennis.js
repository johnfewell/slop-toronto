(function(){
const C=window.CITY;
const HALF_WIDTH=10.97/2,HALF_LENGTH=23.77/2,NET_HALF=HALF_WIDTH+.914;
function courtPoint(site,u,v){const cs=Math.cos(site.yaw),sn=Math.sin(site.yaw);return {x:site.x+u*cs+v*sn,z:site.z-u*sn+v*cs};}
function courtShape(site,W) {
  const cs=Math.cos(site.yaw),sn=Math.sin(site.yaw),rx=Math.abs(cs)*NET_HALF+Math.abs(sn)*HALF_LENGTH,rz=Math.abs(sn)*NET_HALF+Math.abs(cs)*HALF_LENGTH;
  const bounds=site.ring?{minX:Math.min(...site.ring.map((p)=>p[0])),maxX:Math.max(...site.ring.map((p)=>p[0])),minZ:Math.min(...site.ring.map((p)=>p[1])),maxZ:Math.max(...site.ring.map((p)=>p[1])),polygon:site.ring.map(([x,z])=>({x,z}))}:{minX:site.x-rx,maxX:site.x+rx,minZ:site.z-rz,maxZ:site.z+rz,obb:{cx:site.x,cz:site.z,hx:NET_HALF,hz:HALF_LENGTH,cs,sn}};
  const shape={...W.colliderShape(bounds),...bounds,x:site.x,z:site.z,reach:Math.hypot(NET_HALF,HALF_LENGTH)};
  shape.lo=shape.axes.map((a)=>Math.min(...shape.points.map((p)=>p.x*a.x+p.z*a.z)));
  shape.hi=shape.axes.map((a)=>Math.max(...shape.points.map((p)=>p.x*a.x+p.z*a.z)));
  return shape;
}
function tennisSites(records,{blockAt,groundAt,blocked}) {
  const sites=[],rejected=[];
  for(const site of records) {
    const block=blockAt(site.x,site.z),y=groundAt(site.x,site.z);
    if(!block||!Number.isFinite(y)){rejected.push({id:site.id,reason:'ground'});continue;}
    let reason='';
    // Sample the whole play rectangle and net posts. Never move a mapped court
    // to another park, across a road, onto a building or onto a stepped surface.
    for(const u of [-NET_HALF,0,NET_HALF])for(const v of [-HALF_LENGTH,0,HALF_LENGTH]) {
      const p=courtPoint(site,u,v);
      if(blockAt(p.x,p.z)!==block)reason='road';
      else {const height=groundAt(p.x,p.z);if(!Number.isFinite(height)||Math.abs(height-y)>.15)reason='grade';}
    }
    if(!reason&&blocked(site,y))reason='obstruction';
    if(reason)rejected.push({id:site.id,reason});else sites.push({...site,y});
  }
  return {sites,rejected};
}
function onCourt(site,x,z,margin=0){const dx=x-site.x,dz=z-site.z,cs=Math.cos(site.yaw),sn=Math.sin(site.yaw);return Math.abs(dx*cs-dz*sn)<NET_HALF+margin&&Math.abs(dx*sn+dz*cs)<HALF_LENGTH+margin;}
function inTennisPad(pad,x,z) {
  let inside=false;const p=pad.ring;
  for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>z)!==(p[j][1]>z)&&x<(p[j][0]-p[i][0])*(z-p[i][1])/(p[j][1]-p[i][1])+p[i][0])inside=!inside;
  return inside;
}
function buildTennis(scene,staticColliders=[]) {
  const {THREE,WorldCollision:W}=C;
  const groundAt=(x,z)=>(C.blockAt(x,z)?C.CITY_BOUNDS.sidewalkHeight:0)+(C.cutAt?.(x,z)||0);
  const layout=tennisSites(C.TENNIS?.records||[],{blockAt:C.blockAt,groundAt,blocked:(site,y)=>{
    const shape=courtShape(site,W);
    return staticColliders.some((c)=>(c.maxY??Infinity)>y+.08&&(c.minY??-Infinity)<y+1.1&&W.contact(shape,c));
  }});
  const pads=[],rejectedPads=[];
  for(const p of C.TENNIS?.pads||[]) {
    const y=groundAt(p.x,p.z),block=C.blockAt(p.x,p.z),shape=courtShape(p,W);
    let reason=!block||!p.ring.every(([x,z])=>C.blockAt(x,z)===block&&Math.abs(groundAt(x,z)-y)<.15)?'ground-or-road':'';
    if(!reason&&staticColliders.some((c)=>(c.maxY??Infinity)>y+.08&&(c.minY??-Infinity)<y+1.1&&W.contact(shape,c)))reason='obstruction';
    if(!reason&&!layout.sites.some((s)=>s.cityLocationId===p.cityLocationId&&inTennisPad(p,s.x,s.z)))reason='no-accepted-court';
    if(!reason)pads.push({...p,y});else rejectedPads.push({id:p.id,reason});
  }
  const group=new THREE.Group();group.name='MappedTennisCourts';scene.add(group);
  const terrain=C.clearSportsTerrain?.(scene,[...layout.sites,...pads]);
  C.sportsGroundProviders?.set('tennis',(x,z)=>{
    const pad=pads.find((p)=>inTennisPad(p,x,z));if(pad)return pad.y;
    const court=layout.sites.find((s)=>onCourt(s,x,z));return court?court.y:null;
  });
  const positions=[],colours=[];
  const colourCache=new Map(),white='#e7e9df',black='#283631';
  function quad(a,b,c,d,colour) {
    let col=colourCache.get(colour);if(!col){col=new THREE.Color(colour);colourCache.set(colour,col);}
    for(const p of [a,b,c,a,c,d]){positions.push(...p);colours.push(col.r,col.g,col.b);}
  }
  const flat=(x0,x1,z0,z1,y,colour)=>quad([x0,y,z0],[x0,y,z1],[x1,y,z1],[x1,y,z0],colour);
  // A single shared geometry for markings, posts and the coarse net weave.
  // Surfaces are a separate instanced rectangle with per-instance colour.
  for(const x of [-HALF_WIDTH,HALF_WIDTH,-8.23/2,8.23/2])flat(x-.025,x+.025,-HALF_LENGTH,HALF_LENGTH,.025,white);
  for(const z of [-HALF_LENGTH,HALF_LENGTH])flat(-HALF_WIDTH,HALF_WIDTH,z-.035,z+.035,.025,white);
  for(const z of [-6.4,6.4])flat(-8.23/2,8.23/2,z-.025,z+.025,.025,white);
  flat(-.025,.025,-6.4,6.4,.025,white);
  for(const z of [-HALF_LENGTH,HALF_LENGTH])flat(-.025,.025,z<0?z:z-.1,z<0?z+.1:z,.027,white);
  const top=(x)=>.914+.156*(x/NET_HALF)**2;
  // Flat double-sided net strips avoid a translucent sorting pass or per-court
  // textures. The fine real weave is represented coarsely at city scale.
  for(let i=0;i<=64;i++) {
    const x=-NET_HALF+2*NET_HALF*i/64,h=top(x);
    quad([x-.006,.08,0],[x+.006,.08,0],[x+.006,h,0],[x-.006,h,0],black);
  }
  for(let row=0;row<=8;row++)for(let i=0;i<16;i++) {
    const a=-NET_HALF+2*NET_HALF*i/16,b=-NET_HALF+2*NET_HALF*(i+1)/16,ya=.08+(top(a)-.08)*row/8,yb=.08+(top(b)-.08)*row/8;
    const band=row===8?.05:.012;
    quad([a,ya-band,0],[b,yb-band,0],[b,yb,0],[a,ya,0],row===8?white:black);
  }
  quad([-.025,.05,.003],[.025,.05,.003],[.025,.914,.003],[-.025,.914,.003],white);
  for(const x of [-NET_HALF,NET_HALF]) {
    const d=.055,h=1.09;
    quad([x-d,0,-d],[x+d,0,-d],[x+d,h,-d],[x-d,h,-d],black);
    quad([x+d,0,-d],[x+d,0,d],[x+d,h,d],[x+d,h,-d],black);
    quad([x+d,0,d],[x-d,0,d],[x-d,h,d],[x+d,h,d],black);
    quad([x-d,0,d],[x-d,0,-d],[x-d,h,-d],[x-d,h,d],black);
    flat(x-d,x+d,-d,d,h,black);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geo.computeVertexNormals();
  const mat=new THREE.MeshStandardNodeMaterial({vertexColors:true,roughness:.92,side:THREE.DoubleSide});
  const padPos=[],padColours=[];
  for(const p of pads) {
    const ring=p.ring.map(([x,z])=>new THREE.Vector2(x,-z)),col=new THREE.Color(p.colour==='green'?'#536655':'#747873');
    for(const tri of THREE.ShapeUtils.triangulateShape(ring,[]))for(const i of tri){padPos.push(ring[i].x,p.y+.016,-ring[i].y);padColours.push(col.r,col.g,col.b);}
  }
  const padGeo=new THREE.BufferGeometry();padGeo.setAttribute('position',new THREE.Float32BufferAttribute(padPos,3));padGeo.setAttribute('color',new THREE.Float32BufferAttribute(padColours,3));padGeo.computeVertexNormals();
  const paving=new THREE.Mesh(padGeo,mat);paving.name='TennisPaving';paving.receiveShadow=true;group.add(paving);
  const detail=new THREE.InstancedMesh(geo,mat,layout.sites.length);detail.name='TennisLinesAndNets';detail.userData.cullDistance=500;detail.userData.cullCell=150;detail.receiveShadow=true;
  const surfaceGeo=new THREE.PlaneGeometry(10.97,23.77);surfaceGeo.rotateX(-Math.PI/2);
  const surfaceMat=new THREE.MeshStandardNodeMaterial({roughness:.96});
  const surface=new THREE.InstancedMesh(surfaceGeo,surfaceMat,layout.sites.length);surface.name='TennisSurfaces';surface.userData.cullDistance=1000;surface.userData.cullCell=150;surface.receiveShadow=true;
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1),up=new THREE.Vector3(0,1,0),colliders=[];
  layout.sites.forEach((s,i)=>{
    position.set(s.x,s.y+.019,s.z);rotation.setFromAxisAngle(up,s.yaw);matrix.compose(position,rotation,scale);detail.setMatrixAt(i,matrix);surface.setMatrixAt(i,matrix);surface.setColorAt(i,new THREE.Color(s.colour==='blue-green'?'#52768b':'#717575'));
    // Thin physical net and posts; courts stay walkable from every open side.
    const cs=Math.cos(s.yaw),sn=Math.sin(s.yaw),hx=NET_HALF+.055,hz=.055,rx=Math.abs(cs)*hx+Math.abs(sn)*hz,rz=Math.abs(sn)*hx+Math.abs(cs)*hz;
    colliders.push({minX:s.x-rx,maxX:s.x+rx,minZ:s.z-rz,maxZ:s.z+rz,minY:s.y,maxY:s.y+1.09,obb:{cx:s.x,cz:s.z,hx,hz,cs,sn}});
  });
  for(const mesh of [detail,surface]){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);}
  if(surface.instanceColor)surface.instanceColor.needsUpdate=true;
  C.tennisStats={sourceCount:C.TENNIS?.records.length||0,placed:layout.sites.length,rejected:layout.rejected,sites:layout.sites,pads,rejectedPads,trianglesPerCourt:positions.length/9+2,terrain,sourceAudit:C.TENNIS?.audit||[]};
  console.info('[tennis] '+JSON.stringify({placed:layout.sites.length,rejected:layout.rejected}));
  return {group,colliders,sites:layout.sites,pads};
}
C.tennisSites=tennisSites;C.courtPoint=courtPoint;C.courtShape=courtShape;C.onCourt=onCourt;C.inTennisPad=inTennisPad;C.buildTennis=buildTennis;
})();
