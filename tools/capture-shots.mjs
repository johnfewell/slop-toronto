// tools/capture-shots.mjs — shot-list checks for tools/capture.mjs, run before any browser starts.
// The time presets are lighting.js TIME_PRESETS (and the explore.html time buttons). LightingSystem.applyPreset falls
// back to golden hour for an unknown id, so a typo such as "night" would silently capture golden hour instead.
export const TIME_PRESET_IDS = Object.freeze(['golden', 'midday', 'twilight', 'midnight']);

// Throws one error naming every shot whose `time` is not a preset id.
export function validateShots(shots, source = 'shot list') {
  if (!Array.isArray(shots)) throw new Error(`${source}: expected an array of shots`);
  const bad = shots.flatMap((s, i) => (s && s.time !== undefined && !TIME_PRESET_IDS.includes(s.time)
    ? [`shot ${i} "${s.name ?? '?'}" has time ${JSON.stringify(s.time)}`] : []));
  if (bad.length) {
    throw new Error(`${source}: unknown time preset (valid: ${TIME_PRESET_IDS.join(', ')}):\n  ${bad.join('\n  ')}`);
  }
  return shots;
}
