import fs from 'node:fs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/biidaasige-registration.json',import.meta.url),'utf8'));
const ids=['snowy-owl','the-drum','cableway-canyon','swing-hill','canoe-cove-east-launch','canoe-cove-west-landing'];
const anchors=fixture.features.filter(f=>ids.includes(f.id)).map(f=>({id:f.id,lat:f.lat,lon:f.lon,phase:f.phase,pixel:f.px,errorM:f.approxErrorM,source:fixture.map.url,basis:f.pxBasis}));
const ortho=JSON.parse(fs.readFileSync(new URL('./fixtures/biidaasige-play-ortho-anchors.json',import.meta.url),'utf8'));
for(const f of ortho.features){
 const id=f.id==='snowy-owl-base'?'snowy-owl':f.id;
 const a={id,lat:f.latLon[0],lon:f.latLon[1],phase:f.phase,pixel:f.pixel,errorM:f.errorM,
   source:ortho.source,basis:f.note,endpointsLatLon:f.endpointsLatLon,publishedLengthM:f.publishedLengthM};
 const index=anchors.findIndex(a=>a.id===id);if(index>=0)anchors[index]=a;else anchors.push(a);
}
const output=`(function(){\n// Anchors from 2025 City ortho and September 2026 City diagram.\n// Ortho interpretation uncertainty 3m; diagram uncertainty 15–25m. See linked source fixtures.\nconst C=window.CITY;\nconst anchors=${JSON.stringify(anchors)};\nC.BIIDAASIGE_MAP_ANCHORS=anchors;\nC.biidaasigeMapAnchor=id=>{const a=anchors.find(a=>a.id===id);if(!a||!C.worldFromLatLon)return null;const p=C.worldFromLatLon(a.lat,a.lon);return Number.isFinite(p?.x)&&Number.isFinite(p?.z)?{...a,...p}:null;};\n})();\n`;
const file=new URL('../js/biidaasige-map-anchors.js',import.meta.url);
if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==output)process.exitCode=1;}else fs.writeFileSync(file,output);
console.log(`${anchors.length} approximate map anchors`);
