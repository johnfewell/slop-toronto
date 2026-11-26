// tools/frame-time-chart.mjs — draw frame-time charts from capture metrics JSON (a PNG per run, or two runs overlaid).
//
// usage: node tools/frame-time-chart.mjs [options] <out.png> <metrics.json> [<metrics.json> ...]
//   One panel per input file, stacked: frame interval over time, 50/100/200 ms grid lines, dashed marks for the
//   named events, and p50 / p95 / max / frames-over-100-ms in each panel's header.
//   --overlay           draw every input in ONE panel (first = before, grey-blue; second = after, red; a third is amber)
//   --label <text>      a title for the next input (give one per input, in order); default: the file's name
//   --title <text>      one heading over the whole chart (optional)
//   --marks a,b,c       draw only the marks with these names (default: every mark)
//   --max-ms <n>        top of the y axis, default 260 (frames slower than that are drawn at the top)
//   --x-label <text>    the x axis caption, after "seconds since " (default: the start of the capture)
//   --width <px>        image width, default 1200
//   --panel-height <px> height of each panel (default 300, 340 for an overlay)
// An input is what a frame-times capture shot (tools/shots/frame-times.json) writes, with or without the capture's
// own { result } wrapper: { series: [[ms since start, frame interval ms], ...], p50, p95, max, over100, marks }.
// A mark is { name, t } (t in ms since the series started) or the older "name 123ms" string (ms from `startedAtRel`,
// default 0). Missing statistics are computed from the series. Needs `sharp` (a dev dependency of the glTF tools).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COLORS = ['#5b7fa6', '#d33', '#d9902a']; // before, after, third (a lone run is red, as in the original chart)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const FONT = 'font-family="sans-serif"';

// One metrics file -> { series, stats, marks: [{ name, t }] }, with every figure the chart prints present.
export function normalizeRun(json, label = '') {
  const r = json && json.result ? json.result : json;
  if (!r || !Array.isArray(r.series) || !r.series.length) throw new Error(`${label || 'input'}: no series of [t, interval] pairs`);
  const dts = r.series.map((p) => p[1]).sort((a, b) => a - b);
  const q = (p) => dts[Math.min(dts.length - 1, Math.floor(dts.length * p))];
  const stats = {
    p50: r.p50 ?? q(0.5), p95: r.p95 ?? q(0.95), max: r.max ?? dts[dts.length - 1],
    over100: r.over100 ?? dts.filter((d) => d > 100).length
  };
  const at = Number(r.startedAtRel) || 0;
  const marks = (r.marks || []).flatMap((k) => {
    if (k && typeof k === 'object') return Number.isFinite(k.t) ? [{ name: String(k.name), t: k.t }] : [];
    const m = /^(.*?)(?: \d+)? (\d+(?:\.\d+)?)ms$/.exec(String(k));
    return m ? [{ name: m[1], t: Number(m[2]) + at }] : [];
  });
  return { series: r.series, stats, marks };
}

const statLine = (s) => `p50 ${s.p50.toFixed(1)} · p95 ${s.p95.toFixed(1)} · max ${s.max.toFixed(0)} ms · ${s.over100} frames over 100 ms`;

