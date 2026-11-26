// tools/perf4/lib4.js: the ground-cost probe (st-aeg2.4), evaluated after tools/perf1/lib.js. Everything is runtime: nothing reloads.
// Run on the Mac mini through gpu2 only.
(() => {
  const A = window.__CITY_APP, scene = A.scene, R = A.renderer, T = window.CITY.THREE, P = window.__P;
  const sleep = P.sleep;
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const vis = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  const matsOf = (m) => (Array.isArray(m.material) ? m.material : [m.material]);
  const triOf = (m) => { const g = m.geometry; if (!g) return 0; const n = g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0; return (n / 3) * (m.isInstancedMesh ? m.count : 1); };

  // the top-level groups that are ground: CityGround's children by name, and any other top-level group named in GROUND_TOPS
  P.GROUND_TOPS = ['CityGround'];
  // (an entry may be 'Top/Child': one named child of a top-level group, as its own part)
  const tops = () => scene.children.filter((c) => P.GROUND_TOPS.includes(c.name || c.type));
  P.parts = () => {
    const parts = {};
    for (const top of tops()) {
      if ((top.name || top.type) === 'CityGround') for (const c of top.children) (parts[c.name || '(' + c.type + ')'] ||= []).push(c);
      else (parts[top.name || top.type] ||= []).push(top);
    }
    for (const e of P.GROUND_TOPS.filter((x) => x.includes('/'))) { const [t, k] = e.split('/'); for (const top of scene.children.filter((c) => (c.name || c.type) === t)) for (const c of top.children) if ((c.name || c.type) === k) (parts[e] ||= []).push(c); }
    return parts;
  };
  const meshesUnder = (o) => { const l = []; o.traverse((m) => { if (m.isMesh || m.isLine || m.isPoints) l.push(m); }); return l; };

  // ---- inventory: by part, the meshes, triangles, draws, materials and their state
  const matInfo = (mt) => ({ cls: mt.type, name: mt.name || '', id: mt.id, transparent: mt.transparent, opacity: mt.opacity, alphaTest: mt.alphaTest, depthWrite: mt.depthWrite, depthTest: mt.depthTest,
    depthFunc: mt.depthFunc, side: mt.side, po: mt.polygonOffset ? [mt.polygonOffsetFactor, mt.polygonOffsetUnits] : null, blending: mt.blending,
    mask: !!mt.maskNode, opacityNode: !!mt.opacityNode, alphaTestNode: !!mt.alphaTestNode, colorNode: !!mt.colorNode, normalNode: !!mt.normalNode, roughnessNode: !!mt.roughnessNode,
    positionNode: !!mt.positionNode, emissiveNode: !!mt.emissiveNode, aoNode: !!mt.aoNode, lights: mt.lights, fog: mt.fog });
  P.inv = (opts = {}) => {
    const cam = A.cameraSystem.camera; cam.updateMatrixWorld();
    const fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), cam.coordinateSystem, cam.reversedDepth);
    const sp = new T.Sphere();
    const out = {};
    for (const [name, objs] of Object.entries(P.parts())) {
      const r = out[name] = { objs: objs.length, meshes: 0, instanced: 0, inFrustum: 0, tris: 0, trisInFrustum: 0, casters: 0, receivers: 0, renderOrder: new Set(), mats: {}, visible: objs.every(vis), kidTypes: {} };
      for (const o of objs) for (const m of meshesUnder(o)) {
        r.meshes++; if (m.isInstancedMesh) r.instanced++;
        const t = triOf(m); r.tris += t;
        r.kidTypes[m.type] = (r.kidTypes[m.type] || 0) + 1;
        if (m.castShadow) r.casters++; if (m.receiveShadow) r.receivers++;
        r.renderOrder.add(m.renderOrder);
        let inside = true;
        if (m.geometry) { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sp.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld); inside = vis(m) && fr.intersectsSphere(sp) && m.frustumCulled !== undefined; }
        if (inside) { r.inFrustum++; r.trisInFrustum += t; }
        for (const mt of matsOf(m)) { if (!mt) continue; const k = mt.id; (r.mats[k] ||= { ...matInfo(mt), meshes: 0 }).meshes++; }
      }
      r.renderOrder = [...r.renderOrder];
      r.mats = Object.values(r.mats);
    }
    return out;
  };
  // CityGroundBand: what a band holds (cells of the ground the culling system draws): by kid name and material
  P.bands = () => {
    const g = scene.getObjectByName('CityGround'); const out = { bands: 0, visibleBands: 0, kids: {} };
    const cam = A.cameraSystem.camera; cam.updateMatrixWorld();
    const fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), cam.coordinateSystem, cam.reversedDepth);
    const sp = new T.Sphere();
    for (const b of g.children) { if ((b.name || '') !== 'CityGroundBand') continue; out.bands++; if (b.visible) out.visibleBands++;
      for (const m of b.children) { if (!m.isMesh) { const k = `(${m.type}) ${m.name}`; out.kids[k] = (out.kids[k] || 0) + 1; continue; }
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sp.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
        const k = `${m.name || '?'} m${matsOf(m)[0].id}`; const e = out.kids[k] ||= { n: 0, visible: 0, inFr: 0, tris: 0, trisDrawn: 0, recv: 0, cast: 0 };
        e.n++; e.tris += triOf(m); if (m.receiveShadow) e.recv++; if (m.castShadow) e.cast++; if (b.visible && m.visible) { e.visible++; if (fr.intersectsSphere(sp)) { e.inFr++; e.trisDrawn += triOf(m); } } } }
    return out;
  };
  P.cuts = () => { const C = window.CITY; const rc = C.ROAD_CUTS || []; return { roadCuts: rc.length, roadCutSegs: rc.reduce((a, c) => a + (c.segs ? c.segs.length : 0), 0), subwayCutRects: (C.SUBWAY_CUT_RECTS || []).length, hasBankMask: true }; };
  P.topInv = () => scene.children.map((c) => { let n = 0, tris = 0; c.traverse((m) => { if (m.isMesh || m.isLine || m.isPoints) { n++; tris += triOf(m); } }); return { name: c.name || c.type, type: c.type, visible: c.visible, kids: c.children.length, meshes: n, tris: Math.round(tris), ro: c.renderOrder }; });

  // ---- fragment shader statistics for one representative mesh of each material (WGSL text: static counts, loops count once)
  P.shaders = async (opts = {}) => {
    const out = {}, seen = new Set();
    const cam = A.cameraSystem.camera;
    for (const [name, objs] of Object.entries(P.parts())) {
      for (const o of objs) for (const m of meshesUnder(o)) {
        if (!m.visible || !vis(m)) continue;
        for (const mt of matsOf(m)) {
          if (!mt || seen.has(mt.id)) continue; seen.add(mt.id);
          try {
            const sh = await R.debug.getShaderAsync(scene, cam, m);
            const f = sh.fragmentShader || '', v = sh.vertexShader || '';
            const c = (re, s = f) => (s.match(re) || []).length;
            out[`${name}#${mt.id}`] = { part: name, mat: mt.type + ' ' + (mt.name || ''), fragLines: f.split('\n').length, fragBytes: f.length, vertLines: v.split('\n').length,
              tex: c(/textureSample\(/g), texLevel: c(/textureSampleLevel\(/g), texGrad: c(/textureSampleGrad\(/g), cmp: c(/textureSampleCompare/g), load: c(/textureLoad\(/g), discard: c(/discard;/g),
              loops: c(/\bfor\s*\(|\bloop\b|\bwhile\s*\(/g), deriv: c(/dpdx|dpdy|fwidth/g), sqrt: c(/sqrt\(/g), pow: c(/\bpow\(/g), fract: c(/\bfract\(/g), floor: c(/\bfloor\(/g), sin: c(/\bsin\(|\bcos\(/g), uniforms: c(/\bnodeUniform\d+/g),
              shadowRefs: c(/shadow/gi), bindings: c(/@binding\(/g, sh.fragmentShader) };
            if (opts.keep && opts.keep.includes(name)) out[`${name}#${mt.id}`].frag = f;
          } catch (e) { out[`${name}#${mt.id}`] = { part: name, err: String(e).slice(0, 200) }; }
        }
      }
    }
    return out;
  };

  // ---- layers: rays through a w x h grid of the frame against the ground meshes; for each ray the ground surfaces the ray crosses (front faces
  // only, material side honoured) in front of the first building hit and behind it. Reports the layer count and the stack signatures
  // ---- layers: for each ground part, the screen area its in-frustum triangles cover (clipped to the near plane and the screen, front faces
  // only per the material's side), as layers per screen pixel: the fragments the part rasterises before any depth test, over the whole frame
  const _v = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
  const clipPoly = (poly, inside, inter) => { const out = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], ia = inside(a), ib = inside(b); if (ia) out.push(a); if (ia !== ib) out.push(inter(a, b)); } return out; };
  P.layers = (opts = {}) => {
    const cam = A.cameraSystem.camera; cam.updateMatrixWorld();
    const view = cam.matrixWorldInverse, proj = cam.projectionMatrix, W = R.domElement.width, H = R.domElement.height;
    const vp = new T.Matrix4().multiplyMatrices(proj, view);
    const fr0 = new T.Frustum().setFromProjectionMatrix(vp, cam.coordinateSystem, cam.reversedDepth), sp0 = new T.Sphere();
    const res = {}; let total = 0;
    const e = vp.elements;
    const clipOf = (v, o) => { o[0] = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12]; o[1] = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13]; o[2] = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14]; o[3] = e[3] * v.x + e[7] * v.y + e[11] * v.z + e[15]; };
    for (const [name, objs] of Object.entries(P.parts())) for (const o of objs) for (const m of meshesUnder(o)) {
      if (!m.isMesh || m.isInstancedMesh || !vis(m)) continue;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sp0.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld); if (!fr0.intersectsSphere(sp0)) continue;
      const g = m.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
      const mt = Array.isArray(m.material) ? m.material[0] : m.material, side = mt.side;
      const r = res[name] ||= { tris: 0, drawnTris: 0, area: 0, culledBack: 0, meshes: 0, rejTriv: 0, rejW: 0, rejClip: 0, sample: null }; r.meshes++;
      const c = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
      for (let t = 0; t + 2 < n; t += 3) {
        r.tris++;
        let allOut = true;
        for (let k = 0; k < 3; k++) { _v[k].fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(m.matrixWorld); clipOf(_v[k], c[k]); }
        // trivially outside one frustum side
        let rej = false;
        for (let pl = 0; pl < 5 && !rej; pl++) { const sgn = pl % 2 ? -1 : 1, ax = pl >> 1; if (pl < 4 && c[0][ax] * sgn < -c[0][3] && c[1][ax] * sgn < -c[1][3] && c[2][ax] * sgn < -c[2][3]) rej = true; }
        if (!r.sample && t === 300) r.sample = [c[0].slice(), c[1].slice(), c[2].slice(), _v[0].toArray()];
        if (rej) { r.rejTriv++; continue; }
        if (c[0][3] <= 0 && c[1][3] <= 0 && c[2][3] <= 0) { r.rejW++; continue; }
        // clip to w > 0.001 then to the screen, in clip space (x,y,w) -> NDC
        let poly = [c[0], c[1], c[2]];
        poly = clipPoly(poly, (p) => p[3] > 0.001, (a, b) => { const tt = (0.001 - a[3]) / (b[3] - a[3]); return [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt, 0, 0.001]; });
        if (poly.length < 3) { r.rejW++; continue; }
        let pts = poly.map((p) => [p[0] / p[3], p[1] / p[3]]);
        for (const [ax, sg] of [[0, 1], [0, -1], [1, 1], [1, -1]]) { pts = clipPoly(pts, (p) => p[ax] * sg <= 1, (a, b) => { const tt = (sg - a[ax]) / (b[ax] - a[ax]); return [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt]; }); if (pts.length < 3) break; }
        if (pts.length < 3) { r.rejClip++; continue; }
        let ar = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; ar += p[0] * q[1] - q[0] * p[1]; }
        // sign: counter-clockwise in NDC = front face for a CCW triangle
        const signed = ar / 2;
        if ((side === T.FrontSide && signed <= 0) || (side === T.BackSide && signed >= 0)) { r.culledBack++; continue; }
        r.drawnTris++; r.area += Math.abs(signed) / 4; // NDC area 4 = the whole screen
      }
    }
    for (const r of Object.values(res)) { r.layers = +r.area.toFixed(3); total += r.area; delete r.area; }
    return { screen: [W, H], totalLayers: +total.toFixed(3), parts: Object.fromEntries(Object.entries(res).sort((a, b) => b[1].layers - a[1].layers)) };
  };

  // ---- arms. each: { id, on(), off() }
  const flatMats = {};
  const flatFor = (mt, keepMask) => {
    const key = mt.id + (keepMask ? 'm' : 'n');
    if (flatMats[key]) return flatMats[key];
    const f = new T.MeshBasicNodeMaterial({ color: 0x808080 });
    f.side = mt.side; f.transparent = mt.transparent; f.depthWrite = mt.depthWrite; f.depthTest = mt.depthTest; f.depthFunc = mt.depthFunc;
    f.polygonOffset = mt.polygonOffset; f.polygonOffsetFactor = mt.polygonOffsetFactor; f.polygonOffsetUnits = mt.polygonOffsetUnits; f.alphaTest = mt.alphaTest;
    if (keepMask && mt.maskNode) f.maskNode = mt.maskNode;
    if (keepMask && mt.alphaTestNode) f.alphaTestNode = mt.alphaTestNode;
    if (keepMask && mt.opacityNode) f.opacityNode = mt.opacityNode;
    f.fog = false;
    flatMats[key] = f; return f;
  };
  const partObjs = (name) => (name === 'ALL' ? Object.values(P.parts()).flat() : P.parts()[name] || []);
  P.hide = (name) => { const o = partObjs(name); return { id: 'hide:' + name, on() { this.was = o.map((x) => x.visible); o.forEach((x) => { x.visible = false; }); }, off() { o.forEach((x, i) => { x.visible = this.was[i]; }); } }; };
  P.flat = (name, keepMask = true) => ({ id: `flat${keepMask ? '' : '-nomask'}:${name}`, on() { this.l = partObjs(name).flatMap(meshesUnder).filter((m) => m.isMesh); this.was = this.l.map((m) => m.material);
    this.l.forEach((m) => { m.material = Array.isArray(m.material) ? m.material.map((x) => flatFor(x, keepMask)) : flatFor(m.material, keepMask); }); }, off() { this.l.forEach((m, i) => { m.material = this.was[i]; }); } });
  // albedo only: the real colour node on an unlit basic material (the procedural albedo's cost, none of the lighting, shadows or other channels)
  const albMats = {}, lcMats = {};
  const albFor = (mt) => { if (albMats[mt.id]) return albMats[mt.id]; const { vec3 } = window.CITY.TSL; const f = new T.MeshBasicNodeMaterial(); f.colorNode = mt.colorNode || vec3(0.5); f.side = mt.side; f.fog = false; f.toneMapped = mt.toneMapped;
    f.polygonOffset = mt.polygonOffset; f.polygonOffsetFactor = mt.polygonOffsetFactor; f.polygonOffsetUnits = mt.polygonOffsetUnits; if (mt.maskNode) f.maskNode = mt.maskNode; return (albMats[mt.id] = f); };
  // lit with constants: the real material's lighting model, shadows and IBL, but a constant colour and none of the other procedural channels
  const lcFor = (mt) => { if (lcMats[mt.id]) return lcMats[mt.id]; const { vec3, float } = window.CITY.TSL; const c = mt.clone(); c.colorNode = vec3(0.5); c.normalNode = null; c.roughnessNode = null; c.metalnessNode = null; c.aoNode = null; c.emissiveNode = null; c.opacityNode = null; c.alphaTestNode = null;
    c.roughness = 0.6; c.metalness = 0; return (lcMats[mt.id] = c); };
  const swapArm = (id, name, fn) => ({ id: `${id}:${name}`, on() { this.l = partObjs(name).flatMap(meshesUnder).filter((m) => m.isMesh); this.was = this.l.map((m) => m.material); this.l.forEach((m) => { m.material = Array.isArray(m.material) ? m.material.map(fn) : fn(m.material); }); }, off() { this.l.forEach((m, i) => { m.material = this.was[i]; }); } });
  P.albedo = (name) => swapArm('albedo', name, albFor);
  P.litconst = (name) => swapArm('litconst', name, lcFor);
  // render order by material (all draws of one ground material together), the group placed at `base`
  P.orderMat = (name, base) => ({ id: `orderMat${base}:${name}`, on() { this.l = partObjs(name).flatMap(meshesUnder).filter((m) => m.isMesh); this.was = this.l.map((m) => m.renderOrder);
    const ids = [...new Set(this.l.map((m) => (Array.isArray(m.material) ? m.material[0] : m.material).id))].sort((a, b) => a - b); this.l.forEach((m) => { m.renderOrder = base + ids.indexOf((Array.isArray(m.material) ? m.material[0] : m.material).id); }); },
    off() { this.l.forEach((m, i) => { m.renderOrder = this.was[i]; }); } });
  // every mesh drawn with the road surface material (the street level and the bands' copies) moved in the render order (a string arg is a number)
  P.roadOrder = (ro) => ({ id: `roadOrder${ro}`, on() { const rid = P.parts().StreetLevel[0].material.id; this.l = Object.values(P.parts()).flat().flatMap(meshesUnder).filter((m) => m.isMesh && (Array.isArray(m.material) ? m.material[0] : m.material).id === rid);
    this.was = this.l.map((m) => m.renderOrder); this.l.forEach((m) => { m.renderOrder = Number(ro); }); }, off() { this.l.forEach((m, i) => { m.renderOrder = this.was[i]; }); } });
  // the renderer's opaque sort changed: draws whose material can discard (a mask, an alpha test) after the ones that cannot ('last'), optionally also grouped by material
  // before the front-to-back order ('lastmat'), or the reverse ('first')
  const hasD = (m) => !!(m && (m.maskNode || m.alphaTestNode || m.alphaTest > 0 || m.alphaToCoverage));
  P.sortArm = (kind) => ({ id: 'sort:' + kind, on() {
    const dir = kind === 'first' ? -1 : 1, byMat = kind === 'lastmat';
    R.setOpaqueSort((a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || (hasD(a.material) - hasD(b.material)) * dir || (byMat ? a.material.id - b.material.id : 0) || a.z - b.z || a.id - b.id); }, off() { R.setOpaqueSort(null); } });
  // the real material with its mask (road cuts, waterfront and the water mask) removed: an upper bound on what splitting the masked areas off would save. Needs the
  // temporary probe line in city-grid.js maskedByWater (mat.unmaskedColorNode)
  const nmMats = {};
  const nmFor = (mt) => { if (nmMats[mt.id]) return nmMats[mt.id]; if (!mt.maskNode && !mt.unmaskedColorNode) return (nmMats[mt.id] = mt); const c = mt.clone(); c.maskNode = null; if (mt.unmaskedColorNode) c.colorNode = mt.unmaskedColorNode; return (nmMats[mt.id] = c); };
  P.noMask = (name) => swapArm('nomask', name, nmFor);
  // the real mask kept in the shader (so the material still can discard) but behind a branch that is never taken: what the mask costs as arithmetic, with the discard still there
  const gmMats = {};
  const gmFor = (mt) => { if (gmMats[mt.id]) return gmMats[mt.id]; if (!mt.maskNode) return (gmMats[mt.id] = mt); const { Fn, If, bool, float, positionWorld } = window.CITY.TSL; const c = mt.clone();
    c.maskNode = Fn(() => { const k = bool(true).toVar(); If(positionWorld.x.greaterThan(float(1e9)), () => { k.assign(mt.maskNode); }); return k; })(); return (gmMats[mt.id] = c); };
  P.guardMask = (name) => swapArm('guardmask', name, gmFor);
  P.order = (name, ro) => ({ id: `order${ro}:${name}`, on() { this.l = partObjs(name).flatMap(meshesUnder); this.was = this.l.map((m) => m.renderOrder); this.l.forEach((m) => { m.renderOrder = ro; }); }, off() { this.l.forEach((m, i) => { m.renderOrder = this.was[i]; }); } });
  P.noRecv = (name) => ({ id: 'norecv:' + name, on() { this.l = partObjs(name).flatMap(meshesUnder); this.was = this.l.map((m) => m.receiveShadow); this.l.forEach((m) => { m.receiveShadow = false; }); }, off() { this.l.forEach((m, i) => { m.receiveShadow = this.was[i]; }); } });
  P.noCast = (name) => ({ id: 'nocast:' + name, on() { this.l = partObjs(name).flatMap(meshesUnder); this.was = this.l.map((m) => m.castShadow); this.l.forEach((m) => { m.castShadow = false; }); }, off() { this.l.forEach((m, i) => { m.castShadow = this.was[i]; }); } });
  // everything that is not ground drawn flat and unlit is not offered: instead the ground is measured alone: every other top-level group hidden
  P.only = (name) => ({ id: 'only:' + name, on() { const keep = new Set(partObjs(name)); const tp = new Set(tops()); this.l = [];
    for (const c of scene.children) { if (c.isLight || !c.visible) continue; if (tp.has(c)) { if (name !== 'ALL' && (c.name || c.type) === 'CityGround') { for (const k of c.children) if (!keep.has(k) && k.visible) { this.l.push(k); k.visible = false; } } continue; } this.l.push(c); c.visible = false; } },
    off() { this.l.forEach((c) => { c.visible = true; }); } });
  const parseArm = (s) => { const [kind, arg, arg2] = s.split(':'); return P[kind === 'flatn' ? 'flat' : kind](arg, kind === 'flatn' ? false : (arg2 === undefined ? undefined : isNaN(+arg2) ? arg2 : +arg2)); };
  // 'a~b' turns both on (an arm per part of a combination)
  P.armsFor = (spec) => spec.map((s) => { if (!s.includes('~')) return parseArm(s); const l = s.split('~').map(parseArm); return { id: s, on() { l.forEach((a) => a.on()); }, off() { l.slice().reverse().forEach((a) => a.off()); } }; });

  // ---- the runner: B A B A with the arm's own settle; prewarm every arm once untimed (pipelines compile)
  P.run4 = async ({ arms, rounds = 3, warm = 300, win = 1300, settle = 600, prewarm = true } = {}) => {
    const t0 = performance.now();
    if (prewarm) for (const a of arms) { a.on(); await sleep(settle + 600); a.off(); await sleep(250); }
    const res = {}; let prev = await P.meas(warm, win); const bases = [prev.ms];
    for (let k = 0; k < rounds; k++) for (const arm of arms) {
      arm.on(); await sleep(settle);
      const a = await P.meas(warm, win);
      arm.off(); await sleep(250);
      const b = await P.meas(warm, win); bases.push(b.ms);
      (res[arm.id] ||= { runs: [] }).runs.push({ a: a.ms, b0: prev.ms, b1: b.ms, d: +(a.ms - (prev.ms + b.ms) / 2).toFixed(2), cpuA: a.cpu, cpuB: (prev.cpu + b.cpu) / 2 });
      prev = b;
    }
    for (const r of Object.values(res)) { r.d = +med(r.runs.map((x) => x.d)).toFixed(2); r.mean = +(r.runs.reduce((s, x) => s + x.d, 0) / r.runs.length).toFixed(2); r.spread = +(Math.max(...r.runs.map((x) => x.d)) - Math.min(...r.runs.map((x) => x.d))).toFixed(2); }
    const bs = [...bases].sort((x, y) => x - y);
    return { place: P.place, base: { median: bs[bs.length >> 1], min: bs[0], max: bs.at(-1), n: bs.length }, arms: res, elapsedS: Math.round((performance.now() - t0) / 1000) };
  };

  // ---- draw order of the main pass over one frame (run-length by group/child/material), the order the render list sorted it into
  let ordLog = null, curCam = null;
  const origR = R.render;
  R.render = function (sc, cam) { const prev = curCam; curCam = cam === A.cameraSystem.camera ? 'main' : 'x'; try { return origR.call(this, sc, cam); } finally { curCam = prev; } };
  const inf = R.info, upd0 = inf.update.bind(inf);
  inf.update = function (object, count, instanceCount) {
    upd0(object, count, instanceCount);
    if (!ordLog || curCam !== 'main') return;
    let top = object, second = null;
    while (top.parent && top.parent !== scene) { second = top; top = top.parent; }
    const mt = Array.isArray(object.material) ? object.material[0] : object.material;
    ordLog.push([(top.name || top.type) + (second ? '/' + (second.name || second.type) : ''), mt ? mt.id : -1, object.isMesh ? Math.round((instanceCount || 1) * count / 3) : 0, !!(mt && (mt.transparent)), object.renderOrder]);
  };
  P.drawOrder = async () => {
    ordLog = []; const f0 = A.frameNo; while (A.frameNo - f0 < 1) await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => requestAnimationFrame(r));
    const l = ordLog; ordLog = null;
    const rle = []; for (const e of l) { const k = e[0] + ' m' + e[1] + (e[3] ? ' T' : '') + (e[4] ? ' ro' + e[4] : ''); const t = rle.at(-1); if (t && t[0] === k) { t[1]++; t[2] += e[2]; } else rle.push([k, 1, e[2]]); }
    return { draws: l.length, rle };
  };

  // ---- overdraw on the GPU: each ground part drawn alone into a half-float target with additive 1/64 per fragment and no depth test: the number of
  // fragments each pixel receives from that part (road cut and water discards kept, material side kept). Reports, per part and for all parts together,
  // the mean layers over the frame, the share of the frame covered and the layer histogram of the covered pixels
  const h2f = (h) => { const e = (h >> 10) & 31, f = h & 1023; return e === 0 ? (f / 1024) * 6.103515625e-5 : (1 + f / 1024) * Math.pow(2, e - 15); };
  let cntMats = null;
  const cntMat = (mt) => {
    cntMats ||= new Map();
    let c = cntMats.get(mt.id); if (c) return c;
    const { vec3 } = window.CITY.TSL;
    c = new T.MeshBasicNodeMaterial(); c.colorNode = vec3(1 / 64, 1 / 64, 1 / 64); c.side = mt.side; c.transparent = true; c.blending = T.AdditiveBlending; c.depthTest = false; c.depthWrite = false; c.fog = false;
    c.toneMapped = false; if (mt.maskNode) c.maskNode = mt.maskNode; if (mt.alphaTestNode) c.alphaTestNode = mt.alphaTestNode; c.alphaTest = mt.alphaTest;
    cntMats.set(mt.id, c); return c;
  };
  P.overdraw = async () => {
    const cam = A.cameraSystem.camera, W = R.domElement.width, H = R.domElement.height;
    const rt = new T.RenderTarget(W, H, { type: T.HalfFloatType, format: T.RGBAFormat, depthBuffer: false });
    const parts = P.parts(), out = {};
    const hold = scene.children.filter((c) => c.visible && !c.isLight); const bg = scene.background, fogv = scene.fog;
    const pa = R.autoClear;
    const runOne = async (names) => {
      const keep = new Set(names.flatMap((n) => parts[n]));
      const hidden = [], swapped = [];
      for (const c of hold) { if (tops().includes(c)) { if ((c.name || c.type) === 'CityGround') { for (const k of c.children) if (!keep.has(k) && k.visible) { hidden.push(k); k.visible = false; } } else if (!keep.has(c)) { hidden.push(c); c.visible = false; } continue; } if (!keep.has(c)) { hidden.push(c); c.visible = false; } }
      // a top group that is a part, itself kept; for 'Top/Child' parts the other children of the top group are hidden
      for (const n of names) if (n.includes('/')) for (const o of parts[n]) { for (const k of o.parent.children) if (k !== o && k.visible) { hidden.push(k); k.visible = false; } o.parent.visible = true; }
      const ms = [...keep].flatMap(meshesUnder).filter((m) => m.isMesh && !m.isInstancedMesh);
      for (const m of ms) { swapped.push([m, m.material]); m.material = Array.isArray(m.material) ? m.material.map(cntMat) : cntMat(m.material); }
      scene.background = null; scene.fog = null; R.autoClear = true;
      R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.render(scene, cam); R.setRenderTarget(null);
      const buf = await R.readRenderTargetPixelsAsync(rt, 0, 0, W, H);
      for (const [m, mt] of swapped) m.material = mt; for (const k of hidden) k.visible = true; scene.background = bg; scene.fog = fogv; R.autoClear = pa;
      const n = W * H, hist = {}; let sum = 0, cov = 0;
      for (let i = 0; i < n; i++) { const v = Math.round(h2f(buf[i * 4]) * 64); if (v > 0) { cov++; sum += v; hist[v > 9 ? '10+' : v] = (hist[v > 9 ? '10+' : v] || 0) + 1; } }
      return { layers: +(sum / n).toFixed(3), covered: +(cov / n).toFixed(3), meanWhereCovered: +(sum / Math.max(1, cov)).toFixed(2), hist: Object.fromEntries(Object.entries(hist).map(([k, v]) => [k, +(v / n).toFixed(3)])) };
    };
    out.ALL = await runOne(Object.keys(parts));
    for (const n of Object.keys(parts)) { const r = await runOne([n]); if (r.covered > 0) out[n] = r; }
    rt.dispose();
    return out;
  };
  return 'lib4 ok';
})()
