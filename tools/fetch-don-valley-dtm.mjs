// tools/fetch-don-valley-dtm.mjs — downloads the bare-earth lidar DTM tiles under the Don Valley terrain pilot
// (docs/don-valley-terrain.md) into ~/.cache/slop-toronto/raw/ontario-dtm-gta2023 (raw data stays out of git).
//
// Source: Ontario Elevation Mapping Program, "GTA 2023" lidar project, Digital Terrain Model (bare earth), 0.5 m,
// 1 km tiles on NAD83(CSRS) / UTM zone 17N (EPSG:2958), heights in metres above CGVD2013 (EPSG:6647). Served by the
// Ontario GeoHub image service Elevation/Ontario_DTM_LidarDerived. Each tile is exported at its own grid (lock raster,
// nearest neighbour, 2000 x 2000 px over its 1 km): the tile's own pixels, not a resampling.
// Licence: Open Government Licence – Ontario (https://www.ontario.ca/page/open-government-licence-ontario); attribution
// in CREDITS.md. The City of Toronto's own open "Triangular Irregular Network (TIN)" is derived from the same 2023 lidar
// at 2.5 m, as polygons carrying only an average elevation; the provincial raster is that lidar at its full resolution.
//
// Writes <tile>.tif (Deflate-compressed float32 GeoTIFF) and manifest.json (tiles, their catalogue ids, bounds, sha256,
// retrieval date). Existing tiles are kept unless --force.
// usage: node tools/fetch-don-valley-dtm.mjs [--force]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT = process.env.DON_VALLEY_DTM || path.join(os.homedir(), '.cache/slop-toronto/raw/ontario-dtm-gta2023');
const SERVICE = 'https://ws.geoservices.lrc.gov.on.ca/arcgis5/rest/services/Elevation/Ontario_DTM_LidarDerived/ImageServer';
const PROJECT = 'GTA 2023';
// The pilot's working grid (tools/build-don-valley.mjs: the box grown by 600 m) in WGS84, plus a little
const ENVELOPE = { west: -79.3825, south: 43.6585, east: -79.3435, north: 43.6905 };
const force = process.argv.includes('--force');

async function json(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const d = await r.json();
      if (d.error) throw new Error(JSON.stringify(d.error));
      return d;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * attempt));
    }
  }
}
async function bytes(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * attempt));
    }
  }
}

fs.mkdirSync(OUT, { recursive: true });
const q = new URLSearchParams({
  where: `Project='${PROJECT}' AND Category=1`, geometry: `${ENVELOPE.west},${ENVELOPE.south},${ENVELOPE.east},${ENVELOPE.north}`,
  geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
  outFields: 'OBJECTID,TileName,Project,Resolution_m,HorizontalAccuracy_m,VerticalAccuracyClass,StartYear,EndYear', returnGeometry: 'false', f: 'json'
});
const items = (await json(`${SERVICE}/query?${q}`)).features.map((f) => f.attributes).sort((a, b) => a.TileName.localeCompare(b.TileName));
if (!items.length) throw new Error('no GTA 2023 DTM tiles under the pilot');
const tiles = [];
for (const it of items) {
  const info = await json(`${SERVICE}/${it.OBJECTID}/info?f=json`);
  const { xmin, ymin, xmax, ymax } = info.extent, px = info.pixelSizeX;
  const wkid = info.extent.spatialReference.latestWkid;
  const w = Math.round((xmax - xmin) / px), h = Math.round((ymax - ymin) / px);
  const file = `${it.TileName}.tif`, dest = path.join(OUT, file);
  if (force || !fs.existsSync(dest)) {
    const p = new URLSearchParams({
      bbox: `${xmin},${ymin},${xmax},${ymax}`, bboxSR: String(wkid), imageSR: String(wkid), size: `${w},${h}`, format: 'tiff', pixelType: 'F32',
      compression: 'LZ77', interpolation: 'RSP_NearestNeighbor', noDataInterpretation: 'esriNoDataMatchAny',
      mosaicRule: JSON.stringify({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [it.OBJECTID] }), f: 'json'
    });
    const out = await json(`${SERVICE}/exportImage?${p}`);
    if (out.width !== w || out.height !== h) throw new Error(`${file}: exported ${out.width} x ${out.height}, wanted ${w} x ${h}`);
    fs.writeFileSync(dest, await bytes(out.href));
    console.log(`[dtm] ${file} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
  }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  tiles.push({ file, objectId: it.OBJECTID, tile: it.TileName, crs: `EPSG:${wkid}`, verticalCrs: `EPSG:${info.extent.spatialReference.latestVcsWkid ?? 6647}`,
    bounds: [xmin, ymin, xmax, ymax], pixelM: px, width: w, height: h, resolutionM: it.Resolution_m, horizontalAccuracyM: it.HorizontalAccuracy_m,
    verticalAccuracyClass: it.VerticalAccuracyClass, year: it.EndYear, sha256 });
}
const manifest = {
  dataset: `Ontario Elevation Mapping Program, ${PROJECT} lidar, Digital Terrain Model (bare earth)`,
  service: SERVICE, licence: 'Open Government Licence – Ontario', licenceUrl: 'https://www.ontario.ca/page/open-government-licence-ontario',
  attribution: 'Contains information licensed under the Open Government Licence – Ontario.',
  crs: 'NAD83(CSRS) / UTM zone 17N (EPSG:2958)', vertical: 'CGVD2013 (EPSG:6647), metres', envelopeWgs84: ENVELOPE,
  retrieved: new Date().toISOString().slice(0, 10), tiles
};
// (a rerun that changes nothing keeps the first retrieval date)
const mf = path.join(OUT, 'manifest.json');
if (fs.existsSync(mf)) {
  const old = JSON.parse(fs.readFileSync(mf, 'utf8'));
  if (JSON.stringify(old.tiles) === JSON.stringify(tiles)) manifest.retrieved = old.retrieved;
}
fs.writeFileSync(mf, `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`[dtm] ${tiles.length} tiles in ${OUT}`);
