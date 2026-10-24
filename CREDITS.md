# Credits

Slop Toronto is downtown Toronto and the waterfront in 3D, in the browser. The project's own code is under the MIT
License (`LICENSE`). Third-party code, data and assets keep their own licences, listed here.

## Engine and code

- **Slop New York** by mrdoob (Ricardo Cabello): the engine this is built on. MIT.
  https://github.com/mrdoob/slop-newyork
- **Abuja Tour** (abujatour.site), the Slop New York fork this was forked from, including the landing page's layout
  and styles (`css/landing.css`). MIT, © Mr.doob.
- **three.js**, WebGPURenderer and TSL, loaded from jsDelivr at a pinned dev-branch commit. MIT.
  https://threejs.org/
- **Stylized water** (`js/stylized-water.js`, built from `vendor/stylized-water`): John Fewell's three.js port of
  Uber Stylized Water. MIT, © MatrixRex / norio. See `vendor/stylized-water/LICENSE`.
- **three-clouds-webgpu** (`js/clouds.js`, built from `vendor/clouds/three-clouds-webgpu-0.1.0-r187.tgz`): John
  Fewell's volumetric clouds for WebGPU, a port of takram's three-clouds. MIT, © Shota Matsuda & John Fewell; notice in the tarball's
  LICENSE. Built on **@takram/three-atmosphere** and **@takram/three-geospatial** (MIT, © takram).
- **EZ-Tree** by Dan Greenheck: procedural trees. MIT. https://github.com/dgreenheck/ez-tree
- **lil-gui** (loaded only for the `?waterTune` tuning panel). MIT.

## Map and city data

- **City of Toronto Open Data**, under the Open Government Licence – Toronto
  (https://open.toronto.ca/open-data-license/): 3D Massing, Topographic Mapping – Edge of Roadway, Street Tree Data,
  Water Hydrants, Bicycle Parking, Street Furniture – Transit Shelter, Street Furniture – Litter Receptacle.
  Contains information licensed under the Open Government Licence – Toronto.
- **OpenStreetMap**: streets, places, water and land use. © OpenStreetMap contributors, under the Open Database
  License (ODbL). https://www.openstreetmap.org/copyright
  The city database built from it, `js/toronto-geodata.js` (by `tools/build-geodata.mjs`), is a derivative database
  and is made available under the ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/), not the MIT License.
- **AWS Terrain Tiles** (Mapzen "terrarium" tiles, SRTM-derived elevation). https://registry.opendata.aws/terrain-tiles/

## Models and textures

- **Poly Haven** textures (CC0): `brick_wall_07` (the ROM's heritage brick, warmed to buff) and other Poly Haven
  surfaces in the ROM model. https://polyhaven.com/
- **Street props** (hydrant, mailbox, bike ring, transit shelter, litter & recycling bin: `assets/props/`) by John
  Fewell, simplified for the city (meshoptimizer, textures cut to 512–1024 px).
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
