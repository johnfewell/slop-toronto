(function () {
// js/signage.js
// Name boards on Abuja's named buildings: every building OpenStreetMap names, or that holds a named place (a bank, a
// hotel, an office, a shop...; GEO.pois), carries a fascia board with its name on the wall that faces the street, lit at
// night. Boards are drawn as plain lettering on a colour that says what the place is (blue banks, maroon hotels, green
// government...): the businesses' own logos are their trademarks and are not reproduced.

const { THREE } = window.CITY;
const { texture, uv, attribute, mix, smoothstep, vec2, float } = window.CITY.TSL;
const { GEO, nearestRoads, cityUniforms } = window.CITY;

// Board colour [background, lettering] by category
const SIGN_STYLE = {
  hotel: ['#6b1d2f', '#f6e7c8'],
  bank: ['#12355b', '#ffffff'],
  food: ['#b4441b', '#fff6e8'],
  worship: ['#1f5e3a', '#ffffff'],
  fuel: ['#9a1f1f', '#ffffff'],
  health: ['#f4f6f8', '#c0262d'],
  education: ['#2a4a7a', '#ffffff'],
  market: ['#5d2a6e', '#ffffff'],
  shop: ['#262a30', '#ffd34d'],
  government: ['#008751', '#ffffff'],
  office: ['#2b3138', '#ffffff'],
  leisure: ['#0e6b6b', '#ffffff'],
  transport: ['#b88a00', '#1a1a1a'],
  place: ['#2b3138', '#ffffff']
};

// One board per building: a named place inside it (the first commercial one) or the building's own name
function signList() {
  const byBuilding = new Map();
  for (const [, , name, cat, bi] of GEO.pois || []) {
    if (bi < 0 || byBuilding.has(bi)) continue;
    byBuilding.set(bi, { name, cat });
  }
  GEO.buildings.forEach((b, i) => {
    if (b[9] && !byBuilding.has(i)) byBuilding.set(i, { name: b[9], cat: b[5] === 6 ? 'worship' : b[5] === 7 ? 'education' : 'place' });
  });
  return [...byBuilding].map(([bi, s]) => ({ bi, ...s }));
}

function buildSignage(scene) {
  const group = new THREE.Group();
  group.name = 'CitySignage';
  const signs = signList();

  // Text atlases: cells of 512 x 64 px, 8 x 64 cells to a 4096 x 4096 atlas
  const CW = 512, CH = 64, COLS = 8, ROWS = 64, PER = COLS * ROWS;
  const atlases = [];
  const quads = []; // per atlas: { pos, uv, nor }
  for (let k = 0; k < signs.length; k += PER) {
    const c = document.createElement('canvas');
    c.width = CW * COLS;
    c.height = CH * ROWS;
    atlases.push(c);
    quads.push({ pos: [], uv: [], nor: [] });
  }

  let placed = 0;
  signs.forEach((s, k) => {
    const [cx, cz, ang, parts, h] = GEO.buildings[s.bi];
    if (!parts.length || h < 3) return;
    // the largest part, and its wall that faces the nearest street
    const part = parts.reduce((m, p) => ((p[1] - p[0]) * (p[3] - p[2]) > (m[1] - m[0]) * (m[3] - m[2]) ? p : m));
    const [u0, u1, v0, v1] = part;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    let nu = 0, nv = 1;
    const near = nearestRoads(cx, cz, 90);
    if (near.length) {
      const dx = near[0].px - cx, dz = near[0].pz - cz;
      const lu = dx * cs - dz * sn, lv = dx * sn + dz * cs;
      if (Math.abs(lu) > Math.abs(lv)) { nu = Math.sign(lu) || 1; nv = 0; } else { nu = 0; nv = Math.sign(lv) || 1; }
    }
    const faceW = nu ? v1 - v0 : u1 - u0;
    const fu = nu ? (nu > 0 ? u1 : u0) : (u0 + u1) / 2;
    const fv = nv ? (nv > 0 ? v1 : v0) : (v0 + v1) / 2;
    // world: x = cx + u cs + v sn, z = cz - u sn + v cs
    const wx = cx + fu * cs + fv * sn, wz = cz - fu * sn + fv * cs;
    const nx = nu * cs + nv * sn, nz = -nu * sn + nv * cs;
    const tx = nz, tz = -nx; // along the wall, left to right seen from the street

    // the lettering, fitted into its cell
    const atlas = Math.floor(k / PER), cell = k % PER;
    const ctx = atlases[atlas].getContext('2d');
    const ox = (cell % COLS) * CW, oy = Math.floor(cell / COLS) * CH;
    const [bg, fg] = SIGN_STYLE[s.cat] || SIGN_STYLE.place;
    const text = s.name.toUpperCase();
    ctx.font = '700 38px Inter, "Helvetica Neue", Arial, sans-serif';
    const tw = Math.min(CW - 28, ctx.measureText(text).width);
    const usedW = Math.max(CH * 1.6, tw + 28);
    ctx.fillStyle = bg;
    ctx.fillRect(ox, oy, usedW, CH);
    ctx.fillStyle = fg;
    ctx.fillRect(ox, oy + CH - 5, usedW, 3);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, ox + usedW / 2, oy + CH / 2 + 1, CW - 28);

    // the board: as tall as a fascia (taller on tall buildings), no wider than the wall
    let bh = Math.max(1.0, Math.min(3.2, h * 0.07));
    let bw = bh * (usedW / CH);
    const maxW = faceW * 0.86;
    if (bw > maxW) { bw = maxW; bh = Math.max(0.45, bw * CH / usedW); }
    if (bw < 1.2) return;
    const y = h < 9 ? Math.min(h - 0.5 - bh / 2, 3.6 + bh / 2) : h - 0.8 - bh / 2;
    const px = wx + nx * 0.09, pz = wz + nz * 0.09;
    const Q = quads[atlas];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    const U0 = ox / atlases[atlas].width, U1 = (ox + usedW) / atlases[atlas].width;
    const V1 = 1 - oy / atlases[atlas].height, V0 = 1 - (oy + CH) / atlases[atlas].height;
    for (const [a, b] of corners) {
      Q.pos.push(px + tx * a * bw / 2, y + b * bh / 2, pz + tz * a * bw / 2);
      Q.nor.push(nx, 0, nz);
      Q.uv.push(a < 0 ? U0 : U1, b < 0 ? V0 : V1);
    }
    placed++;
  });

  atlases.forEach((c, i) => {
    const Q = quads[i];
    if (!Q.pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(Q.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(Q.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(Q.uv, 2));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.05 });
    const t = texture(tex, uv());
    mat.colorNode = t;
    // lit from within after dark
    mat.emissiveNode = t.rgb.mul(smoothstep(0.4, 1.1, cityUniforms.uInteriorGlow).mul(0.9));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'NameBoards';
    group.add(mesh);
  });

  console.info(`[signage] ${placed} name boards on ${signs.length} named buildings`);
  scene.add(group);
  return { group, count: placed };
}

Object.assign(window.CITY, { buildSignage, SIGN_STYLE });
})();
