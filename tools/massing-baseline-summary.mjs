// tools/massing-baseline-summary.mjs — summarizes tools/massing-baseline.sh's runs (st-2nl.3): per arm (main, cells,
// boxes), tier (high, low) and shot, the medians over the measured runs (warm-ups and failed attempts left out, listed)
// of frame time, CPU submission, the census's draws and triangles, the renderer's geometry memory, and per run the
// startup phases. Raw numbers stay in the runs' own files; this only gathers them.
// usage: node tools/massing-baseline-summary.mjs <results dir> [prefix: mb]   (writes <prefix>-baseline-summary.json and
// .md there)
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2], prefix = process.argv[3] || 'mb';
if (!dir) { console.error('usage: node tools/massing-baseline-summary.mjs <results dir>'); process.exit(2); }
const rank = (s, p) => (s.length ? s[Math.max(0, Math.ceil(p * s.length) - 1)] : null);
const median = (a) => { const s = a.filter((v) => Number.isFinite(v)).sort((p, q) => p - q); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

const runs = [];
for (const file of fs.readdirSync(dir).filter((f) => f.startsWith(`${prefix}-`) && /-(main|cells|boxes)-(high|low)-r\d+b?-metrics\.json$/.test(f)).sort()) {
  const [, arm, tier, rep] = file.slice(prefix.length).match(/^-(\w+)-(\w+)-(r\d+b?)-metrics\.json$/);
  const tag = file.replace(/-metrics\.json$/, '');
  const reports = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const log = fs.existsSync(path.join(dir, `${tag}-console.log`)) ? fs.readFileSync(path.join(dir, `${tag}-console.log`), 'utf8') : '';
  const init = Object.fromEntries([...(log.match(/\[init\] (.*)/)?.[1] || '').matchAll(/(\w+) (\d+)ms/g)].map((m) => [m[1], Number(m[2])]));
  const census = {};
  for (const m of log.matchAll(/\[massing-census\] (\S+) massing=\d \| (.*)/g)) {
    const parts = Object.fromEntries(m[2].split(' | ').map((p) => p.match(/^(.*) draws ([\d.]+) tris (\d+)$/)).filter(Boolean).map((q) => [q[1], { draws: Number(q[2]), tris: Number(q[3]) }]));
    census[m[1]] = parts;
  }
  const worker = log.match(/built in the (worker|main thread) in ([\d.]+) ms/);
  const shots = reports.map((r) => {
    const s = r.frames.samples || {};
    const frame = [...(s.frameIntervalMs || [])].sort((p, q) => p - q);
    const cpu = (s.simulationCpuMs || []).map((v, i) => v + s.renderSubmissionCpuMs[i]).sort((p, q) => p - q);
    const mem = r.resources?.renderer || {};
    const c = census[r.shot] || {};
    return {
      shot: r.shot, valid: r.frames.valid, measurementClass: r.measurementClass,
      frameP50: r1(rank(frame, 0.5)), frameP95: r1(rank(frame, 0.95)), cpuP50: r1(rank(cpu, 0.5)), cpuP95: r1(rank(cpu, 0.95)),
      viewDraws: c['view ALL']?.draws ?? null, viewTris: c['view ALL']?.tris ?? null,
      buildingDraws: c['view CityBuildings']?.draws ?? null, buildingTris: c['view CityBuildings']?.tris ?? null,
      massingDraws: c['view CityBuildings/MassingBuildings']?.draws ?? 0, massingTris: c['view CityBuildings/MassingBuildings']?.tris ?? 0,
      shadowDraws: c['shadow ALL']?.draws ?? null, shadowTris: c['shadow ALL']?.tris ?? null,
      attributesMiB: r1((mem.attributesSize || 0) / 1048576), geometries: mem.geometries ?? null, rendererMiB: r1((mem.total || 0) / 1048576)
    };
  });
  runs.push({ tag, arm, tier, rep, startupReadyMs: reports[0]?.startupReadyMs ?? null, init, cellsBuild: worker ? { where: worker[1], ms: Number(worker[2]) } : null, shots });
}
// a retried run (<tag>b) stands for its round; the failed attempt is listed, not pooled
const measured = runs.filter((r) => !runs.some((q) => q.tag === `${r.tag}b`));
const groups = {};
for (const r of measured) for (const s of r.shots) (groups[`${r.arm}|${r.tier}|${s.shot}`] ||= []).push(s);
const pooled = Object.entries(groups).map(([k, list]) => {
  const [arm, tier, shot] = k.split('|');
  const m = (key) => median(list.map((s) => s[key]));
  return { arm, tier, shot, runs: list.length, allValid: list.every((s) => s.valid), classes: [...new Set(list.map((s) => s.measurementClass))],
    frameP50: m('frameP50'), frameP95: m('frameP95'), cpuP50: m('cpuP50'), cpuP95: m('cpuP95'), viewDraws: m('viewDraws'), massingDraws: m('massingDraws'),
    buildingTris: m('buildingTris'), massingTris: m('massingTris'), shadowDraws: m('shadowDraws'), shadowTris: m('shadowTris'), attributesMiB: m('attributesMiB'), geometries: m('geometries') };
});
const startup = {};
for (const r of measured) {
  const g = (startup[`${r.arm}|${r.tier}`] ||= { arm: r.arm, tier: r.tier, ready: [], blocks: [], massingData: [], massingCells: [], culling: [], compile: [], cellsBuild: [] });
  g.ready.push(r.startupReadyMs); for (const k of ['blocks', 'massingData', 'massingCells', 'culling', 'compile']) g[k].push(r.init[k] ?? null);
  g.cellsBuild.push(r.cellsBuild?.ms ?? null);
}
const startupRows = Object.values(startup).map((g) => ({ arm: g.arm, tier: g.tier, runs: g.ready.length, ...Object.fromEntries(['ready', 'blocks', 'massingData', 'massingCells', 'culling', 'compile', 'cellsBuild'].map((k) => [k, median(g[k])])) }));
const out = { generatedAt: new Date().toISOString(), note: 'medians over the measured runs; frame times include vsync and the low tier 30 fps limiter; census triangles count the index ranges drawn', excluded: runs.filter((r) => !measured.includes(r)).map((r) => r.tag), startup: startupRows, pooled, runs };
fs.writeFileSync(path.join(dir, `${prefix}-baseline-summary.json`), JSON.stringify(out, null, 1) + '\n');

const md = ['# ?massing=1 matched baseline (tools/massing-baseline.sh)', '', `Generated ${out.generatedAt}. Medians over ${new Set(measured.map((r) => r.rep)).size} rounds; excluded: ${out.excluded.join(', ') || 'none'}.`, '',
  '| Arm | Tier | Startup ready (ms) | blocks | massingData | massingCells (wait) | culling | compile | cells build (worker ms) |', '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ...startupRows.map((s) => `| ${s.arm} | ${s.tier} | ${s.ready} | ${s.blocks} | ${s.massingData ?? '—'} | ${s.massingCells ?? '—'} | ${s.culling} | ${s.compile} | ${s.cellsBuild ?? '—'} |`), '',
  '| Shot | Tier | Arm | Frame p50 / p95 (ms) | CPU p50 / p95 (ms) | View draws | Massing draws / tris | Buildings tris | Shadow draws / tris | Attributes MiB | Valid |', '|---|---|---|---|---|---:|---|---:|---|---:|---|',
  ...pooled.sort((a, b) => a.shot.localeCompare(b.shot) || a.tier.localeCompare(b.tier) || a.arm.localeCompare(b.arm)).map((p) =>
    `| ${p.shot} | ${p.tier} | ${p.arm} | ${p.frameP50} / ${p.frameP95} | ${p.cpuP50} / ${p.cpuP95} | ${p.viewDraws} | ${p.massingDraws} / ${p.massingTris} | ${p.buildingTris} | ${p.shadowDraws} / ${p.shadowTris} | ${p.attributesMiB} | ${p.allValid ? 'yes' : 'NO'} (${p.classes.join(', ')}) |`)];
fs.writeFileSync(path.join(dir, `${prefix}-baseline-summary.md`), md.join('\n') + '\n');
console.log(md.join('\n'));
