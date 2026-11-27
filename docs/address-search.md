# Address and place search

The search box, full map and directions share the same suggestions. The
map's landmarks, streets, neighbourhoods and places appear first. Crossings
such as “Queen and Spadina” match a shared node on the street graph. Pick a
place to open its card, then choose **Go there** to arrive on its street in
your current travel mode. The full map also pans to the selection. A resolved
address marks the building footprint when one is available, or shows a pin.

Numbered queries use the City's [municipal address points](https://open.toronto.ca/dataset/address-points-municipal-toronto-one-address-repository/).
Each street name uses one of 256 files. For duplicate addresses, the list
shows the former municipalities so visitors can distinguish them. If an
exact number is unavailable, the list labels the nearby number it found.
Addresses outside the active frame are marked **Outside the map** and
cannot be selected. Each address uses the active frame's WGS84 projection.

A weak place search can call `/live/geocode` after 400 ms or on Enter. The
Worker queries Cesium ion's default geocoder, Microsoft Bing. It accepts
same-origin browser requests, limits requests per IP and per Cloudflare
location, and stops asking for one hour if the provider returns 403 or 429.
The Worker filters results by the City's municipal boundary and query words.
Geocoded addresses from a place search use the nearest matching City point
when it is within 300 m of the provider's result. Postal codes show a pin.

Provider results stay in the active suggestions or selection. Successful
and unsuccessful responses carry `Cache-Control: no-store`. The Worker
does not save provider content. A search can still return no matches,
particularly for businesses the provider does not recognize.

## Rebuild and deploy

The sharded address files are committed and included automatically in the
site build. To refresh them, obtain the City CSV with WGS84 geometry and
`MUNICIPALITY`, then run:

```sh
node tools/search/city-addresses.mjs /path/to/address-points-4326.csv
```

The 2026-11-05 export has 525,262 records. The build retains 523,912 distinct
street, number and municipality combinations. Coordinates are rounded to
six decimal places. The City boundary is the Regional Municipal Boundary
simplified to 25 m. Both datasets use the Open Government Licence – Toronto.

For a deployment using the fallback, supply `ION_GEOCODE_TOKEN` as a
Worker secret with geocode scope. The two rate limit bindings live in
`wrangler.jsonc`. City address and map searches work independently of the
token. See the [credits](../CREDITS.md#address-and-place-search) and run
`node --test tests/geocode.test.mjs tests/navigation.test.cjs` for the
search checks.
