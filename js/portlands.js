(function () {
'use strict';
// js/portlands.js — integration of the Port Lands pieces (bead jf-li1, docs/portlands.md): the Victory Soya and Essroc
// silos, the white steel shell arches over the Commissioners Street and Cherry Street bridges, and the armour-stone banks with the
// planting behind them. The Atlas Crane is placed by the park itself
// (js/biidaasige-park.js, from js/biidaasige-heritage.js), as it was before.
//
// Everything here replaces or adds to something this map already draws, never a second copy:
//   - the two City massing rows the silos stand on are left out of CityBuildings (portLandsExcludesBuilding);
//   - the bridge decks, sidewalks and the walking / driving over them stay the map's own (city-config.js ROAD_BRIDGES);
//     the shells stand on them;
//   - the river bank apron and reeds stay js/water-edges.js's; the stone lies on the water's edge and the land side of them.
// ?portlands=0 leaves all of it out for an A/B.
const C = window.CITY;
const enabled = () => new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('portlands') !== '0';
let active = null;

// A generator (one `yield` between its pieces) for main.js's late build; createPortLands runs it through at once
function* createPortLandsSteps(THREE = C.THREE, scene, options = {}) {
  active = null;
  C.portLandsStats = null;
  C.releasePortLandsBaseEdits?.();
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
  yield 'bridges';
  // bridge shells
  try {
    const shells = C.buildPortLandsBridges?.({});
    if (shells?.group) {
      result.group.add(shells.group);
      result.layers.bridges = { triangles: shells.triangles, built: shells.bridges };
    }
  } catch (e) { console.warn('[portlands] bridge shells failed', e); }
  yield 'banks';
  // armour-stone banks and planting (js/portlands-banks.js)
  try {
    const parkRing = options.parkRing || options.park?.parkRing;
    const banks = parkRing ? (C.buildPortLandsBanksSteps ? yield* C.buildPortLandsBanksSteps({ parkRing }) : null) : null;
    if (banks?.group) {
      result.group.add(banks.group);
      result.layers.banks = banks.stats;
      result.update = banks.update || null; // (per frame: the planting's viewer and distance)
    }
  } catch (e) { console.warn('[portlands] banks failed', e); }
  yield 'portlands-done';
  active = result;
  result.nativeGeo = C.GEO;
  C.claimPortLandsBaseEdits?.(C.GEO); // (the silo rows the base city leaves out: js/park-detail.js)
  if (scene) scene.add(result.group);
  C.portLandsStats = { silos: result.layers.silos || null, bridges: result.layers.bridges || null, banks: result.layers.banks || null, colliders: result.colliders.length };
  return result;
}

function createPortLands(THREE, scene, options) {
  const steps = createPortLandsSteps(THREE, scene, options);
  for (let r = steps.next(); ; r = steps.next()) if (r.done) return r.value;
}

Object.assign(C, { createPortLands, createPortLandsSteps });
})();
