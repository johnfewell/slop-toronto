(function () {
// js/landmarks.js
// Abuja's landmarks on their real OpenStreetMap outlines (city-config.js LANDMARK_SITES):
// - Abuja National Mosque (1984): the prayer hall under its gilded main dome, four minarets at the corners
// - National Christian Centre (2005): the white hall with tall pointed (neo-Gothic) windows
// - Millennium Tower: three cylindrical concrete pillars of differing heights (roof 170 m) joined by the disc of the
//   observation deck near the first peak, three stainless-steel wings fanning out from the base
// - National Assembly: the white building under its green dome, in the Three Arms Zone
// - Eagle Square: the paved parade square with the national flag
// - Unity Fountain, the World Trade Center towers, the Central Bank, Transcorp Hilton and the other mapped buildings,
//   extruded from their outlines to their mapped heights
// Where the record gives no dimension (the mosque's minarets & dome, the Millennium Tower's lower pillars & disc, the
// Assembly's dome) the model's proportions are estimates; see the README.

const { THREE } = window.CITY;
const { mergeGeometries } = window.CITY.Addons;
const { Fn, float, color, positionWorld, positionGeometry, smoothstep, step, abs, fract, mix, max, min, sin, normalWorldGeometry } = window.CITY.TSL;
const { GEO, LANDMARK_SITES, CITY_BOUNDS, createExtrudedPolygonMesh, createFlatPolygonMesh } = window.CITY;
const { createCurtainWallMaterial, createRenderedFacadeMaterial, createFacadeBoxes, WALL_KINDS, createWaterMaterial } = window.CITY;

const ringPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};
const linear = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

// White render with tall pointed-arch windows every 4 m (the Christian Centre's neo-Gothic hall)
function createGothicHallMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const u = fract(p.x.add(p.z).div(4.0)).sub(0.5).abs(); // across each bay
    const y = p.y;
    const shaft = step(u, 0.13).mul(step(2.5, y)).mul(step(y, 15.0));
    // pointed arch: the window narrows over its top 2.5 m
    const arch = step(u, float(0.13).mul(smoothstep(17.5, 15.0, y))).mul(step(15.0, y)).mul(step(y, 17.5));
    const win = max(shaft, arch).mul(step(normalWorldGeometry.y, 0.5));
    const wall = mix(color(0xf3f1ea), color(0xe6e2d8), smoothstep(0.0, 1.5, y).oneMinus().mul(0.5));
    return mix(wall, color(0x2a3a52), win);
  })();
  return mat;
}

