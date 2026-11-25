(function () {
'use strict';
// js/portlands.js — integration of the Port Lands pieces (bead jf-li1, docs/portlands.md): the Victory Soya and Essroc
// silos and the white steel shell arches over the Commissioners Street and Cherry Street bridges. The Atlas Crane is placed by the park itself
// (js/biidaasige-park.js, from js/biidaasige-heritage.js), as it was before.
//
// Everything here replaces or adds to something this map already draws, never a second copy:
//   - the two City massing rows the silos stand on are left out of CityBuildings (portLandsExcludesBuilding);
//   - the bridge decks, sidewalks and the walking / driving over them stay the map's own (city-config.js ROAD_BRIDGES);
//     the shells stand on them.
// ?portlands=0 leaves all of it out for an A/B.
const C = window.CITY;
const enabled = () => new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('portlands') !== '0';
let active = null;

function createPortLands(THREE = C.THREE, scene) {
  active = null;
  C.portLandsStats = null;
  if (!enabled() || !THREE || !C.PORTLANDS_KIT) return null;
  const result = { group: new THREE.Group(), colliders: [], excludedRows: new Set(), layers: {} };
  result.group.name = 'PortLands';
  // silos
  try {
    const silos = C.buildPortLandsSilos?.({ geo: C.GEO });
    if (silos?.group?.children.length) {
      result.group.add(silos.group);
      result.colliders.push(...silos.colliders);
      for (const i of silos.matchedRows) result.excludedRows.add(i);
      result.layers.silos = { triangles: silos.triangles, built: silos.built.map((b) => b.id) };
    }
  } catch (e) { console.warn('[portlands] silos failed', e); }
  // bridge shells
  try {
    const shells = C.buildPortLandsBridges?.({});
    if (shells?.group) {
      result.group.add(shells.group);
      result.layers.bridges = { triangles: shells.triangles, built: shells.bridges };
    }
  } catch (e) { console.warn('[portlands] bridge shells failed', e); }
  active = result;
  result.nativeGeo = C.GEO;
  if (scene) scene.add(result.group);
  C.portLandsStats = { silos: result.layers.silos || null, bridges: result.layers.bridges || null, colliders: result.colliders.length };
  return result;
}

/** buildings.js: a massing row the silos replace (matched by place and form, so only the two silo rows). */
const portLandsExcludesBuilding = (i) => !!active && active.nativeGeo === C.GEO && active.excludedRows.has(i);

Object.assign(C, { createPortLands, portLandsExcludesBuilding });
})();
