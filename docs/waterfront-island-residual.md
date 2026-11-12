# Toronto Islands: residual island-lane edge and yard fixes (bead st-sb3r.24)

Bead **st-sb3r.24**, continuing st-sb3r.23 (the centre-line gate and flush verge). This pass fixes the two mismatches the
captain found in the accepted checkpoint's final captures:

- **Third Street (Ward's), left edge:** a continuous raised curb remained on the left of `island-lanes-wards-third-street-
  along-midday`, though the right verge was already flush and green.
- **Oneida Avenue (Algonquin), left side:** a broad concrete yard remained (the native material category), though the
  right verge was flush.

Both are diagnosed from the committed source data and the built scene, not from a blanket island override.

## 1. Third Street left edge: the City-sidewalk blanket exclusion

The pure verge gate (`islandVergeEdgeMaterial`, js/waterfront-island-lanes.js) is already correct on Third Street. The
left side of the lane is the north edge of **block 2887** (its long edge runs 62.3 m at x≈1500, z≈1869, ~0.36 m from the
Third Street OSM way centre line). The gate flags it, along with 52 of the block's 134 edges.

The exclusion was in the producer: `js/city-grid.js` did `!hasCityWalk ? islandVergeFlags(inner) : null`, i.e. any block
with **any** City sidewalk lost the whole verge. Block 2887 does have City sidewalk pieces — but on its far side (its two
pieces are 116 m from Third Street, bbox x 1382–1494, z 1960–2034). So the correct lane edge was excluded for a sidewalk
that is nowhere near it.

**Fix (per-edge, not whole-block).** The producer now masks only the flagged edges whose ramp footprint **overlaps a City
walk piece**, using an exact polygon/quad test (`cityWalkOverlapsEdge`: vertex-in-polygon plus edge crossings, with a bbox
reject), not a sample guess. Block 2887 keeps its City walks on the edges the City maps and flushes the Third Street edge
the City does not map (45 of 134 edges remain ramps).

**Material preservation.** On such a mixed block, the former `if (walks)` branch laid new concrete band on every retained
edge. That is replaced by a **mixed yard outline** (`mixedYardOutline`): the yard keeps its original material and runs to
the inner outline on retained edges, cut back to the prop inset only on flagged edges where the ramp is. The surveyed City
walk pieces are still laid on top at `SW_TOP + 0.006`, exactly as before; the slab's vertical face at the inner outline is
kept only on retained edges. A small `slabSides(..., keep)` masks the face on flagged edges so no side pokes above the ramp.

## 2. Oneida left side: inherited tall rows paving a cottage yard

Block **2918** (Oneida Avenue's left side) has 26 validated island-building profiles, all cottages, and one unmatched
inherited row whose stale geodata height is 31.5 m. `isPaved` in `js/city-grid.js` used the raw native height when a row
did not match a profile, so that single inherited row paved the whole yard (the captain's broad concrete yard).

**Fix (validated evidence only).** The `blockBuilt` pass already calls `islandBuildingProfile(row)` per active building
row; it now also counts `matchedN`, `matchedArea`, `matchedTop` and `matchedResidentialN` from the **validated** profiles
only (a reshaped/missing record or a wrong frame is a no-op). A block is treated as residential when at least three
validated profiles are cottages/houses and they are the clear majority; then **only the matched heights** decide paving,
so a genuinely tall matched building still paves. Block 2918 becomes a plot yard; block 2916 (all cottages) stays a plot
yard. No new source lookup, no second weaker index.

## 3. Bounded scope and honest limits

- **Only the edges the gate already confirms change.** No tolerance is enlarged; the gate is untouched.
- **Only the yard material category changes on residential blocks.** A matched tall/service building keeps the right
  material; the residential override needs `matchedN >= 3` and a cottage majority, so it cannot catch a lone block.
- **The City walk polygons, kerb and walking floor are unchanged** on the edges the City maps.
- **Still approximation:** the native merged footprints, the estimated 6.4 m living-street / 4.8 m service widths, and
  the absence of a parcel survey. The mixed-outline yard is a material-category decision, not a per-parcel garden sketch.
- Native road routing and width are unchanged; the flush ramp is still a local approximate transition.

## 4. Verification

Focused tests:

```sh
node --test tests/island-lane-verge.test.mjs     # 11 tests
node --test tests/waterfront-island-buildings.test.mjs
node --test tests/waterfront-island-lanes.test.mjs
node --test tests/city-grid-concave-walk-band.test.mjs
```

`tests/island-lane-verge.test.mjs` adds built-scene assertions (not copies of the builder's classifier):

- a retained edge of block 2887 away from any City walk is still `Yards` at the walking floor (not a new sidewalk);
- every surveyed City walk piece in a refined island block is still the topmost `Walkways` surface, and the exact ramp
  sampler reports no ramp under it;
- the known Oneida left-side yard (block 2918) is `Yards` at the walking floor, not the inherited concrete.

The ground check still passes: on the built detail frame every `islandVergeSurfaceAt` sample matches a raycast of the
whole `CityGround` to ~4e-16, so the ramp sampler and the walker's ground hook are unchanged for the accepted geometry.

## 5. Review shots / diagnostics

Same cameras as the accepted wave6 final set:
- `tools/shots/waterfront-island-lanes.json`: `island-lanes-wards-third-street-along-midday`,
  `island-lanes-algonquin-oneida-along-midday`, plus the aerial overview and the producer checks.
- `tools/shots/waterfront-island-verge-phone.json`: the 412×915 phone views and the movement check.

Diagnostic coordinates: Third Street left edge ≈ (1513, 1873) is block 2887's plot yard (previously kerb/walk); the Oneida
left yard ≈ (1038, 2369) is block 2918's plot yard (previously paved/forecourt). `CITY.islandVergeRampStats()` and
`CITY.islandVergeSurfaceAt(x, z)` remain the contracts; `CITY.cityWalkOverlapsEdge(poly, prop, i, walks)` is exported for
tests.

## 6. GPU acceptance and remaining limits

Build **9b9ff034c285** passed the Mac mini `wave6-residual-draft` high/detail capture and
`wave6-residual-phone` low/412×915 capture. The captain inspected matching Third and Oneida
street views and the portrait Third view. The reported left curb and concrete-yard artifacts
are removed. Desktop verified **865 actual rendered-ground/controller points**, maximum error
4.44e-16 m; phone verified **865 movement points in all three travel modes**, maximum error zero.
These are functional and visual results on a shared host, not performance budgets.

Exact lane widths, planting/garden boundaries, property entrances and per-house facade details
remain approximations. No commit or deployment was requested or performed.
