// tools/build-patios.mjs: the prebuilt CaféTO patio layout (st-cmf), from what js/patio-layout.js placed in the browser.
// The layout's inputs include what exists only once the city is built (the solid colliders of buildings, landmarks,
// poles and furniture; the laid-out benches, pay stations and signs; the City sidewalk pieces), so it is computed by the
// page itself, on the GPU runner like any capture, and recorded:
//   gpu2 <name> -- env CAPTURE_TAG=patios CAPTURE_QUERY='?patios=layout' node tools/capture.mjs tools/shots/patio-layout.json
//   node tools/build-patios.mjs <review dir>/patios-patio-layout.json
// It writes, deterministically (the same record gives the same bytes):
// - js/toronto-patios.js (window.CITY.PATIOS, loaded by the page): the placed sites (the fields js/cafeto-patios.js
//   builds them from, exact), the rejection and blocker counts, and the fingerprint of the runtime inputs, which the page
//   checks at startup before trusting the sites
// - tools/data/patio-inputs.json (not shipped): what node cannot rebuild (the colliders the layout met, the furniture near
//   the cafés), every record's rejection reason, the SHA-256 of the data scripts it was built from, and the fingerprints
//   of what node can rebuild of the colliders from the code as well (the flyover decks and the mapped poles near the
//   cafés, tools/patio-replay.mjs patioDerivedInputs)
// Before writing, it replays the layout in node (tools/patio-replay.mjs) and refuses a record the replay does not
// reproduce exactly. tests/cafeto.test.mjs repeats both checks, so the prebuilt layout cannot drift from its inputs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReplayWorld, replayPatios, patioDerivedInputs } from './patio-replay.mjs';
import { PATIO_FRAMES, frameFile } from './cafeto-world.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PATIOS_JS = 'js/toronto-patios.js';
export const PATIO_INPUTS = 'tools/data/patio-inputs.json';
// Each map has its own layout (st-3cbb): another frame's sidewalks, buildings and Bike Share near the cafés are its own,
// so the detail frame's fingerprint never matched the Eglinton frame's city, and the default desktop map laid the patios
// out at startup. `--frame eglinton` records that frame's layout into its own files, loaded by explore.html ?map=eglinton.
export const patioFiles = (frame = PATIO_FRAMES.detail) => frame.bin
  ? { js: `js/frames/${frame.name}/toronto-patios.js`, inputs: `tools/data/frames/${frame.name}/patio-inputs.json` }
  : { js: PATIOS_JS, inputs: PATIO_INPUTS };
// The data scripts the layout reads, directly or through the colliders and furniture it meets: a change to any of them
// means a new layout (the replay covers the direct ones; the hashes cover the rest)
export const SOURCES = ['js/toronto-geodata.js', 'js/toronto-sidewalks.js', 'js/toronto-poles.js', 'js/toronto-cafeto.js',
  'js/toronto-benches.js', 'js/toronto-parking-meters.js', 'js/toronto-wayfinding.js', 'js/bike-share-stations.js',
  'js/toronto-transit.js', 'js/toronto-subway.js', 'js/toronto-traffic-data.js', 'js/toronto-landmarks.js'];

