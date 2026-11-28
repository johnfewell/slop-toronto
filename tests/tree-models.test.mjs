// The tree models (assets/trees, tools/merge-tree-models.mjs, st-tw6z): one file per species holds its sizes and the leaf-and-bark
// atlas once. The merge must not have changed a thing the page draws: every vertex attribute and index, decoded, every
// material parameter and every node transform hash the same as in the 11 per-size files it replaced
// (tests/fixtures/tree-models-decoded.json is those files' hashes, recorded when the merge was run), and each file keeps exactly one image.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { decodedDigests, readGlb } from '../tools/merge-tree-models.mjs';

const FILES = ['ez-oak', 'ez-ash', 'ez-pine-a', 'ez-aspen'];
const treePath = (f) => new URL(`../assets/trees/${f}.glb`, import.meta.url).pathname;
const expected = JSON.parse(fs.readFileSync(new URL('./fixtures/tree-models-decoded.json', import.meta.url), 'utf8'));

test('the merged species files decode to exactly what the per-size files did', async () => {
  const got = {};
  for (const f of FILES) Object.assign(got, await decodedDigests(treePath(f), (n) => `${f}:${n}`));
  assert.deepEqual(Object.keys(got).sort(), Object.keys(expected).sort());
  for (const k of Object.keys(expected)) assert.equal(got[k], expected[k], k);
});

test('each species file carries its leaf atlas once and names its sizes the way js/ez-trees.js looks them up', () => {
  const sizes = { 'ez-oak': ['small', 'medium', 'large'], 'ez-ash': ['small', 'medium', 'large'], 'ez-pine-a': ['small', 'medium', 'large'], 'ez-aspen': ['medium', 'large'] };
  for (const f of FILES) {
    const { json } = readGlb(treePath(f));
    assert.equal(json.images.length, 1, `${f}: one image`);
    const names = json.nodes.map((n) => n.name).sort();
    assert.deepEqual(names, sizes[f].flatMap((s) => [`${s}_mid`, `${s}_near`]).sort(), f);
  }
});

test('every model GEO.treeModels names is a size in one of the files', () => {
  const geo = fs.readFileSync(new URL('../tools/geo-trees.mjs', import.meta.url), 'utf8');
  const ids = [...geo.matchAll(/'(ez-(?:oak|ash|aspen|pine)-(?:small|medium|large)(?:-a)?)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 11, 'the model list is in tools/geo-trees.mjs');
  const have = new Set(Object.keys(expected).map((k) => { const [f, rest] = k.split(':'); const size = rest.split('_')[0]; return f === 'ez-pine-a' ? `ez-pine-${size}-a` : `${f}-${size}`; }));
  for (const id of new Set(ids)) assert.ok(have.has(id), id);
});
