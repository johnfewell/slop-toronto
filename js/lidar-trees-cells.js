// js/lidar-trees-cells.js — the Eglinton map's lidar-only trees (docs/lidar-trees.md), ?lidarTrees=1 on a desktop: the
// index of data/frames/eglinton/lidar-trees/ (asked for by its hash, like the geodata), then every cell file at once,
// each by its own hash. explore.html starts this while three.js loads and awaits it with the geodata, before the city's
// scripts run, so js/lidar-trees.js has every cell when street-details.js builds the tree field: a cell can never arrive
// after it. Each cell is the packed trees of tools/lidar-trees-lib.mjs packBytes, gzip'd (the server sends /data/ files
// as they are; one already inflated by a Content-Encoding is used as it comes).

async function inflate(buffer) {
  const u8 = new Uint8Array(buffer);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return u8;
  const out = new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip')));
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * `base`: the folder ('./data/frames/eglinton/lidar-trees/'); `indexFile`: 'index.json?v=<its hash>'. Resolves to the
 * index with each cell's bytes (`cells[i].data`), and `load` ({ ms, bytes, files }); or to { error } when any file
 * failed (the layer then stays off and says so). Never rejects: the city loads either way.
 */
export async function loadCells(base, indexFile) {
  const t0 = performance.now();
  try {
    const res = await fetch(base + indexFile);
    if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`);
    const text = await res.text();
    const index = JSON.parse(text);
    let bytes = text.length;
    const cells = await Promise.all(index.cells.map(async (c) => {
      const r = await fetch(`${base}${c.file}?v=${c.sha256.slice(0, 12)}`);
      if (!r.ok) throw new Error(`${c.file}: HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      bytes += buf.byteLength;
      const data = await inflate(buf);
      if (data.length !== c.count * 7) throw new Error(`${c.file}: ${data.length} bytes for ${c.count} trees`);
      return { ...c, data };
    }));
    const ms = performance.now() - t0;
    performance.measure('lidar-trees-cells', { start: t0, end: performance.now(), detail: { bytes, files: cells.length + 1 } });
    return { ...index, cells, load: { ms: Math.round(ms), bytes, files: cells.length + 1 } };
  } catch (e) {
    return { error: e.message, load: { ms: Math.round(performance.now() - t0) } };
  }
}
