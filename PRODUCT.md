# Product

<!-- impeccable:product-schema 1 -->

Scope: John's design interest is the landing page (`index.html`, served at https://sloptoronto.ca/). The 3D city itself (`explore.html`) is the product the page leads into; it is described here only as far as the landing page needs it.

## Platform

web

## Users

- **Curious Torontonians:** locals who want to see their own city, their street, their park or their commute in 3D.
- **The tech / three.js crowd:** developers and graphics people, often arriving from social posts or by way of mrdoob's Slop New York, who want to see what WebGPU and TSL can do with a real city.

Both usually arrive from a shared link or a post and decide within a few seconds whether to open the city.

## Product Purpose

Slop Toronto is downtown Toronto and the waterfront in 3D, in the browser: walk, cycle, drive or fly from the Humber Bay Arch Bridge along the lake to Sugar Beach, past the CN Tower and through downtown, and ride the 504 streetcar or the subway across the Don Valley.

The landing page has one job: **get the visitor into the city.** Success is the visitor opening it, through Explore, the place search or a sight.

## Positioning

The city is built from the City of Toronto's own open data and OpenStreetMap at 1:1: the City's 3D Massing footprints and heights, its street trees, hydrants, bike rings, park signs, cycling network and CaféTO patios, and the real TTC subway and streetcar network you can ride. It runs on the engine of mrdoob's Slop New York (by way of Abuja Tour), rebuilt for Toronto.

## Operating Context

- Visitors arrive from shared links and social posts; the page's link preview (`assets/og-toronto.jpg`) is often the first thing they see.
- The city needs WebGPU: a recent Chrome or Edge on a laptop or desktop works best. Many visitors arrive on phones or browsers without it; the page already detects this and says so.
- Entry points into the city are deep links: `explore.html#place=<name>` (search and sight cards arrive on the street facing the place), `#mode=cycle`, `#to=<place>` for directions.

## Capabilities and Constraints

- A static site: `index.html` + `css/landing.css`, built by `npm run build` into fingerprinted `dist/` and served by a Cloudflare Worker. No framework on the landing page.
- Page analytics: self-hosted Umami, visit counter only, no cookies, no session replay.
- Data licences require attribution wherever the data is shown: City of Toronto Open Data (Open Government Licence – Toronto), © OpenStreetMap contributors (ODbL), AWS Terrain Tiles (SRTM). See `CREDITS.md`.

## Brand Commitments

- Name: **Slop Toronto** (part of the Slop New York family). Logo: `assets/brand/slop-toronto-logo.png` (the tall logo, CN Tower included) and `assets/brand/slop-toronto-mark.png` (the square mark behind the favicons and app icons).
- **Every image on the page is the app itself.** Pictures of the city are real in-app screenshots, never outside renders, stock photography or generated imagery. The logo (`assets/brand/`, John's own) is a brand mark, not a picture, and is the one exception.

## Evidence on Hand

- In-app screenshots: `assets/site/` (hero, ride, CN Tower, Rogers Centre, Union Station, City Hall, ROM, St. Lawrence Market, Distillery District, Harbourfront Centre, Cinesphere, Queen's Park), `docs/images/hero-bloor-viaduct.jpg`, `docs/images/grid.jpg`, `assets/og-toronto.jpg`. New shots come from the capture tooling (`npm run capture`, the `gpu2` recipe in `docs/adoption-measurements.md`).
- Figures currently on the page, from the city data: 35,266 buildings, 1,383 named streets, 57,120 street trees, ~6 km of lakeshore, 11.6 × 6.6 km of downtown at 1:1. Any new figure must come from the data, not be estimated.
- No testimonials, press, user counts or endorsements exist; do not invent them.

## Product Principles

1. **Into the city fast.** Every part of the page should move a visitor toward opening the city, and a specific place in it.
2. **Show, from the app.** The proof is the city itself, in its own screenshots.
3. **Toronto by name.** Real places, streets and lines sell it to locals and make the technical feat legible to everyone else.
4. **Honest about the requirement.** Say plainly that it needs WebGPU and where it works best.
