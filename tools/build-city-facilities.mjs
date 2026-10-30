import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { projectPoint } from './build-open-data.mjs';
const root = fileURLToPath(new URL('..',import.meta.url));
const clean = (s) => s == null || /^(none|null|n\/a)$/i.test(String(s).trim()) ? '' : String(s).trim().replace(/\s+/g,' ');
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const number=(value)=>/^\d+(\.\d+)?$/.test(clean(value))?Number(value):null;
const positive=(value)=>{const n=number(value);return n>0?n:null;};
const WATER_TYPES=new Set(['Drinking Fountain','Bottle Filling Station','Dog Fountain','Water Tap']);
function normalizeRecord(kind,a) {
  if(kind==='rink') {
    const lengthFt=positive(a['Pad Length (ft.)']),widthFt=positive(a['Pad Width (ft.)']);
    return {ASSET_ID:a['Asset ID'],ALTERNATIVE_NAME:a['Public Name']||a['Asset Name'],TYPE:a['Ice Pad Type'],LOCATIONID:a.locationid,ADDRESS:a.Address,geometry:a.geometry,
      URL:`https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/parks-and-recreation-facilities/location/?id=${encodeURIComponent(a.locationid)}`,
      parentName:a['Parent Asset Name'],facts:{'Boards':clean(a['Boards (Ice Rink)']),'Lighting':clean(a['Rink is Lit']),'Pad dimensions':lengthFt&&widthFt?`${(lengthFt*.3048).toFixed(2)} × ${(widthFt*.3048).toFixed(2)} m (${lengthFt} × ${widthFt} ft)`:'Not supplied'},
      dimensions:{lengthFt,widthFt,lengthM:lengthFt===null?null:lengthFt*.3048,widthM:widthFt===null?null:widthFt*.3048},AMENITIES:`Outdoor ice rink, ${clean(a['Ice Pad Type'])}`};
  }
  if(kind==='tennis')return {ASSET_ID:a.ID,LOCATIONID:a.ID,ALTERNATIVE_NAME:`${a.Name} tennis courts · ${clean(a.Type)||'Access unspecified'}`,TYPE:`${clean(a.Type)||'Unspecified access'} tennis facility`,ADDRESS:a.LocationAddress,geometry:a.geometry,
    URL:`https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/parks-and-recreation-facilities/location/?id=${encodeURIComponent(a.ID)}`,parentName:a.Name,
    facts:{'Courts':number(a.Courts),'Access type':clean(a.Type)||'Not supplied','Lighting':clean(a.Lights),'Club':clean(a.ClubName),'Club information':clean(a.ClubInfo),'Winter play':clean(a.WinterPlay)},
    AMENITIES:`Tennis, ${clean(a.Lights)==='Yes'?'lit courts':''}`,LOCATION_DETAILS:clean(a.Type)==='Club'?'Club facility. Check membership and public-access arrangements with the club.':''};
  return a;
}
function inRing(x,z,p) {
  let yes=false;
  for(let i=0,j=p.length-2;i<p.length;j=i,i+=2) if((p[i+1]>z)!==(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i]) yes=!yes;
  return yes;
}
function buildingAt(record,geo) {
  const candidates=[];
  for(let i=0;i<geo.buildings.length;i++) {
    const b=geo.buildings[i],dx=record.x-b[0],dz=record.z-b[1],cs=Math.cos(b[2]),sn=Math.sin(b[2]);
    const x=dx*cs-dz*sn,z=dx*sn+dz*cs;
    if(b[3].some(([x0,x1,z0,z1])=>x>=x0&&x<=x1&&z>=z0&&z<=z1)) candidates.push({kind:'building',index:i,name:b[9]||'',evidence:'point-in-footprint'});
  }
  return candidates.length===1 ? candidates[0] : null;
}
export function cityFacilities(snapshots,geo) {
  const records=[],sources={},audit={duplicate:[],unmatched:[],conflicting:[],reusedWaterAssetIds:[]};
  for(const [kind,snapshot] of Object.entries(snapshots)) {
    if(snapshot.records.length!==snapshot.total) throw new Error(`Incomplete ${kind} snapshot`);
    sources[kind]=snapshot.source;
    const seen=new Map();
    for(const raw of snapshot.records) {
      const a=normalizeRecord(kind,raw);
      if(kind==='water'&&!clean(a.TYPE).split(',').map((s)=>s.trim()).every((type)=>WATER_TYPES.has(type))) throw new Error(`Non-water type in active drinking-water source: ${a.TYPE}`);
      const assetId=clean(a.ASSET_ID);
      // Water identity includes the typed outlet combination. The active source
      // reuses 989056 for two different named/located combinations in Biidaasige.
      const id=kind==='water'?`${assetId}:${clean(a.TYPE).split(',').map((s)=>s.trim().toLowerCase().replaceAll(' ','-')).sort().join('+')}`:kind==='tennis'?`${assetId}:${clean(raw.Type).toLowerCase()||'unspecified'}`:assetId;
      if(!assetId) throw new Error(`Missing ${kind} asset ID`);
      const identity=JSON.stringify({...a,_id:undefined});
      if(seen.has(id)) {
        if(seen.get(id)!==identity) throw new Error(`Conflicting ${kind} asset ID ${id}`);
        audit.duplicate.push(`${kind}:${id}`); continue;
      }
      seen.set(id,identity);
      const point=projectPoint(a.geometry,geo.frame); if(!point) continue;
      const record={id:`city-${kind}:${id}`,assetId,kind,...point,name:clean(a.ALTERNATIVE_NAME||a.ASSET_NAME||a.LOCATION),type:clean(a.TYPE),address:clean(a.ADDRESS),url:clean(a.URL),locationId:clean(a.LOCATIONID)||new URL(a.URL).searchParams.get('id')||'',amenities:clean(a.AMENITIES),accessibility:clean(a.ACCESSIBLE_FEATURES),hours:clean(a.HOURS),details:clean(a.LOCATION_DETAILS),status:clean(a.Status),reason:clean(a.Reason),comments:clean(a.Comments),statusAt:clean(a.PostedDate)};
      if(a.facts)record.facts=a.facts;
      if(a.dimensions)record.dimensions=a.dimensions;
      if(kind==='tennis')record.identityScope='facility-and-access-type';
      if(a.parentName||a.LOCATION)record.parentName=clean(a.parentName||a.LOCATION);
      if(kind==='washroom'||kind==='water') record.match=buildingAt(record,geo);
      else {
        const matching=geo.areas.map(([type,name,ring],index)=>({type,name,ring,index})).filter((p)=>p.type==='park'&&norm(p.name)===norm(record.parentName||record.name)&&inRing(record.x,record.z,p.ring));
        record.match=matching.length===1?{kind:'park',index:matching[0].index,name:matching[0].name,evidence:'name-and-point-in-outline'}:buildingAt(record,geo);
        if(record.match?.kind==='building'&&norm(record.match.name)!==norm(record.name)) record.match=null;
      }
      if(!record.match) audit.unmatched.push(record.id);
      records.push(record);
    }
  }
  // Tennis has no City location ID. Infer only a unique same-name nearby park
  // link; keep missing/ambiguous relationships unresolved for audit.
  for(const record of records.filter((r)=>!r.locationId&&r.parentName)) {
    const candidates=records.filter((r)=>r.kind==='facility'&&norm(r.name)===norm(record.parentName)&&Math.hypot(r.x-record.x,r.z-record.z)<300);
    if(candidates.length===1){record.locationId=candidates[0].locationId;record.locationLinkEvidence='same-parent-name-within-300m';}
  }
  const waterIds=new Map();
  for(const record of records.filter((r)=>r.kind==='water')){const ids=waterIds.get(record.assetId)||[];ids.push(record.id);waterIds.set(record.assetId,ids);}
  audit.reusedWaterAssetIds=[...waterIds].filter(([,ids])=>ids.length>1).map(([assetId,ids])=>({assetId,records:ids}));
  return {sources,audit,records:records.sort((a,b)=>a.id.localeCompare(b.id))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const ctx={window:{CITY:{}}};vm.runInNewContext(fs.readFileSync(path.join(root,'js/toronto-geodata.js'),'utf8'),ctx);
  const load=(slug)=>JSON.parse(fs.readFileSync(path.join(root,`tools/data/${slug}-20261028.json`),'utf8'));
  const data=cityFacilities({washroom:load('washroom-facilities'),facility:load('parks-and-recreation-facilities'),water:load('parks-drinking-fountains'),rink:load('outdoor-artificial-ice-rinks'),tennis:load('tennis-courts-facilities')},ctx.window.CITY.GEO);
  fs.writeFileSync(path.join(root,'js/toronto-city-facilities.js'),'// GENERATED by tools/build-city-facilities.mjs; dated City inventory, not live availability.\n(function () { window.CITY.CITY_FACILITIES = '+JSON.stringify(data)+'; })();\n');
  console.log(`[cityFacilities] ${JSON.stringify(Object.fromEntries(Object.keys(data.sources).map((k)=>[k,data.records.filter((r)=>r.kind===k).length])))}; ${data.audit.unmatched.length} unmatched, ${data.audit.duplicate.length} exact duplicates suppressed`);
}
