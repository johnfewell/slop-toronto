// One gpu2 lock: the scene-date (off-season) rinks on desktop and the low/phone tier, then the ?rinks=ice preview.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const shots=JSON.parse(fs.readFileSync('tools/shots/rinks.json','utf8'));
const ice=shots.filter((s)=>['rinks-dufferin','rinks-dufferin-overview','rinks-nps-overview','rinks-riverdale-overview','rinks-night'].includes(s.name));
const out=process.env.GPU2_OUT||'gpu2-out',iceFile=path.join(out,'rinks-ice-shots.json');
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(iceFile,JSON.stringify(ice));
const runs=[
  {tag:'rinks-desktop',query:'',file:'tools/shots/rinks.json'},
  {tag:'rinks-phone',query:'?quality=low',file:'tools/shots/rinks.json',phone:true},
  {tag:'rinks-ice',query:'?rinks=ice',file:iceFile}
];
for(const run of runs) {
  const result=spawnSync(process.execPath,['tools/capture.mjs',run.file],{stdio:'inherit',env:{...process.env,CAPTURE_PORT:process.env.CAPTURE_PORT||'8773',CAPTURE_CDN_CACHE:'1',CAPTURE_NAVIGATION_TIMEOUT_MS:'120000',CAPTURE_PROGRESS:'1',CAPTURE_TAG:run.tag+'-',CAPTURE_QUERY:run.query,...(run.phone?{CAPTURE_VIEWPORT:'412x915',CAPTURE_MOBILE:'1'}:{})}});
  if(result.status!==0)process.exit(result.status||1);
}