// SVG for one panel at vertical offset y0. runs: [{ label, run }]; overlay puts them all on one set of axes.
function panelSvg(runs, { y0, W, H, maxMs, markNames, overlay, heading, xLabel }) {
  const L = 60, B = 40, T = overlay ? 56 : 40, w = W - L - 20, h = H - B - T;
  const tmax = Math.max(...runs.flatMap(({ run }) => run.series.map((s) => s[0]))) || 1;
  const x = (t) => L + (t / tmax) * w;
  const y = (v) => y0 + T + h - (Math.min(v, maxMs) / maxMs) * h;
  let s = `<text x="${L}" y="${y0 + 22}" font-size="16" ${FONT} font-weight="700">${esc(heading)}</text>`;
  for (const g of [0, 50, 100, 200].filter((g) => g <= maxMs)) {
    s += `<line x1="${L}" x2="${W - 20}" y1="${y(g)}" y2="${y(g)}" stroke="#ccc"/><text x="${L - 6}" y="${y(g) + 4}" font-size="11" text-anchor="end" ${FONT}>${g} ms</text>`;
  }
  const drawn = new Set();
  runs.forEach(({ run }, i) => {
    const color = COLORS[(runs.length === 1 ? 1 : i) % COLORS.length];
    for (const m of run.marks) {
      if (markNames && !markNames.includes(m.name)) continue;
      if (m.t < 0 || m.t > tmax) continue;
      const key = `${m.name}@${Math.round(m.t / 250)}`; // the same event in two runs, within a quarter second: once
      if (drawn.has(key)) continue;
      drawn.add(key);
      s += `<line x1="${x(m.t)}" x2="${x(m.t)}" y1="${y0 + T}" y2="${y0 + T + h}" stroke="${runs.length === 1 ? '#3a7' : color}" stroke-dasharray="4 3"/>`
        + `<text x="${x(m.t)}" y="${y0 + T - 6 - (overlay ? (i % 2) * 12 : 0)}" font-size="11" text-anchor="middle" ${FONT} fill="${runs.length === 1 ? '#262' : color}">${esc(m.name)}</text>`;
    }
  });
  runs.forEach(({ label, run }, i) => {
    const color = COLORS[(runs.length === 1 ? 1 : i) % COLORS.length];
    s += `<polyline fill="none" stroke="${color}" stroke-width="1.2" points="${run.series.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"${overlay && i === 0 ? ' stroke-opacity="0.85"' : ''}/>`;
    const line = overlay ? `${label}: ${statLine(run.stats)}` : statLine(run.stats);
    s += `<text x="${W - 20}" y="${y0 + 22 + (overlay ? i * 16 : 0)}" font-size="12" text-anchor="end" ${FONT}${overlay ? ` fill="${color}"` : ''}>${esc(line)}</text>`;
  });
  s += `<text x="${L}" y="${y0 + H - 6}" font-size="11" ${FONT}>seconds since ${esc(xLabel)}: 0 to ${(tmax / 1000).toFixed(0)}</text>`;
  return s;
}

// items: [{ label, json }]. Returns { svg, width, height }.
export function chartSvg(items, opts = {}) {
  const { overlay = false, title = '', marks = null, maxMs = 260, width = 1200, xLabel = 'the start of the capture' } = opts;
  if (!items.length) throw new Error('no inputs');
  if (overlay && items.length < 2) throw new Error('--overlay needs two or more inputs');
  const runs = items.map((it) => ({ label: it.label, run: normalizeRun(it.json, it.label) }));
  const H = opts.panelHeight || (overlay ? 340 : 300), head = title ? 34 : 0;
  const groups = overlay ? [runs] : runs.map((r) => [r]);
  const height = head + groups.length * H + (overlay ? 0 : (groups.length - 1) * 20) + 20; // (20 px margin below)
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/>`;
  if (title) svg += `<text x="60" y="24" font-size="18" ${FONT} font-weight="700">${esc(title)}</text>`;
  groups.forEach((g, i) => {
    const heading = overlay ? g.map((r) => r.label).join(' vs ') : g[0].label;
    svg += panelSvg(g, { y0: head + i * (H + 20), W: width, H, maxMs, markNames: marks, overlay, heading, xLabel });
  });
  return { svg: svg + '</svg>', width, height };
}

export function parseArgs(argv) {
  const o = { files: [], labels: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], need = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--overlay') o.overlay = true;
    else if (a === '--label') o.labels.push(need());
    else if (a === '--title') o.title = need();
    else if (a === '--marks') o.marks = need().split(',').map((m) => m.trim()).filter(Boolean);
    else if (a === '--max-ms') o.maxMs = Number(need());
    else if (a === '--x-label') o.xLabel = need();
    else if (a === '--width') o.width = Number(need());
    else if (a === '--panel-height') o.panelHeight = Number(need());
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.files.push(a);
  }
  if (o.files.length < 2) throw new Error('usage: node tools/frame-time-chart.mjs [options] <out.png> <metrics.json> [<metrics.json> ...]');
  for (const k of ['maxMs', 'width', 'panelHeight']) if (k in o && !(o[k] > 0)) throw new Error(`--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} must be a positive number`);
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const [out, ...inputs] = o.files;
  const items = inputs.map((f, i) => ({ label: o.labels[i] ?? path.basename(f, '.json'), json: JSON.parse(fs.readFileSync(f, 'utf8')) }));
  const { svg } = chartSvg(items, o);
  const { default: sharp } = await import('sharp');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log(`wrote ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
