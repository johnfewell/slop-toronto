// tools/extract-gait-logs.mjs
// Extracts [gait-log:<shot>] JSON payloads from capture console.log and writes them to <shot>.json
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] || 'capture-out';
const consolePath = path.join(outDir, 'console.log');
if (!fs.existsSync(consolePath)) {
  console.log(`[extract-gait-logs] No console.log found in ${outDir}`);
  process.exit(0);
}

const content = fs.readFileSync(consolePath, 'utf8');
const lines = content.split('\n');

for (const line of lines) {
  const m = line.match(/\[gait-log:(\w+)\]\s+(.+)$/);
  if (m) {
    const shotName = m[1];
    try {
      const data = JSON.parse(m[2]);
      const targetFile = path.join(outDir, `${shotName}.json`);
      fs.writeFileSync(targetFile, JSON.stringify(data, null, 2) + '\n');
      console.log(`[extract-gait-logs] Wrote ${targetFile} (${Array.isArray(data) ? data.length + ' entries' : 'object'})`);
    } catch (e) {
      console.error(`[extract-gait-logs] Failed to parse log for ${shotName}: ${e.message}`);
    }
  }
}
