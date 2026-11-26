# Figures on the landing page, read from the build (2026-11-26)

Bead st-mcqm. Read in the running game on the Mac mini (`gpu2-local`), with `tools/shots/landing-figures.json` (a shot
that returns counts from `window.CITY.GEO`), on the build of `main` d972777 (the 2026-11-26 deploy).

| Reading | Downtown (`?map=detail`, what phones load) | To Eglinton (the desktop default) | How it is counted |
|---|---:|---:|---|
| Buildings with the City's heights | 35,271 | 140,548 | `GEO.buildings.length` (City of Toronto 3D Massing rows) |
| Named streets | 1,383 | 3,390 | distinct non-empty names in `GEO.roads` (OpenStreetMap); the downtown value is the 1,383 the page printed on 3 November |
| Street trees placed | 55,852 | 180,125 | `GEO.streetTrees.length / 4` (four numbers a tree); the City's inventory inside each box is larger (57,120 and 183,006 on 2026-11-05) because trees off the frame or under the rail corridor are dropped before the game places them. The page says "placed", the default of the 2026-11-10 spec |
| Area at 1:1 | 76.6 km² (11.6 × 6.6 km) | 190.8 km² (17.5 × 10.9 km) | the frame's box in `GEO.frame.detail`: x −7,900 to 3,700, z −3,000 to 3,600 and x −7,900 to 9,600, z −7,300 to 3,600 |

The buildings differ from the 2026-11-05 counts (35,266 and 140,541) by 5 and 7: keeping the holes of the City's road polygons
(jf-4v9, `docs/road-medians.md`) restored those buildings.

Re-read when a data build changes: `GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local <name> -- env CAPTURE_ROOT=dist
CAPTURE_PORT=<port> 'CAPTURE_QUERY=?autoscale=0&hud=0' node tools/capture.mjs tools/shots/landing-figures.json`, and
again with `?map=detail`; the result is in `<capture folder>/figures.json`.
