(function () {
// Physical machine points can fall just off the simplified curb. Move at most 1.25 m
// away from the road; reject unsafe points rather than scattering machines by zone.
function parkingMeterSites(records, { nearestRoads, blockAt, blocked, bikeShareAt }) {
  const sites = [], rejected = { road: 0, sidewalk: 0, obstruction: 0 };
  for (const record of records) {
    const road = nearestRoads(record.x, record.z, 30)[0];
    if (!road || road.road.raised) { rejected.road++; continue; }
    const vx = record.x-road.px, vz = record.z-road.pz, length = Math.hypot(vx,vz);
    if (length < 0.1) { rejected.road++; continue; }
    const dx = vx/length, dz = vz/length;
    let site = null, hadSidewalk = false;
    for (let step = 0; step <= 5; step++) {
      const x = record.x+dx*step*0.25, z = record.z+dz*step*0.25;
      const block = blockAt(x,z);
      if (!block || block.median || block.park > 0.6 || block.wild > 0.6) continue;
      // Keep the whole cabinet on the same curb island, including its corner clearance.
      if ([[0.32,0.32],[0.32,-0.32],[-0.32,0.32],[-0.32,-0.32]].some(([a,b]) => blockAt(x+a,z+b) !== block)) continue;
      hadSidewalk = true;
      if (blocked(x,z) || bikeShareAt?.(x,z,'prop') || sites.some((s) => Math.hypot(s.x-x,s.z-z)<0.8)) continue;
      site = { ...record, x, z, yaw: Math.atan2(road.px-x,road.pz-z), shifted: step*0.25 };
      break;
    }
    if (site) sites.push(site);
    else rejected[hadSidewalk ? 'obstruction' : 'sidewalk']++;
  }
  return { sites, rejected };
}
Object.assign(window.CITY, { parkingMeterSites });
})();
