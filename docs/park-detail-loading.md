# Biidaasige Park and the Port Lands load after the city is ready (st-nz3v)

PR #143 added Biidaasige Park, the Port Lands and the island detail. On a phone (Pixel-class tier `low`, 4x CPU
throttle on the Mac mini) that moved the ready time from about 36.5 s to about 44 s. Removing the park's and the Port
Lands' 23 scripts from the start-up recovered about 3 to 4 s of it (variant runs, `docs/park-detail-loading.md`
measurements below); removing the island scripts (arrivals, access, garden cover, dinghies) or the holiday, skaters and
Freedom Arches scripts recovered nothing measurable, so those stay in the start-up.

## What loads when

- `explore.html` lists the park's and the Port Lands' scripts as `cityAppScripts.detail`, not in the start-up list.
- `js/park-detail.js` (always loaded, small) holds what the base city reads before they exist, and the loader:
  - the building rows they replace (nine for the park, two silo rows for the Port Lands), the one City tree in the dog
    turf, and the 19 stale City poles (`biidaasigeParkExcludesBuilding`, `portLandsExcludesBuilding`,
    `biidaasigeParkExcludesTree`, `BIIDAASIGE_STALE_CITY_POLE_IDS`). They apply from the base city's first build
    (`claimParkBaseEdits`), so nothing about the base city changes when the park arrives;
  - the Places menu's destination (`TELEPORT_LOCATIONS.biidaasige`), from the always-loaded map anchors;
  - the region (x 1500..3300, z 100..1250), `startsInRegion()` and the loader (`load()`, one promise).
- A visit **starts with the detail loaded and built with the city** (today's path, unchanged) when it starts in the
  region: a saved position inside it (300 m margin), `#park=biidaasige`, a `#place=`/`#to=` naming a place there,
  `?parkDetail=now`, `?lidarTrees=1`, `?gallery=`. `?parkDetail=late` forces the late path.
- Otherwise `main.js` `assembleParkDetail()` runs once the city is ready (2.5 s after, or at once when the player is
  within 2.2 km of the region): scripts load, then a hidden stage is built a few milliseconds a frame (the park and the
  Port Lands are generators with a `yield` between their pieces; the banks' loops yield too), joined to the culling
  (`setupSceneCulling(..., { append: true, hold: true })`), warmed three meshes a frame drawn at nothing, then shown on
  one frame that builds nothing. On that frame the generated trees the park clears leave the tree field (`ezTrees.retire`; the
  young planting's smaller scale is in the base city's tree build from the start, from the park's polygon in `park-detail.js`), the colliders join the controllers
  (`WorldCollision.swap`), the lamps join the street-light pool. The city ground's masks then go on one material a frame.
- A teleport, link, Sights jump or map tap to a place in the region (400 m margin) before it is built waits for it
  (`parkDetailGate` in `teleportTo`, a toast says so) and then jumps.

## Switches

`?parkDetail=now` builds them with the city (the old behaviour, for A/B); `?parkDetail=late` forces the late build;
`?biidaasige=0` and `?portlands=0` still leave their pieces out.

## Tests

`tests/park-detail.test.mjs` (lists, region, start decision, loader, claims, stepwise build equals the one-shot build);
the Biidaasige, Port Lands and teleport tests load `js/park-detail.js` with the others.
