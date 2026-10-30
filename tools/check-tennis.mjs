import {spawnSync} from 'node:child_process';
for(const phone of [false,true]) {
  const result=spawnSync(process.execPath,['tools/capture.mjs','tools/shots/tennis.json'],{stdio:'inherit',env:{...process.env,CAPTURE_CDN_CACHE:'1',CAPTURE_NAVIGATION_TIMEOUT_MS:'120000',CAPTURE_PROGRESS:'1',CAPTURE_TAG:phone?'tennis-phone':'tennis-desktop',CAPTURE_QUERY:phone?'?quality=low':'',...(phone?{CAPTURE_VIEWPORT:'412x915',CAPTURE_MOBILE:'1'}:{})}});
  if(result.status!==0)process.exit(result.status||1);
}
