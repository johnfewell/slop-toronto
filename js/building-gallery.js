// js/building-gallery.js — the internal gallery page, ?gallery=presets (st-ndw9.13). Not linked from anywhere and fetched
// by nothing but the flag (js/main.js). It stands every preset in a row of six, on cleared ground, each lot a synthetic
// building the very same code draws the city with (js/buildings.js buildCityBlocks reads the lots as extra rows of the
// building list and of the massing records), so what the gallery shows is what the city gets. A preset with no drawing
// rule yet stands there in today's look and is labelled "not drawn yet". The three drawn presets come first.
//
// Layout (pure, tested in node): GALLERY_COLUMNS columns of rows, each row one preset's six lots side by side, every
// front toward +z (south); a row's lots are a rectangle of the preset's median width and depth (docs/building-forms.md
// for the houses) with the right dwelling count. Rows in a column stack northward with a street's width between.
// `mountGallery` (browser only) lays a flat ground over the rect and a plain text label over each row.

// (south-west corner of the first column's first row's front.) Open water in Lake Ontario, 3 km south of the city: no street trees,
// poles, bike-share docks, props or buildings stand there (st-ndw9.15 round 3), so every row is seen on its own; the gallery's own
// ground plane stands over the water. It was beside the rail corridor at x 2100, z -40, in the middle of the city's street furniture.
export const GALLERY_ORIGIN = { x: -3000, z: 3500 };
export const GALLERY_COLUMNS = 4;
export const LOTS_PER_ROW = 6;
const LOT_GAP = 9;     // m between neighbouring lots in a row
const ROW_GAP = 24;    // m between a row's back and the next row's front
const COLUMN_GAP = 40; // m between columns

// width, depth, height (m), the building list's kind (0 house, 1 low-rise, 2 mid-rise, 3 tower, 4 shed, 5 works, 6 worship,
// 7 civic) and roof (0 flat, 1 pitched, 2 sheet): houses from docs/building-forms.md's medians, the rest a plausible
// size for the type (only today's look uses them: those presets are not drawn yet)
const HOUSE = { detached: [7.3, 14.9, 9, 0, 1], semi: [11, 16.2, 9.5, 0, 1], row: [24.6, 13.4, 9.5, 0, 1] };
// (st-ndw9.15) the later presets: their drawn main block's median width and the depth the gallery gives it (the real median
// depth plus the rear wing the odd lots carry), the height of the data, and the dwellings of a pair or a run
const MORE = {
  'victorian-detached': [7.3, 14.5, 8, 1], 'edwardian-semi': [10.4, 15, 8, 2], 'edwardian-row': [18, 13.5, 8.4, 4],
  'interwar-detached': [7.8, 14.5, 7.7, 1], 'interwar-semi': [10.2, 15.5, 7.8, 2], 'postwar-detached': [9, 14, 5.5, 1], 'postwar-semi': [10.4, 14.5, 5.5, 2],
  'recent-detached': [8, 14, 9.3, 1], 'recent-semi': [10.5, 15, 9.3, 2], 'modern-townhouse-row': [19.2, 13.5, 9.3, 4]
};
const SIZES = {
  garage: [6, 6, 3, 4, 2], 'main-street-shop-early': [6.5, 22, 8.6, 1, 0], 'main-street-shop-later': [8, 24, 8.6, 1, 0],
  'walk-up-apartment': [20, 28, 13, 1, 0], 'mid-rise-block': [24, 36, 28, 2, 0], 'slab-tower': [48, 15, 58, 3, 0],
  'glass-tower-podium': [32, 32, 90, 3, 0], 'low-masonry-block': [15, 25, 10, 1, 0], 'dark-curtain-wall-tower': [36, 36, 100, 3, 0],
  'contemporary-glass': [25, 40, 35, 2, 0], 'plain-low-block': [18, 30, 10, 1, 0], tower: [40, 32, 70, 3, 0],
  school: [30, 60, 12, 7, 0], 'small-civic': [20, 30, 10, 7, 0], 'institutional-block': [40, 70, 25, 7, 0], church: [18, 36, 16, 6, 1],
  // (st-ndw9.20) the worship rows: the nave's footprint, its height to the ridge or the top
  'church-gothic': [15, 35, 21, 6, 1], 'church-chapel': [10, 18, 11, 6, 1], 'church-modern': [24, 30, 10, 6, 0], mosque: [24, 32, 12, 6, 0], synagogue: [16, 26, 14, 6, 1], temple: [20, 26, 12, 6, 0],
  'brick-warehouse': [30, 60, 14, 5, 0], 'low-shed': [15, 30, 6, 4, 2], fallback: [10, 15, 8, 0, 1]
};
export function lotSize(id) {
  if (MORE[id]) { const [w, d, h, dwellings] = MORE[id]; return { w, d, h, kind: 0, roof: 1, dwellings }; }
  if (id.startsWith('main-street-shop')) { const [w, d, h, kind, roof] = SIZES[id]; return { w, d, h, kind, roof, dwellings: 1, gap: 0, shop: true }; } // (a joined run of shops)
  const form = id.endsWith('-detached') ? 'detached' : id.endsWith('-semi') ? 'semi' : id.endsWith('-row') || id === 'modern-townhouse-row' ? 'row' : null;
  const [w, d, h, kind, roof] = form ? HOUSE[form] : SIZES[id] || SIZES.fallback;
  const dwellings = form === 'semi' ? 2 : form === 'row' ? Math.max(3, Math.round(w / 5)) : 1;
  return { w, d, h, kind, roof, dwellings };
}

