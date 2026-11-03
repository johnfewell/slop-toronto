// js/massing-worker.js — builds the ?massing=1 cell meshes off the main thread (a module worker; buildings.js starts it,
// js/massing-cells.js does the work). Message in: packInput's arrays (transferred); out: buildMassingCells' result
// (transferred), or { error }.
import { buildMassingCells, outputTransferables } from './massing-cells.js';

self.onmessage = ({ data }) => {
  try {
    const out = buildMassingCells(data.input, data.opts || {});
    self.postMessage({ out }, outputTransferables(out));
  } catch (error) {
    self.postMessage({ error: String(error && error.stack || error) });
  }
};
