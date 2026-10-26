// tools/fetch-bikeshare.mjs — downloads Bike Share Toronto's station list (GBFS station_information: every station's
// position, capacity and name) into the raw cache, for tools/geo-bikeshare.mjs. The feed's address comes from the City's
// "Bike Share Toronto" dataset on Toronto Open Data (Open Government Licence – Toronto): its bike-share-json resource is
// the system's GBFS discovery file, which lists station_information & station_status. The live station_status is not
// stored: js/bike-share.js reads it in the browser.
// usage: node tools/fetch-bikeshare.mjs   (writes $PROPS_DATA or ~/.cache/slop-toronto/raw/bike-share-*.json)
import fs from 'node:fs';
import path from 'node:path';

const RAW = process.env.PROPS_DATA || path.join(process.env.HOME, '.cache/slop-toronto/raw');
const CKAN = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=bike-share-toronto';
// the discovery file the dataset pointed at on 2026-10-25 (used if the portal is down: it answered 502 that day)
const FALLBACK = 'https://tor.publicbikesystem.net/ube/gbfs/v1/';

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

let discovery, discoveryUrl;
try {
  const pkg = (await json(CKAN)).result;
  const res = pkg.resources.find((r) => r.name === 'bike-share-json');
  discoveryUrl = res.url;
  discovery = await json(discoveryUrl);
} catch (e) {
  console.warn(`[bikeshare] the open data portal failed (${e.message}); using ${FALLBACK}`);
  discoveryUrl = FALLBACK;
  discovery = await json(FALLBACK);
}
const feeds = Object.fromEntries((discovery.data.en || Object.values(discovery.data)[0]).feeds.map((f) => [f.name, f.url]));
const infoUrl = feeds.station_information, statusUrl = feeds.station_status;
if (!infoUrl || !statusUrl) throw new Error('the GBFS discovery lists no station_information / station_status');
const info = await json(infoUrl);
fs.mkdirSync(RAW, { recursive: true });
fs.writeFileSync(path.join(RAW, 'bike-share-station-information.json'), JSON.stringify(info));
fs.writeFileSync(path.join(RAW, 'bike-share-gbfs.json'), JSON.stringify({ discoveryUrl, infoUrl, statusUrl, fetched: new Date().toISOString() }));
console.log(`[bikeshare] ${info.data.stations.length} stations (feed of ${new Date(info.last_updated * 1000).toISOString()}) from ${infoUrl}`);