/**
 * ids (the catalogue's preset ids in order), counts ({ id: downtown buildings }), drawn (a Set of the ids with drawing
 * rules), syntactic origin -> { lots, rows, rect, start }. A lot: { preset, building (the GEO.buildings row), foot (the
 * massing record), x, z, w, d }. A row: { preset, count, drawn, x, z (its first lot's centre), w (its length), d, front }.
 */
export function galleryLayout(ids, counts, drawn, makeLot, origin = GALLERY_ORIGIN, columns = GALLERY_COLUMNS) {
  const order = [...ids.filter((id) => drawn.has(id) && id !== 'fallback'), ...ids.filter((id) => !drawn.has(id) && id !== 'fallback')];
  const perColumn = Math.ceil(order.length / columns);
  const rows = [], lots = [];
  let colX = origin.x, rect = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (let c = 0; c < columns; c++) {
    const members = order.slice(c * perColumn, (c + 1) * perColumn);
    if (!members.length) break;
    let colW = 0, front = origin.z;
    for (const preset of members) {
      const size = lotSize(preset);
      const gap = size.gap ?? LOT_GAP;
      const rowW = LOTS_PER_ROW * size.w + (LOTS_PER_ROW - 1) * gap;
      colW = Math.max(colW, rowW);
      const cz = front - size.d / 2; // the row's lots stand back from `front` (their fronts toward +z)
      rows.push({ preset, count: counts[preset] || 0, drawn: drawn.has(preset), x: colX, z: cz, w: rowW, d: size.d, front, h: size.h });
      for (let i = 0; i < LOTS_PER_ROW; i++) {
        const cx = colX + size.w / 2 + i * (size.w + gap);
        const lot = makeLot({ preset, index: i, cx, cz, ...size });
        lots.push(lot);
        if (lot.extra) lots.push(lot.extra); // (a podium under a tower, a church's tower part: one more building row of the same group)
      }
      rect.x0 = Math.min(rect.x0, colX); rect.x1 = Math.max(rect.x1, colX + rowW);
      rect.z0 = Math.min(rect.z0, front - size.d); rect.z1 = Math.max(rect.z1, front);
      front -= size.d + ROW_GAP;
    }
    colX += colW + COLUMN_GAP;
  }
  const margin = 30;
  rect = { x0: rect.x0 - margin, x1: rect.x1 + margin, z0: rect.z0 - margin, z1: rect.z1 + margin };
  const first = rows[0];
  return { lots, rows, rect, start: { x: first.x + first.w / 2, z: first.front + 16, heading: Math.PI } };
}

