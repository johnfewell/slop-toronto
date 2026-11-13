# The TTC timetable behind the city's transit (`st-uzvg.13`)

The streetcars, buses and subway trains run on the TTC's timetable: "Merged GTFS - TTC Routes and Schedules", City of
Toronto Open Data, Open Government Licence – Toronto. `tools/build-transit.mjs` turns it into `js/toronto-transit.js`
(routes, stopping patterns, stops, trips per hour on a Wednesday). Everything that reads that file is rebuilt with it
(below).

## Which edition, and where it is read from

`data/shared-toronto-data-pin.json` names the edition the committed files were built from, under
`datasets["ttc-gtfs-static"]`: its `feed_info` version (`edition`), the SHA-256 of its zip, the date the City
published it, and the feed's start and end dates. It holds no paths.

- **With `TORONTO_DATA_CACHE` set** (the shared Toronto data repo's cache root), the transit tools read the pinned
  edition from `<cache>/raw/ttc-gtfs-static/<edition>/feed`. They stop if it is missing, or if its zip's SHA-256 is
  not the pinned one.
- **Without it,** they read this repo's own download, `~/.cache/slop-toronto/gtfs/feed` (`node tools/fetch-gtfs.mjs`),
  as before. The public snapshot builds this way, without the shared repo.
  - **The download must be the pinned edition.** The tools compare the download's zip with the pin's SHA-256. With no
    zip, they compare the date in its `SOURCE.json` with the pin's publish date. If it is any other edition, they stop,
    and the message names the edition found, the edition pinned, and the ways out.
  - **An older download** (for example September's, left in the cache): set `TORONTO_DATA_CACHE`, or run
    `node tools/fetch-gtfs.mjs` to download the current feed.
  - **A newer download** (the portal moved on after the pin) **also stops**, by choice. The committed transit files
    are always the pinned edition's, and a new edition needs its shape review and the full rebuild order below. A
    warning would let a build quietly turn out other bytes under the old pin. The ways out: move the pin and rebuild
    (the steps below), set `TORONTO_DATA_CACHE` to build the pinned edition, or pass the feed folder as an argument to
    build from that edition on purpose.
- **A feed folder given on the command line** wins over both, unchecked.

`tools/ttc-feed.mjs` does the choosing, for `tools/build-transit.mjs` and `tools/check-geodata-ids.mjs`.

Since 2026-11-12 the pin is `S1000544` (published 2026-11-04, service 2026-11-01 to 2026-12-19). The edition before,
`S1000542`, expired on 2026-10-31. Through the shared path it rebuilt every output below byte-identical to the
committed files before the pin moved.

## Rebuilding after a new edition

In this order, with the edition pinned:

1. `node tools/build-transit.mjs`. A shape that calls at the same stops as another of its pattern but strays more than
   20 m from it stops the build until it is reviewed in `tools/data/transit-variants.json`
   ([geodata-ids.md](geodata-ids.md)).
2. `node tools/build-subway-topology.mjs`.
3. The Eglinton map's pair:
   `node tools/frames/build-frame.mjs --frame tools/frames/eglinton.json --out <dir> --force transit,subway-topology --skip massing-bin --install`
   ([map-scale-measurements.md](map-scale-measurements.md)). Use a copy of the frame's build folder, so a shared one
   keeps its edition.
4. The CaféTO patios on both maps, recorded on the Mac mini ([cafeto-patios.md](cafeto-patios.md)). The layout
   fingerprints the transit file and keeps clear of its stops.
5. `node tools/build-parked-cars.mjs`. Stalls keep clear of the TTC's stops. It repacks `data/toronto-geodata.bin`
   and sets its hash in `explore.html`; never edit or merge the binary by hand.
6. `npm test`, and `tools/check-geodata-ids.mjs` (it needs the raw downloads).

## What `S1000544` changed

These are from the timetable itself; the reason and end date of a diversion are not in the feed.

**501 Queen and 301.**
- The streetcars run Queen, then north on Broadview and east along Gerrard, instead of along Queen St East from
  Broadview.
- A new 501B replacement bus runs on Queen between York St and Kingston Rd.
- This is a diversion: the replacement bus runs on the old streetcar path (median 0 m from it), and the streetcars run
  on other routes' track.
- Streetcar trips are about the same, 125 a Wednesday eastbound against 121. The 501B buses add 126.

**504 King and 304.**
- The 504A and 504B patterns are replaced by one streetcar pattern, Dundas West Station to Broadview Station. Between
  Roncesvalles and Spadina it runs on the Queen track, 380 m from King.
- A 504C replacement bus runs on King, Roncesvalles to Distillery.
- This is a diversion, for the same reasons as the 501.

**503 Kingston Rd.** Still a replacement bus. It now starts at Dufferin Gate, not York St.

**512 St Clair and 312.** The 512B bus west of Lansdowne is gone: the streetcars run the whole route again, Gunns Loop
to St Clair Station (Eglinton map).

**Other streetcars.**
- 505 Dundas and 510 Spadina: the same paths with more trips (505 eastbound 160 to 203 a Wednesday).
- 506 Carlton, 509 Harbourfront, 511 Bathurst, 306 and 310: unchanged (506B bus stops one fewer).
- 305 night: changes its patterns.

**Every streetcar path is on OpenStreetMap tram track** (`GEO.rails`), and the page routes every one through the
track graph (none "snapped").

**One shape review.** 11 Bayview southbound, on the Eglinton map: a second shape into Davisville Station, reviewed as
one pattern.

**Stops.** 908 in the detail map, from 919. 28 stop ids were reused by the TTC for other places, most of them
renumbered parent-station nodes. None of them is in this city's data except one at its new place (43271, Kingston Rd
at Victoria Park, Eglinton map), and nothing here keys on a stop id from another edition.

**Parked cars.** 14,891 stalls and 11,042 cars, from 14,857 and 11,012.
