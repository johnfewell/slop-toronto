(function () {
// js/collision-debug.js: ?debug=collisions only (main.js fetches this file just then; normal play never loads it).
// The colliders within 30 m of the player (&debugRadius=<m> for more) drawn over the city as the controllers meet them (js/world-collision.js
// outlines), at the bottom and top of their height range (clipped to a few metres round the player) with posts at their
// corners: the buildings cyan, the landmarks' drawn outlines magenta, thin walls (the road cuts', the subway's fences,
// the embankments') orange, poles yellow, the rest green; grey where they don't meet the player's height (a deck's piers
// seen from on top, a cut's wall from the street). The player's body is white, the last contact a red cross with its
// push-out normal. The panel counts them, and the contacts.
const { THREE } = window.CITY;

function createCollisionDebug({ scene, controllerManager: cm }) {
  const G = window.CITY.WorldCollision;
  const R = Math.max(5, Math.min(400, Number(new URLSearchParams(location.search).get('debugRadius')) || 30));
  const group = new THREE.Group();
  group.name = 'CollisionDebug';
  scene.add(group);
  const CAP = 120000; // floats per layer (20,000 segments)
  const layer = (color, opacity = 0.95) => {
    const g = new THREE.BufferGeometry();
    const a = new THREE.BufferAttribute(new Float32Array(CAP), 3);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', a);
    g.setDrawRange(0, 0);
    const m = new THREE.LineSegments(g, new THREE.LineBasicNodeMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
    m.frustumCulled = false;
    m.renderOrder = 2000;
    group.add(m);
    return { m, a, n: 0 };
  };
  const L = {
    building: layer(0x39d9ff), landmark: layer(0xff4fd8), thin: layer(0xffa630), pole: layer(0xffe14a),
    other: layer(0x7dff9a), off: layer(0x8a96a0, 0.4), body: layer(0xffffff), contact: layer(0xff3b30)
  };
  const seg = (l, ax, ay, az, bx, by, bz) => {
    if (l.n + 6 > CAP) return;
    const v = l.a.array;
    v[l.n++] = ax; v[l.n++] = ay; v[l.n++] = az; v[l.n++] = bx; v[l.n++] = by; v[l.n++] = bz;
  };
  const ring = (l, pts, y) => {
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; seg(l, a.x, y, a.z, b.x, y, b.z); }
  };
  const kindOf = (c) => {
    if (c.polygon) return 'landmark';
    const hx = c.obb ? c.obb.hx : (c.maxX - c.minX) / 2, hz = c.obb ? c.obb.hz : (c.maxZ - c.minZ) / 2;
    if (Math.max(hx, hz) < 0.6) return 'pole';
    if ((c.minY ?? 0) < -0.5 || Math.min(hx, hz) < 0.6) return 'thin';
    return c.maxY > 3 && Math.min(hx, hz) > 1.5 ? 'building' : 'other';
  };

  const panel = document.createElement('div');
  panel.id = 'collision-debug';
  panel.style.cssText = 'position:fixed;z-index:20000;left:12px;top:72px;background:rgba(12,20,28,.86);color:#e8eef3;padding:10px 12px;border-radius:8px;font:12px/1.45 ui-monospace,Menlo,monospace;pointer-events:none;max-width:300px;white-space:pre';
  document.body.appendChild(panel);
  const swatch = (hex, label) => `<span style="color:#${hex.toString(16).padStart(6, '0')}">■</span> ${label}`;
  const legend = [swatch(0x39d9ff, 'building'), swatch(0xff4fd8, 'landmark (drawn outline)'), swatch(0xffa630, 'thin wall'), swatch(0xffe14a, 'pole'), swatch(0x7dff9a, 'other'), swatch(0x8a96a0, 'not at your height'), swatch(0xff3b30, 'last contact & normal')].join('\n');

  let frame = 0, lastCount = 0, contactAt = -1e9, rate = 0, rateT = performance.now(), rateN = 0;
  const counts = {};
  function update() {
    const mode = cm.activeMode, e = cm.getActiveEntity(), p = e.position;
    for (const l of Object.values(L)) l.n = 0;
    for (const k of Object.keys(counts)) counts[k] = 0;
    const band = mode === 'helicopter' ? [-0.25, 3.2] : mode === 'car' ? [0, 1.8] : [0, 1.9];
    for (const c of cm.nearColliders(p.x, p.z, R)) {
      if (c.maxX < p.x - R || c.minX > p.x + R || c.maxZ < p.z - R || c.minZ > p.z + R) continue;
      const lo = c.minY ?? 0, hi = c.maxY;
      if (hi < p.y - 8 || lo > p.y + 12) continue;
      const meets = !(p.y + band[0] >= hi || p.y + band[1] <= lo);
      const kind = kindOf(c);
      counts[kind] = (counts[kind] || 0) + 1;
      const l = meets ? L[kind] : L.off;
      const pts = G.colliderShape(c).points;
      const y0 = Math.max(lo, p.y - 3) + 0.04, y1 = Math.min(hi, p.y + 4.5);
      ring(l, pts, y0);
      if (y1 > y0 + 0.05) {
        ring(l, pts, y1);
        const every = Math.max(1, Math.floor(pts.length / 16));
        for (let i = 0; i < pts.length; i += every) seg(l, pts[i].x, y0, pts[i].z, pts[i].x, y1, pts[i].z);
      }
    }
    // the player's body, as the controllers meet the world
    if (mode === 'car') {
      const s = G.carShape(p.x, p.z, e.heading);
      ring(L.body, s.points, p.y + 0.3);
      ring(L.body, s.points, p.y + 1.2);
    } else {
      const r = { person: 0.48, cyclist: 0.65, helicopter: 4.5 }[mode] || 0.48, pts = [];
      for (let i = 0; i < 32; i++) pts.push({ x: p.x + Math.cos((i / 32) * Math.PI * 2) * r, z: p.z + Math.sin((i / 32) * Math.PI * 2) * r });
      ring(L.body, pts, p.y + 0.3);
      ring(L.body, pts, p.y + 1.5);
    }
    // the last contact (for 1.5 s): where it touched, and the way it pushed
    const now = performance.now();
    if ((cm.worldContactCount || 0) !== lastCount) { lastCount = cm.worldContactCount || 0; contactAt = now; }
    const hit = cm.lastWorldContact;
    if (hit && now - contactAt < 1500) {
      const y = p.y + 0.6;
      seg(L.contact, hit.x - 0.25, y, hit.z, hit.x + 0.25, y, hit.z);
      seg(L.contact, hit.x, y, hit.z - 0.25, hit.x, y, hit.z + 0.25);
      seg(L.contact, hit.x, y - 0.4, hit.z, hit.x, y + 0.6, hit.z);
      seg(L.contact, hit.x, y, hit.z, hit.x + hit.nx * 1.5, y, hit.z + hit.nz * 1.5);
    }
    for (const l of Object.values(L)) {
      l.a.needsUpdate = true;
      l.m.geometry.setDrawRange(0, l.n / 3);
    }
    if (now - rateT > 1000) { rate = (lastCount - rateN) / ((now - rateT) / 1000); rateN = lastCount; rateT = now; }
    if (frame++ % 10 === 0) {
      const near = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none';
      const last = hit ? `${hit.depth.toFixed(3)} m deep, ${kindOf(hit.collider)}${now - contactAt < 1500 ? '' : ' (earlier)'}` : '-';
      panel.innerHTML = `<b>Collisions</b>  ?debug=collisions\nwithin ${R} m: ${near}\ncontacts: ${lastCount} (${rate.toFixed(0)}/s)\nlast: ${last}\n${mode} at ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}\n${legend}\nR: back to the nearest road`;
    }
  }
  return { group, update, panel };
}

Object.assign(window.CITY, { createCollisionDebug });
})();
