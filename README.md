# Slop Toronto

Downtown Toronto and the waterfront in 3D, in the browser: walk, cycle, drive or fly from the Humber Bay Arch Bridge
along the lake to Sugar Beach, past the CN Tower and through downtown. Built with [three.js](https://threejs.org/)
WebGPURenderer and TSL on the engine of [Slop New York](https://github.com/mrdoob/slop-newyork) by mrdoob, by way of
its fork Abuja Tour. Needs a WebGPU browser (recent Chrome or Edge).

## Run it

No build step for development: `npm run dev` (or `python3 -m http.server 5530 --bind 127.0.0.1`) and open
`http://127.0.0.1:5530/` (landing page) or `/explore.html` (the city).

## Publish

The site is static. `node tools/build-site.mjs` copies what the pages load into `dist/`: the two pages, `css/`,
`assets/` and only the `js/` files the pages load (followed through their imports). Netlify runs that build
(`netlify.toml`) and publishes `dist/`:

- **Production** deploys from the `release` branch: merge a PR into `release` to publish.
- **Deploy Previews** build every pull request.

Netlify CLI, pinned: `npx netlify-cli@27.14.2 <command>` (e.g. `deploy --build` for a draft deploy, `status`).

## License and data

The project code is available under the [MIT License](LICENSE). Data and third-party code keep their own licences:
see [CREDITS.md](CREDITS.md). In short: City of Toronto Open Data (Open Government Licence – Toronto),
© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL), AWS Terrain Tiles (SRTM).
