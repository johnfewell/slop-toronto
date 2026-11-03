// tools/massing-legacy-format.mjs — the ?massing=1 pilot's 17-float vertex format: main's tsl-materials.js
// createFootprintFacades as of c3a76d7 (st-2nl.2), kept unchanged as the reference js/massing-cells.js's near tier must
// match vertex for vertex (tests/massing-cells.test.mjs) and the cost it is measured against
// (tools/report-massing-cells.mjs). Not shipped.
// Per vertex: position, normal, facadeWall (3 floats each), box and paint (4 each); one mesh per facade style per 1 km.
export function legacyFootprintFacades(THREE, material, records, cell = 1000) {
  const WALL_KINDS = { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 };
  return createFootprintFacades(material, records, cell);
  function createFootprintFacades(material, records, cell = 1000) {
    const cells = new Map();
    const withPaint = records.some((r) => r.paint);
    let walls = 0;
    const signedArea = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; return a / 2; };
    records.forEach((r, index) => {
      const top = r.h, base = r.base || 0;
      if (!(top > base) || !r.rings || !r.rings.length || r.rings[0].length < 3) return;
      const key = Math.floor(r.cx / cell) + ',' + Math.floor(r.cz / cell);
      let c = cells.get(key);
      if (!c) cells.set(key, (c = { pos: [], nor: [], box: [], wall: [], paint: [], idx: [] }));
      const seed = (Math.floor(r.seed ?? index * 29) % 1000) + 0.1 + 0.8 * (r.tone ?? 0.5);
      const paint = r.paint || [0.6, 0.6, 0.6, 0.5];
      const vert = (x, y, z, nx, ny, nz, w, h, along, fromTop, kind) => {
        c.pos.push(x, y, z); c.nor.push(nx, ny, nz); c.box.push(w, h, 0, seed); c.wall.push(along, fromTop, kind);
        if (withPaint) c.paint.push(paint[0], paint[1], paint[2], paint[3]);
      };
      // Outer ring counter-clockwise in (x, z) (signed area > 0), holes clockwise: the right-hand normal (dz, -dx) of
      // every edge then points away from the building's mass, out of it or into its courtyard
      const rings = r.rings.map((ring, i) => {
        const pts = ring.filter((p, k) => { const q = ring[(k + ring.length - 1) % ring.length]; return p[0] !== q[0] || p[1] !== q[1]; });
        if ((signedArea(pts) > 0) !== (i === 0)) pts.reverse();
        return pts;
      });
      // (kinds are given for the outer ring as the record lists it; reversed above, an edge's index moves with it)
      const outerFlipped = signedArea(r.rings[0]) <= 0;
      rings.forEach((ring, ri) => {
        const n = ring.length;
        for (let i = 0; i < n; i++) {
          const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
          const dx = bx - ax, dz = bz - az, w = Math.hypot(dx, dz);
          if (!(w > 1e-3)) continue;
          const nx = dz / w, nz = -dx / w;
          const kind = ri ? WALL_KINDS.rear : (r.kinds ? r.kinds[outerFlipped ? (2 * n - 2 - i) % n : i] : WALL_KINDS.rear) ?? WALL_KINDS.rear;
          if (kind < 0) continue; // (no wall: another part's wall stands there)
          // 0..1 along the wall, rising along the positive world axis it mostly follows
          const reverse = (Math.abs(dz) >= Math.abs(dx) ? dz : dx) < 0;
          const o = c.pos.length / 3;
          vert(ax, base, az, nx, 0, nz, w, top, reverse ? 1 : 0, top - base, kind);
          vert(bx, base, bz, nx, 0, nz, w, top, reverse ? 0 : 1, top - base, kind);
          vert(ax, top, az, nx, 0, nz, w, top, reverse ? 1 : 0, 0, kind);
          vert(bx, top, bz, nx, 0, nz, w, top, reverse ? 0 : 1, 0, kind);
          // counter-clockwise seen from outside: (a1 - a0) x (b0 - a0) = (top - base) (dz, 0, -dx), along the normal
          c.idx.push(o, o + 2, o + 1, o + 2, o + 3, o + 1);
          walls++;
        }
      });
      if (r.cap === false) return;
      const capY = r.capY ?? top;
      const contour = rings[0].map(([x, z]) => new THREE.Vector2(x, z));
      const holes = rings.slice(1).map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
      const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
      const pts = [contour, ...holes].flat();
      const o = c.pos.length / 3;
      for (const p of pts) vert(p.x, capY, p.y, 0, 1, 0, 1, top, 0, top - capY, WALL_KINDS.shop);
      for (const [a, b, d] of tris) {
        // facing up: (b - a) x (d - a) has a positive y
        const cross = (pts[b].y - pts[a].y) * (pts[d].x - pts[a].x) - (pts[b].x - pts[a].x) * (pts[d].y - pts[a].y);
        if (cross > 0) c.idx.push(o + a, o + b, o + d); else c.idx.push(o + a, o + d, o + b);
      }
    });
    const meshes = [];
    let triangles = 0, first = null;
    for (const c of cells.values()) {
      if (!c.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nor, 3));
      g.setAttribute('box', new THREE.Float32BufferAttribute(c.box, 4));
      g.setAttribute('facadeWall', new THREE.Float32BufferAttribute(c.wall, 3));
      if (withPaint) g.setAttribute('paint', new THREE.Float32BufferAttribute(c.paint, 4));
      g.setIndex(c.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(c.idx, 1) : new THREE.Uint16BufferAttribute(c.idx, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, material);
      mesh.name = 'MassingFootprints';
      mesh.castShadow = mesh.receiveShadow = true;
      // (each cell falls under scene-culling.js's size limits for the big casters: it opts in to the position-only shadow
      // stand-ins, as mrdoob's c4ab18f does for New York's surveyed cells)
      mesh.userData.shadowStandIn = true;
      if (first) {} void first;
      meshes.push(mesh);
      triangles += c.idx.length / 3;
    }
    return { meshes, triangles, walls };
  }
  
}