function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'CityLandmarks';
  const colliders = [];
  const SW_Y = CITY_BOUNDS.sidewalkHeight;
  const S = LANDMARK_SITES;

  const white = new THREE.MeshStandardNodeMaterial({ color: 0xf1eee6, roughness: 0.72 });
  const cream = new THREE.MeshStandardNodeMaterial({ color: 0xe9e0cc, roughness: 0.75 });
  const concrete = new THREE.MeshStandardNodeMaterial({ color: 0xb9b5ad, roughness: 0.82 });
  const gold = new THREE.MeshStandardNodeMaterial({ color: 0xd8a83a, roughness: 0.28, metalness: 0.95 });
  const green = new THREE.MeshStandardNodeMaterial({ color: 0x2e7d4f, roughness: 0.4, metalness: 0.35 });
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0xc9ced3, roughness: 0.22, metalness: 0.95 });
  const glassDark = new THREE.MeshStandardNodeMaterial({ color: 0x1e3546, roughness: 0.1, metalness: 0.8 });

  // Player collider for a turned rectangle (centre, half sizes, yaw) up to maxY
  function boxCollider(cx, cz, hw, hd, ang, maxY) {
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const ex = Math.abs(cs) * hw + Math.abs(sn) * hd, ez = Math.abs(sn) * hw + Math.abs(cs) * hd;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY, obb: { cx, cz, hx: hw, hz: hd, cs, sn } });
  }
  // Point in the site's frame (u along its width, v along its depth) -> world
  const at = (s, u, v) => {
    const cs = Math.cos(s.ang || 0), sn = Math.sin(s.ang || 0);
    return { x: s.x + u * cs + v * sn, z: s.z - u * sn + v * cs };
  };
  const extrude = (s, h, mat, y0 = 0) => {
    const m = createExtrudedPolygonMesh(ringPts(s.ring), y0, h, mat, true, true);
    group.add(m);
    boxCollider(s.x, s.z, s.w / 2, s.d / 2, s.ang || 0, y0 + h);
    return m;
  };
  const done = new Set();

  // =========================================================================
  // CN TOWER (1976, 553.3 m): C.J..Goldman's model (Sketchfab, CC BY 4.0; tools/blender/export_cn_tower.py made
  // assets/landmarks/cn-tower.glb from it). Until it has loaded (or if it can't) a stand-in: the tapering shaft as a
  // lathe, the main pod with its glass band, the SkyPod and the antenna mast (main pod ~342-352 m, SkyPod 447 m; the
  // lathe profile is one-minute-ride's).
  // =========================================================================
  {
    const p = GEO.points.cnTower;
    const s = S.cnTower || { x: p[0], z: p[1] };
    const prof = [
      [0, 0], [32, 0], [28, 20], [12, 300], [11, 330], [24, 338], [26, 346], [24, 352], [14, 360], [9, 368],
      [8, 440], [11, 444], [11, 452], [6, 456], [3, 470], [2, 520], [0.6, 553], [0, 553]
    ];
    const towerMat = new THREE.MeshStandardNodeMaterial({ color: 0xd9d4ca, roughness: 0.78 });
    const shaft = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48), towerMat);
    shaft.position.set(s.x, SW_Y, s.z);
    shaft.castShadow = true;
    group.add(shaft);
    // the main pod's windows and the SkyPod's, dark glass bands
    const band = (r0, r1, y0, h) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 48, 1, true), glassDark);
      m.position.set(s.x, SW_Y + y0 + h / 2, s.z);
      group.add(m);
      return m;
    };
    const stand = [shaft, band(24.2, 26.2, 339, 6.5), band(11.2, 11.2, 445, 6)];
    boxCollider(s.x, s.z, 24, 24, 0, 553);
    if (window.CITY.Addons.GLTFLoader) {
      const loader = new window.CITY.Addons.GLTFLoader();
      if (window.CITY.Addons.MeshoptDecoder) loader.setMeshoptDecoder(window.CITY.Addons.MeshoptDecoder);
      loader.loadAsync('./assets/landmarks/cn-tower.glb').then((gltf) => {
        const tower = gltf.scene;
        tower.name = 'Landmark_cnTower';
        tower.position.set(s.x, SW_Y, s.z);
        tower.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        for (const m of stand) group.remove(m);
        group.add(tower);
        tower.updateMatrixWorld(true); // (the static city's matrices are frozen once built: main.js)
        console.info('[landmarks] CN Tower model placed');
      }).catch((e) => console.warn('[landmarks] CN Tower model did not load:', e));
    }
    done.add('cnTower');
  }

  // =========================================================================
  // ROGERS CENTRE (1989): the drum of the stands and the white retractable roof, a shallow dome over a ~205 m circle
  // =========================================================================
  if (S.rogersCentre && !(window.CITY.LANDMARK_MESHES || {}).rogersCentre) {
    const s = S.rogersCentre;
    const R = Math.min(s.w, s.d) / 2 * 0.98;
    const drumH = 46;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.02, drumH, 64), concrete);
    drum.position.set(s.x, SW_Y + drumH / 2, s.z);
    drum.castShadow = true;
    group.add(drum);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), white);
    dome.scale.y = 40 / R;
    dome.position.set(s.x, SW_Y + drumH, s.z);
    dome.castShadow = true;
    group.add(dome);
    boxCollider(s.x, s.z, R * 0.75, R * 0.75, 0, drumH + 40);
    done.add('rogersCentre');
  }

  // =========================================================================
  // THE CITY'S 3D MASSING: City Hall's two curved towers & council saucer, Union Station, Queen's Park, the Royal York,
  // the Gooderham (Flatiron) Building, the Princes' Gates, St. Lawrence Market, the Cinesphere, Scotiabank Arena and the
  // Rogers Centre, from the multipatch faces in toronto-landmarks.js (tools/fetch-landmark-massing.mjs), in stone,
  // concrete or brick by what each is built of
  // =========================================================================
  {
    const LOOKS = {
      concrete: new THREE.MeshStandardNodeMaterial({ color: 0xdcd9d1, roughness: 0.8 }),
      limestone: new THREE.MeshStandardNodeMaterial({ color: 0xd9cdb2, roughness: 0.78 }),
      sandstone: new THREE.MeshStandardNodeMaterial({ color: 0xc28a6c, roughness: 0.82 }),
      brick: new THREE.MeshStandardNodeMaterial({ color: 0x9a5a43, roughness: 0.86 }),
      white: new THREE.MeshStandardNodeMaterial({ color: 0xf1efe9, roughness: 0.6 })
    };
    // the multipatch faces don't keep one winding (the Rogers Centre's roof faced inward: from above its dome vanished)
    for (const m of Object.values(LOOKS)) m.side = THREE.DoubleSide;
    const decode = (b64, Type) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Type(bytes.buffer);
    };
    for (const [id, m] of Object.entries(window.CITY.LANDMARK_MESHES || {})) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(decode(m.positions, Float32Array), 3));
      g.setIndex(new THREE.BufferAttribute(decode(m.indices, Uint32Array), 1));
      g.computeVertexNormals(); // every face has its own vertices: flat-shaded facets
      const mesh = new THREE.Mesh(g, LOOKS[m.look] || LOOKS.limestone);
      mesh.position.y = SW_Y;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `Landmark_${id}`;
      group.add(mesh);
      const s = S[id];
      if (s && s.w) {
        g.computeBoundingBox();
        boxCollider(s.x, s.z, s.w / 2, s.d / 2, s.ang || 0, g.boundingBox.max.y);
      }
      done.add(id);
    }
  }

  // =========================================================================
  // ROYAL ONTARIO MUSEUM: John's model (rom-heist's SketchUp shell: the 1914 & 1933 wings and Libeskind's Crystal,
  // exported to assets/landmarks/rom.glb), turned & placed on the museum's OSM outline by tools/fit-rom.mjs
  // =========================================================================
  if (S.rom && window.CITY.Addons.GLTFLoader) {
    const s = S.rom;
    boxCollider(s.x, s.z, s.w / 2, s.d / 2, s.ang || 0, 36);
    Promise.all([
      fetch('./assets/landmarks/rom-fit.json').then((r) => r.json()),
      new window.CITY.Addons.GLTFLoader().loadAsync('./assets/landmarks/rom.glb')
    ]).then(([fit, gltf]) => {
      const rom = gltf.scene;
      rom.name = 'Landmark_rom';
      rom.rotation.y = fit.rotationY;
      rom.position.set(fit.x, SW_Y + fit.y, fit.z);
      rom.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      group.add(rom);
      rom.updateMatrixWorld(true); // (the static city's matrices are frozen once built: main.js)
      console.info('[landmarks] ROM model placed');
    }).catch((e) => console.warn('[landmarks] ROM model did not load:', e));
    done.add('rom');
  }

  // =========================================================================
  // ABUJA NATIONAL MOSQUE
  // =========================================================================
  if (S.mosque) {
    const s = S.mosque;
    const hallH = 16;
    extrude(s, hallH, cream);
    // the gilded main dome on a drum at the centre of the hall
    const R = Math.min(s.w, s.d) * 0.29;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.05, 5, 40), cream);
    drum.position.set(s.x, hallH + 2.5, s.z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    dome.scale.set(1, 1.08, 1);
    dome.position.set(s.x, hallH + 5, s.z);
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.6, 6, 10), gold);
    finial.position.set(s.x, hallH + 5 + R * 1.08 + 3, s.z);
    group.add(drum, dome, finial);
    // four minarets at the corners (height estimated: no surveyed figure)
    const H = 76;
    const shaft = new THREE.CylinderGeometry(1.7, 2.3, H, 8);
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = at(s, su * (s.w / 2 - 4), sv * (s.d / 2 - 4));
      const m = new THREE.Mesh(shaft, cream);
      m.position.set(p.x, H / 2, p.z);
      group.add(m);
      for (const f of [0.42, 0.66, 0.88]) {
        const balcony = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 2.4, 1.6, 12), cream);
        balcony.position.set(p.x, H * f, p.z);
        group.add(balcony);
      }
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.0, 9, 8), gold);
      cap.position.set(p.x, H + 4.5, p.z);
      group.add(cap);
      colliders.push({ minX: p.x - 2.4, maxX: p.x + 2.4, minZ: p.z - 2.4, maxZ: p.z + 2.4, maxY: H });
    }
    for (const o of group.children) o.castShadow = o.receiveShadow = true;
    done.add('mosque');
  }

  // =========================================================================
  // NATIONAL CHRISTIAN CENTRE (its tower is mapped as its own part and stands with the other buildings)
  // =========================================================================
  if (S.church) {
    extrude(S.church, S.church.h || 25, createGothicHallMaterial());
    done.add('church');
  }

  // =========================================================================
  // MILLENNIUM TOWER: three concrete cylinders (roof 170 m, top floor 110 m), the observation disc, steel wings
  // =========================================================================
  if (S.millennium) {
    const s = S.millennium;
    const top = s.h || 170;
    const R = Math.min(s.w, s.d) * 0.14;
    const heights = [top, top * 0.86, top * 0.74];
    heights.forEach((h, k) => {
      const a = (s.ang || 0) + (k * Math.PI * 2) / 3;
      const px = s.x + Math.cos(a) * R * 1.25, pz = s.z - Math.sin(a) * R * 1.25;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.82, R, h, 28), concrete);
      c.position.set(px, h / 2, pz);
      c.castShadow = c.receiveShadow = true;
      group.add(c);
      colliders.push({ minX: px - R, maxX: px + R, minZ: pz - R, maxZ: pz + R, maxY: h });
      // a steel wing fanning out & up from the base, away from the core
      const wing = new THREE.Shape();
      wing.moveTo(0, 0);
      wing.lineTo(R * 3.2, 0);
      wing.quadraticCurveTo(R * 3.4, 22, R * 1.2, 48);
      wing.lineTo(0, 40);
      wing.closePath();
      const g = new THREE.ExtrudeGeometry(wing, { depth: 0.4, bevelEnabled: false });
      g.translate(R * 1.4, 0, -0.2);
      const w = new THREE.Mesh(g, steel);
      w.position.set(s.x, 0, s.z);
      w.rotation.y = a;
      w.castShadow = true;
      group.add(w);
    });
    // the two-floor disc of the observation deck & restaurant, near the first peak
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 3.3, R * 2.9, 7, 40), glassDark);
    disc.position.set(s.x, 110 - 3.5, s.z);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 3.4, R * 3.4, 1.0, 40), concrete);
    rim.position.set(s.x, 110 + 0.4, s.z);
    disc.castShadow = rim.castShadow = true;
    group.add(disc, rim);
    done.add('millennium');
  }

  // =========================================================================
  // NATIONAL ASSEMBLY: the white building under its green dome
  // =========================================================================
  if (S.assembly) {
    const s = S.assembly;
    const H = 15;
    extrude(s, H, white);
    const R = Math.min(s.d * 0.42, 18);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.05, R * 1.08, 6, 40), white);
    drum.position.set(s.x, H + 3, s.z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), green);
    dome.position.set(s.x, H + 6, s.z);
    drum.castShadow = dome.castShadow = true;
    group.add(drum, dome);
    done.add('assembly');
  }

  // =========================================================================
  // EAGLE SQUARE: granite paving & the national flag (green, white, green)
  // =========================================================================
  if (S.eagleSquare) {
    const s = S.eagleSquare;
    const paving = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
    paving.colorNode = Fn(() => {
      const p = positionWorld.xz;
      const joints = max(smoothstep(0.04, 0.0, abs(fract(p.x.div(1.2)).sub(0.5)).sub(0.46)), smoothstep(0.04, 0.0, abs(fract(p.y.div(1.2)).sub(0.5)).sub(0.46)));
      return mix(color(0xc9c4ba), color(0x9d988e), joints);
    })();
    group.add(createFlatPolygonMesh(ringPts(s.ring), SW_Y + 0.01, paving, true));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 30, 10), steel);
    pole.position.set(s.x, 15, s.z);
    const flag = new THREE.Group();
    const stripe = (hex, k) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.8), new THREE.MeshStandardNodeMaterial({ color: hex, side: THREE.DoubleSide, roughness: 0.8 }));
      m.position.set(1.2 + k * 2.4, 0, 0);
      return m;
    };
    flag.add(stripe(0x008751, 0), stripe(0xffffff, 1), stripe(0x008751, 2));
    flag.position.set(s.x, 27.4, s.z);
    group.add(pole, flag);
    colliders.push({ minX: s.x - 0.3, maxX: s.x + 0.3, minZ: s.z - 0.3, maxZ: s.z + 0.3, maxY: 30 });
    done.add('eagleSquare');
  }

  // =========================================================================
  // UNITY FOUNTAIN: the basin & its water
  // =========================================================================
  if (S.unityFountain) {
    const s = S.unityFountain;
    const r = Math.min(s.w, s.d) / 2;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.9, 48, 1, true), white);
    basin.position.set(s.x, SW_Y + 0.45, s.z);
    const water = new THREE.Mesh(new THREE.CircleGeometry(r - 0.2, 48).rotateX(-Math.PI / 2), createWaterMaterial());
    water.position.set(s.x, SW_Y + 0.7, s.z);
    basin.material.side = THREE.DoubleSide;
    group.add(basin, water);
    done.add('unityFountain');
  }

  // =========================================================================
  // THE OTHER MAPPED LANDMARK BUILDINGS, extruded from their outlines to their mapped heights (an estimate of four
  // storeys where none is mapped): glass for the towers, white render for the rest. Parks, the lake, the Villa grounds
  // & the like are areas, not buildings (city-grid.js draws them).
  // =========================================================================
  const AREAS = new Set(['millenniumPark', 'shagariPark', 'centralPark', 'arboretum', 'jabiLake', 'villa', 'wtc', 'golf', 'shipHouse', 'fedSecretariat', 'nnpc']);
  const glassTower = createCurtainWallMaterial({ glassTint: 0x22465a, frameTint: 0x9aa4ab, windowWidth: 1.6, floorHeight: 4.0, litProbability: 0.5, warmth: 0.55, reflectivity: 0.93, seed: 101.0, boxLocal: true });
  const rendered = createRenderedFacadeMaterial({ windowWidth: 2.6, floorHeight: 3.8, windowRatioX: 0.55, windowRatioY: 0.55, seed: 211.0 });
  const glassBoxes = [], renderedBoxes = [];
  // Toronto: only the landmarks left out of the 3D Massing (tools/geo-features.mjs MODELLED) would need this; the
  // others stand in the massing already
  const EXTRUDED = new Set();
  for (const [id, s] of Object.entries(S)) {
    if (!EXTRUDED.has(id) || done.has(id) || AREAS.has(id) || !s.ring || !s.w) continue;
    const h = s.h || (s.levels ? s.levels * 3.8 + 1 : 15);
    const rectish = s.area / (s.w * s.d) > 0.88;
    const tower = h >= 40;
    if (rectish) {
      // a facade box on the minimum rectangle
      const box = { x: s.x, y: h / 2, z: s.z, w: s.w, h, d: s.d, ry: s.ang || 0, tone: 0.5, faces: [WALL_KINDS.entry, WALL_KINDS.rear, WALL_KINDS.rear, WALL_KINDS.rear], paint: [...linear(0xefebe3), 0.8] };
      (tower ? glassBoxes : renderedBoxes).push(box);
      boxCollider(s.x, s.z, s.w / 2, s.d / 2, s.ang || 0, h);
    } else {
      extrude(s, h, tower ? glassDark : white);
    }
    done.add(id);
  }
  if (glassBoxes.length) group.add(createFacadeBoxes(glassTower, glassBoxes));
  if (renderedBoxes.length) group.add(createFacadeBoxes(rendered, renderedBoxes));

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.castShadow || false;
      o.receiveShadow = true;
    }
  });
  scene.add(group);
  console.info(`[landmarks] ${done.size} landmarks built: ${[...done].join(', ')}`);
  return { group, colliders };
}

Object.assign(window.CITY, { buildLandmarks });
})();
