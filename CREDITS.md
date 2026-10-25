# Credits

Slop Toronto is downtown Toronto and the waterfront in 3D, in the browser. The project's own code is under the MIT
License (`LICENSE`). Third-party code, data and assets keep their own licences, listed here.

## Engine and code

- **Slop New York** by mrdoob (Ricardo Cabello): the engine this is built on. MIT.
  https://github.com/mrdoob/slop-newyork
- **Abuja Tour** (abujatour.site), the Slop New York fork this was forked from, including the landing page's layout
  and styles (`css/landing.css`). MIT, © Mr.doob.
  Later Slop New York work ported onto it (to upstream 1b54e16): gamepad controls (`js/gamepad-controls.js`),
  pedestrians' connected routes & conversations (`js/pedestrian-routes.js`), vehicle bumpers & lamps, fire escapes,
  corner collisions, bicycle coasting, restored visits, traffic that stays populated, SSR & road-marking fixes.
- **aalghooneh/slop-toronto** by aalghooneh, another Toronto fork of Slop New York: the car's powertrain, arcade
  handling & handbrake, crash damage, and the pedestrians knocked down as ragdolls (`PersonRagdoll` in
  `js/pedestrians.js`, the knock-downs in `js/traffic.js`, the driving in `js/controllers.js`). MIT, © Mr.doob & Slop
  Toronto contributors.
  https://github.com/aalghooneh/slop-toronto
- **City audio** (`js/audio-*.js`): mrdoob's synthesized spatial audio from Slop New York (MIT, above), with the
  player car's tyre squeal and engine revs from aalghooneh's slop-toronto fork (MIT, © Slop Toronto contributors).
  https://github.com/aalghooneh/slop-toronto. Every sound is synthesized in code; no recordings.
- **three.js**, WebGPURenderer and TSL, loaded from jsDelivr at a pinned dev-branch commit. MIT.
  https://threejs.org/
- **Stylized water** (`js/stylized-water.js`, built from `vendor/stylized-water`): John Fewell's three.js port of
  Uber Stylized Water. MIT, © MatrixRex / norio. See `vendor/stylized-water/LICENSE`.
- **three-clouds-webgpu** (`js/clouds.js`, built from `vendor/clouds/three-clouds-webgpu-0.1.0-r187.tgz`): John
  Fewell's volumetric clouds for WebGPU, a port of takram's three-clouds. MIT, © Shota Matsuda & John Fewell; notice in the tarball's
  LICENSE. Built on **@takram/three-atmosphere** and **@takram/three-geospatial** (MIT, © takram).
- **EZ-Tree** by Dan Greenheck: procedural trees. MIT. https://github.com/dgreenheck/ez-tree
- **lil-gui** (loaded only for the `?waterTune` tuning panel). MIT.
- **aalghooneh/slop-toronto** by aalghooneh, another Toronto fork of Slop New York. MIT.
  https://github.com/aalghooneh/slop-toronto. Ported from it, adapted to this city's scripts and data:
  - the TTC streetcars (`js/streetcars.js`: track chaining & direction of travel, stops, signals, queuing, the Flexity
    Outlook model & livery) and the traffic keeping behind them (the streetcars block in `js/traffic.js`), the paved
    rights-of-way (`js/city-grid.js`);
  - the Union Station Rail Corridor's ballast and rails (`js/rail-corridor.js`; the GO trains are this project's own);
  - the rest of Toronto around the detailed city (`js/surroundings.js`): the procedural ground on the terrain, the
    land-use map, the far house rows, mid-rise & high-rise clusters, the Hearn's stack, Casa Loma, Gibraltar Point's
    lighthouse;
  - the facade colours measured from Wikimedia Commons photos: `tools/commons-palette.py`,
    `tools/data/commons_palette.json` (used in `js/buildings.js`) and the photo credits below.

## Map and city data

- **City of Toronto Open Data**, under the Open Government Licence – Toronto
  (https://open.toronto.ca/open-data-license/): 3D Massing, Topographic Mapping – Edge of Roadway, Street Tree Data,
  Water Hydrants, Bicycle Parking, Street Furniture – Transit Shelter, Street Furniture – Litter Receptacle.
  Contains information licensed under the Open Government Licence – Toronto.
- **OpenStreetMap**: streets, places, water and land use, the streetcar & railway tracks and the streetcar stops. © OpenStreetMap contributors, under the Open Database
  License (ODbL). https://www.openstreetmap.org/copyright
  The city database built from it, `js/toronto-geodata.js` (by `tools/build-geodata.mjs`), is a derivative database
  and is made available under the ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/), not the MIT License.
- **AWS Terrain Tiles** (Mapzen "terrarium" tiles, SRTM-derived elevation). https://registry.opendata.aws/terrain-tiles/
- **Wikimedia Commons photos** of Toronto's buildings: the facade base colours (`tools/data/commons_palette.json`) were
  measured from 384 freely licensed photos (CC0, public domain, CC BY, CC BY-SA). The photos are not in this
  repository; each is credited with its author, licence and link in
  [`tools/data/commons_photos.md`](tools/data/commons_photos.md).

## Models and textures

- **Poly Haven** textures (CC0): `brick_wall_07` (the ROM's heritage brick, warmed to buff) and other Poly Haven
  surfaces in the ROM model. https://polyhaven.com/
- **Street props** (hydrant, mailbox, bike ring, transit shelter, litter & recycling bin: `assets/props/`) by John
  Fewell, simplified for the city (meshoptimizer, textures cut to 512–1024 px).
- **CN Tower model** (`assets/landmarks/cn-tower.glb`): "CN Tower low poly model base mesh" by C.J..Goldman
  (https://sketchfab.com/C.J..Goldman),
  https://sketchfab.com/3d-models/cn-tower-low-poly-model-base-mesh-da7bbf4926de434cb5ef8d0e0bea9d59, licensed CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/). Modified: display plinth removed, scaled to 553.3 m, glass made opaque
  dark glass, compressed (`tools/blender/export_cn_tower.py`).
- **Royal Ontario Museum model** (`assets/landmarks/rom.glb`): from John Fewell's rom-heist project, a SketchUp shell
  re-textured in Blender (`tools/blender/export_rom.py`), with SketchUp library materials and a Flag of Canada image.
  It is not covered by this project's MIT License.
- **Cloud noise textures** (`assets/shape.bin`, `assets/shape_detail.bin`, `assets/turbulence.png`,
  `assets/local_weather.png`) come with three-clouds-webgpu / takram (MIT).
- **Water textures** (`assets/water/`) come with Uber Stylized Water (MIT, © MatrixRex / norio).

## Not affiliated

Slop Toronto is a fan project. It is not affiliated with or endorsed by the City of Toronto, the landmarks shown or
their owners. Name boards show places' names, not their trademarked logos. The screenshots on the landing page are
from the app itself.
