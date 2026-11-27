// One gpu2 lock: the skaters on the outdoor rinks (js/skaters.js) in the ice season by day and in the evening, outside the
// rinks' hours (empty), and on a summer date (nothing). Dates are 2026-12-12, a Saturday, after the City's usual opening.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const clock=(local)=>`liveDate=2026-12-12&liveClock=2026-12-12T${local}-05:00`;
const runs=[
  {tag:'skaters-day',query:`?${clock('14:00:00')}`},
  {tag:'skaters-evening',query:`?${clock('18:30:00')}`},
  {tag:'skaters-shinny-sat',query:`?${clock('10:30:00')}`},
  {tag:'skaters-shinny-weekday',query:'?liveDate=2026-12-09&liveClock=2026-12-09T16:30:00-05:00'},
  {tag:'skaters-closed',query:`?${clock('23:00:00')}`},
  {tag:'skaters-summer',query:'?liveDate=2026-08-22&liveClock=2026-08-22T14:00:00-04:00'}
];
fs.mkdirSync(process.env.GPU2_OUT||'gpu2-out',{recursive:true});
for(const run of runs) {
  const result=spawnSync(process.execPath,['tools/capture.mjs','tools/shots/skaters.json'],{stdio:'inherit',env:{...process.env,CAPTURE_PORT:process.env.CAPTURE_PORT||'8774',CAPTURE_CDN_CACHE:'1',CAPTURE_NAVIGATION_TIMEOUT_MS:'180000',CAPTURE_TAG:run.tag,CAPTURE_QUERY:run.query}});
  if(result.status!==0)process.exit(result.status||1);
}
