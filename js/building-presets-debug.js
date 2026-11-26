// js/building-presets-debug.js — the ?massing=1&presets=debug view's legend and identify panel (st-ndw9.11). Loaded
// only when the page's presets flag is exactly 'debug' (js/main.js), and it fetches its own small file
// (data/toronto-building-presets-debug.bin), so the default page and ?presets=1 never load or fetch either.
//
// The legend lists every preset's debug colour, name and building count, grouped by family, in a collapsible panel
// that uses the page's own .panel styling. The identify panel shows one building's preset name, durable id, form,
// dwellings, use class, how its era was chosen and its neighbourhood name — the facts come from the presets file
// (data/toronto-building-presets.bin, already loaded) and this module's own file. Identify is a key press ('I') at the
// screen centre: clicking the canvas is the game's (drag to look), so a key is used instead.
import { unpackGeo } from './geodata-loader.js';
import { builtFor } from './building-presets.js';
import { PROTOTYPES, byId, FALLBACK_ID } from './building-prototypes.js';

export const DEBUG_URL = './data/toronto-building-presets-debug.bin?v=f5fc00422ed0'; // (tools/build-building-presets.mjs sets the hash)
export const DEBUG_SCHEMA = 2; // (st-ndw9.16: adds the place-of-worship columns)

const hex = (c) => `#${(c >>> 0).toString(16).padStart(6, '0')}`;

// --- the analytic pick: the building under the view ray. Pure, so the tests can run it in node. -----------------------
/** Point in a ring (x, z), even-odd. */
function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** The ray (origin o, direction d) entering a building slab (base..top, inside the outer ring), or null. */
function raySlabHit(o, d, ring, base, top) {
  let t0 = 0, t1 = Infinity;
  if (Math.abs(d.y) < 1e-9) { if (o.y < base || o.y > top) return null; }
  else {
    let ta = (base - o.y) / d.y, tb = (top - o.y) / d.y;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (t1 < t0) return null;
  const dx = d.x, dz = d.z;
  if (dx * dx + dz * dz < 1e-12) return pointInRing(o.x, o.z, ring) ? t0 : null;
  const n = ring.length, ts = [];
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    const ex = xi - xj, ez = zi - zj;
    const denom = dx * ez - dz * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const rx = xj - o.x, rz = zj - o.z;
    const t = (rx * ez - rz * ex) / denom;
    const u = (rx * dz - rz * dx) / denom;
    if (t >= 0 && u >= 0 && u <= 1) ts.push(t);
  }
  if (!ts.length) return null;
  ts.sort((a, b) => a - b);
  const lo = Math.max(t0, ts[0]), hi = Math.min(t1, ts.length > 1 ? ts[1] : Infinity);
  return lo <= hi ? lo : null;
}
/** The nearest massing GEO row the ray enters, or null. */
export function pickMassing(massing, GEO, o, d) {
  if (!massing || !(massing.rows instanceof Map) || massing.error) return null;
  let bestT = Infinity, bestRow = -1;
  for (const [row, rec] of massing.rows) {
    const ring = rec.rings && rec.rings[0];
    if (!ring || ring.length < 3) continue;
    const b = GEO.buildings[row];
    if (!b) continue;
    const base = rec.base || 0, top = (b[4] || 0) + base;
    const t = raySlabHit(o, d, ring, base, top);
    if (t != null && t < bestT) { bestT = t; bestRow = row; }
  }
  return bestRow < 0 ? null : bestRow;
}

// --- the debug file ---------------------------------------------------------------------------------------------------
/** Validates the debug file against the loaded presets and sidecar; returns the DEBUG layer or throws. */
export async function readDebugFile(buffer, massing, geo) {
  const { DEBUG } = await unpackGeo(buffer);
  if (!DEBUG || DEBUG.schema !== DEBUG_SCHEMA) throw new Error(`debug file schema ${DEBUG && DEBUG.schema}, not ${DEBUG_SCHEMA}`);
  if (!massing || massing.error || !(massing.rows instanceof Map)) throw new Error('no usable massing sidecar is loaded');
  if (DEBUG.records !== massing.records || DEBUG.rowCheck !== builtFor(massing, geo)) throw new Error(`debug file built for another sidecar (${DEBUG.records} records, rowCheck ${DEBUG.rowCheck})`);
  return DEBUG;
}

// --- the panel --------------------------------------------------------------------------------------------------------
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

/** Per-preset building counts: the preset file is per record; every record of a group shares one preset. */
function countByPreset(DEBUG, ids, preset) {
  const groupPreset = new Uint8Array(DEBUG.groups);
  for (let i = 0; i < DEBUG.groupOfRecord.length; i++) groupPreset[DEBUG.groupOfRecord[i]] = preset[i];
  const counts = new Array(ids.length).fill(0);
  for (let g = 0; g < DEBUG.groups; g++) counts[groupPreset[g]]++;
  return counts;
}

const ERA_LABEL = { 0: 'year', 1: 'neighbourhood', 2: 'fallback', 3: '—' };

