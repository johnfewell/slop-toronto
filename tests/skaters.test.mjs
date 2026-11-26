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
