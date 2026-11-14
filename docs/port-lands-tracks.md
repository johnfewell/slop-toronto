# The Port Lands cycle tracks and Biidaasige Park's paths (st-ya4y)

PR #150 (`docs/road-widths.md`) took the City's cycle bikeways out of the surveyed and widened carriageways, where
they took a traffic lane. In their place it drew OpenStreetMap's separately mapped cycleways beside the kerb. In and
around Biidaasige Park that left three things:

- paths drawn twice, once by that street layer and once by the park's own network;
- tracks that read as near-black strips;
- one corner of an old City road polygon still drawn as road.

This change fixes all three. It also records what green junction paint would need; that paint is not added.

## The rule: the park's paths are the park's

Biidaasige Park's path network (`js/biidaasige-path-network-data.js`, drawn by `js/biidaasige-paths.js` in the park's
materials) is the park's own hand-built work. It draws its paths on the park's lawn, 3 cm above it. So they show
inside the park's outline (the network's `park.polygon`); outside it, they lie under the curb islands' surface.

`tools/geo-cycling.mjs`:

- **Inside the park's outline,** a path is drawn once, by the park.
  - No City trail is drawn there: the network carries every path in the park.
  - An OSM cycleway that the network draws, matched by its way id, is not drawn as a street track there.
  - Any street track stops within `PARK_MEET` = 1.5 m of a park path's centre line, whatever its direction, so the
    two meet end to end with the park's path on top.
  - The distance is small so that a track beside a park walk a few metres off goes on.
- **"The ways the park draws"** are the network's ways that `pathSpecs` draws: not bridges or steps (listed as
  unplaced), nor private, under-construction or proposed ways.
- **Outside the outline** the street layer draws as before, even for a way the network also lists. For example,
  Commissioners' north-side track (OSM 1242711091) is a network way, but north of Commissioners it would sit under
  the sidewalk.
  - A first try handed every network way to the park by id. It lost that track in the frames, which is why the rule
    is bounded by the outline.

On the detail map, 1,212 m of City trail inside the park is left to it. Its own ways are not drawn as tracks there, and
18 OSM cycleways (2,097 m) are drawn as street tracks beside the measured streets (the build's log lines).

## The tracks' materials

The street layer drew every trail other than the Martin Goodman's red in `0x353534`, a near-black asphalt. The park's
paths are `0x6d6f72` (asphalt) and `0xb9b3a8` (concrete), so the street tracks read as black strips beside them.

The OSM tracks drawn beside the measured streets now take the park paths' materials, by their OSM `surface`:

- surface 2, the park's asphalt;
- surface 3, its concrete (`concrete`, `paving_stones`, `sett`).

The City's own trails keep their colours everywhere, the red and the dark grey. Changing those across the city is
outside this change; 708 m of dark-grey City trail remain in the Port Lands box, all outside the park.
`js/city-config.js` and `tools/make-home-clips-shots.mjs` looked for "the red trail" as any non-zero surface. They now
look for surface 1.

## The track across the lawn

The dark track the coordinator saw curving from the Cherry and Commissioners junction is two OSM cycleways:

- **1414354040,** a 19 m concrete link across the corner plaza at the junction's south-east corner;
- **1242949359,** the park-side Commissioners cycle track running east from it.

On the City's 2025 orthophoto both are real, light concrete and asphalt beside the kerb planting. Neither is in the
park's network, so both stay street tracks, now in the park's materials (1414354040 concrete, 1242949359 asphalt).
They are listed for John as gaps in the park's data: real paths at the park's edge that the park's network doesn't
carry.

## The merge corner

The last corner of City polygon 56694's old Commissioners tail, about 5 × 6 m at the eastbound lane's merge, is now
ground. It is a second `ground` strip in `tools/fixtures/road-surfaces.json`, along the merge link (OSM 1418441607).
The kerb was measured on the orthophoto at +3.3 m (2 m along) and +3.5 m (8 m along), and the strip runs 9 m out over
grass, the cycle track and the sidewalk, from 0 to 9 m along. At 11 m the link is in the next junction's asphalt.

## Junction paint (findings, not changed)

- **On the 2025 orthophoto:**
  - **Commissioners by the Bike Share dock:** zebra crosswalks, and the cycle tracks with bicycle symbols. No green
    paint.
  - **Cherry and Commissioners:** two-way crossrides marked with white elephant's feet and bicycle symbols, no green
    fill. One green bike box (a two-stage turn queue box) on Cherry's southbound approach.
  - The green marking main drew by the dock was the in-road band's generic junction-approach paint. The real junction
    doesn't have it.
- **What it would take.** The street tracks already get crossing pieces where they cross a road (`trailPieces`,
  drawn with white elephant's feet in `js/cycling.js`).
  - Green conflict paint would be a green fill ribbon on those crossing pieces, perhaps only where the City marks one.
  - The bike box would be a new symbol at a mapped point. OSM doesn't tag it here, so it would be hand placed.