/** Builds the legend and the identify panel and mounts them; returns the root element. */
export function buildPanel(DEBUG, ids, preset) {
  const counts = countByPreset(DEBUG, ids, preset);
  const root = el('div', 'hud hud-preset-debug');
  const panel = el('details', 'panel preset-legend');
  panel.open = true;
  const summary = el('summary', 'preset-legend-head', `Preset colours (debug) · ${DEBUG.groups.toLocaleString('en-CA')} buildings`);
  panel.appendChild(summary);
  const body = el('div', 'preset-legend-body');
  // grouped by family, in catalogue order
  const families = [];
  const byFamily = new Map();
  PROTOTYPES.forEach((p, i) => {
    if (!byFamily.has(p.family)) { byFamily.set(p.family, []); families.push(p.family); }
    byFamily.get(p.family).push([p, i]);
  });
  for (const family of families) {
    const group = el('div', 'preset-family');
    group.appendChild(el('div', 'preset-family-name', family));
    for (const [p, i] of byFamily.get(family)) {
      const row = el('div', 'preset-row');
      const sw = el('span', 'preset-swatch');
      sw.style.background = hex(p.color);
      row.appendChild(sw);
      row.appendChild(el('span', 'preset-name', p.name));
      row.appendChild(el('span', 'preset-count', counts[i].toLocaleString('en-CA')));
      group.appendChild(row);
    }
    body.appendChild(group);
  }
  panel.appendChild(body);
  const identify = el('div', 'panel preset-identify');
  identify.id = 'preset-identify';
  identify.textContent = 'Press I while looking at a building to identify it.';
  root.appendChild(panel);
  root.appendChild(identify);
  return root;
}

const fmt = (n) => Number(n).toLocaleString('en-CA');

/** The identify card's lines for one massing GEO row. */
export function identifyFacts(DEBUG, GEO, massing, ids, preset, row, fallbackEra = 'postwar') {
  const rec = massing.rows.get(row);
  if (!rec) return null;
  const g = DEBUG.groupOfRecord[rec.index];
  const id = rec.id;
  const proto = byId[ids[preset[rec.index]]] || byId[FALLBACK_ID];
  const nb = DEBUG.nb[g];
  const nbName = (DEBUG.nbNames && DEBUG.nbNames[nb]) || `neighbourhood ${nb}`;
  let era;
  const kind = DEBUG.era[g];
  if (kind === 0) era = `own year ${DEBUG.eraYear[g]} (a source dates it)`;
  else if (kind === 1) { const w = DEBUG.draft && DEBUG.draft[nb]; era = `from ${nbName}'s split${w ? ` (${w.join(' / ')})` : ''}`; }
  else if (kind === 2) era = `neighbourhood not in the draft (fallback ${fallbackEra})`;
  else era = '— (this type has no period)';
  if (DEBUG.run[g]) era += ' · given its row\'s era';
  // (st-ndw9.16: a place of worship's name, religion and tradition, where buildings/4 has them)
  const religion = DEBUG.religionNames && DEBUG.religion[g] >= 0 ? DEBUG.religionNames[DEBUG.religion[g]] : null;
  const tradition = DEBUG.traditionNames && DEBUG.tradition[g] >= 0 ? DEBUG.traditionNames[DEBUG.tradition[g]] : null;
  const worshipYear = DEBUG.worshipYear && DEBUG.worshipYear[g] ? DEBUG.worshipYear[g] : null;
  return {
    preset: proto.name, presetId: proto.id, id,
    form: DEBUG.formNames[DEBUG.form[g]], dwellings: DEBUG.dwellings[g],
    use: DEBUG.useNames[DEBUG.use[g]], era, neighbourhood: nbName,
    name: (DEBUG.names && DEBUG.names[g]) || '', religion, tradition, worshipYear
  };
}

/** Renders the facts into the identify card. */
export function renderIdentify(node, facts) {
  node.textContent = '';
  if (!facts) { node.textContent = 'No building under the view centre.'; return; }
  const title = el('div', 'preset-identify-title');
  const sw = el('span', 'preset-swatch');
  sw.style.background = hex((byId[facts.presetId] || {}).color || 0);
  title.appendChild(sw);
  title.appendChild(el('span', null, facts.preset));
  node.appendChild(title);
  const rows = [];
  // (st-ndw9.16: a place of worship leads with where it worships)
  if (facts.name) rows.push(['name', facts.name]);
  if (facts.religion) rows.push(['religion', facts.religion]);
  if (facts.tradition) rows.push(['tradition', facts.tradition]);
  rows.push(['durable id', facts.id], ['form', facts.form], ['dwellings', fmt(facts.dwellings)],
    ['use class', facts.use], ['era', facts.era], ['neighbourhood', facts.neighbourhood]);
  if (facts.worshipYear) rows.push(['worship year', facts.worshipYear]);
  for (const [k, v] of rows) {
    const r = el('div', 'preset-identify-row');
    r.appendChild(el('span', 'preset-identify-key', k));
    r.appendChild(el('span', 'preset-identify-val', String(v)));
    node.appendChild(r);
  }
}

/** Fetches the debug file, builds the panel and wires the identify key. Called only in debug mode. */
export async function mountBuildingPresetsDebug({ cameraSystem, massing, geo, presets, url = DEBUG_URL }) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`presets debug: ${res.url}: HTTP ${res.status}`);
  const DEBUG = await readDebugFile(await res.arrayBuffer(), massing, geo);
  const panel = buildPanel(DEBUG, presets.ids, presets.preset);
  document.body.appendChild(panel);
  const node = panel.querySelector('#preset-identify');
  const THREE = window.CITY.THREE;
  const origin = new THREE.Vector3(), dir = new THREE.Vector3();
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'i' && e.key !== 'I') return;
    if (window.CITY.isTypingInField && window.CITY.isTypingInField(e)) return;
    const cam = cameraSystem && cameraSystem.camera;
    if (!cam) return;
    cam.getWorldPosition(origin);
    cam.getWorldDirection(dir);
    const row = pickMassing(massing, geo, { x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    renderIdentify(node, row == null ? null : identifyFacts(DEBUG, geo, massing, presets.ids, presets.preset, row));
  });
  return { DEBUG, panel };
}
