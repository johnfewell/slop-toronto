(function(){
// js/rinks.js
// The City's 17 outdoor rink and skate-trail footprints (js/toronto-rinks.js, tools/build-rinks.mjs): the mapped
// polygons with their curves and holes, never rectangles from inventory points or dimensions. Boards follow the 2025
// aerial review, which overrides two High Park source flags (the source values stay on the place cards).
//
// Season: the scene is lit on one calendar day (lighting.js SCENE_DATE, 22 August), so the rinks show their
// off-season state: concrete pads, paved trails and Nathan Phillips / TMU Square's reflecting pools. rinkSeason() is the
// game's approximation of the City's usual outdoor season (ice from 1 December to 15 March, weather permitting); it is
// not an operational status. ?rinks=ice or ?rinks=off previews either state. Lit rinks (source Lighting: Yes) glow
// under floodlight at night only in the ice season; no light pole positions are mapped, so none are drawn.
const C=window.CITY;
const BOARD_HEIGHT=1.07,BOARD_HALF=.045,GATE_WIDTH=2,SURFACE_LIFT=.024,LINE_LIFT=.028,MAX_OVERLAP=1,WALL_STEP=.45;
const COLOURS={pad:'#7f817c',path:'#6f7270',water:'#1c2c2e',ice:'#dde8ec',board:'#e6e8e2',cap:'#3a4245',wall:'#9c9a92',
  red:{ice:'#c0443c',off:'#8f5e57'},blue:{ice:'#3b6cb5',off:'#5f7590'}};
const ROUGH={pad:.95,path:.93,water:.07,ice:.16,line:.6};

function rinkSeason(date) {
  const m=date?.month,d=date?.day;
  if(!Number.isInteger(m)||!Number.isInteger(d))throw new Error('rinkSeason needs {month, day}');
  return m===12||m===1||m===2||(m===3&&d<=15)?'ice':'off';
}
function sceneSeason(search,date) {
  const forced=new URLSearchParams(search||'').get('rinks');
  return forced==='ice'||forced==='off'?{season:forced,forced:true}:{season:rinkSeason(date),forced:false};
}
// The surface a record shows in a season
function surfaceKind(record,season) {
  if(season==='ice')return 'ice';
  return record.appearance==='pond'?'water':record.type==='Skate Trail'?'path':'pad';
}

// ---- polygon helpers ([x, z] rings)
function inRing(ring,x,z) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i][1]>z)!==(ring[j][1]>z)&&x<(ring[j][0]-ring[i][0])*(z-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0])inside=!inside;
  return inside;
}
const ringArea=(ring)=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
function recordBounds(record) {
  const b={x0:Infinity,x1:-Infinity,z0:Infinity,z1:-Infinity};
  for(const p of record.polygons)for(const [x,z]of p.outer){b.x0=Math.min(b.x0,x);b.x1=Math.max(b.x1,x);b.z0=Math.min(b.z0,z);b.z1=Math.max(b.z1,z);}
  return b;
}
function inRecord(record,x,z,margin=0) {
  const b=record.bounds||recordBounds(record);
  if(x<b.x0-margin||x>b.x1+margin||z<b.z0-margin||z>b.z1+margin)return false;
  if(record.polygons.some((p)=>inRing(p.outer,x,z)&&!p.holes.some((h)=>inRing(h,x,z))))return true;
  if(!margin)return false;
  // within `margin` of the outline
  for(const p of record.polygons)for(let i=0;i<p.outer.length;i++) {
    const a=p.outer[i],c=p.outer[(i+1)%p.outer.length],dx=c[0]-a[0],dz=c[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
    if(Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<margin)return true;
  }
  return false;
}
// Interior sample points on a grid (and the outline's vertices), for placement checks
function samplePoints(record,step) {
  const b=record.bounds||recordBounds(record),out=[];
  for(let x=b.x0+step/2;x<b.x1;x+=step)for(let z=b.z0+step/2;z<b.z1;z+=step)if(inRecord(record,x,z))out.push([x,z]);
  return out;
}
function isConvex(points) {
  let sign=0;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],c=points[(i+2)%points.length];
    const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
    if(Math.abs(cross)<1e-9)continue;
    if(sign&&Math.sign(cross)!==sign)return false;
    sign=Math.sign(cross);
  }
  return true;
}
// A polygon with holes as convex pieces (earcut triangles merged across diagonals while convex: Hertel-Mehlhorn), for
// the terrain clipper, which subtracts one convex footprint at a time
function convexPieces(outer,holes,triangulate) {
  if(!holes.length&&isConvex(outer))return [outer];
  const points=[...outer,...holes.flat()];
  const ccw=(t)=>ringArea(t.map((k)=>points[k]))<0?t.slice().reverse():t.slice();
  const polys=triangulate(outer,holes).map(ccw),parent=polys.map((_,i)=>i);
  const find=(i)=>{while(parent[i]!==i)i=parent[i]=parent[parent[i]];return i;};
  const edgeOwner=new Map();
  polys.forEach((t,i)=>t.forEach((a,j)=>edgeOwner.set(`${a},${t[(j+1)%3]}`,i)));
  for(const [edge,i]of edgeOwner) {
    const [a,b]=edge.split(',').map(Number),j=edgeOwner.get(`${b},${a}`);
    if(j===undefined||i>j)continue; // each shared diagonal once
    const p=find(i),q=find(j);if(p===q)continue;
    const A=polys[p],B=polys[q],ia=A.findIndex((k,n)=>k===a&&A[(n+1)%A.length]===b),ib=B.findIndex((k,n)=>k===b&&B[(n+1)%B.length]===a);
    if(ia<0||ib<0)continue;
    const merged=[];
    for(let n=1;n<=A.length;n++)merged.push(A[(ia+n)%A.length]); // b ... a
    for(let n=2;n<B.length;n++)merged.push(B[(ib+n)%B.length]); // after a, around to before b
    if(!isConvex(merged.map((k)=>points[k])))continue;
    polys[p]=merged;parent[q]=p;
  }
  return polys.filter((_,i)=>find(i)===i).map((t)=>t.map((k)=>points[k]));
}
// Closed-ring Douglas-Peucker: board panels follow the outline without a panel per digitised vertex
function simplifyRing(ring,tolerance) {
  if(ring.length<=4)return ring.slice();
  let far=0,best=-1;
  for(let i=1;i<ring.length;i++){const d=Math.hypot(ring[i][0]-ring[0][0],ring[i][1]-ring[0][1]);if(d>best){best=d;far=i;}}
  const run=(pts)=>{
    if(pts.length<3)return pts;
    const a=pts[0],b=pts.at(-1),dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1;let k=0,max=-1;
    for(let i=1;i<pts.length-1;i++){const d=Math.abs((pts[i][0]-a[0])*dz-(pts[i][1]-a[1])*dx)/l;if(d>max){max=d;k=i;}}
    return max<=tolerance?[a,b]:[...run(pts.slice(0,k+1)).slice(0,-1),...run(pts.slice(k))];
  };
  const first=run(ring.slice(0,far+1)),second=run([...ring.slice(far),ring[0]]);
  return [...first.slice(0,-1),...second.slice(0,-1)];
}
// Board runs: the outline minus a GATE_WIDTH opening centred on the reviewed access point
function boardRuns(ring,gate) {
  const n=ring.length,lengths=ring.map((a,i)=>{const b=ring[(i+1)%n];return Math.hypot(b[0]-a[0],b[1]-a[1]);}),total=lengths.reduce((s,l)=>s+l,0);
  let at=null;
  if(gate) {
    let best=Infinity,s=0;
    ring.forEach((a,i)=>{const b=ring[(i+1)%n],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((gate.x-a[0])*dx+(gate.z-a[1])*dz)/(lengths[i]**2||1))),d=Math.hypot(gate.x-a[0]-t*dx,gate.z-a[1]-t*dz);if(d<best){best=d;at=s+t*lengths[i];}s+=lengths[i];});
  }
  const open=(s)=>at!==null&&Math.abs(((s-at)%total+total*1.5)%total-total/2)<GATE_WIDTH/2;
  const segments=[];let s=0;
  ring.forEach((a,i)=>{
    const b=ring[(i+1)%n],L=lengths[i];
    if(L<1e-6)return;
    // the gate's ends cut this edge into up to three pieces
    const cuts=[0,L];
    if(at!==null)for(const g of [at-GATE_WIDTH/2,at+GATE_WIDTH/2])for(const w of [g-total,g,g+total])if(w>s&&w<s+L)cuts.push(w-s);
    cuts.sort((p,q)=>p-q);
    for(let k=0;k+1<cuts.length;k++) {
      const t0=cuts[k],t1=cuts[k+1];if(t1-t0<1e-6||open(s+(t0+t1)/2))continue;
      const p=(t)=>[a[0]+(b[0]-a[0])*t/L,a[1]+(b[1]-a[1])*t/L];segments.push([p(t0),p(t1)]);
    }
    s+=L;
  });
  return {segments,gateAt:at,perimeter:total,gateGap:at===null?0:GATE_WIDTH};
}
// The smallest rectangle around the outline (from the outline's own edge directions): a hockey pad's long axis
function outlineRectangle(ring) {
  let best=null;
  for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l<.5)continue;
    const ux=(b[0]-a[0])/l,uz=(b[1]-a[1])/l;let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;
    for(const [x,z]of ring){const u=x*ux+z*uz,v=-x*uz+z*ux;u0=Math.min(u0,u);u1=Math.max(u1,u);v0=Math.min(v0,v);v1=Math.max(v1,v);}
    const area=(u1-u0)*(v1-v0);
    if(!best||area<best.area) {
      const cu=(u0+u1)/2,cv=(v0+v1)/2,long=u1-u0>=v1-v0;
      best={area,x:cu*ux-cv*uz,z:cu*uz+cv*ux,length:Math.max(u1-u0,v1-v0),width:Math.min(u1-u0,v1-v0),ax:long?ux:-uz,az:long?uz:ux};
    }
  }
  return best;
}

