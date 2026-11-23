#!/usr/bin/env node
// tools/house-outline-width.mjs — how many house outlines have no party wall and how wide they are (the count the
// addendum to st-ndw9.2 quotes; docs/building-era-sources.md section 7). A house outline is kind 0 in GEO.buildings;
// its party walls are the massing sidecar's partyN column (js/massing-data.js), keyed by the durable ID.
// usage: node tools/house-outline-width.mjs [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadGeo, loadMassing } from './building-era-frame.mjs';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingId } from '../js/massing-data.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { values: opt } = parseArgs({ options: { json: { type: 'string' } } });

const G = loadGeo();
const outlines = await loadMassing(G);
const { MASSING } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
const party = new Map();
for (let i = 0; i < MASSING.fid.length; i++) party.set(massingId(MASSING, i), MASSING.partyN[i]);

let houses = 0, noParty = 0;
const widths = [];
for (const o of outlines) {
  if (G.buildings[o.row][5] !== 0) continue;
  houses++;
  if (!(party.get(o.id) || 0)) noParty++;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of o.rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  widths.push(Math.min(x1 - x0, z1 - z0));
}
widths.sort((a, b) => a - b);
const out = {
  houseOutlines: houses,
  noPartyWall: noParty,
  share: +(100 * noParty / houses).toFixed(1),
  medianNarrowSideM: +widths[Math.floor(widths.length / 2)].toFixed(2),
};
if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
