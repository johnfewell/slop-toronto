const ABBREV = {
  st: 'street', str: 'street', rd: 'road', ave: 'avenue', av: 'avenue', cres: 'crescent', cr: 'crescent',
  blvd: 'boulevard', expy: 'expressway', expwy: 'expressway', hwy: 'highway', cl: 'close', dr: 'drive', ln: 'lane',
  wy: 'way', sq: 'square', mt: 'mount', intl: 'international', natl: 'national', govt: 'government', hosp: 'hospital',
  univ: 'university', ctr: 'centre', center: 'centre', tor: 'toronto', to: 'toronto',
  n: 'north', s: 'south', e: 'east', w: 'west'
};
export const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
export const words = (s) => normalize(s).split(' ').filter(Boolean).map((w) => ABBREV[w] || w);

// Keep only nodes where two distinct street names meet in the road graph.
export function junctions({ names, links, nodes }) {
  const incident = new Map();
  for (const [a, b, i] of links) {
    if (!names[i]) continue;
    for (const node of [a, b]) {
      if (!incident.has(node)) incident.set(node, new Set());
      incident.get(node).add(i);
    }
  }
  const points = [];
  for (const [node, streets] of incident) {
    if (streets.size > 1) points.push([node, nodes[2 * node], nodes[2 * node + 1], ...streets]);
  }
  return { names, points };
}

export function searchIntersections(query, { names, points }, near) {
  if (typeof query !== 'string' || /^\d/.test(query.trim())) return [];
  const pair = query.split(/\s*[/&]\s*|\s+and\s+/i);
  if (pair.length !== 2) return [];
  const needles = pair.map((s) => words(s).join(' '));
  if (needles.some((s) => !s)) return [];
  const streetWords = /\b(street|road|avenue|boulevard|drive|lane|crescent|court|way|place)\b/g;
  const direction = /\s+(north|south|east|west|n|s|e|w)$/;
  const matches = names.map((name) => {
    const full = words(name).join(' ');
    const base = full.replace(streetWords, '').replace(/\s+/g, ' ').trim();
    const forms = [full, full.replace(direction, ''), base, base.replace(direction, '')];
    return needles.map((s) => forms.includes(s));
  });
  const results = [];
  for (const [node, x, z, ...indices] of points) {
    const i = indices.find((i) => matches[i][0]);
    const j = indices.find((j) => matches[j][1] && names[i] !== names[j]);
    if (i === undefined || j === undefined) continue;
    results.push({ id: `intersection:${node}`, kind: 'intersection', name: `${names[i]} & ${names[j]}`,
      x, z, sub: 'Intersection', strong: true, distance: near ? Math.hypot(x - near.x, z - near.z) : null });
  }
  results.sort((a, b) => a.distance - b.distance);
  return results.filter((p, i) => !results.slice(0, i).some((other) => Math.hypot(p.x - other.x, p.z - other.z) < 40));
}
