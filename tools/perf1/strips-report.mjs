// tools/perf1/strips-report.mjs <dir> <cell> [<cell> ...]: the fitted impostor strips' benchmark (jf-baa) as tables. Reads the visit job's
// records (<cell>-<arm>-r<round>-visit-<place>.json, tools/perf1/strips.sh) and prints, per place, each arm's frame time (mean over the page's windows;
// median over rounds, and the range), its difference from the quad (`off`) of the SAME round (paired: pages of a round sit minutes apart, so
// slow drift on the shared mini cancels most), the median of those differences, and how many rounds the arm was ahead. Also the main
// pass's draw calls and triangles. A difference counts as real only when it is beyond the spread of the quad's own rounds.
import fs from 'node:fs';
import path from 'node:path';

const [dir, ...cells] = process.argv.slice(2);
if (!dir || !cells.length) { console.error('usage: node tools/perf1/strips-report.mjs <dir> <cell> [<cell> ...]'); process.exit(2); }
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const sgn = (v) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(2) : '-');
const files = fs.readdirSync(dir);
const out = {};
for (const cell of cells) {
  const rows = {}; // place -> arm -> round -> { ms, p95, draws, tris }
  const re = new RegExp(`^${cell}-([^-]+)-r(\\d+)-visit-(\\w+)\\.json$`);
  for (const name of files) {
    const m = re.exec(name);
    if (!m) continue;
    const j = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')), r = j.result || j;
    if (!r.m || !r.m.length) continue;
    const [, arm, round, place] = m;
    const main = r.census && r.census.passes && r.census.passes.main;
    ((rows[place] ||= {})[arm] ||= {})[round] = { ms: r.m.reduce((s, x) => s + x.ms, 0) / r.m.length, p95: med(r.m.map((x) => x.p95)), draws: main && main.draws, tris: main && main.tris };
  }
  out[cell] = {};
  console.log(`\n### ${cell}\n`);
  console.log('| Place | Arm | Frame ms (median of rounds) | Range | Paired change vs quad (median) | Rounds ahead | Main draws | Main triangles |');
  console.log('| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |');
  for (const place of Object.keys(rows)) {
    const base = rows[place].off || {};
    const arms = Object.keys(rows[place]).sort((a, b) => (a === 'off' ? -1 : b === 'off' ? 1 : parseInt(a.slice(1)) - parseInt(b.slice(1)) || a.localeCompare(b)));
    for (const arm of arms) {
      const byRound = rows[place][arm], rounds = Object.keys(byRound);
      const ms = rounds.map((r) => byRound[r].ms);
      const diffs = rounds.filter((r) => base[r]).map((r) => byRound[r].ms - base[r].ms);
      const ahead = diffs.filter((d) => d < 0).length;
      const sample = byRound[rounds[0]];
      out[cell][`${place}/${arm}`] = { ms: med(ms), min: Math.min(...ms), max: Math.max(...ms), paired: arm === 'off' ? 0 : med(diffs), diffs, ahead, rounds: rounds.length, draws: sample.draws, tris: sample.tris };
      console.log(`| ${place} | ${arm} | ${f(med(ms))} | ${f(Math.min(...ms))} to ${f(Math.max(...ms))} | ${arm === 'off' ? '' : sgn(med(diffs))} | ${arm === 'off' ? '' : `${ahead} of ${diffs.length}`} | ${sample.draws ?? '-'} | ${sample.tris ?? '-'} |`);
    }
  }
}
fs.writeFileSync(path.join(dir, `strips-report-${cells.join('+')}.json`), JSON.stringify(out, null, 1) + '\n');