/** A lot's building-list row and massing record, from the shared lot shape (js/building-draw.js syntheticLot). */
let FOOT_INDEX = 0;
const TRADITIONS = ['roman catholic', 'anglican', 'baptist', 'presbyterian', 'unknown', 'orthodox'];
const TEMPLE_RELIGIONS = ['buddhist', 'hindu', 'sikh'];
// (st-ndw9.20) the towers that stand on a podium in the gallery: every lot, or the odd ones; the podium's height
const PODIUM_ROWS = { 'glass-tower-podium': 'all', 'dark-curtain-wall-tower': 'odd', 'contemporary-glass': 'odd', tower: 'third' };
export function makeGalleryLot(syntheticLot) {
  return ({ preset, index, cx, cz, w, d, h, kind, roof, dwellings, shop }) => {
    const id = `gallery:${preset}:${index}`;
    // (a shop run: each building its own height, joined by its party walls; a house: every other lot has a rear wing)
    if (shop) h = Math.round(h * [1, 1.4, 0.85, 1.25, 1.0, 1.5][index % 6] * 10) / 10;
    const row = (lw, ld, lh, lx, lz, opts, lid, facts) => {
      const foot = syntheticLot(lid, lx, lz, lw, ld, preset, opts);
      foot.index = -(++FOOT_INDEX); // (a number of its own: the group's parts tell each other apart by it)
      foot.drawFacts = { groupId: id, dwellings, ...facts };
      const seed = Math.abs(hashString(lid)) % 1000;
      const building = [lx, lz, 0, [[-lw / 2, lw / 2, -ld / 2, ld / 2]], lh, kind, roof, seed, 0, `gallery ${preset} ${index + 1}`];
      return { preset, building, foot, x: lx, z: lz, w: lw, d: ld };
    };
    if (shop || kind === 0) {
      const foot = syntheticLot(id, cx, cz, w, d, preset, shop ? { joined: true, h } : kind === 0 && index % 2 === 1 ? { wing: true, wingLeft: index % 4 === 1 } : {});
      foot.drawFacts = { groupId: id, dwellings };
      // (the building list's row: centre, turn, one box part, height, kind, roof, a seed per lot, name)
      const seed = Math.abs(hashString(id)) % 1000;
      const building = [cx, cz, 0, [[-w / 2, w / 2, -d / 2, d / 2]], h, kind, roof, seed, 0, `gallery ${preset} ${index + 1}`];
      return { preset, building, foot, x: cx, z: cz, w, d };
    }
    // ---- the apartments, towers, offices and low blocks
    const podiumRow = PODIUM_ROWS[preset];
    const podium = podiumRow === 'all' || (podiumRow === 'odd' && index % 2 === 1) || (podiumRow === 'third' && index % 3 === 2);
    if (kind === 1 || kind === 2 || kind === 3) {
      const slabRow = preset === 'slab-tower' || (preset === 'tower' && !podium && index % 2 === 0);
      const tw = slabRow ? w : podium ? Math.round(w * 0.55) : preset === 'tower' ? Math.round(w * 0.5) : w, td = slabRow ? (preset === 'slab-tower' ? 15 : 14) : podium ? Math.round(d * 0.55) : preset === 'tower' ? Math.round(d * 0.62) : d;
      const th = h, ph = podium ? 12 : 0;
      const group = { n: podium ? 2 : 1, area: tw * td + (podium ? w * d : 0), maxH: th, podium, mainAspect: Math.max(tw, td) / Math.min(tw, td), mainLong: Math.max(tw, td) };
      const towerLot = row(tw, td, th, cx, podium ? cz - (d - td) / 2 + 2 : cz, podium ? { base: ph } : {}, id, { group });
      if (podium) towerLot.extra = row(w, d, ph, cx, cz, {}, `${id}:podium`, { group });
      return towerLot;
    }
    // ---- the places of worship: religion by row, a church's traditions in turn; Gothic churches on odd lots get a tower part
    const religion = preset === 'mosque' ? 'muslim' : preset === 'synagogue' ? 'jewish' : preset === 'temple' ? TEMPLE_RELIGIONS[index % 3] : 'christian';
    const tradition = preset === 'church-gothic' ? TRADITIONS[index % TRADITIONS.length] : '';
    const towerPart = preset === 'church-gothic' && index % 2 === 1;
    // (the last two lots of a mosque or temple row are converted buildings: small, and two or three ordinary storeys tall)
    const conv = (preset === 'mosque' || preset === 'temple') && index >= 4;
    if (conv) { w = 14; d = 20; h = 11; }
    const naveFoot = row(w, d, h, cx, cz, {}, id, {});
    const recs = [{ index: naveFoot.foot.index, area: w * d, h, asp: Math.max(w, d) / Math.min(w, d) }];
    let tower = null;
    if (towerPart) {
      tower = row(6, 6, h + 8, cx + w / 2 - 3, cz + d / 2 + 3, {}, `${id}:tower`, {});
      recs.push({ index: tower.foot.index, area: 36, h: h + 8, asp: 1 });
    }
    const group = { n: recs.length, area: w * d, maxH: h, podium: false, mainAspect: Math.max(w, d) / Math.min(w, d), mainLong: Math.max(w, d), religion, tradition, name: '', recs };
    naveFoot.foot.drawFacts.group = group;
    if (tower) { tower.foot.drawFacts.group = group; naveFoot.extra = tower; }
    return naveFoot;
  };
}
function hashString(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }

