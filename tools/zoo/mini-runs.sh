set -x
C="node tools/capture.mjs"
CAPTURE_QUERY="?quality=high" GPU2_OUT=gpu2-out/zoo-r4 $C tools/shots/zoo-animals.json
CAPTURE_QUERY="?quality=high" GPU2_OUT=gpu2-out/zoo-approach-r3 $C tools/shots/zoo-approach.json
CAPTURE_UNCAPPED=1 CAPTURE_QUERY="?quality=high" GPU2_OUT=gpu2-out/zoo-approach-timing2 $C tools/shots/zoo-approach-timing.json
CAPTURE_QUERY="?quality=high&liveClock=2026-11-08T17:00:00Z&liveDate=2026-11-08&liveWeather=Sunny" CAPTURE_TAG=nov08-midday GPU2_OUT=gpu2-out/zoo-seasons2 $C tools/shots/zoo-seasons.json
CAPTURE_QUERY="?quality=high&liveClock=2026-11-08T21:05:00Z&liveDate=2026-11-08&liveWeather=Sunny" CAPTURE_TAG=nov08-golden GPU2_OUT=gpu2-out/zoo-seasons2 $C tools/shots/zoo-seasons.json
CAPTURE_QUERY="?quality=high&liveClock=2026-07-15T17:00:00Z&liveDate=2026-07-15&liveWeather=Sunny" CAPTURE_TAG=jul15-midday GPU2_OUT=gpu2-out/zoo-seasons2 $C tools/shots/zoo-seasons.json
CAPTURE_QUERY="?quality=high&liveClock=2026-01-15T17:00:00Z&liveDate=2026-01-15&liveWeather=Sunny&liveSnow=8" CAPTURE_TAG=jan15-midday GPU2_OUT=gpu2-out/zoo-seasons2 $C tools/shots/zoo-seasons.json
CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=8000 CAPTURE_METRICS_WARMUP_MS=1500 CAPTURE_QUERY="?quality=high&autoscale=0&cloudSpeed=0" CAPTURE_SEED=6711 CAPTURE_TAG=high GPU2_OUT=gpu2-out/zoo-ab2 $C tools/shots/zoo-ab.json
CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=8000 CAPTURE_METRICS_WARMUP_MS=1500 CAPTURE_VIEWPORT=412x915 CAPTURE_DPR=2.625 CAPTURE_MOBILE=1 CAPTURE_CPU_THROTTLE=4 CAPTURE_QUERY="?quality=low&autoscale=0&cloudSpeed=0" CAPTURE_SEED=6711 CAPTURE_TAG=phone GPU2_OUT=gpu2-out/zoo-ab2 $C tools/shots/zoo-ab.json
CAPTURE_QUERY="?quality=high&zoo=boxes" CAPTURE_TAG=boxes GPU2_OUT=gpu2-out/zoo-boxes2 $C tools/shots/zoo-animals.json