// Which records can be drawn where they are mapped: one curb island, level ground, no building or prop under them.
// A rejected rink is reported, never moved.
function rinkSites(records,{blockAt,groundAt,overlapArea}) {
  const sites=[],rejected=[];
  for(const source of records) {
    const record={...source,bounds:recordBounds(source)},interior=samplePoints(record,2);
    if(!interior.length){rejected.push({id:record.id,reason:'empty'});continue;}
    const block=blockAt(...interior[0]),y=groundAt(...interior[0]);
    if(!block||!Number.isFinite(y)){rejected.push({id:record.id,reason:'ground'});continue;}
    let reason='';
    for(const [x,z]of [...interior,...record.polygons.flatMap((p)=>p.outer)]) {
      if(blockAt(x,z)!==block){reason='road';break;}
      const h=groundAt(x,z);if(!Number.isFinite(h)||Math.abs(h-y)>.15){reason='grade';break;}
    }
    const overlap=reason?0:overlapArea(record,y);
    if(!reason&&overlap>MAX_OVERLAP)reason='obstruction';
    if(reason)rejected.push({id:record.id,reason,...(overlap?{overlap}:{})});else sites.push({...record,y,overlap});
  }
  return {sites,rejected};
}

function buildRinks(scene,staticColliders=[]) {
  const {THREE,WorldCollision:W,TSL}=C;
  const records=C.RINKS?.records||[];
  if(!records.length)return null;
  const {season,forced}=sceneSeason(location.search,C.SCENE_DATE||{month:8,day:22});
  const groundAt=(x,z)=>(C.blockAt(x,z)?C.CITY_BOUNDS.sidewalkHeight:0)+(C.cutAt?.(x,z)||0);
  // Area (m2) of a footprint under something solid between ankle and head height: buildings, landmarks, props
  const overlapArea=(record,y)=>{
    const b=record.bounds,solid=staticColliders.filter((c)=>c.maxX>b.x0&&c.minX<b.x1&&c.maxZ>b.z0&&c.minZ<b.z1&&(c.maxY??Infinity)>y+.08&&(c.minY??-Infinity)<y+1.1);
    if(!solid.length)return 0;
    const shapes=solid.map((c)=>W.colliderShape(c));let hits=0;
    for(const [x,z]of samplePoints(record,.5))if(shapes.some((s)=>W.inside(x,z,s.points)))hits++;
    return hits*.25;
  };
  const layout=rinkSites(records,{blockAt:C.blockAt,groundAt,overlapArea});
  const sites=layout.sites;
  for(const s of sites)s.surface=surfaceKind(s,season);

  // Terrain: the coarse near grid is clipped from every accepted footprint (sports-terrain.js), in convex pieces
  const triangulate=(outer,holes)=>THREE.ShapeUtils.triangulateShape(outer.map(([x,z])=>new THREE.Vector2(x,z)),holes.map((h)=>h.map(([x,z])=>new THREE.Vector2(x,z))));
  const pieces=sites.flatMap((s)=>s.polygons.flatMap((p)=>convexPieces(p.outer,p.holes,triangulate)).map((ring)=>({ring,y:s.y})));
  const terrain=C.clearSportsTerrain?.(scene,pieces)||{cutTriangles:0};
  // Walking floors: the prepared slab replaces the coarse hill inside the outline (holes keep their ground)
  C.sportsGroundProviders?.set('rinks',(x,z)=>{for(const s of sites)if(inRecord(s,x,z))return s.y;return null;});

  // ---- one surface mesh (pads, trails, ice, pools and pad lines) and one board mesh
  const surf={position:[],color:[],rough:[],lit:[]},board={position:[],color:[]},colliders=[];
  const colourCache=new Map(),col=(hex)=>{let c=colourCache.get(hex);if(!c){c=new THREE.Color(hex);colourCache.set(hex,c);}return c;};
  const surfaceTri=(pts,y,hex,rough,lit)=>{const c=col(hex);for(const [x,z]of pts){surf.position.push(x,y,z);surf.color.push(c.r,c.g,c.b);surf.rough.push(rough);surf.lit.push(lit);}};
  const boardQuad=(a,b,c,d,hex)=>{const k=col(hex);for(const p of [a,b,c,a,c,d]){board.position.push(...p);board.color.push(k.r,k.g,k.b);}};
  const wall=(a,b,y0,ha,hb,hex)=>{boardQuad([a[0],y0,a[1]],[b[0],y0,b[1]],[b[0],hb,b[1]],[a[0],ha,a[1]],hex);boardQuad([b[0],y0,b[1]],[a[0],y0,a[1]],[a[0],ha,a[1]],[b[0],hb,b[1]],hex);};
  const segmentCollider=(a,b,y0,y1,half)=>{
    const cx=(a[0]+b[0])/2,cz=(a[1]+b[1])/2,L=Math.hypot(b[0]-a[0],b[1]-a[1]),cs=(b[1]-a[1])/L,sn=(b[0]-a[0])/L,hx=half,hz=L/2;
    const rx=Math.abs(cs)*hx+Math.abs(sn)*hz,rz=Math.abs(sn)*hx+Math.abs(cs)*hz;
    colliders.push({minX:cx-rx,maxX:cx+rx,minZ:cz-rz,maxZ:cz+rz,minY:y0,maxY:y1,obb:{cx,cz,hx,hz,cs,sn}});
  };
  const stats={boards:[],lines:[],walls:0,wallColliders:0,maxWall:{}};
  for(const s of sites) {
    const lit=season==='ice'&&s.sourceFacts?.Lighting==='Yes'?1:0;
    const hex=COLOURS[s.surface],rough=ROUGH[s.surface];
    for(const p of s.polygons) {
      const pts=[...p.outer,...p.holes.flat()];
      for(const tri of triangulate(p.outer,p.holes)) {
        const t=tri.map((k)=>pts[k]);if(ringArea(t)>0)t.reverse(); // up-facing in the world (x, -z) plane
        surfaceTri(t,s.y+SURFACE_LIFT,hex,rough,lit);
      }
    }
    // Hockey pads: centre red line and blue lines, across the outline's long axis (faded in the off-season)
    const ring=s.polygons[0].outer,rect=outlineRectangle(ring);
    if(s.boards&&rect&&Math.abs(ringArea(ring))/rect.area>.85&&s.surface!=='water') {
      const key=season==='ice'?'ice':'off',half=rect.width/2-.6;
      for(const [offset,colour]of [[0,COLOURS.red[key]],[-.18*rect.length,COLOURS.blue[key]],[.18*rect.length,COLOURS.blue[key]]]) {
        const cx=rect.x+rect.ax*offset,cz=rect.z+rect.az*offset,w=.15,px=-rect.az,pz=rect.ax;
        const q=[[cx-rect.ax*w-px*half,cz-rect.az*w-pz*half],[cx+rect.ax*w-px*half,cz+rect.az*w-pz*half],[cx+rect.ax*w+px*half,cz+rect.az*w+pz*half],[cx-rect.ax*w+px*half,cz-rect.az*w+pz*half]];
        for(const t of [[q[0],q[1],q[2]],[q[0],q[2],q[3]]]){if(ringArea(t)>0)t.reverse();surfaceTri(t,s.y+LINE_LIFT,colour,ROUGH.line,lit);}
      }
      stats.lines.push(s.id);
    }
    // Retaining edge where the near terrain grid stands above the slab (Withrow's bank): concrete up to its cut edge
    const terrainAt=C.terrainNearHeightAt;
    if(terrainAt)for(const p of s.polygons)for(const r of [p.outer,...p.holes])for(let i=0;i<r.length;i++) {
      const a=r[i],b=r[(i+1)%r.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/4));
      for(let k=0;k<n;k++) {
        const p0=[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n],p1=[a[0]+(b[0]-a[0])*(k+1)/n,a[1]+(b[1]-a[1])*(k+1)/n];
        const h0=terrainAt(...p0),h1=terrainAt(...p1);
        if(Math.max(h0,h1)<=s.y+.02)continue;
        wall(p0,p1,s.y,Math.max(s.y,h0)+.05,Math.max(s.y,h1)+.05,COLOURS.wall);stats.walls++;stats.maxWall[s.assetId]=+Math.max(stats.maxWall[s.assetId]||0,h0-s.y,h1-s.y).toFixed(2);
        if(Math.max(h0,h1)-s.y>WALL_STEP){segmentCollider(p0,p1,s.y,Math.max(h0,h1),.05);stats.wallColliders++;}
      }
    }
    if(!s.boards)continue;
    // Dasher boards: 1.07 m white panels with a dark cap rail, open at the reviewed gate
    const runs=boardRuns(simplifyRing(ring,.05),s.gate);
    for(const [a,b]of runs.segments) {
      const L=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/L*BOARD_HALF,nz=(b[0]-a[0])/L*BOARD_HALF,y0=s.y,y1=s.y+BOARD_HEIGHT;
      const i0=[a[0]+nx,a[1]+nz],i1=[b[0]+nx,b[1]+nz],o0=[a[0]-nx,a[1]-nz],o1=[b[0]-nx,b[1]-nz];
      boardQuad([i0[0],y0,i0[1]],[i1[0],y0,i1[1]],[i1[0],y1-.08,i1[1]],[i0[0],y1-.08,i0[1]],COLOURS.board);
      boardQuad([o1[0],y0,o1[1]],[o0[0],y0,o0[1]],[o0[0],y1-.08,o0[1]],[o1[0],y1-.08,o1[1]],COLOURS.board);
      for(const [p,q]of [[i0,i1],[o1,o0]])boardQuad([p[0],y1-.08,p[1]],[q[0],y1-.08,q[1]],[q[0],y1,q[1]],[p[0],y1,p[1]],COLOURS.cap);
      boardQuad([i0[0],y1,i0[1]],[i1[0],y1,i1[1]],[o1[0],y1,o1[1]],[o0[0],y1,o0[1]],COLOURS.cap);
      segmentCollider(a,b,y0,y1,BOARD_HALF);
    }
    stats.boards.push({id:s.id,segments:runs.segments.length,perimeter:runs.perimeter,gateGap:runs.gateGap});
  }

  const group=new THREE.Group();group.name='MappedRinks';scene.add(group);
  const {attribute,smoothstep,float}=TSL;
  const surfGeo=new THREE.BufferGeometry();
  surfGeo.setAttribute('position',new THREE.Float32BufferAttribute(surf.position,3));surfGeo.setAttribute('color',new THREE.Float32BufferAttribute(surf.color,3));
  surfGeo.setAttribute('rough',new THREE.Float32BufferAttribute(surf.rough,1));surfGeo.setAttribute('lit',new THREE.Float32BufferAttribute(surf.lit,1));
  surfGeo.computeVertexNormals();surfGeo.computeBoundingSphere();
  const surfMat=new THREE.MeshStandardNodeMaterial({vertexColors:true,roughness:.9});
  surfMat.roughnessNode=attribute('rough','float');
  // Floodlit ice at night (the same night ramp as the windows, boroughs.js)
  if(C.cityUniforms?.uInteriorGlow)surfMat.emissiveNode=attribute('color','vec3').mul(attribute('lit','float')).mul(smoothstep(float(.7),float(1.45),C.cityUniforms.uInteriorGlow)).mul(.32);
  const surfaces=new THREE.Mesh(surfGeo,surfMat);surfaces.name='RinkSurfaces';surfaces.receiveShadow=true;group.add(surfaces);
  let boards=null;
  if(board.position.length) {
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(board.position,3));g.setAttribute('color',new THREE.Float32BufferAttribute(board.color,3));
    g.computeVertexNormals();g.computeBoundingSphere();
    boards=new THREE.Mesh(g,new THREE.MeshStandardNodeMaterial({vertexColors:true,roughness:.7}));boards.name='RinkBoards';boards.receiveShadow=true;
    // (phones drop small casters: the same rule as the kerbs, quality.js)
    boards.castShadow=C.QUALITY?.kerbShadows!==false;group.add(boards);
  }
  C.rinkStats={season,forced,sceneDate:C.SCENE_DATE||null,sourceCount:records.length,placed:sites.length,rejected:layout.rejected,
    sites:sites.map(({id,assetId,name,parentName,type,y,surface,boards:b,overlap})=>({id,assetId,name,parentName,type,y,surface,boards:b,overlap})),
    terrain,terrainPieces:pieces.length,surfaceTriangles:surf.position.length/9,boardTriangles:board.position.length/9,colliders:colliders.length,...stats,sourceAudit:C.RINKS.audit||[]};
  console.info('[rinks] '+JSON.stringify({season,forced,placed:sites.length,rejected:layout.rejected,triangles:C.rinkStats.surfaceTriangles+C.rinkStats.boardTriangles,colliders:colliders.length}));
  return {group,colliders,sites};
}
let footprints=null;
const inRinkFootprint=(x,z,margin=0)=>(footprints??=(C.RINKS?.records||[]).map((r)=>({...r,bounds:recordBounds(r)}))).some((r)=>inRecord(r,x,z,margin));
// Place-card lines for a rink's discovery record (tour-guide.js): what the city shows for it, and why
function rinkCardFacts(record) {
  if(record?.kind!=='rink')return null;
  const stats=C.rinkStats;if(!stats)return null;
  const site=stats.sites.find((s)=>s.id===record.id),rejected=stats.rejected.find((s)=>s.id===record.id);
  const date=stats.sceneDate?new Date(Date.UTC(2026,stats.sceneDate.month-1,stats.sceneDate.day)).toLocaleDateString('en-CA',{month:'long',day:'numeric',timeZone:'UTC'}):'';
  const what={pad:'off-season concrete pad',path:'off-season paved trail',water:'off-season reflecting pool',ice:'ice'}[site?.surface];
  const facts={};
  if(site)facts['In the city']=`City-mapped outline, shown as ${what}${stats.forced?' (preview)':date?` (scene date ${date})`:''}`;
  else facts['In the city']=`Outline not drawn (${rejected?.reason||'not in this area'})`;
  const audit=stats.sourceAudit.find((a)=>`city-rink:${a.id}`===record.id&&a.kind==='boards');
  if(site&&audit)facts['Boards in the city']=`${site.boards?'Drawn':'Not drawn'}: 2025 City aerial review differs from the source listing`;
  facts['Season']='Outdoor rinks are seasonal and weather dependent. The scene shows no live status; check the City for current skating hours';
  return facts;
}
Object.assign(C,{rinkSeason,sceneSeason,surfaceKind,inRecord,convexPieces,simplifyRing,boardRuns,outlineRectangle,rinkSites,buildRinks,inRinkFootprint,rinkCardFacts});
})();
