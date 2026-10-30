(function(){
const groundProviders=new Map();
function sportsGroundAt(x,z) {
  for(const provider of groundProviders.values()){const y=provider(x,z);if(Number.isFinite(y))return y;}
  return null;
}
// Subtract a convex vertical footprint from a triangle while interpolating its
// original height. Each emitted piece is outside a different clipping plane;
// pieces do not overlap and the surrounding hill is unchanged.
function subtractCourtTriangle(triangle,site) {
  const cs=Math.cos(site.yaw),sn=Math.sin(site.yaw);
  const winding=site.ring?.reduce((sum,a,i)=>{const b=site.ring[(i+1)%site.ring.length];return sum+a[0]*b[1]-b[0]*a[1];},0)>0?1:-1;
  const planes=site.ring?site.ring.map((a,i)=>{const b=site.ring[(i+1)%site.ring.length],x=(b[1]-a[1])*winding,z=-(b[0]-a[0])*winding;return {x,z,c:x*a[0]+z*a[1]};}):[{x:cs,z:-sn,c:site.x*cs-site.z*sn+6.454},{x:-cs,z:sn,c:-site.x*cs+site.z*sn+6.454},{x:sn,z:cs,c:site.x*sn+site.z*cs+11.92},{x:-sn,z:-cs,c:-site.x*sn-site.z*cs+11.92}];
  const pieces=[];let inside=triangle;
  for(const plane of planes) {
    const keep=[],outside=[];
    for(let i=0;i<inside.length;i++) {
      const a=inside[i],b=inside[(i+1)%inside.length],da=plane.c-plane.x*a[0]-plane.z*a[2],db=plane.c-plane.x*b[0]-plane.z*b[2];
      (da>=0?keep:outside).push(a);
      if((da>=0)!==(db>=0)) {
        const t=da/(da-db),p=a.map((v,j)=>v+(b[j]-v)*t);keep.push(p);outside.push(p);
      }
    }
    if(outside.length>=3)pieces.push(outside);
    inside=keep;if(inside.length<3)break;
  }
  return pieces;
}
function clearSportsTerrain(scene,sites) {
  const mesh=scene.getObjectByName('TerrainNear');
  if(!mesh||!sites.length)return {cutTriangles:0};
  const g=mesh.geometry,index=g.index,position=g.attributes.position,normal=g.attributes.normal,uv=g.attributes.uv;
  const bounds=sites.map((s)=>{if(s.ring)return {...s,x0:Math.min(...s.ring.map((p)=>p[0])),x1:Math.max(...s.ring.map((p)=>p[0])),z0:Math.min(...s.ring.map((p)=>p[1])),z1:Math.max(...s.ring.map((p)=>p[1]))};const cs=Math.abs(Math.cos(s.yaw)),sn=Math.abs(Math.sin(s.yaw)),rx=cs*6.454+sn*11.92,rz=sn*6.454+cs*11.92;return {...s,x0:s.x-rx,x1:s.x+rx,z0:s.z-rz,z1:s.z+rz};});
  // Footprints bucketed into cells: rinks add hundreds of convex pieces, and
  // each terrain triangle needs only the few beside it (same order as given).
  const CELL=64,cells=new Map(),key=(i,j)=>i*100003+j;
  bounds.forEach((s,n)=>{for(let i=Math.floor(s.x0/CELL);i<=Math.floor(s.x1/CELL);i++)for(let j=Math.floor(s.z0/CELL);j<=Math.floor(s.z1/CELL);j++){const k=key(i,j);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(n);}});
  const near=(x0,x1,z0,z1)=>{let found=null;for(let i=Math.floor(x0/CELL);i<=Math.floor(x1/CELL);i++)for(let j=Math.floor(z0/CELL);j<=Math.floor(z1/CELL);j++){const list=cells.get(key(i,j));if(list){found??=new Set();for(const n of list)found.add(n);}}return found?[...found].sort((a,b)=>a-b).map((n)=>bounds[n]):[];};
  const out=Array.from(position.array),nor=Array.from(normal.array),tex=Array.from(uv.array),indices=[];let cutTriangles=0;
  const count=index?index.count:position.count;
  for(let i=0;i<count;i+=3) {
    const ids=[0,1,2].map((j)=>index?index.getX(i+j):i+j);
    const x0=Math.min(...ids.map((k)=>position.getX(k))),x1=Math.max(...ids.map((k)=>position.getX(k))),z0=Math.min(...ids.map((k)=>position.getZ(k))),z1=Math.max(...ids.map((k)=>position.getZ(k))),y1=Math.max(...ids.map((k)=>position.getY(k)));
    const candidates=near(x0,x1,z0,z1).filter((s)=>s.x1>x0&&s.x0<x1&&s.z1>z0&&s.z0<z1&&y1>s.y-.01);
    if(!candidates.length){indices.push(...ids);continue;}
    const vertices=ids.map((k)=>[position.getX(k),position.getY(k),position.getZ(k),normal.getX(k),normal.getY(k),normal.getZ(k),uv.getX(k),uv.getY(k)]);
    let pieces=[vertices];
    for(const s of candidates)pieces=pieces.flatMap((p)=>subtractCourtTriangle(p,s));
    const area=(p)=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[2]-b[0]*a[2];},0))/2;
    if(area(vertices)-pieces.reduce((sum,p)=>sum+area(p),0)<.00001){indices.push(...ids);continue;}
    cutTriangles++;
    for(const p of pieces)for(let j=1;j+1<p.length;j++)for(const v of [p[0],p[j],p[j+1]]){indices.push(out.length/3);out.push(...v.slice(0,3));nor.push(...v.slice(3,6));tex.push(...v.slice(6,8));}
  }
  if(cutTriangles) {
    const next=new window.CITY.THREE.BufferGeometry();
    for(const [name,values,size]of [['position',out,3],['normal',nor,3],['uv',tex,2]])next.setAttribute(name,new window.CITY.THREE.Float32BufferAttribute(values,size));
    next.setIndex(indices);
    next.normalizeNormals();next.computeBoundingSphere();mesh.geometry=next;g.dispose();
  }
  return {cutTriangles};
}
Object.assign(window.CITY,{subtractCourtTriangle,clearSportsTerrain,sportsGroundAt,sportsGroundProviders:groundProviders});
})();
