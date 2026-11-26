# Landing page refresh: the issue of 26 November

Spec for refreshing `index.html` (sloptoronto.ca). First drafted 2026-11-10 for what had shipped since 2026-11-03, never
carried out; brought up to date and carried out 2026-11-26 (bead st-mcqm). John's decisions of 2026-11-10 (§10) stand.

The page keeps its job (get the visitor into the city, at a specific place), its design system (`DESIGN.md`, "The City
Weekly") and its surface brief. This is a new **issue** of the same paper, not a redesign: new stories, new listings, new
readings, new pictures, same masthead, inks and grid.

## 1. Why

On 3 November the page described "downtown and the waterfront": Humber to Sugar Beach, lake to Bloor, 35,266 buildings,
eight waterfront listings. Since then the map has more than doubled on desktop, a park with a zoo and another with a
river mouth have arrived, the waterfront has been rebuilt from sources, the seasons, rinks and holiday lights follow the
real date, and the site has a newspaper section. Some of what the page said was wrong, and every picture predated it.

## 2. What has shipped (inventory) and what the page does with it

"Verified" is the check on the Mac mini (`gpu2-local`) against the 2026-11-26 build (`main` d972777, live).

### Since 3 November (the first draft)

| What | Where it's recorded | Treatment on the page |
|---|---|---|
| Bigger map on desktop: Humber to Victoria Park, lake to Eglinton, 190.8 km². Phones and low quality keep downtown | st-bz1o, `docs/map-scale-measurements.md` | Dek, Corrections, a two-column readings table, the "Off the lake, up to Eglinton" section |
| Landmark lookups for Ontario Place, Sugar Beach, Centre Island, Kensington Market | st-bz1o.8, fixed by PR #142 | Verified in the Eglinton frame: all four resolve as landmarks (§6). The Cinesphere listing and the Sugar Beach, Centre Island and Kensington Market links stand |
| High Park on its real ground, woods, pond, trails, seasons | st-xob.48, .53, .58, .63 | Section "The park" |
| High Park Zoo: ten species that graze and peck | st-xob.57 | In "The park"; a "Go to the zoo" button; the real zoo's closure noted |
| Seasons: trees, rinks and patios follow the real date; rain | st-xob.63, st-xob.61 | "How it works": "The real date", "Toronto's own sky" |
| Natural shores (beaches, reeds, mud) | st-xob.47 | "What's real", Water & light |
| The waterfront rebuilt from sources | st-sb3r.1-43 | Section "On the water" |
| Humber Bay Arch Bridge, Ontario Place's pods, bridges you can cross | st-xob.49, .54, .55 | The ride's start and the Cinesphere listing show them; "Getting around" |
| The paper (news) | st-p5rl | "In this week's paper" box |

### Since 10 November (new in this update)

| What | Where it's recorded | Treatment on the page |
|---|---|---|
| Biidaasige Park and the Port Lands: bridges, banks, planting, play areas, lighting | st-bmyv.*, jf-li1, st-xob.51 | Lead of "On the water" |
| The TORONTO sign at Nathan Phillips Square (medicine wheel, maple leaf, night colours, summer fountain), the pool and rink, the Freedom Arches lit for the Cavalcade, the holiday tree | jf-icu, jf-gdw, jf-6p1, jf-hcu | Lead picture of the City Hall listing (a December frame: the arches stand from 28 November); "The real date" run-in |
| Holiday installations on their real dates (Distillery Winter Village from 12 November) | jf-hcu, `docs/holiday-installations.md` | "The real date" run-in |
| Outdoor rinks across the Eglinton map, with skaters in the ice season (1 December to 15 March) | jf-2g0, jf-9vp | "The real date" run-in |
| Road works from the City's Road Restrictions feed: barrels, cones, signs, traffic that goes round | jf-w0s, jf-dqj | "What's real", Streets; "Getting around", Drive |
| Street furniture from City data: litter bins, poster columns, publication boxes; amenities across the whole Eglinton map | jf-yxy, jf-e8y | "What's real", Trees & street furniture |
| Ghost signs on old party walls, real polygon edges on old main streets; roofs from the City's heights; drawn houses, shops, towers and places of worship | st-2nl.5, st-2nl.6, st-ndw9.* | "What's real", Buildings (desktop) |
| Streetcars: live cars the TTC runs off its schedule are hidden; diverted streetcars shown | st-1aqy, PR #189 | Nothing new claimed beyond the 504 story |
| People: 18 Rocketbox civilians with a new gait | st-8p1p, st-xob.64 | Colophon credit |
| Lighting: sky occlusion, material layers (Ben Houston's Slop New York lighting) | jf-s3b, jf-rcw | Colophon credit; the new pictures show it |
| Eglinton frame lighting fixed (it looked dim and overcast) | jf-lu7 | The new pictures |
| Performance: lighter tree shadows and models, deferred park and Port Lands detail | st-aeg2.*, st-nz3v | Not a claim; the Corrections box says the bigger map loads a little slower |

Left out on purpose: the subway north to Eglinton (st-bz1o.7, in progress); Line 5 Eglinton at street level (the build
draws a train at street level at Yonge and Eglinton, where the line runs underground, so the page doesn't claim it);
the follow camera's CN Tower director (not a visitor-facing switch that was verified); building presets as a section
(one run-in in Buildings carries them); the school fences.

## 3. Principles for this issue

1. **Nothing claimed that isn't live.** Every listing is opened on the build on desktop and on a phone before it ships.
2. **Every figure from the data,** with its source, read from the build (§5).
3. **Say which map a figure is for.** Desktop gets the Eglinton map; phones keep downtown.
4. **Every picture is the app,** captured fresh the day of the issue, with its provenance beside it. Seasons are shown
   as they are: late November, bare trees. A summer or December frame is used only where a scene needs it (the
   TORONTO sign and the Freedom Arches stand from 28 November, the rinks freeze on 1 December) and the picture's
   provenance says so.
5. **One spot red, one yellow sticker per view, no new components** beyond a lead-and-four grid, a park layout and a
   boxed notice built from the ones that exist.

## 4. Changes, section by section

- **Masthead, title, meta:** "Toronto, lake to Eglinton, in 3D" (laptops), downtown and phones named in the dek.
- **Cover:** coverline "Toronto, to scale." stays. The four time-of-day cover clips are re-rendered on the real date
  with the same camera (the cover's crop on narrow screens depends on the tower standing 68.5 % across the frame).
- **Listings rail:** all eight listings stay, with new clips and thumbnails; distances are unchanged (the places have not
  moved). **Corrections box:** gains "Phones get downtown; laptops and desktops get the city from the lake to Eglinton,
  and that bigger map takes a little longer to load."
- **Ride the TTC:** the 504 and the subway clips re-rendered; "Getting around" mentions the bridges and the road works.
- **The park (new):** a lead picture of Grenadier Pond, a zoo picture, a woods picture, three run-ins, the zoo's closure
  noted, a "Go to the zoo" button.
- **On the water (new):** Biidaasige Park (lead), Sugar Beach, Toronto Music Garden, Jack Layton Ferry Terminal, Centre
  Island.
- **Off the lake, up to Eglinton:** City Hall (lead, with the sign, the arches and the rink), the ROM, Queen's Park,
  Kensington Market, Yonge and Eglinton. The dek says which map has what.
- **By the numbers:** two columns, Downtown (every device) and To Eglinton (desktop), each with its source.
- **How it works:** adds "The real date" and "Toronto's own sky". **What's real:** buildings, streets (road works),
  street furniture, shores, parks and animals, and a "Made up" run-in.
- **In this week's paper:** a boxed notice linking the latest news story (hand-written until st-p5rl builds the index).
- **Colophon:** adds the data sets and credits new since 3 November.

## 5. Figures (blocking, re-read from the build)

Read in the running game on the Mac mini from the two geodata files the page loads (`data/toronto-geodata.bin` for the
phone and downtown, `data/frames/eglinton/toronto-geodata.bin` for desktop): building rows, placed street trees, named
street names in the road table, the frame's box. See `docs/landing-refresh-figures.md` for the values read, the date and
the method.

## 6. Prerequisites and risks

- **st-bz1o.8 (landmark lookups):** checked in the Eglinton frame on 2026-11-26: Sugar Beach, Cinesphere, Ontario Place,
  Centre Island and Kensington Market each return their landmark first.
- **Two maps, one page.** Every listing and button link is tried on both frames (§9).
- **Start-up time.** The bigger map loads slower on desktop; the Corrections box says so.
- **The sign and the arches** are dated scenery: a picture taken in December shows what a visitor sees from 28 November.

## 7. Pictures and footage

Captured through `tools/capture.mjs` (stills) and `tools/render-film.mjs` (clips) on the Mac mini, live sky on the real
date (`?liveDate=2026-11-26&liveClock=…`), with `tools/make-landing-stills-shots.mjs` and
`tools/make-home-clips-shots.mjs` (`LIVE=1`) writing the shot lists. Clip encoding is `tools/encode-home-clips.sh`;
stills are encoded and given their provenance JSON by `tools/landing-stills-encode.mjs`.

## 8. Out of scope

The masthead, type, inks, rules and grid; the explorer's own UI; the news Markdown build (st-p5rl).

## 9. Acceptance

- Every claim on the page is live, checked on desktop (Eglinton frame) and a phone (downtown frame).
- Every figure re-read from the build, with its source beside it.
- New pictures and clips captured from the app, each with provenance; reduced-motion and Save-Data still stop clips.
- Screenshots at 1440×900, 1280, 390×844 and 360×780 reviewed against DESIGN.md.
- `PRODUCT.md`, the surface brief and `DESIGN.md` figures updated to match.
- One PR, merged and deployed only after John has reviewed the page.

## 10. Decisions

Decided by John, 2026-11-10:
1. **Listings:** all eight current listings stay; the new waterfront sights get their own section ("On the water").
2. **Coverline:** "Toronto, to scale." stays; Eglinton goes in the dek, the numbers and Corrections.
3. **High Park:** its own section ("The park").
4. **st-bz1o.8:** fix it first, then ship the refresh with the Cinesphere and Sugar Beach links working on desktop.

Decided by John, 2026-11-26: a full refresh, not pictures only ("things have changed so much").

Open: trees "placed" or "in the inventory". Default used: **placed** (what the visitor sees).
