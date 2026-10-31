(function () {
// js/discovery.js
// Two City of Toronto discovery layers in the place search and its cards (docs/public-art-heritage.md):
// - Public Art (CITY.PUBLIC_ART, js/toronto-public-art.js, loaded with the city: small): title, artist, year, type and
//   where to find each work, and what the 3D city shows of it (a simplified monument, a stand-in marker, a landmark, or
//   nothing where the City's point is inside a building).
// - Heritage Register (CITY.HERITAGE, js/toronto-heritage.js, ~3 MB): loaded only the first time a search box is used,
//   so a phone that never searches never downloads it. Each address keeps its register entries (status, by-law,
//   dates) and the City 3D Massing building it stands in, by durable ID.
// Cards build from text nodes only; links go to toronto.ca pages over HTTPS. No artwork or facade photographs are
// fetched or shipped: the City's record is the reference.

const { districtAt } = window.CITY;

const HERITAGE_URL = 'https://www.toronto.ca/city-government/planning-development/heritage-preservation/heritage-register/';
const ART_URL = 'https://open.toronto.ca/dataset/public-art/';

// ---- search records ------------------------------------------------------------------------------------------------
function artSub(r) {
  return ['Public art', r.type, r.year, r.artist].filter(Boolean).join(' · ');
}
/** The discovery layers' search items: kind 'place' with cat 'art' / 'heritage' and the source record as `discovery` */
function discoveryPlaces() {
  const items = [];
  for (const r of window.CITY.PUBLIC_ART?.records || []) {
    // (at the work as the city draws it: OSM's point on the work, or a reviewed spot, where the City's is an address)
    const at = r.place || r;
    items.push({ kind: 'place', cat: 'art', name: r.title, x: at.x, z: at.z, sub: artSub(r), discovery: { layer: 'art', record: r }, aliases: r.osm && r.osm.name !== r.title ? [r.osm.name] : undefined,
      keywords: `${r.artist} ${r.type} ${r.medium} ${r.address} public art artwork` });
  }
  const H = window.CITY.HERITAGE;
  if (H) for (const p of H.records) {
    const e = p.entries[0], hcd = p.entries.find((x) => x.hcd)?.hcd;
    const status = [...new Set(p.entries.map((x) => x.st))].join(' / ');
    items.push({ kind: 'place', cat: 'heritage', name: p.address, x: p.x, z: p.z,
      sub: `Heritage · ${status}${hcd ? ` · ${hcd}` : ''} · ${districtAt(p.x, p.z)}`, discovery: { layer: 'heritage', record: p },
      keywords: `heritage ${p.bname || ''} ${hcd || ''} ${e.arch || ''} ${(e.about || '').split(/[;,(]/)[0]}` });
  }
  return items;
}
/** OpenStreetMap place rows the art records stand in for (one search result per work) */
function mergedPoiRows() {
  return new Set((window.CITY.PUBLIC_ART?.records || []).filter((r) => r.osm).map((r) => r.osm.row));
}

// ---- the heritage layer, on first use --------------------------------------------------------------------------------
let heritage = null;
const listeners = [];
function loadHeritage() {
  if (window.CITY.HERITAGE) return Promise.resolve(window.CITY.HERITAGE);
  if (!heritage) heritage = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './js/toronto-heritage.js';
    s.async = true;
    s.onload = () => {
      window.CITY.Navigation?.resetIndex?.();
      for (const f of listeners) try { f(); } catch (e) { console.warn('[discovery]', e); }
      resolve(window.CITY.HERITAGE);
    };
    s.onerror = () => { heritage = null; reject(new Error('heritage register did not load')); };
    document.head.appendChild(s);
  });
  return heritage;
}
function onDiscoveryLoaded(f) { listeners.push(f); }

// ---- cards ------------------------------------------------------------------------------------------------------------
const ACCESS = {
  reviewed: 'Reviewed: stands outdoors, in public view.',
  'outdoor-point': 'The City’s point is outdoors, outside every mapped building. The work may still be on private land or partly out of view.',
  'in-building': 'The City’s point is inside a building: the work may be indoors, in a lobby or part of the facade.'
};
const MODEL_NOTE = {
  cenotaph: 'Drawn here as simplified massing of the stepped granite cenotaph (public domain: designers died 1956 and 1966). Carving and inscriptions are not reproduced; the height is inferred.',
  obelisk: 'Drawn here as simplified massing of the 1887 granite obelisk (public domain). Plaques, cannon and the exact height are not modelled.'
};
const cityLink = (href, label) => {
  try {
    const u = new URL(href);
    if (u.protocol === 'https:' && (u.hostname === 'toronto.ca' || u.hostname.endsWith('.toronto.ca'))) return { href: u.href, label };
  } catch { /* not a City link */ }
  return null;
};
/**
 * A discovery place's card: { address, facts: [[label, text]], notes: [text], links: [{ href, label }] }, all plain
 * text. `site` (optional) is what the city drew for it (public-art.js publicArtSite).
 */
