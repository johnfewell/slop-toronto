import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
const read=(p)=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ctx={window:{CITY:{THREE}},URLSearchParams,console};
for(const f of ['toronto-geodata','toronto-city-facilities','toronto-rinks','world-collision','sports-terrain','rinks','skaters'])vm.runInNewContext(read(`js/${f}.js`),ctx);
const C=ctx.window.CITY;

test('skaters only while the ice is in and the rinks are open',()=>{
  const open=(o)=>C.skaterRinkOpen({season:'ice',hour:14,lit:true,dark:false,...o});
  assert.ok(open({}));
  assert.ok(!open({season:'off'}),'the off-season and every summer preset: nobody');
  assert.ok(!open({hour:8.9}),'before 9 am');
  assert.ok(open({hour:9}));
  assert.ok(open({hour:21.99}));
  assert.ok(!open({hour:22}),'closed at 10 pm');
  assert.ok(!open({hour:NaN}));
  assert.ok(open({hour:19,dark:true,lit:true}),'a lit rink stays open after dark');
  assert.ok(!open({hour:19,dark:true,lit:false}),'an unlit rink is empty at dusk');
  assert.ok(open({hour:15,dark:false,lit:false}),'an unlit rink is open by day');
});

test('crowd size scales with pad size, the hour and the weekend',()=>{
  const n=(o)=>C.skaterCount({area:1800,hour:19,weekend:false,...o});
  assert.equal(n({open:false}),0);
  assert.ok(n({hour:9})>=1&&n({hour:9})<n({hour:19})/4,'a few at 9 am');
  assert.ok(n({hour:19})>n({hour:14}),'weekday evenings are busier than the afternoon');
  assert.ok(n({hour:13,weekend:true})>n({hour:13,weekend:false}),'weekend middays are busier');
  assert.ok(n({area:600})<n({area:1800})&&n({area:1800})<=n({area:6000}),'bigger pads hold more');
  assert.equal(C.skaterPeak(40),4);assert.equal(C.skaterPeak(1e6),26);
  assert.ok(C.skaterCount({area:300,hour:9,weekend:false})>=1,'never zero while open');
  assert.ok(C.skaterIsWeekend({year:2026,month:12,day:12})&&!C.skaterIsWeekend({year:2026,month:12,day:9}));
});

test('every drawn rink has a counter-clockwise loop that stays inside its outline',()=>{
  let fitted=0;
  for(const r of C.RINKS.records) {
    if(r.type==='Skate Trail')continue;
    const rec={...r},loop=C.skaterLoop(rec);
    if(!loop)continue;
    fitted++;
    const p=[0,0];
    for(const k of [.4,.7,.94])for(let i=0;i<32;i++){C.loopPoint(loop,i/32*Math.PI*2,k,p);assert.ok(C.inRecord(rec,p[0],p[1]),`${r.name} lane ${k} point ${i}`);}
    // as the angle falls the loop runs counter-clockwise seen from above (map east = +x, north = -z)
    const a=[0,0],b=[0,0];C.loopPoint(loop,0,1,a);C.loopPoint(loop,-.1,1,b);
    const cross=(a[0]-loop.cx)*(b[1]-loop.cz)-(a[1]-loop.cz)*(b[0]-loop.cx); // x,z cross: positive is clockwise on the map
    assert.ok(cross<0,`${r.name} runs counter-clockwise`);
  }
  assert.ok(fitted>=8,`${fitted} pads fitted`);
});

test('shinny: after school, evenings and weekend hours, on boarded pads that host a game',()=>{
  const on=(o)=>C.shinnyOn({open:true,hour:17,weekend:false,boards:true,pick:.2,...o});
  assert.ok(on({}),'weekday after school');
  assert.ok(!on({hour:13}),'weekday school hours: public skate');
  assert.ok(on({hour:20}),'weekday evening');
  assert.ok(!on({hour:18.5}),'weekday supper gap');
  assert.ok(on({hour:10,weekend:true})&&on({hour:14,weekend:true}),'weekend days');
  assert.ok(!on({hour:12.5,weekend:true}));
  assert.ok(!on({open:false}),'never while the rink is closed');
  assert.ok(!on({boards:false}),'a pad without boards stays public skate');
  assert.ok(!on({pick:.9}),'some boarded pads stay public skate');
  assert.equal(C.shinnyPerSide(700),3);assert.equal(C.shinnyPerSide(2000),6);
});

test('shinny: puck and players stay in the pad, move at skating speed, and play both ends',()=>{
  const A=21,B=10,out=[0,0],prev=[0,0];
  let maxPuck=0,maxPlayer=0,teamEnd=[0,0],n=0;
  for(const seed of [3,9,17])for(let t=0;t<600;t+=.25){
    C.shinnyPuck(t,seed,A,B,out);C.fitSuper(out,A,B);
    assert.ok(Math.abs(out[0])<=A+1e-9&&Math.abs(out[1])<=B+1e-9);
    if(t>0){C.shinnyPuck(t-.25,seed,A,B,prev);C.fitSuper(prev,A,B);maxPuck=Math.max(maxPuck,Math.hypot(out[0]-prev[0],out[1]-prev[1])/.25);}
    for(let team=0;team<2;team++)for(let i=0;i<6;i++){
      C.shinnyPlayer(t,seed,i,team,A,B,out);C.fitSuper(out,A,B);
      assert.ok(Math.abs(out[0])<=A+1e-9&&Math.abs(out[1])<=B+1e-9);
      if(t>0){C.shinnyPlayer(t-.25,seed,i,team,A,B,prev);C.fitSuper(prev,A,B);maxPlayer=Math.max(maxPlayer,Math.hypot(out[0]-prev[0],out[1]-prev[1])/.25);}
      if(i<2)teamEnd[team]+=out[0];n++; // the back pair holds its own end
    }
  }
  assert.ok(maxPuck<9,`puck ${maxPuck.toFixed(1)} m/s`);
  assert.ok(maxPlayer<8,`player ${maxPlayer.toFixed(1)} m/s`);
  assert.ok(teamEnd[1]-teamEnd[0]>0,'the back pair of each side holds its own end');
});

test('every mapped skate trail has a counter-clockwise centre line with lanes inside its outline',()=>{
  const trails=C.RINKS.records.filter((r)=>r.type==='Skate Trail');
  assert.ok(trails.length>=3);
  for(const r of trails){
    const loop=C.trailLoop({...r});
    assert.ok(loop&&loop.band>=.3,`${r.name} fitted (band ${loop?.band})`);
    const p=[0,0];
    for(let k=0;k<loop.samples.length;k+=3)for(const lane of [.5-loop.band/2,.5,.5+loop.band/2]){C.trailPoint(loop,k+.4,lane,p);assert.ok(C.inRecord(r,p[0],p[1]),`${r.name} sample ${k} lane ${lane}`);}
    // counter-clockwise on the map (z south): the shoelace sum of the centre line is negative
    const a=loop.mid.reduce((sum,q,i)=>{const b=loop.mid[(i+1)%loop.mid.length];return sum+q[0]*b[1]-b[0]*q[1];},0)/2;
    assert.ok(a<0,`${r.name} runs counter-clockwise`);
    assert.ok(loop.length>40,`${r.name} is ${loop.length.toFixed(0)} m round`);
    // distance travelled moves along the line
    assert.ok(C.trailIndex(loop,10)<C.trailIndex(loop,20));
    assert.ok(C.trailIndex(loop,loop.length+5)>=0);
  }
});
