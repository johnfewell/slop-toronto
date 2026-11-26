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
// nobody needs per-frame state until drawn. They step aside for the player (a smoothed offset away from them, kept
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

function buildSkaters(scene,{sites,getHour,getDark,getDate}) {
  const rinkStats=C.rinkStats;
  if(!rinkStats||rinkStats.season!=='ice'||!C.PersonCrowd||!C.PersonRig)return null;
  const rinks=[];
  sites.forEach((site,n)=>{
    if(site.surface!=='ice'||site.type==='Skate Trail')return;
    const area=polygonArea(site);if(area<200)return;
    const loop=skaterLoop(site);if(!loop)return;
    const peak=skaterPeak(area);
    const lit=site.sourceFacts?.Lighting==='Yes';
    const slots=makeSlots(site,loop,peak,n+1);
    for(const s of slots)s.rig=new C.PersonRig({seed:s.phase*100+n*7.13,scale:s.scale,female:s.female,girth:s.girth,hair:s.hair});
    const R=Math.hypot(loop.length,loop.width)/2+4;
    rinks.push({site,loop,area,lit,slots,peak,active:0,first:true,R,y:site.y+.03});
  });
  if(!rinks.length)return null;
  const crowd=new C.PersonCrowd(MAX_DRAWN,{farDistance:34,castShadow:C.QUALITY?.kerbShadows!==false});
  scene.add(...crowd.meshes);
  const p0=[0,0],p1=[0,0];
  const stats={rinks:rinks.length,open:0,skaters:0,drawn:0};
  const date=getDate?.()||C.SITE_DATE||{month:12,day:1};
  const weekend=isWeekend(date);

  function slotPlace(rink,s,t,out) {
    const th=s.theta-s.rate*t;
    loopPoint(rink.loop,th,s.lane,p0);loopPoint(rink.loop,th-.02,s.lane,p1);
    out.x=p0[0];out.z=p0[1];out.yaw=Math.atan2(p0[0]-p1[0],p0[1]-p1[1]);
  }
  const pos={x:0,z:0,yaw:0};
  function update(dt,t,cam,player) {
    const hour=getHour(),dark=getDark();
    crowd.begin();
    let drawn=0,openCount=0,total=0;
    for(const rink of rinks) {
      const open=skaterRinkOpen({season:'ice',hour,lit:rink.lit,dark});
      const target=skaterCount({area:rink.area,hour,weekend,open});
      // People arrive and leave out of sight: the head count follows the hour only for skaters far from the camera
      while(rink.active!==target) {
        const s=rink.slots[rink.active-(rink.active>target?1:0)];if(!s)break;
        if(!rink.first){slotPlace(rink,s,t,pos);if(Math.hypot(pos.x-cam.x,pos.z-cam.z)<50)break;}
        rink.active+=rink.active<target?1:-1;
        s.ox=s.oz=0;s.yaw=NaN;
      }
      rink.first=false;
      if(rink.active>0)openCount++;
      total+=rink.active;
      if(!rink.active||Math.hypot(rink.loop.cx-cam.x,rink.loop.cz-cam.z)>DRAW_RANGE+rink.R)continue;
      for(let i=0;i<rink.active&&drawn<MAX_DRAWN;i++) {
        const s=rink.slots[i];
        slotPlace(rink,s,t,pos);
        const dist=Math.hypot(pos.x-cam.x,pos.z-cam.z);
        if(dist>DRAW_RANGE)continue;
        // step aside for the player: end up AVOID_RADIUS away, inside the rink
        let tx=0,tz=0;
        if(player) {
          const dx=pos.x-player.x,dz=pos.z-player.z,d=Math.hypot(dx,dz);
          if(d<AVOID_RADIUS){
            const push=Math.min(MAX_OFFSET,AVOID_RADIUS-d),nx=d>.01?dx/d:Math.cos(pos.yaw),nz=d>.01?dz/d:-Math.sin(pos.yaw);
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
        const roll=-Math.max(-.3,Math.min(.3,s.turn*s.speed*.06));
        s.rig.skate(Math.min(Math.max(dt,1e-3),.1),x,z,pos.yaw,rink.y,s.phase+t*s.cadence,roll,s.kind==='kid'?.92:.9);
        crowd.add(s.rig,dist);
        drawn++;
      }
    }
    crowd.end();
    stats.open=openCount;stats.skaters=total;stats.drawn=drawn;
  }
  C.skaterStats=stats;
  console.info('[skaters] '+JSON.stringify({rinks:rinks.length}));
  return {update,crowd,rinks,stats};
}
Object.assign(C,{skaterRinkOpen,skaterActivity,skaterPeak,skaterCount,skaterLoop,loopPoint,buildSkaters,skaterIsWeekend:isWeekend});
})();
