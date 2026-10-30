(function () {
// Source points have no heading. Match the named frontage first, then its curb.
// Reject unresolved sites; never populate a street with synthetic benches.
function benchSites(records, { nearestRoads, blockAt, blocked, bikeShareAt, halfWidth=.98, halfDepth=.45, clearBehind=1.2, headingFor }) {
  const sites = [], rejected = { road:0, sidewalk:0, obstruction:0 };
  const norm = (s) => String(s||'').toLowerCase().replace(/\bstreet\b/g,'st').replace(/\bavenue\b/g,'ave').replace(/[^a-z0-9]/g,'');
  for (const record of records) {
    const roads = nearestRoads(record.x,record.z,35).filter((r)=>!r.road.raised);
    const road = roads.find((r)=>norm(r.road.name)===norm(record.frontage)) || roads[0];
    if (!road) { rejected.road++; continue; }
    const vx = record.x-road.px, vz = record.z-road.pz, length = Math.hypot(vx,vz);
    if (length < .1) { rejected.road++; continue; }
    const fx = -vx/length, fz = -vz/length;
    const yaw = headingFor?.(record,road,Math.atan2(fx,fz)) ?? Math.atan2(fx,fz);
    const point = (x,z,u,v) => [x+u*Math.cos(yaw)+v*Math.sin(yaw), z-u*Math.sin(yaw)+v*Math.cos(yaw)];
    let site = null, hadSidewalk = false;
    for (let step=0;step<=5;step++) {
      const x = record.x-fx*step*.25, z = record.z-fz*step*.25, block = blockAt(x,z);
      if (!block || block.median) continue;
      // Seat is 1.8 x .8 m. Keep its corners, curb margin and a 1.2 m
      // pedestrian strip behind it on one island, clear of buildings/furniture.
      const w=halfWidth,d=halfDepth,c=d+clearBehind;
      const samples = [[-w,-d],[w,-d],[-w,d],[w,d],[-w,-c],[0,-c],[w,-c]].map(([u,v])=>point(x,z,u,v));
      if (samples.some(([a,b])=>blockAt(a,b)!==block)) continue;
      hadSidewalk = true;
      if ([[x,z],...samples].some(([a,b])=>blocked(a,b)||bikeShareAt?.(a,b,'prop')) || sites.some((s)=>Math.hypot(s.x-x,s.z-z)<2.2)) continue;
      site = {...record,x,z,yaw,shifted:step*.25}; break;
    }
    if (site) sites.push(site); else rejected[hadSidewalk?'obstruction':'sidewalk']++;
  }
  return {sites,rejected};
}
Object.assign(window.CITY,{benchSites});
})();
