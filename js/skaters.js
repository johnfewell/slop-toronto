(function(){
// js/skaters.js
// People skating on the City's outdoor rinks (rinks.js), only while the rinks are open: in the ice season, between the
// opening and closing hours, and, for a rink the City lists without lights, only in daylight. Nothing is built in the
// off-season (the presets' 22 August), so the summer scene pays nothing.
//
// Season and hours. The City publishes no per-rink 2026-27 opening dates or daily hours: its Drop-in Skating page says
// outdoor artificial ice rinks "typically open in late November and close for the season in March", that "Schedules and
// hours of operation vary", and closes them after heavy snow or on warm days. The game keeps rinks.js's ice season
// (1 December to 15 March) and uses a representative 9 am to 10 pm day. It is an approximation, not a live status.
//
// Each skater sits on a closed loop inside their rink, travelling counter-clockwise (seen from above) as public skate
// runs: a superellipse fitted to the pad (or shrunk to fit an irregular outline), one lane per skater by speed. A
// skater's place is a closed-form function of time (angle = start - rate * t), so a rink out of range costs nothing and
// nobody needs per-frame state until drawn.
//
// Shinny and trails (jf-9vp follow-up). A hockey-boarded pad runs a pickup game in the after-school and evening windows
// (and at weekend hours): two loose sides in different jerseys' worth of colour, sticks, a puck and a net at each end, on a
// closed-form game (a puck wandering the pad on two sine pairs; each player home position pulled towards the puck, lagged,
// so the nearest ones chase and the rest hold their spots). Skate trails (the City's three mapped loops) carry people along
// the trail's own centre line, counter-clockwise, lane by speed. Neither adds per-frame state beyond the smoothed offsets.
// Rinks the City lists elsewhere (Greenwood, Dieppe, Colonel Samuel Smith, the Bentway, Harbourfront Natrel) are not in its
// rink data and so are not drawn by the game; only the mapped trails get skaters. They step aside for the player (a smoothed offset away from them, kept
// inside the rink); they are never colliders, so the player cannot be held by them.
const C=window.CITY;
const OPEN_HOUR=9,CLOSE_HOUR=22,DARK_GLOW=.9;
const DRAW_RANGE=110,MAX_DRAWN=220,AVOID_RADIUS=3.2,MAX_OFFSET=2.6,EDGE_CLEAR=1.2;
// Share of a rink's peak crowd by hour: [hour, share] keypoints, linear between
const WEEKDAY=[[9,.1],[12,.2],[15,.4],[17,.55],[19,1],[21,.8],[22,.5]];
const WEEKEND=[[9,.2],[10,.7],[12,1],[16,1],[18,.8],[20,.55],[22,.4]];

const hash=(i,salt)=>{const v=Math.sin(i*12.9898+salt*78.233)*43758.5453;return v-Math.floor(v);};
const lerp=(a,b,t)=>a+(b-a)*t;

// Whether the rinks are open for skating now. `lit`: the City lists lights for this rink; `dark`: after dusk.
function skaterRinkOpen({season,hour,lit,dark}) {
  if(season!=='ice'||!Number.isFinite(hour))return false;
  if(hour<OPEN_HOUR||hour>=CLOSE_HOUR)return false;
  return Boolean(lit)||!dark;
}
function isWeekend(date) {
  const d=new Date(Date.UTC(date?.year||2026,(date?.month||1)-1,date?.day||1)).getUTCDay();
  return d===0||d===6;
}
function skaterActivity(hour,weekend) {
  const keys=weekend?WEEKEND:WEEKDAY;
  if(hour<=keys[0][0])return keys[0][1];
  for(let i=1;i<keys.length;i++)if(hour<=keys[i][0]){const [h0,v0]=keys[i-1],[h1,v1]=keys[i];return lerp(v0,v1,(hour-h0)/(h1-h0));}
  return keys.at(-1)[1];
}
// Peak and current head count for a pad of `area` m2: about one person per 70 m2 at the busiest, 4 to 26 a rink
function skaterPeak(area) {return Math.max(4,Math.min(26,Math.round(area/70)));}
function skaterCount({area,hour,weekend,open=true}) {
  if(!open)return 0;
  return Math.max(1,Math.round(skaterPeak(area)*skaterActivity(hour,weekend)));
}

// ---- geometry: clearance from a footprint's outline
// ---- shinny: when a boarded pad plays a game rather than public skate, and how many play
// Windows (local hours): after school and evenings on weekdays; mornings, early afternoon and evenings at weekends
const SHINNY_WEEKDAY=[[15.5,18],[19,22]],SHINNY_WEEKEND=[[9,12],[13,16],[19,22]];
const SHINNY_SHARE=.75; // of boarded pads host the game in a window; the rest stay public skate
function shinnyWindow(hour,weekend) {
  if(!Number.isFinite(hour))return false;
  return (weekend?SHINNY_WEEKEND:SHINNY_WEEKDAY).some(([a,b])=>hour>=a&&hour<b);
}
// `pick`: a stable 0..1 per pad
function shinnyOn({open,hour,weekend,boards,pick}) {
  return Boolean(open&&boards&&pick<SHINNY_SHARE&&shinnyWindow(hour,weekend));
}
// Players on each side: 3 on a small pad to 6 on a full one
function shinnyPerSide(area) {return Math.max(3,Math.min(6,Math.round(area/330)));}
// Trail loops carry fewer people per m2 than a pad (they are single file with passing)
const trailPeak=(area)=>Math.max(4,Math.min(20,Math.round(area/90)));

// The game in the pad's own frame: u along the long axis (-halfU..halfU), w across. The puck wanders on two sine pairs
// (peaks near 5 m/s on a full pad). Each player has a home spot by role and side; the player's place is the home pulled
// towards where the puck was `lag` seconds ago, by `pull` (chasers pull hard, the rest hold position).
function shinnyPuck(t,seed,halfU,halfW,out) {
  const h=(n)=>hash(seed,n)*Math.PI*2;
  out[0]=halfU*.8*(.68*Math.sin(.19*t+h(1))+.32*Math.sin(.53*t+h(2)));
  out[1]=halfW*.78*(.6*Math.sin(.31*t+h(3))+.4*Math.sin(.83*t+h(4)));
  return out;
}
// Role i of a side (team 0 defends -u, team 1 defends +u): back pair, then forwards, then wingers
function shinnyHome(team,i,halfU,halfW,out) {
  const dir=team?1:-1,rank=Math.floor(i/2),lateral=(i%2?-1:1)*(rank===0?.45:rank===1?.25:.6);
  out[0]=dir*halfU*(rank===0?.5:rank===1?.05:-.3); // depth from its own end: backs near it, wingers towards the other net
  out[1]=halfW*lateral;
  return out;
}
const _pk=[0,0],_hm=[0,0];
function shinnyPlayer(t,seed,i,team,halfU,halfW,out) {
  const h=(n)=>hash(seed*37+i*5+team*101,n);
  const lag=.25+h(1)*.9,pull=Math.max(.25,Math.min(.85,.78-Math.floor(i/2)*.18+(h(2)-.5)*.2));
  shinnyHome(team,i,halfU,halfW,_hm);
  shinnyPuck(t-lag,seed,halfU,halfW,_pk);
  out[0]=_hm[0]+(_pk[0]-_hm[0])*pull+Math.sin(t*(.7+h(3)*.5)+h(4)*6)*.8;
  out[1]=_hm[1]+(_pk[1]-_hm[1])*pull+Math.sin(t*(.6+h(5)*.5)+h(6)*6)*.8;
  out[0]=Math.max(-halfU,Math.min(halfU,out[0]));out[1]=Math.max(-halfW,Math.min(halfW,out[1]));
  return out;
}

// ---- trails: a centre line (outer and inner edge per sample) for each mapped skate trail, walked counter-clockwise
const TRAIL_SAMPLES=96;
function resample(ring,n) {
  const len=[0];for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];len.push(len[i]+Math.hypot(b[0]-a[0],b[1]-a[1]));}
  const total=len[ring.length],out=[];let j=0;
  for(let k=0;k<n;k++){
    const d=total*k/n;while(len[j+1]<d)j++;
    const a=ring[j],b=ring[(j+1)%ring.length],f=(d-len[j])/((len[j+1]-len[j])||1);
    out.push([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]);
  }
  return out;
}
const shoelace=(ring)=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
const smoothRing=(ring,passes)=>{
  let r=ring;
  for(let p=0;p<passes;p++)r=r.map((a,i)=>{const b=r[(i+r.length-1)%r.length],c=r[(i+1)%r.length];return [(a[0]*2+b[0]+c[0])/4,(a[1]*2+b[1]+c[1])/4];});
  return r;
};
// Samples {o:[x,z] outer edge, i:[x,z] inner edge} around the trail, ordered so travel is counter-clockwise on the map
// (the world's z points south, so counter-clockwise seen from above is a falling angle: a negative shoelace sum).
// A trail with an island has its inner edge on the island; a solid blob (Riverdale) has its inner edge at the deepest
// point along the inward normal, so a lane is a straight line between the two and stays inside.
function trailSamples(record) {
  const poly=record.polygons[0];if(!poly)return null;
  const n=TRAIL_SAMPLES;
  const raw=resample(poly.outer,n),sign=shoelace(raw)>0?1:-1;
  // From each outline sample a ray runs along the inward normal: the lane line for that sample starts a little inside the
  // edge and ends where it meets the island, the far edge or the next bend, so it is always inside the footprint
  const normal=(k)=>{const a=raw[(k+n-1)%n],b=raw[(k+1)%n],tx=b[0]-a[0],tz=b[1]-a[1],l=Math.hypot(tx,tz)||1;return [-sign*tz/l,sign*tx/l];};
  const outer=[],inner=[];
  raw.forEach((o,k)=>{
    const [nx,nz]=normal(k);
    let d0=.5;while(d0<4&&clearance(record,o[0]+nx*d0,o[1]+nz*d0)<.4)d0+=.25;
    let reach=d0;
    for(let d=d0;d<=14;d+=.25){if(clearance(record,o[0]+nx*d,o[1]+nz*d)<.4)break;reach=d;}
    outer.push([o[0]+nx*d0,o[1]+nz*d0]);inner.push([o[0]+nx*reach,o[1]+nz*reach]);
  });
  // a notch in the outline can leave a ray with no width: borrow the nearest wide neighbours, blended
  const wide=outer.map((o,k)=>Math.hypot(o[0]-inner[k][0],o[1]-inner[k][1])>=1.5);
  if(wide.some(Boolean))for(let k=0;k<n;k++){
    if(wide[k])continue;
    let a=1,b=1;while(!wide[(k-a+n)%n]&&a<n)a++;while(!wide[(k+b)%n]&&b<n)b++;
    const ia=(k-a+n)%n,ib=(k+b)%n,f=a/(a+b);
    outer[k]=[outer[ia][0]+(outer[ib][0]-outer[ia][0])*f,outer[ia][1]+(outer[ib][1]-outer[ia][1])*f];
    inner[k]=[inner[ia][0]+(inner[ib][0]-inner[ia][0])*f,inner[ia][1]+(inner[ib][1]-inner[ia][1])*f];
  }
  const samples=outer.map((o,k)=>({o,i:inner[k]}));
  if(shoelace(samples.map((s)=>s.o))>0)samples.reverse();
  return samples;
}
// The loop for a trail: the samples with their cumulative length along the centre line, or null when no lane fits
function trailLoop(record) {
  const samples=trailSamples(record);if(!samples)return null;
  const mid=samples.map((s)=>[(s.o[0]+s.i[0])/2,(s.o[1]+s.i[1])/2]);
  const cum=[0];for(let k=0;k<mid.length;k++){const a=mid[k],b=mid[(k+1)%mid.length];cum.push(cum[k]+Math.hypot(b[0]-a[0],b[1]-a[1]));}
  const loop={samples,mid,cum,length:cum[mid.length]};
  // every lane must stay inside the footprint: the usable lane band, shrunk towards the centre line until it does
  for(let band=.7;band>=.1;band-=.1){
    let ok=true;const p=[0,0];
    for(let k=0;k<samples.length&&ok;k++)for(const lane of [.5-band/2,.5,.5+band/2]){trailPoint(loop,k,lane,p);if(clearance(record,p[0],p[1])<.35){ok=false;break;}}
    if(ok){loop.band=band;return loop;}
  }
  return null;
}
// A point at sample k (fractional) and lane (0 outer edge .. 1 inner edge)
function trailPoint(loop,k,lane,out) {
  const n=loop.samples.length,k0=Math.floor(k)%n,k1=(k0+1)%n,f=k-Math.floor(k),a=loop.samples[k0],b=loop.samples[k1];
  const ox=a.o[0]+(b.o[0]-a.o[0])*f,oz=a.o[1]+(b.o[1]-a.o[1])*f,ix=a.i[0]+(b.i[0]-a.i[0])*f,iz=a.i[1]+(b.i[1]-a.i[1])*f;
  out[0]=ox+(ix-ox)*lane;out[1]=oz+(iz-oz)*lane;return out;
}
// Distance travelled s (m along the centre line) to a fractional sample index
function trailIndex(loop,s) {
  const d=((s%loop.length)+loop.length)%loop.length,n=loop.samples.length;
  let lo=0,hi=n;while(hi-lo>1){const m=(lo+hi)>>1;if(loop.cum[m]<=d)lo=m;else hi=m;}
  return lo+(d-loop.cum[lo])/((loop.cum[lo+1]-loop.cum[lo])||1);
}