// (keyed by the frame's own files: another frame's binary stands for its geodata and its poles)
export const sourceHashes = (root = ROOT, frame = PATIO_FRAMES.detail) => Object.fromEntries([...new Set(SOURCES.map((rel) => frameFile(frame, rel)))]
  .map((rel) => [rel, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex').slice(0, 16)]));

// object keys sorted, for stable bytes
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** A dump (CITY.patioLayoutDump) -> { js, inputs } file contents; throws unless node's replay reproduces it */
export function buildPatios(dump, { root = ROOT, frame = PATIO_FRAMES.detail, world = loadReplayWorld(root, frame) } = {}) {
  const { CITY } = world;
  if (JSON.stringify(dump.fields) !== JSON.stringify(CITY.PATIO_SITE_FIELDS)) throw new Error('build-patios: the record\'s site fields are not js/cafeto-patios.js\'s');
  for (const k of ['colliders', 'furniture', 'bikeShare', 'sidewalks']) {
    if (!/^\d+:[0-9a-f]{16}$/.test(dump.fingerprint?.[k] || '')) throw new Error(`build-patios: the record has no ${k} fingerprint`);
  }
  const replay = replayPatios(world, dump.replay);
  for (const k of ['sites', 'rejected', 'blockers', 'reasons']) {
    const a = JSON.stringify(k === 'sites' ? dump[k] : sortKeys(dump[k])), b = JSON.stringify(k === 'sites' ? replay[k] : sortKeys(replay[k]));
    if (a !== b) throw new Error(`build-patios: node's replay of the layout gives other ${k} than the browser recorded: ` +
      'the committed data scripts are not the ones the page ran, or the record is incomplete');
  }
  const PATIOS = {
    generator: 'tools/build-patios.mjs (js/patio-layout.js in the browser, ?patios=layout)',
    fingerprint: sortKeys(dump.fingerprint),
    rejected: dump.rejected,
    blockers: dump.blockers,
    fields: dump.fields,
    sites: dump.sites
  };
  const js = `// ${patioFiles(frame).js} — GENERATED by tools/build-patios.mjs${frame.bin ? ` --frame ${frame.name}` : ''}, do not edit by hand. The CaféTO patios as\n` +
    (frame.bin ? `// placed on the ${frame.name} map (explore.html ?map=${frame.name}, its own city data): ` +
      'js/toronto-patios.js is the detail map\'s.\n' : '') +
    '// js/patio-layout.js placed them with the built city\'s inputs (docs/cafeto-patios.md): each site\'s `fields`, the\n' +
    '// rejection & blocker counts, and the fingerprint of the runtime inputs js/cafeto-patios.js checks before using them.\n' +
    '// Source: City of Toronto Open Data, CaféTO Locations (Open Government Licence – Toronto), js/toronto-cafeto.js.\n' +
    `(function () {\nwindow.CITY = window.CITY || {};\nwindow.CITY.PATIOS = ${JSON.stringify(PATIOS)};\n})();\n`;
  const inputs = {
    note: 'tools/build-patios.mjs: what node replays js/patio-layout.js with (tests/cafeto.test.mjs). Not shipped.',
    sources: sourceHashes(root, frame),
    derived: patioDerivedInputs(world, root),
    reasons: sortKeys(dump.reasons),
    furniture: dump.replay.furniture.map(({ x, z, kind }) => ({ x, z, kind })),
    colliders: dump.replay.colliders
  };
  return { js, inputs: JSON.stringify(inputs) + '\n', PATIOS };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--frame');
  const name = at >= 0 ? args.splice(at, 2)[1] : 'detail', frame = PATIO_FRAMES[name], file = args[0];
  if (!file || !frame) throw new Error('usage: node tools/build-patios.mjs <patio-layout.json recorded by tools/shots/patio-layout.json> ' +
    `[--frame ${Object.keys(PATIO_FRAMES).join('|')}] (the map the record was made on, ?map=)`);
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { js, inputs, PATIOS } = buildPatios(dump, { frame });
  const out = patioFiles(frame);
  for (const [rel, bytes] of [[out.js, js], [out.inputs, inputs]]) {
    fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, rel), bytes);
  }
  const kinds = PATIOS.sites.reduce((m, s) => ((m[s[1]] = (m[s[1]] || 0) + 1), m), {});
  console.log(`[patios] ${out.js}: ${PATIOS.sites.length} sites ${JSON.stringify(kinds)} (${js.length} bytes); ` +
    `${out.inputs}: ${dump.replay.colliders.length} colliders, ${dump.replay.furniture.length} furniture; node's replay is identical`);
}