function discoveryCard(p) {
  const d = p.discovery;
  if (!d) return null;
  if (d.layer === 'art') {
    const r = d.record, site = window.CITY.publicArtSite?.(r.id);
    const facts = [['Artist', r.artist || 'Not recorded'], ['Year', r.year ? String(r.year) : 'Not recorded'], ['Type', r.type], ['Medium', r.medium],
      ['Find it', r.address], ['Program', r.program], ['Commissioned by', r.commissionedBy], ['About', r.about]];
    let shown;
    if (r.show === 'landmark') shown = 'Part of the landmark drawn here; no separate model or marker.';
    else if (site?.kind === 'model') shown = MODEL_NOTE[r.model];
    else if (site?.kind === 'marker') shown = `A stand-in marker shows where it is${site.moved > 0.3 ? ` (${site.moved.toFixed(1)} m from the mapped point, clear of the roadway)` : ''}; the artwork itself is not modelled.`;
    else if (r.show === 'marker') shown = 'Not marked in the 3D city: its point is on the roadway or crowded by something solid here. Search still finds it.';
    else shown = r.building?.name ? `Not marked: inside ${r.building.name} in the 3D city.` : 'Not marked in the 3D city.';
    facts.push(['In the 3D city', shown], ['Visibility', ACCESS[r.access]]);
    return {
      address: r.address,
      facts: facts.filter(([, v]) => v),
      notes: ['City of Toronto Public Art inventory, dated snapshot. Artwork photographs are not shown here.'],
      links: [r.link && cityLink(r.link, 'City of Toronto page'), cityLink(ART_URL, 'City of Toronto source')].filter(Boolean)
    };
  }
  const p2 = d.record, H = window.CITY.HERITAGE;
  const facts = [];
  const one = p2.entries.length === 1;
  for (const [i, e] of p2.entries.slice(0, 6).entries()) {
    const head = one ? '' : `Entry ${i + 1}: `;
    facts.push([`${head}Status`, H.statusLabels[e.st] || e.st]);
    if (e.hcd) facts.push([`${head}District`, e.hcd]);
    if (e.bl) facts.push([`${head}By-law`, e.bl]);
    if (e.d) facts.push([`${head}Designated`, e.d]);
    if (e.l) facts.push([`${head}Listed`, e.l]);
    if (e.built) facts.push([`${head}Built`, e.built]);
    if (e.arch) facts.push([`${head}Architect`, e.arch]);
    if (e.type) facts.push([`${head}Type`, e.type]);
    if (e.why) facts.push([`${head}Reasons`, e.why]);
    if (e.eas) facts.push([`${head}Easement`, e.eas]);
    if (e.about) facts.push([`${head}Register note`, e.about]);
  }
  if (p2.entries.length > 6) facts.push(['More entries', `${p2.entries.length - 6} more at this address in the City’s register`]);
  const lm = p2.lm && window.CITY.GEO.landmarks[p2.lm];
  if (lm) facts.push(['In the 3D city', `Drawn as the ${lm.name} landmark, a game model rather than a survey of its facade.`]);
  else facts.push(['In the 3D city', p2.bid ? `City 3D massing${p2.bname ? `, ${p2.bname}` : ''} (${p2.bid}${p2.m === 'in' ? '' : `, nearest footprint ${p2.m}`}); a massing model, not a historic facade.` : 'No matching building footprint here.']);
  return {
    address: p2.address,
    facts,
    notes: [`City of Toronto Heritage Register, ${H.source.updatedAt.slice(0, 10)} edition. Not a legal status determination: check the City’s register, Council decisions and by-laws.`],
    links: [cityLink(HERITAGE_URL, 'City of Toronto Heritage Register'), cityLink(H.source.url, 'City of Toronto source')].filter(Boolean)
  };
}

Object.assign(window.CITY, { Discovery: { discoveryPlaces, mergedPoiRows, loadHeritage, onDiscoveryLoaded, discoveryCard } });
})();