// ---- the page (browser only) -------------------------------------------------------------------------------------------
/**
 * A flat ground over the gallery's rect (one mesh, the gallery's own) and a plain text label over every row, and a short
 * help line. Returns { dispose }. `names`: { preset id: its catalogue name }.
 */
export function mountGallery({ THREE, scene, cameraSystem, layout, names }) {
  const { rect } = layout;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(rect.x1 - rect.x0, rect.z1 - rect.z0),
    new THREE.MeshStandardNodeMaterial({ color: 0x8a9473, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((rect.x0 + rect.x1) / 2, 0.2, (rect.z0 + rect.z1) / 2);
  ground.receiveShadow = true;
  ground.name = 'GalleryGround';
  scene.add(ground);

  const layer = document.createElement('div');
  layer.id = 'building-gallery-labels';
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;font:12px/1.3 ui-monospace,Menlo,monospace;color:#fff;';
  const rowEls = layout.rows.map((row) => {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;transform:translate(-50%,-100%);padding:2px 6px;background:rgba(0,0,0,.62);border-radius:3px;white-space:nowrap;';
    el.textContent = `${names[row.preset] || row.preset} · ${row.count.toLocaleString('en-CA')} buildings downtown${row.drawn ? '' : ' · not drawn yet'}`;
    layer.appendChild(el);
    return el;
  });
  const help = document.createElement('div');
  help.style.cssText = 'position:absolute;left:8px;bottom:8px;padding:2px 6px;background:rgba(0,0,0,.62);border-radius:3px;';
  help.textContent = 'gallery=presets: every row is one preset, six lots with different seeds; the drawn ones first. Walk or fly along the rows.';
  layer.appendChild(help);
  document.body.appendChild(layer);

  const v = new THREE.Vector3();
  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const cam = cameraSystem && cameraSystem.camera;
    if (!cam) return;
    const w = window.innerWidth, h = window.innerHeight;
    layout.rows.forEach((row, i) => {
      v.set(row.x + row.w / 2, row.h + 3, row.front - row.d / 2).project(cam);
      const el = rowEls[i];
      const near = Math.hypot(cam.position.x - (row.x + row.w / 2), cam.position.z - (row.front - row.d / 2)) < row.w / 2 + 60; // (only the rows beside you: the rest would pile up in one line of sight)
      const on = near && v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      el.style.display = on ? 'block' : 'none';
      if (on) { el.style.left = `${(v.x * 0.5 + 0.5) * w}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`; }
    });
  };
  tick();
  return { dispose() { cancelAnimationFrame(raf); layer.remove(); scene.remove(ground); } };
}
