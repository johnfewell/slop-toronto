# Toronto Islands: defensible low vegetation on the photographed Oneida / Ojibway frontages

Source audit · 2026-11-10 · Bead **st-sb3r.35**. **Audit only — no runtime planting, no source edit.** This pass asks a
narrow question and answers it from primary data: the accepted Oneida/Ojibway yard material
([waterfront-island-yard-materials.md](waterfront-island-yard-materials.md)), the 33 City tree points
([waterfront-island-residential-canopy.md](waterfront-island-residential-canopy.md)) and the lawn material still read
flat next to the captain's primary 2026 photographs, which show dense cottage gardens. Does a primary source actually
support a **bounded** low-cover layer on those two rows, or is the observation missing?

Reproducible tool: `tools/audit-island-low-vegetation.mjs`. Focused tests:
`tests/audit-island-low-vegetation.test.mjs`. No file under `js/`, `explore.html`, data or runtime is changed by this
bead.

## 1. Finding

- The GTA 2023 lidar **does see low surfaces** on the two frontages: **10.25 %** of the observed corridor ground (0.09 ha
  of 0.89 ha) carries a first return **1–5 m** above bare earth. These are measured low surfaces; their vegetation identity is unresolved.
- But that is **not proof of shrubs**: a 1–5 m first return can be a hedge, a sapling, a fence, a shed/deck roof, garden
  furniture or a parked machine. A height band is a *surface* class, not a botanical one.
- The single biggest limitation is structural: **71.7 %** of the observed ground returns **≥ 5 m** (canopy/structure).
  A first-return DSM cannot see the **understory under a closed canopy** at all. The dense gardens in the photographs
  run partly under the mature canopy, and that part is exactly what lidar cannot measure here.
- **Defensible next step (proposal, not done):** a **bounded, photo-informed *representative* low-cover layer** on the
  three source-validated yard blocks along those two lanes, clipped to the corridor, driven by the lidar's 1–5 m band
  *as a coarse where-mostly-low hint*, and **explicitly labelled an approximation** — not a surveyed hedge/planting plan
  and not a claim of exact BIA-wide real vegetation. Anything finer (species, flowerbeds, hedges as objects) needs an
  observation this source does not contain.

## 2. Sources (all local, primary, rights-clear)

| Source | Path / layer | Rights |
| --- | --- | --- |
| Ontario GTA 2023 lidar, DSM (first return) + DTM (bare earth), 0.5 m | cached tiles + manifests in `$DON_VALLEY_DTM` (here `$WATERFRONT_RESEARCH/vegetation-cache`), `manifest-toronto-island-dsm.json` / `manifest-toronto-island.json`, 23 + 23 one-km tiles | Open Government Licence – Ontario |
| OSM building polygons on the islands | `$WATERFRONT_RESEARCH/research/island-cottages/b.json` (`way["building"](43.605,-79.405,43.6345,-79.338)`, Overpass 2026-11-10) | OpenStreetMap contributors, ODbL |
| Photographed lanes (Oneida OSM way 13541126, Ojibway 13541122) | `js/waterfront-island-lanes-data.js` (committed) | OSM / ODbL |
| Narrowed paved widths (Oneida 3.3 m, Ojibway 3.5 m) | [waterfront-island-width-audit.md](waterfront-island-width-audit.md) | captain-measured |
| Committed water polygons (islands are land holes of Lake Ontario) | `GEO.areas` from `js/toronto-geodata.js` / `data/toronto-geodata.bin` | City of Toronto OGL |

The tool reads the lidar through `tools/terrain-pilot-lib.mjs` `openDtm`, which **re-checks every tile against its
manifest SHA-256** before use, so the audit runs only on the exact tiles. Manifest hashes are recorded in the output.
OpenStreetMap building completeness is community-mapped, not a survey; the lane widths are the captain's narrowed
representatives, not paint.

Not used: City `cot_geospatial3` FeatureServer **9** `TreedArea`. That layer is **woodland canopy**, not automatically
shrub, so it is not a low-cover source; the residential canopy bead already uses the separate **Tree Point** layer (10).
The lidar 1–5 m band (below) is the primary low-surface evidence.

## 3. Method (bounded, photographed frontage only)

Corridor = **within 12 m** of the mapped Oneida/Ojibway centre line (the same envelope the canopy bead uses), inside the
detail frame. From that corridor, eligible ground **excludes**:

