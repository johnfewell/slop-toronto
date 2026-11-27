// Build the citywide address shards from the City's municipal address point CSV (WGS84).
// Usage: node tools/search/city-addresses.mjs <address-points-4326.csv> [output-directory]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { key } from '../../js/search-text.js';
import { AREAS, shardOf } from '../../js/search-geocode.js';

const [csv, out = 'assets/geocoder/addresses'] = process.argv.slice(2);
if (!csv) throw new Error('Pass the City address point CSV as the first argument');

function parseCsvLine(line) {
  const out = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') value += c;
      else if (line[i + 1] === '"') { value += '"'; i++; }
      else quoted = false;
    } else if (c === ',') {
      out.push(value);
      value = '';
    } else if (c === '"') quoted = true;
    else value += c;
  }
  out.push(value);
  return out;
}

const shards = Array.from({ length: 256 }, () => new Map());
const rl = readline.createInterface({ input: fs.createReadStream(csv), crlfDelay: Infinity });
const areas = { TO: 'Old Toronto', EY: 'East York', ET: 'Etobicoke', NY: 'North York', SC: 'Scarborough', YK: 'York' };
let hdr, n = 0, kept = 0;
for await (const line of rl) {
  const f = parseCsvLine(line);
  if (!hdr) {
    hdr = Object.fromEntries(f.map((h, i) => [h, i]));
    for (const field of ['ADDRESS_NUMBER', 'LINEAR_NAME_FULL', 'MUNICIPALITY', 'geometry']) {
      if (!(field in hdr)) throw new Error(`Missing column: ${field}`);
    }
    continue;
  }
  n++;
  const m = /\[\[\s*(-?[\d.]+),\s*(-?[\d.]+)\]/.exec(f[hdr.geometry]);
  const num = f[hdr.ADDRESS_NUMBER]?.trim().toLowerCase().replace(/\s+/g, '~');
  const name = f[hdr.LINEAR_NAME_FULL]?.trim();
  const area = AREAS.indexOf(areas[f[hdr.MUNICIPALITY]]);
  if (!m || !num || num === 'none' || !name || name === 'None' || area < 0) continue;
  const streetKey = key(name);
  if (!streetKey) continue;
  const sh = shards[shardOf(streetKey)];
  let street = sh.get(streetKey);
  if (!street) sh.set(streetKey, street = { name, points: new Map() });
  const addressKey = `${num}:${area}`;
  if (street.points.has(addressKey)) continue;
  street.points.set(addressKey, [num, Math.round(+m[2] * 1e6), Math.round(+m[1] * 1e6), area].join(' '));
  kept++;
}
if (!kept || kept < n * 0.95) throw new Error(`Unexpected coverage: ${kept} distinct addresses for ${n} rows`);
fs.mkdirSync(out, { recursive: true });
let bytes = 0;
for (let i = 0; i < shards.length; i++) {
  const s = Object.fromEntries([...shards[i]].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, street]) =>
    [k, { name: street.name, points: [...street.points.values()].join(',') }]));
  const data = JSON.stringify({ v: 1, s });
  fs.writeFileSync(path.join(out, i.toString(16).padStart(2, '0') + '.json'), data);
  bytes += Buffer.byteLength(data);
}
console.log(`${n} address points, ${kept} distinct addresses, 256 shards, ${bytes} bytes`);
