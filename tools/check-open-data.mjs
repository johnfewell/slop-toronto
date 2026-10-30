// One GPU2 lock, sequential desktop and phone captures of the same source tree.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const shots=['wayfinding','benches','city-facilities'].flatMap((name)=>JSON.parse(fs.readFileSync(`tools/shots/${name}.json`,'utf8')));
const file=path.join(process.env.GPU2_OUT||'gpu2-out','open-data-shots.json');
fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(shots));
for(const phone of [false,true]) {
  const result=spawnSync(process.execPath,['tools/capture.mjs',file],{stdio:'inherit',env:{...process.env,CAPTURE_CDN_CACHE:'1',CAPTURE_NAVIGATION_TIMEOUT_MS:'120000',CAPTURE_TAG:phone?'open-data-phone':'open-data-desktop',CAPTURE_QUERY:phone?'?quality=low':'',CAPTURE_PROGRESS:'1',...(phone?{CAPTURE_VIEWPORT:'412x915',CAPTURE_MOBILE:'1'}:{})}});
  if(result.status!==0) process.exit(result.status||1);
}