1. every **actual OSM building polygon** in `b.json` plus a **1.0 m** buffer (a building's walls/roof are not ground
   vegetation);
2. **every mapped island lane's paved strip** at the narrowed Oneida 3.3 m / Ojibway 3.5 m, else its own mapped width
   (default 5.6 m), so mapped pavement is never counted;
3. **committed water** (respecting the lake's land holes, the `city-config.js` rule), so the shoreline is excluded.

Sampling is a **0.5 m grid** (the lidar's native pixel) inside the corridor box, one DSM/DTM pixel pair per cell, 0.25 m²
per cell. A cell with no plausible lidar value is `noLidar` (**not** guessed). **Both** the DSM and the DTM are validated
independently to a plausible elevation (−100…1000 m) **before** the difference is taken, so two nodata sentinels cannot
cancel to 0 and masquerade as lawn (a regression test covers this).

Classification of each observed cell (`DSM − DTM`, the same band `tools/build-park-cover.mjs` uses for High Park's shrub
layer):

| Class | Rule | Meaning |
| --- | --- | --- |
| below | diff < 1 m | bare earth, lawn, ground clutter |
| **low** | 1 ≤ diff < 5 m | a low **surface**: candidate low-cover band (not a species) |
| tall | diff ≥ 5 m | canopy/structure; understory here is **unobservable** |
| noLidar | either surface implausible / missing | not measured |

## 4. Results

Corridor = 44,664 cells (11,166 m² of 0.25 m² cells). Excluded: **372** building (+1 m), **8,388** pavement, **308**
water, 0 out of frame. Observed = **35,596** cells = **8,899 m²**.

| | Cells | Area | Share of observed |
| --- | --- | --- | --- |
| below 1 m | 6,416 | 1,604 m² | 18.02 % |
| **low 1–5 m** | **3,649** | **912 m² (0.09 ha)** | **10.25 %** |
| tall ≥ 5 m | 25,531 | 6,383 m² | 71.72 % |
| no lidar | 0 | — | — |

Per lane:

| Lane | observed m² | low m² | low share | tall share |
| --- | --- | --- | --- | --- |
| Ojibway | 4,367.5 | 422.3 | 9.67 % | 72.33 % |
| Oneida | 4,531.5 | 490.0 | 10.81 % | 71.14 % |

Sensitivity (the low share barely moves, so it is not an artifact of one gate):

| Variation | low share | low area |
| --- | --- | --- |
| building pad 0 m | 10.26 % | 919 m² |
| building pad 1 m (default) | 10.25 % | 912 m² |
| building pad 2 m | 10.25 % | 899 m² |

### The building exclusion is small and measured, not assumed

**79** OSM building polygons fall in the corridor's bounding box; only **5** have a vertex within the 12 m corridor
itself (the box is larger than the corridor), and the corridor ground sits well off them:

| Nearest OSM building distance over corridor cells | m |
| --- | --- |
| min | 0.00 (a wall clip at the lane edge) |
| p10 | 4.53 |
| median | 10.52 |
| p90 | 16.57 |
| max | 33.83 |

Cells within the nearest building: **372** within 1 m, **911** within 2 m, **5,477** within 5 m. The 372 excluded cells
(= 93 m²) are the thin ring hugging the few cottages/sheds that actually reach the lane — which is why the building
exclusion is small next to the 8,899 m² corridor: most of the sampled frontage is gardens and lawn *between* houses and
the path, not building footprint. These are measured diagnostics from the OSM polygons, not an estimate.

## 5. Honest limits — what the source cannot tell us

1. **Understory under closed canopy is invisible to a first-return DSM.** 71.7 % of the observed ground returns ≥ 5 m;
   the ground and any shrubs beneath sit under the canopy's first return. The photographs' dense gardens run partly in
   that shadow. This is the **exact missing observation** for the canopy-covered part.
2. **Height alone does not name a species, a flowerbed or a hedge.** A 1–5 m return is a surface. Distinguishing shrub
   from fence, shed, deck, furniture or vehicle needs either a multi-return/point-cloud classification (return numbers,
   intensity, height-above-ground per return) or field/aerial oblique photography of the lots. The cached DSM/DTM has
   neither.
3. **OSM building completeness.** The 372-cell exclusion is only as complete as OSM's mapped cottages/sheds; an unmapped
   shed or deck can still read as a low return.
4. **Two rows only.** This audit says nothing about Ward's, Centre Island or the mainland. It is bounded to the
   photographed Oneida/Ojibway frontages.

## 6. Finding and proposed next step (bounded, photo-informed, explicit approximation)

**The source supports "there is a real low surface layer on these two frontages" (10.25 % of observed ground), but not
"these are shrubs / hedges / flowerbeds" and not the understory under closed canopy.** So the defensible options are:

- **(A) Do nothing from this source alone.** Honest, and the flat read stays; the missing observation (§5.1–5.2) is the
  exact gap.
- **(B, recommended, still a separate captain-reviewed bead) A bounded low-cover *approximation*.** Extend the existing
  yard-material pass, on the same three source-validated blocks along Oneida/Ojibway only, within the same 12 m corridor,
  with a **representative low-cover layer**:
  - drive a *coarse where-mostly-low hint* from the lidar's 1–5 m band (e.g. a cell is "low-supporting" where its 0.5 m
    sub-samples are mostly 1–5 m), **never** claiming a plant from a single return;
  - clip plants off the mapped pavement, the OSM building footprints + 1 m, and water (this audit's exclusions), and
    keep them clear of the shared path edges;
  - **label it explicitly an approximation** in code and docs: representative low vegetation, not a surveyed planting,
    no species and no flowerbed/hedge objects, and **not** a claim of exact real vegetation.
  This is defensible as a *photo-informed approximation* because the photographs establish dense gardens along these lanes and the lidar constrains low surfaces. They do not identify each planting footprint. It is **not** an exact reproduction. A first implementation should leave canopy-covered cells untouched rather than infer hidden shrubs.

No runtime plants are proposed from first returns alone; (B) is a separate, gated bead with the above constraints and any
density it uses must stay inside this audit's corridor and exclusions.

## 7. Reproduce

```sh
# Cache: the captain's copy of the island's 23 DSM + 23 DTM tiles and the two manifests.
export DON_VALLEY_DTM=$WATERFRONT_RESEARCH/vegetation-cache
node tools/audit-island-low-vegetation.mjs \
  --buildings $WATERFRONT_RESEARCH/research/island-cottages/b.json \
  --building-pad 1.0 --sample 0.5 \
  --out $WATERFRONT_RESEARCH/island-low-vegetation-audit.json
```

Exit 0 writes the JSON; it prints the summary and writes the same JSON to `--out`. It writes **no repository file**. The
tool refuses `--sample <= 0` / non-finite and `--building-pad < 0` / non-finite. The lidar cache carries **23 DSM + 23
DTM** tiles; `openDtm` verifies each against its manifest SHA-256, and the manifests' own SHA-256 are recorded in the
output:

- `manifest-toronto-island-dsm.json` — `7c1d5631cabc76b2b35d378c1d19978231c12855cee8cca0b87cd33c9e6ab619`
- `manifest-toronto-island.json` — `afa491aca646ab03abe917f4d8803d1cd4d1e838ae22d61cecadc795b163ce5d`

If `$DON_VALLEY_DTM` (and the default home cache) are absent, the CLI fails with the exact missing-manifest path rather
than guessing.

Focused tests (8, all passing):

```sh
node --test tests/audit-island-low-vegetation.test.mjs
```

They prove, on the real committed lanes and water and the saved OSM buildings, that the corridor is the photographed
centre-line envelope only; that an island point inside the lake's land hole is **not** water while an open-lake point is;
that the height classifier keeps 1–5 m in `low`, < 1 m bare and ≥ 5 m tall; that **nodata on both surfaces is `noLidar`**
not a false lawn, with the plausible-elevation guard; that the CLI rejects bad sample/pad; that actual building
interiors and mapped pavement are excluded; and that the CLI completes on the cached lidar with bounded, reconciling
counts and the tall blind spot reported separately.

## 8. What this bead did not do

- No runtime planting and no change to `js/waterfront-island-yard-materials.js`, the canopy module, `city-grid.js`,
  `explore.html`, data or any other source. Buildings/massing are owned by a different worker.
- No commit, deploy, GPU capture or dev-server restart; no full test suite run.
- No species, flowerbed, hedge or fence invented from a height band.