const ringsOf=(record)=>record.polygons.flatMap((p)=>[p.outer,...p.holes]);
function clearance(record,x,z) {
  if(!C.inRecord(record,x,z))return -1;
  let best=Infinity;
  for(const ring of ringsOf(record))for(let i=0;i<ring.length;i++){
    const a=ring[i],c=ring[(i+1)%ring.length],dx=c[0]-a[0],dz=c[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
    best=Math.min(best,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
  }
  return best;
}
const SUPER=2/3; // superellipse exponent 3: a rounded rectangle
const sp=(c)=>Math.sign(c)*Math.abs(c)**SUPER;
// A point on the loop: angle th, lane scale k. Counter-clockwise seen from above (the world's z points south).
function loopPoint(loop,th,k,out) {
  const u=loop.A*k*sp(Math.cos(th)),w=loop.B*k*sp(Math.sin(th));
  out[0]=loop.cx+u*loop.ax-w*loop.az;out[1]=loop.cz+u*loop.az+w*loop.ax;return out;
}
// The loop for a footprint: its smallest rectangle inset from the boards, shrunk until every point stays clear of the outline
function skaterLoop(record) {
  const rect=C.outlineRectangle(record.polygons[0].outer);
  if(!rect)return null;
  let A=rect.length/2-EDGE_CLEAR-.4,B=rect.width/2-EDGE_CLEAR-.4;
  const loop={cx:rect.x,cz:rect.z,ax:rect.ax,az:rect.az,A,B,length:rect.length,width:rect.width};
  const p=[0,0];
  for(let tries=0;tries<40;tries++){
    if(loop.A<3||loop.B<2)return null;
    let ok=true;
    for(let i=0;i<48&&ok;i++){loopPoint(loop,i/48*Math.PI*2,1,p);if(clearance(record,p[0],p[1])<EDGE_CLEAR)ok=false;}
    if(ok)return loop;
    loop.A*=.94;loop.B*=.94;
  }
  return null;
}
const polygonArea=(record)=>record.polygons.reduce((s,poly)=>s+Math.abs(ringArea(poly.outer))-poly.holes.reduce((h,r)=>h+Math.abs(ringArea(r)),0),0);
const ringArea=(ring)=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;

// The slots on a rink: kids, slower adults, regular adults and the odd pair, each on a lane by speed
function makeSlots(site,loop,peak,salt) {
  const slots=[];
  for(let i=0;i<peak;i++){
    const h=(n)=>hash(i+salt*101,n);
    const kind=h(1)<.25?'kid':h(1)<.5?'slow':'adult';
    const speed=kind==='kid'?1.3+h(2)*.8:kind==='slow'?1.4+h(2)*.8:2.2+h(2)*1.1;
    const prev=slots[i-1];
    const pair=prev&&!prev.pairWith&&h(3)<.14&&prev.kind!=='kid'&&kind!=='kid';
    const slot={kind,speed,female:h(4)<.5,scale:kind==='kid'?.62+h(5)*.18:.93+h(5)*.1,girth:.9+h(6)*.24,hair:h(7)*.8,
      theta:h(8)*Math.PI*2,lane:0,pairWith:pair?prev:null};
    // faster skaters take the outside lanes (an adult overtaking a child stays clear of them)
    slot.lane=Math.min(.94,Math.max(.4,.4+(speed-1.3)/2*.52+(h(9)-.5)*.08));
    if(pair){slot.speed=prev.speed;slot.lane=Math.min(.94,prev.lane+.07);slot.theta=prev.theta+.7/(Math.max(loop.A,loop.B)*slot.lane);slot.kind=prev.kind;}
    slot.rate=slot.speed/(Math.max(2,(loop.A+loop.B)/2*slot.lane)); // radians per second (counter-clockwise: the angle falls)
    slot.cadence=(slot.kind==='kid'?.75:.5)+slot.speed*.04;
    slot.phase=h(10);
    slot.ox=slot.oz=0;slot.yaw=NaN;slot.turn=0;
    slots.push(slot);
  }
  return slots;
}

// Keep a point inside the rounded rectangle (the same superellipse as the public-skate loop): scale it back to the edge
function fitSuper(out,A,B) {
  const q=Math.abs(out[0]/A)**3+Math.abs(out[1]/B)**3;
  if(q>1){const f=q**(-1/3);out[0]*=f;out[1]*=f;}
  return out;
}
const SHINNY_END=2.6; // the players stay this far from the end of the loop: the nets stand behind them
function makeShinnySlots(perSide,salt) {
  const slots=[];
  for(let idx=0;idx<perSide*2;idx++){
    const h=(n)=>hash(idx+salt*131,n+40);
    slots.push({team:idx%2,i:Math.floor(idx/2),scale:h(1)<.15?.8+h(2)*.08:.93+h(2)*.12,female:h(3)<.28,girth:.9+h(4)*.24,hair:h(5)*.8,
      lefty:h(6)<.25,phase:h(7),cadence:.72+h(8)*.2,ox:0,oz:0,yaw:NaN,turn:0,rig:null,kind:'adult'});
  }
  return slots;
}
function makeTrailSlots(loop,peak,salt) {
  const slots=[];
  for(let i=0;i<peak;i++){
    const h=(n)=>hash(i+salt*97,n+70);
    const kind=h(1)<.2?'kid':h(1)<.45?'slow':'adult';
    const speed=kind==='kid'?1.3+h(2)*.8:kind==='slow'?1.4+h(2)*.8:2.3+h(2)*1.1;
    const lane01=Math.max(0,Math.min(1,1-(speed-1.3)/2.1+(h(9)-.5)*.2)); // faster skaters take the outside edge
    slots.push({kind,speed,lane01,dist0:h(8)*loop.length,female:h(4)<.5,scale:kind==='kid'?.62+h(5)*.18:.93+h(5)*.1,girth:.9+h(6)*.24,hair:h(7)*.8,
      phase:h(10),cadence:(kind==='kid'?.75:.5)+speed*.04,ox:0,oz:0,yaw:NaN,turn:0,rig:null});
  }
  return slots;
}

function buildSkaters(scene,{sites,getHour,getDark,getDate}) {
  const rinkStats=C.rinkStats;
  if(!rinkStats||rinkStats.season!=='ice'||!C.PersonCrowd||!C.PersonRig)return null;
  const THREE=C.THREE;
  const rinks=[];
  sites.forEach((site,n)=>{
    if(site.surface!=='ice')return;
    const area=polygonArea(site);if(area<200)return;
    const lit=site.sourceFacts?.Lighting==='Yes';
    if(site.type==='Skate Trail'){
      const loop=trailLoop(site);if(!loop)return;
      const peak=trailPeak(area);
      rinks.push({site,kind:'trail',trail:loop,area,lit,boards:false,pick:1,
        pools:[{type:'trail',slots:makeTrailSlots(loop,peak,n+1),active:0,first:true}],R:loop.length/6+10,cx:loop.mid[0][0],cz:loop.mid[0][1],y:site.y+.03});
      return;
    }
    const loop=skaterLoop(site);if(!loop)return;
    const peak=skaterPeak(area);
    const slots=makeSlots(site,loop,peak,n+1);
    for(const s of slots)s.rig=new C.PersonRig({seed:s.phase*100+n*7.13,scale:s.scale,female:s.female,girth:s.girth,hair:s.hair});
    const R=Math.hypot(loop.length,loop.width)/2+4;
    const boards=Boolean(site.boards),perSide=shinnyPerSide(area);
    const pools=[{type:'public',slots,active:0,first:true}];
    if(boards)pools.push({type:'shinny',slots:makeShinnySlots(perSide,n+1),active:0,first:true,A:Math.max(4,loop.A-SHINNY_END),B:loop.B,nets:null,seed:n+3});
    rinks.push({site,kind:'pad',loop,area,lit,boards,pick:hash(n+1,17),perSide,pools,R,cx:loop.cx,cz:loop.cz,y:site.y+.03});
  });
  if(!rinks.length)return null;
  const crowd=new C.PersonCrowd(MAX_DRAWN,{farDistance:34,castShadow:C.QUALITY?.kerbShadows!==false});
  scene.add(...crowd.meshes);

  // Sticks, blades and pucks: three small instanced meshes (the crowd draws the people)
  const MAX_STICKS=128;
  const mk=(geo,color,rough=.6)=>{
    const m=new THREE.InstancedMesh(geo,new THREE.MeshStandardNodeMaterial({color,roughness:rough}),MAX_STICKS);
    m.frustumCulled=false;m.castShadow=false;m.receiveShadow=false;m.count=0;m.name='ShinnyGear';scene.add(m);return m;
  };
  const shafts=mk(new THREE.BoxGeometry(.028,1,.028),'#3a2f26'),blades=mk(new THREE.BoxGeometry(.03,.085,.3),'#d9d6cc'),pucks=mk(new THREE.CylinderGeometry(.038,.038,.026,12),'#111214',.5);
  let nShafts=0,nPucks=0;
  const _m=new THREE.Matrix4(),_q=new THREE.Quaternion(),_qy=new THREE.Quaternion(),_v=new THREE.Vector3(),_sc=new THREE.Vector3(),_up=new THREE.Vector3(0,1,0),_d=new THREE.Vector3();
  const hideGear=()=>{nShafts=0;nPucks=0;};
  function addStick(hx,hy,hz,bx,by,bz,yaw) {
    if(nShafts>=MAX_STICKS)return;
    _d.set(bx-hx,by-hy,bz-hz);const len=_d.length()||1;_d.divideScalar(len);
    _q.setFromUnitVectors(_up,_d);_sc.set(1,len,1);_v.set((hx+bx)/2,(hy+by)/2,(hz+bz)/2);
    _m.compose(_v,_q,_sc);shafts.setMatrixAt(nShafts,_m);
    _qy.setFromAxisAngle(_up,yaw);_sc.set(1,1,1);_v.set(bx+Math.sin(yaw)*.1,by+.04,bz+Math.cos(yaw)*.1);
    _m.compose(_v,_qy,_sc);blades.setMatrixAt(nShafts,_m);
    nShafts++;
  }
  function addPuck(x,y,z) {
    if(nPucks>=MAX_STICKS)return;
    _v.set(x,y+.014,z);_q.identity();_sc.set(1,1,1);_m.compose(_v,_q,_sc);pucks.setMatrixAt(nPucks++,_m);
  }
  function finishGear() {
    for(const m of [shafts,blades])m.count=nShafts;
    pucks.count=nPucks;
    for(const m of [shafts,blades,pucks])m.instanceMatrix.needsUpdate=true;
  }
  // A hockey net, mouth towards +z of its group: red frame, light mesh
  let netGeo=null,frameMat=null,meshMat=null;
  function buildNet() {
    netGeo??=new THREE.BoxGeometry(1,1,1);
    frameMat??=new THREE.MeshStandardNodeMaterial({color:'#c4332b',roughness:.5});
    meshMat??=new THREE.MeshStandardNodeMaterial({color:'#e6e8e6',roughness:.9,transparent:true,opacity:.35,side:THREE.DoubleSide});
    const g=new THREE.Group();
    const part=(mat,x,y,z,w,h,d)=>{const m=new THREE.Mesh(netGeo,mat);m.position.set(x,y,z);m.scale.set(w,h,d);g.add(m);};
    part(frameMat,-.915,.61,0,.06,1.22,.06);part(frameMat,.915,.61,0,.06,1.22,.06);part(frameMat,0,1.2,0,1.89,.06,.06);
    part(frameMat,-.915,.03,-.3,.05,.05,.6);part(frameMat,.915,.03,-.3,.05,.05,.6);part(frameMat,0,.03,-.6,1.83,.05,.05);
    part(meshMat,0,.6,-.6,1.83,1.2,.015);part(meshMat,-.915,.6,-.3,.015,1.2,.6);part(meshMat,.915,.6,-.3,.015,1.2,.6);part(meshMat,0,1.2,-.3,1.83,.015,.6);
    return g;
  }
  function placeNets(rink,pool) {
    pool.nets=[];
    for(const dir of [-1,1]){
      const g=buildNet(),loop=rink.loop,u=dir*(loop.A-.8);
      g.position.set(loop.cx+u*loop.ax,rink.y,loop.cz+u*loop.az);
      g.rotation.y=Math.atan2(-dir*loop.ax,-dir*loop.az); // mouth towards the middle of the pad
      scene.add(g);pool.nets.push(g);
    }
  }

  const p0=[0,0],p1=[0,0];
  const stats={rinks:rinks.length,open:0,skaters:0,drawn:0,shinny:0,trail:0};
  const date=getDate?.()||C.SITE_DATE||{month:12,day:1};
  const weekend=isWeekend(date);

  // Where a slot is at time t (x, z, yaw, and `stroke` speed hint). The world heading is the direction of travel.
  const _a={x:0,z:0},_b={x:0,z:0},_pk2=[0,0],_pl=[0,0];
  function rawPlace(rink,pool,s,t,out) {
    if(pool.type==='public'){
      const th=s.theta-s.rate*t;
      loopPoint(rink.loop,th,s.lane,p0);out.x=p0[0];out.z=p0[1];return;
    }
    if(pool.type==='trail'){
      const k=trailIndex(rink.trail,s.dist0+s.speed*t);
      trailPoint(rink.trail,k,.5+(s.lane01-.5)*rink.trail.band,p0);out.x=p0[0];out.z=p0[1];return;
    }
    const loop=rink.loop;
    shinnyPlayer(t,pool.seed,s.i,s.team,pool.A,pool.B,_pl);fitSuper(_pl,pool.A,pool.B);
    out.x=loop.cx+_pl[0]*loop.ax-_pl[1]*loop.az;out.z=loop.cz+_pl[0]*loop.az+_pl[1]*loop.ax;
  }
  function slotPlace(rink,pool,s,t,out) {
    rawPlace(rink,pool,s,t,_a);rawPlace(rink,pool,s,t-.15,_b);
    out.x=_a.x;out.z=_a.z;
    const dx=_a.x-_b.x,dz=_a.z-_b.z;
    out.yaw=Math.hypot(dx,dz)>.004?Math.atan2(dx,dz):(Number.isFinite(s.yaw)?s.yaw:0);
  }
  const pos={x:0,z:0,yaw:0};
  function update(dt,t,cam,player) {
    const hour=getHour(),dark=getDark();
    crowd.begin();hideGear();
    let drawn=0,openCount=0,total=0,shinnyOn_=0,trailN=0;
    for(const rink of rinks) {
      const open=skaterRinkOpen({season:'ice',hour,lit:rink.lit,dark});
      const playing=shinnyOn({open,hour,weekend,boards:rink.boards,pick:rink.pick});
      const near=Math.hypot(rink.cx-cam.x,rink.cz-cam.z)<DRAW_RANGE+rink.R;
      for(const pool of rink.pools) {
        const raw=pool.type==='shinny'?(playing?rink.perSide*2:0)
          :pool.type==='public'?(playing?0:skaterCount({area:rink.area,hour,weekend,open}))
          :(open?Math.max(1,Math.round(trailPeak(rink.area)*skaterActivity(hour,weekend))):0);
        const target=Math.min(raw,pool.slots.length);
        // People arrive and leave out of sight: the head count follows the hour only for skaters far from the camera
        while(pool.active!==target) {
          const s=pool.slots[pool.active<target?pool.active:pool.active-1];
          if(!pool.first){slotPlace(rink,pool,s,t,pos);if(Math.hypot(pos.x-cam.x,pos.z-cam.z)<50)break;}
          pool.active+=pool.active<target?1:-1;
          s.ox=s.oz=0;s.yaw=NaN;
        }
        pool.first=false;
        if(pool.type==='shinny'&&pool.nets)for(const g of pool.nets)g.visible=pool.active>0;
        if(pool.active>0){openCount+=pool.type==='public'||pool.type==='trail'?1:0;total+=pool.active;if(pool.type==='shinny')shinnyOn_++;if(pool.type==='trail')trailN++;}
        if(!pool.active||!near)continue;
        if(pool.type==='shinny'&&!pool.nets)placeNets(rink,pool);
        if(pool.type==='shinny'){
          // the puck
          const loop=rink.loop;shinnyPuck(t,pool.seed,pool.A,pool.B,_pk2);fitSuper(_pk2,pool.A,pool.B);
          addPuck(loop.cx+_pk2[0]*loop.ax-_pk2[1]*loop.az,rink.y,loop.cz+_pk2[0]*loop.az+_pk2[1]*loop.ax);
        }
        for(let i=0;i<pool.active&&drawn<MAX_DRAWN;i++) {
          const s=pool.slots[i];
          slotPlace(rink,pool,s,t,pos);
          const dist=Math.hypot(pos.x-cam.x,pos.z-cam.z);
          if(dist>DRAW_RANGE)continue;
          // step aside for the player: end up AVOID_RADIUS away, inside the rink
          let tx=0,tz=0;
          if(player) {
            const dx=pos.x-player.x,dz=pos.z-player.z,d=Math.hypot(dx,dz);
            if(d<AVOID_RADIUS){
              const push=Math.min(MAX_OFFSET,AVOID_RADIUS-d),nx=d>.01?dx/d:Math.sin(pos.yaw),nz=d>.01?dz/d:Math.cos(pos.yaw);
              tx=nx*push;tz=nz*push;
              for(let k=0;k<3&&clearance(rink.site,pos.x+tx,pos.z+tz)<.6;k++){tx*=.5;tz*=.5;}
            }
          }
          const e=1-Math.exp(-Math.min(dt,.1)*(tx||tz?7:2.5));
          s.ox+=(tx-s.ox)*e;s.oz+=(tz-s.oz)*e;
          const x=pos.x+s.ox,z=pos.z+s.oz;
          // lean into the turn (a smoothed yaw rate)
          let turn=0;
          if(Number.isFinite(s.yaw)&&dt>0){let dy=pos.yaw-s.yaw;dy-=Math.round(dy/(Math.PI*2))*Math.PI*2;turn=dy/Math.max(dt,1e-3);}
          s.turn+=(Math.max(-3,Math.min(3,turn))-s.turn)*(1-Math.exp(-dt*4));
          s.yaw=pos.yaw;
          const sp=pool.type==='shinny'?4:s.speed;
          const roll=-Math.max(-.3,Math.min(.3,s.turn*sp*.06));
          s.rig??=new C.PersonRig({seed:s.phase*100+i*7.13+rink.pick*50,scale:s.scale,female:s.female,girth:s.girth,hair:s.hair});
          const stroke=s.phase+t*s.cadence;
          const stick=pool.type==='shinny';
          s.rig.skate(Math.min(Math.max(dt,1e-3),.1),x,z,pos.yaw,rink.y,stroke,roll,s.kind==='kid'?.9:.88,{stick,glide:stick?.25:s.kind==='slow'?.5:.2});
          crowd.add(s.rig,dist);
          if(stick){
            // stick: hands low and in front, blade on the ice ahead and to the stick side
            const sn=Math.sin(pos.yaw),cs=Math.cos(pos.yaw),hand=s.lefty?-1:1,sc=s.scale,sway=Math.sin(stroke*Math.PI*2)*.07;
            addStick(x+sn*.4*sc+cs*hand*.2*sc,rink.y+.82*sc,z+cs*.4*sc-sn*hand*.2*sc,x+sn*(1.0+sway)*sc+cs*hand*.3*sc,rink.y+.03,z+cs*(1.0+sway)*sc-sn*hand*.3*sc,pos.yaw);
          }
          drawn++;
        }
      }
    }
    crowd.end();finishGear();
    stats.open=openCount;stats.skaters=total;stats.drawn=drawn;stats.shinny=shinnyOn_;stats.trail=trailN;
  }
  C.skaterStats=stats;
  console.info('[skaters] '+JSON.stringify({rinks:rinks.length,trails:rinks.filter((r)=>r.kind==='trail').length,boarded:rinks.filter((r)=>r.boards).length}));
  return {update,crowd,rinks,stats};
}
Object.assign(C,{trailSamples,shinnyWindow,shinnyOn,shinnyPerSide,shinnyPuck,shinnyPlayer,fitSuper,trailLoop,trailPoint,trailIndex,trailPeak,skaterRinkOpen,skaterActivity,skaterPeak,skaterCount,skaterLoop,loopPoint,buildSkaters,skaterIsWeekend:isWeekend});
})();
