// tools/perf1/lib.js: the in-page probe for the desktop frame census (st-aeg2). Evaluated once per page by
// tools/perf1/make.mjs's first shot; everything is then reached as window.__P. Run on the Mac mini through gpu2 only.
(() => {
  const A = window.__CITY_APP, scene = A.scene, R = A.renderer;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const P = window.__P = { sleep };

  // ---- places (world metres of the default page's frame; the same cameras as tools/shots/drawn-default-cost.json and
  // perf-pass-views.json, so numbers can be set beside the earlier censuses)
  const ll = (lat, lon) => window.CITY.worldFromLatLon(lat, lon);
  const stj = ll(43.6678, -79.3748), out = ll(43.7064, -79.3985);
  const egw = ll(43.7062, -79.4005), ege = ll(43.7075, -79.3920);
  const hpG = (x, z) => (window.CITY.cutAt ? window.CITY.cutAt(x, z) : 0) + (window.CITY.blockAt(x, z) ? 0.22 : 0);
  P.places = {
    cab: { x: 1800, z: -1601, cam: { pos: [1800, 1.7, -1601], look: [1650, 5, -1606], fov: 60 } },
    qwa: { x: -1386.6, z: -713.6, cam: { pos: [-1386.6, 1.7, -713.6], look: [-1370.6, 6, -713.3], fov: 65 } },
    tb: { x: -2700, z: -750, cam: { pos: [-2700, 1.7, -757], look: [-2950, 1.6, -760], fov: 60 } },
    fin: { x: 130, z: -345, cam: { pos: [130, 1.7, -352], look: [-200, 2.5, -352], fov: 60 } },
    fin300: { x: 420, z: -60, cam: { pos: [420, 300, -60], look: [420, 0, -520], fov: 60 } },
    stj: { x: stj.x, z: stj.z, cam: { pos: [stj.x - 120, 110, stj.z + 160], look: [stj.x, 30, stj.z], fov: 60 } },
    out: { x: out.x, z: out.z, cam: { pos: [out.x, 1.7, out.z], look: [out.x + 40, 6, out.z - 60], fov: 62 } },
    isl: { x: -658, z: 2419, cam: { pos: [-658, 1.7, 2419], look: [-935, 6, 2303], fov: 62 } },
    isln: { x: -658, z: 2419, cam: { pos: [-658, 1.7, 2419], look: [-658, 6, 2119], fov: 62 } },
    // (st-perf heavy views, 2026-11-26: High Park's densest woods on foot and from above, and a busy Eglinton street at Yonge looking east)
    hpw: { x: -6240, z: -2350, cam: { pos: [-6240, hpG(-6240, -2350) + 1.7, -2350], look: [-6200, hpG(-6200, -2440) + 4, -2440], fov: 62 } },
    hpa: { x: -6240, z: -2350, cam: { pos: [-6120, 70, -2230], look: [-6280, 10, -2400], fov: 55 } },
    egl: { x: egw.x, z: egw.z, cam: { pos: [egw.x, 1.7, egw.z], look: [ege.x, 6, ege.z], fov: 62 } },
    rom: { x: -300, z: -2640, cam: { pos: [-300, 20, -2640], look: [-349, 12, -2699], fov: 60 } },
    // (perf2 sheets: the same cameras at golden hour, a look at the sidewalk's dapple from 2 m up, one aerial, the Island at golden hour)
    cabg: { x: 1800, z: -1601, time: 'golden', cam: { pos: [1800, 1.7, -1601], look: [1650, 5, -1606], fov: 60 } },
    cabc: { x: 1800, z: -1601, cam: { pos: [1800, 2.2, -1601], look: [1797, 0, -1604], fov: 60 } },
    cabcg: { x: 1800, z: -1601, time: 'golden', cam: { pos: [1800, 2.2, -1601], look: [1803, 0, -1598], fov: 60 } },
    air: { x: 1700, z: -1650, cam: { pos: [1700, 150, -1515], look: [1700, 0, -1650], fov: 60 } },
    airg: { x: 1700, z: -1650, time: 'golden', cam: { pos: [1700, 150, -1515], look: [1700, 0, -1650], fov: 60 } },
    tbg: { x: -2700, z: -750, time: 'golden', cam: { pos: [-2700, 1.7, -757], look: [-2950, 1.6, -760], fov: 60 } },
    islg: { x: -658, z: 2419, time: 'golden', cam: { pos: [-658, 1.7, 2419], look: [-935, 6, 2303], fov: 62 } },
    night: { x: -1386.6, z: -713.6, time: 'midnight', cam: { pos: [-1386.6, 1.7, -713.6], look: [-1370.6, 6, -713.3], fov: 65 } }
  };
  P.go = async (name, settleMs = 9000) => {
    const p = P.places[name];
    A.teleportTo(p.x, p.z, 0);
    if (!new URLSearchParams(location.search).has('liveClock')) A.selectTime(p.time || 'midday'); // (?liveClock=: the page keeps its live clock and date, for the seasons)
    A.cameraSystem.cinema = () => p.cam;
    P.place = name;
    await sleep(settleMs);
  };


  // ---- trees: how much of each shadow-casting tree mesh (near, mid) lies outside the camera's frustum (a tree's crown as a sphere of
  // `pad` m): triangles the main pass transforms for nothing (the casters draw all round, for the shadow cascades)
  P.treeCull = (pad = 14) => {
    const T = window.CITY.THREE, cam = A.cameraSystem.camera;
    cam.updateMatrixWorld();
    const fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), cam.coordinateSystem, cam.reversedDepth);
    const sp = new T.Sphere(), out = {};
    const trees = scene.getObjectByName('Trees');
    if (!trees) return out;
    for (const m of trees.children) {
      if (!m.isInstancedMesh || !m.visible || !m.count) continue;
      const a = m.instanceMatrix.array, g = m.geometry, tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      let inside = 0, c0 = 0, c1 = 0;
      const sf = shadow._frustums || [];
      for (let i = 0; i < m.count; i++) {
        sp.center.set(a[i * 16 + 12], a[i * 16 + 13], a[i * 16 + 14]); sp.radius = pad;
        if (fr.intersectsSphere(sp)) inside++;
        if (sf[0] && sf[0].intersectsSphere(sp)) c0++;
        if (sf[1] && sf[1].intersectsSphere(sp)) c1++;
      }
      out[m.name] = { cast: m.castShadow, instances: m.count, inside, casc0: c0, casc1: c1, trisPer: Math.round(tris), trisAll: Math.round(tris * m.count), trisOutside: Math.round(tris * (m.count - inside)) };
    }
    return out;
  };


  // ---- triangles the view draws that lie outside the camera frustum (plain meshes that pass three's own mesh-level frustum test; a triangle by its
  // first vertex, 4 m pad): what finer culling cells could save. By top-level group
  P.outside = () => {
    const T = window.CITY.THREE, cam = A.cameraSystem.camera;
    cam.updateMatrixWorld();
    const fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), cam.coordinateSystem, cam.reversedDepth);
    const v = new T.Vector3(), sp = new T.Sphere(), res = {};
    const visibleChain = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    for (const top of scene.children) {
      const name = top.name || top.type, r = res[name] ||= { tris: 0, outside: 0, meshes: 0 };
      top.traverse((m) => {
        if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || !visibleChain(m) || m.layers.mask === (1 << 3)) return;
        const g = m.geometry, pos = g.attributes.position; if (!pos) return;
        if (!g.boundingSphere) g.computeBoundingSphere();
        sp.copy(g.boundingSphere).applyMatrix4(m.matrixWorld);
        if (!fr.intersectsSphere(sp)) return;
        const idx = g.index, start = g.drawRange.start, end = Math.min(idx ? idx.count : pos.count, g.drawRange.count === Infinity ? Infinity : start + g.drawRange.count);
        r.meshes++;
        for (let t = start; t + 2 < end; t += 3) {
          const i0 = idx ? idx.getX(t) : t;
          v.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
          sp.center.copy(v); sp.radius = 4;
          r.tris++;
          if (!fr.intersectsSphere(sp)) r.outside++;
        }
      });
    }
    return Object.fromEntries(Object.entries(res).filter(([, r]) => r.tris > 20000).sort((a, b) => b[1].tris - a[1].tris).slice(0, 14));
  };

  // ---- the census hook: draw calls and triangles by pass and by the scene's top-level group
  const shadow = A.lightingSystem.sunLight.shadow;
  const stack = [];
  let acc = null;
  const _c = new window.CITY.THREE.Vector3(), _d = new window.CITY.THREE.Vector3(), _f = new window.CITY.THREE.Vector3();
  P.skip = new Set();
  P.skipNames = new Set(); // post passes left out (their outputs stay as last drawn): by the render call's scene name, 'Sprite' for the stars, a trailing * for a prefix
  P.cascadeHide = { shadow0: [], shadow1: [] };
  const origRender = R.render.bind(R);
  R.render = function (s, cam) {
    const sc = shadow._cameras || [];
    const label = cam === A.cameraSystem.camera ? 'main' : cam === sc[0] ? 'shadow0' : cam === sc[1] ? 'shadow1' : 'other';
    if (P.skip.has(label)) return undefined;
    if (P.skipNames.size && (P.skipNames.has(s.name) || (s.isSprite && P.skipNames.has('Sprite')) || [...P.skipNames].some((n) => n.endsWith('*') && (s.name || '').startsWith(n.slice(0, -1))))) return undefined;
    if (acc && label === 'main' && !s.isSprite) acc.frames++; // (the stars sprite also renders through the main camera: not a frame)
    if (P.traceOn) {
      const rt = R.getRenderTarget();
      P.traceOn.push({ f: A.frameNo, label, depth: stack.length, scene: s === scene ? 'scene' : (s.name || s.type), cam: cam.type + (cam === A.cameraSystem.camera ? '(main)' : ''),
        rt: rt ? `${rt.width}x${rt.height}${rt.samples ? ' x' + rt.samples : ''}${rt.texture && rt.texture.name ? ' ' + rt.texture.name : ''}` : 'canvas', t: +performance.now().toFixed(1) });
    }
    const hid = P.cascadeHide[label]; // objects left out of this cascade only (the arms 'casc0:' / 'casc1:')
    let was = null;
    if (hid && hid.length) { was = hid.map((o) => o.visible); hid.forEach((o) => { o.visible = false; }); }
    stack.push(label);
    try { return origRender(s, cam); } finally { stack.pop(); if (was) hid.forEach((o, i) => { o.visible = was[i]; }); }
  };
  const info = R.info, origUpdate = info.update.bind(info);
  info.update = function (object, count, instanceCount) {
    origUpdate(object, count, instanceCount);
    if (!acc) return;
    const pass = stack[stack.length - 1] || 'none';
    let top = object, second = null;
    while (top.parent && top.parent !== scene) { second = top; top = top.parent; }
    const g = top.parent === scene ? (top.name || top.type) : '(' + (object.name || object.type) + ')';
    const g2 = second ? g + '/' + (second.name || second.type) : g;
    const tris = object.isMesh || object.isSprite ? instanceCount * count / 3 : 0;
    const a = acc.p[pass] ||= { draws: 0, tris: 0, by: {}, by2: {}, dist: {}, ghost: {}, far: {}, far2: {}, px: {}, pxBy: {} };
    a.draws++; a.tris += tris;
    // where the drawn object is: nearest distance of its bounding sphere to the camera (m), behind the camera, huge (never culled)
    const geo = object.geometry;
    let bs = object.boundingSphere || (geo && (geo.boundingSphere || (geo.computeBoundingSphere(), geo.boundingSphere)));
    if (bs) {
      _c.copy(bs.center).applyMatrix4(object.matrixWorld);
      const rad = bs.radius * (object.isInstancedMesh ? 1 : Math.max(object.matrixWorld.getMaxScaleOnAxis(), 1e-6));
      const cam = A.cameraSystem.camera;
      _d.copy(_c).sub(cam.position);
      const dist = Math.max(0, _d.length() - rad);
      cam.getWorldDirection(_f);
      const behind = _d.dot(_f) < -rad;
      const key = dist < 50 ? '<50' : dist < 150 ? '<150' : dist < 300 ? '<300' : dist < 600 ? '<600' : dist < 1200 ? '<1200' : dist < 2500 ? '<2500' : '2500+';
      const dd = a.dist[key] ||= [0, 0]; dd[0]++; dd[1] += tris;
      if (!object.isInstancedMesh && stack[stack.length - 1] === 'main') { // projected size of the object's bounding sphere on screen (px of the 900 px frame)
        const dc = _d.length(), px = (2 * rad / Math.max(dc, rad)) / (2 * Math.tan(cam.fov * Math.PI / 360)) * 900;
        const sz = px < 1 ? '<1px' : px < 4 ? '<4px' : px < 16 ? '<16px' : '16px+';
        const q = a.px[sz] ||= [0, 0]; q[0]++; q[1] += tris;
        if (px < 4) { const qq = a.pxBy[g] ||= [0, 0]; qq[0]++; qq[1] += tris; }
      }
      if (dist >= 1200) { const f = a.far[g] ||= [0, 0]; f[0]++; f[1] += tris; }
      if (dist >= 2500) { const f = a.far2[g2] ||= [0, 0]; f[0]++; f[1] += tris; }
      const tag = behind ? 'behind' : rad > 3000 ? 'huge' : object.frustumCulled === false ? 'nocull' : null;
      if (tag) { const gg = a.ghost[g + ' ' + tag] ||= [0, 0]; gg[0]++; gg[1] += tris; }
    }
    const b = a.by[g] ||= [0, 0]; b[0]++; b[1] += tris;
    const c = a.by2[g2] ||= [0, 0]; c[0]++; c[1] += tris;
  };
  P.trace = async (frames = 4) => {
    P.traceOn = [];
    const f0 = A.frameNo;
    for (let i = 0; i < 100 && A.frameNo - f0 < frames; i++) await raf();
    const r = P.traceOn; P.traceOn = null;
    return r;
  };
  P.census = async (frames = 6) => {
    acc = { frames: 0, p: {} };
    for (let i = 0; i < 400 && acc.frames < frames; i++) await raf();
    const n = Math.max(1, acc.frames), res = { frames: acc.frames, passes: {} };
    for (const [k, a] of Object.entries(acc.p)) {
      const top = (m) => Object.entries(m).sort((x, y) => y[1][1] - x[1][1]).slice(0, 40)
        .map(([name, v]) => [name, +(v[0] / n).toFixed(1), Math.round(v[1] / n)]);
      res.passes[k] = { draws: +(a.draws / n).toFixed(1), tris: Math.round(a.tris / n), by: top(a.by), by2: top(a.by2), dist: top(a.dist), ghost: top(a.ghost), far: top(a.far), far2: top(a.far2), px: top(a.px), pxBy: top(a.pxBy) };
    }
    acc = null;
    return res;
  };


  // ---- queue.writeBuffer census: calls and bytes per frame, by pass (the renderer wrapper's stack) and buffer label; the callers of the big writes
  let wb = null;
  const origWrite = GPUQueue.prototype.writeBuffer;
  GPUQueue.prototype.writeBuffer = function (buffer, offset, data, dataOffset, size) {
    if (wb) {
      const el = data.BYTES_PER_ELEMENT || 1;
      const bytes = size !== undefined ? size * el : data.byteLength - (dataOffset || 0) * el;
      const pass = stack[stack.length - 1] || 'none';
      const k = pass + ' ' + (buffer.label || '(no label)');
      const e = wb.by[k] ||= [0, 0]; e[0]++; e[1] += bytes;
      wb.calls++; wb.bytes += bytes;
      const sz = bytes < 256 ? '<256B' : bytes < 4096 ? '<4K' : bytes < 65536 ? '<64K' : bytes < 1048576 ? '<1M' : '1M+';
      const h = wb.size[sz] ||= [0, 0]; h[0]++; h[1] += bytes;
      if (bytes >= 262144 && wb.big.length < 400) {
        const st = new Error().stack.split('\n').slice(2, 9).map((l) => l.trim().replace(/^at /, '').replace(/\(.*[\/]/, '(')).join(' < ');
        wb.big.push([pass, buffer.label || '', bytes, st]);
      }
    }
    return origWrite.call(this, buffer, offset, data, dataOffset, size);
  };
  P.wb = async (frames = 6) => {
    wb = { calls: 0, bytes: 0, by: {}, size: {}, big: [], frames: 0 };
    const f0 = A.frameNo;
    for (let i = 0; i < 400 && A.frameNo - f0 < frames; i++) await raf();
    const n = Math.max(1, A.frameNo - f0), r = wb; wb = null;
    const top = (m, k = 25) => Object.entries(m).sort((x, y) => y[1][1] - x[1][1]).slice(0, k).map(([name, v]) => [name, +(v[0] / n).toFixed(1), Math.round(v[1] / n)]);
    const bigBy = {};
    for (const [pass, label, bytes, st] of r.big) { const k = pass + ' | ' + label + ' | ' + st; const e = bigBy[k] ||= [0, 0]; e[0]++; e[1] += bytes; }
    return { frames: n, callsPerFrame: +(r.calls / n).toFixed(1), bytesPerFrame: Math.round(r.bytes / n), by: top(r.by), size: top(r.size), big: top(bigBy, 12) };
  };


  // ---- time inside the native WebGPU calls (a main thread that waits on the GPU process shows its wait here): ms and calls per frame
  let nat = null;
  const natTargets = [[GPUQueue.prototype, ['writeBuffer', 'submit', 'writeTexture']], [GPUDevice.prototype, ['createCommandEncoder', 'createBindGroup', 'createBuffer']],
    [GPUCommandEncoder.prototype, ['beginRenderPass', 'finish', 'copyBufferToBuffer']], [GPURenderPassEncoder.prototype, ['draw', 'drawIndexed', 'setBindGroup', 'setPipeline', 'setVertexBuffer', 'setIndexBuffer', 'end']],
    [GPUCanvasContext.prototype, ['getCurrentTexture']]];
  P.nat = async (frames = 20) => {
    const undo = [];
    nat = {};
    for (const [proto, names] of natTargets) for (const name of names) {
      const o = proto[name]; if (typeof o !== 'function') continue;
      proto[name] = function (...a) { const t = performance.now(); try { return o.apply(this, a); } finally { const e = nat[name] ||= [0, 0]; e[0] += performance.now() - t; e[1]++; } };
      undo.push(() => { proto[name] = o; });
    }
    const f0 = A.frameNo, t0 = performance.now();
    for (let i = 0; i < 600 && A.frameNo - f0 < frames; i++) await raf();
    const n = Math.max(1, A.frameNo - f0), wall = performance.now() - t0, r = nat; nat = null;
    undo.forEach((u) => u());
    return { frames: n, frameMs: +(wall / n).toFixed(2), ms: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [+(v[0] / n).toFixed(2), +(v[1] / n).toFixed(1)]])) };
  };

  // ---- frame measurement: the frame's own measurements window (needs ?metrics=1): wall frame interval, the simulation
  // CPU and the renderer's synchronous submission CPU, per frame. GPU time is not measured: with uncapped frames, a frame
  // longer than the CPU total is the GPU's (or the compositor's) time
  P.meas = async (warmMs = 500, winMs = 2000) => {
    if (A.gpuTimes) A.gpuTimes(); // (reset: ?gputime=1 only)
    A.measurements.start({ label: 'm', warmupMs: warmMs });
    await sleep(warmMs + winMs);
    const r = A.frameTimes({ stop: true });
    const gpu = A.gpuTimes ? A.gpuTimes() : null;
    const f = r.frameIntervalMs, s = r.simulationCpuMs, d = r.renderSubmissionCpuMs;
    return { n: f.count, ms: f.mean, med: f.median, mean: f.mean, p95: f.p95, sim: s.median, sub: d.median, cpu: r.totalSubmissionCpuMs.median, valid: r.valid, ...(gpu ? { gpu } : {}) };
  };

  // ---- structure of the scene (names, sizes), for choosing what to hide
  P.tree = () => {
    const rows = [];
    for (const o of scene.children) {
      let meshes = 0, tris = 0, casters = 0, inst = 0, vis = 0;
      o.traverse((m) => {
        if (!m.isMesh) return;
        meshes++; if (m.castShadow) casters++; if (m.visible) vis++;
        if (m.isInstancedMesh) inst += m.count;
        const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0) / 3;
      });
      rows.push({ name: o.name || o.type, type: o.type, visible: o.visible, kids: o.children.length, meshes, visMeshes: vis, casters, inst, tris: Math.round(tris),
        kidNames: o.children.slice(0, 40).map((c) => (c.name || c.type) + (c.visible ? '' : '(off)')) });
    }
    return rows;
  };
  P.quality = () => ({ q: Object.fromEntries(Object.entries(window.CITY.QUALITY).filter(([, v]) => typeof v !== 'function')),
    canvas: [R.domElement.width, R.domElement.height], dpr: devicePixelRatio, backend: R.backend.constructor.name });

  // ---- ablation arms (runtime: nothing reloads). An arm turns one thing off; P.run measures the frame with it off against
  // the base frame measured on either side of it (B A B A ...), so slow drift on the shared mini cancels
  const meshesUnder = (o) => { const l = []; o.traverse((m) => { if (m.isMesh || m.isLine || m.isPoints) l.push(m); }); return l; };
  const topByName = (n) => scene.children.filter((c) => (c.name || c.type) === n);
  const hideArm = (id, objs) => ({ id, on() { this.was = objs.map((o) => o.visible); objs.forEach((o) => { o.visible = false; }); }, off() { objs.forEach((o, i) => { o.visible = this.was[i]; }); } });
  const noShadowArm = (id, objs) => ({ id, on() { this.l = objs.flatMap(meshesUnder); this.was = this.l.map((m) => m.castShadow); this.l.forEach((m) => { m.castShadow = false; }); },
    off() { this.l.forEach((m, i) => { m.castShadow = this.was[i]; }); } });
  const cascadeArm = (id, c, objs) => ({ id, on() { P.cascadeHide[c] = objs; }, off() { P.cascadeHide[c] = []; } });
  const sun = A.lightingSystem.sunLight;
  const passArm = (id, names) => ({ id, on() { names.forEach((n) => P.skipNames.add(n)); }, off() { names.forEach((n) => P.skipNames.delete(n)); } });
  P.postArms = () => [passArm('pass-stars', ['Sprite']), passArm('pass-clouds', ['CloudsPass', 'CloudsResolve']), passArm('pass-ssr', ['SSR*']), passArm('pass-bloom', ['Bloom*']),
    passArm('pass-shadowmask', ['ShadowPass', 'ShadowResolve']), passArm('pass-clouds+ssr+bloom+stars', ['Sprite', 'CloudsPass', 'CloudsResolve', 'SSR*', 'Bloom*'])];
  P.namedArms = () => [
    { id: 'shadows-all', on() { sun.castShadow = false; }, off() { sun.castShadow = true; } },
    { id: 'shadow-cascade0', on() { P.skip.add('shadow0'); }, off() { P.skip.delete('shadow0'); } },
    { id: 'shadow-cascade1', on() { P.skip.add('shadow1'); }, off() { P.skip.delete('shadow1'); } },
    { id: 'scale-0.75', on() { R.setPixelRatio(0.75); R.setSize(innerWidth, innerHeight); }, off() { R.setPixelRatio(1); R.setSize(innerWidth, innerHeight); } },
    { id: 'scale-0.25', on() { R.setPixelRatio(0.25); R.setSize(innerWidth, innerHeight); }, off() { R.setPixelRatio(1); R.setSize(innerWidth, innerHeight); } },
    { id: 'hide-all', on() { this.l = scene.children.filter((c) => !c.isLight && c.visible); this.l.forEach((c) => { c.visible = false; }); }, off() { this.l.forEach((c) => { c.visible = true; }); } },
    { id: 'hide-all+scale-0.25', on() { this.l = scene.children.filter((c) => !c.isLight && c.visible); this.l.forEach((c) => { c.visible = false; }); R.setPixelRatio(0.25); R.setSize(innerWidth, innerHeight); },
      off() { this.l.forEach((c) => { c.visible = true; }); R.setPixelRatio(1); R.setSize(innerWidth, innerHeight); } },
    { id: 'scale-0.5', on() { R.setPixelRatio(0.5); R.setSize(innerWidth, innerHeight); }, off() { R.setPixelRatio(1); R.setSize(innerWidth, innerHeight); } },
    { id: 'sim-traffic', on() { this.u = [A.trafficSystem.update, A.highwayTraffic.update]; A.trafficSystem.update = () => {}; A.highwayTraffic.update = () => {}; },
      off() { [A.trafficSystem.update, A.highwayTraffic.update] = this.u; } }
  ];
  // every sun-shadow caster except the named top-level group's stops casting: the group's shadow cost alone
  const onlyShadowArm = (top) => ({ id: 'shadow-only:' + top, on() {
    const keep = new Set(topByName(top).flatMap(meshesUnder));
    this.l = []; scene.traverse((m) => { if ((m.isMesh || m.isLine || m.isPoints) && m.castShadow && !keep.has(m)) this.l.push(m); });
    this.l.forEach((m) => { m.castShadow = false; }); sun.castShadow = true; }, off() { this.l.forEach((m) => { m.castShadow = true; }); } });
  P.onlyShadowArms = () => ['Trees', 'CityGround', 'CityStreetDetails', 'CityBuildings', 'ShadowProxies', 'PedestrianSignals', 'CityStreetProps'].map(onlyShadowArm);
  // arms from a census record: every top-level group that draws, hidden and (if it casts) its shadows off; the big groups' children too
  P.mkArms = (cen, { minTris = 4000, minDraws = 2, kidTris = 60000, kidDraws = 12, maxKids = 32 } = {}) => {
    const sum = {}, sum2 = {}, shad = {};
    for (const [pass, a] of Object.entries(cen.passes)) {
      for (const [n, d, t] of a.by) { const x = sum[n] ||= [0, 0]; x[0] += d; x[1] += t; if (pass.startsWith('shadow')) { const y = shad[n] ||= [0, 0]; y[0] += d; y[1] += t; } }
      for (const [n, d, t] of a.by2) { const x = sum2[n] ||= [0, 0]; x[0] += d; x[1] += t; }
    }
    const arms = [];
    for (const [n, [d, t]] of Object.entries(sum)) {
      if (n.startsWith('(') || (d < minDraws && t < minTris)) continue;
      const objs = topByName(n); if (!objs.length) continue;
      arms.push(hideArm('hide:' + n, objs));
      if (shad[n] && shad[n][0] >= 1) {
        arms.push(noShadowArm('noshadow:' + n, objs));
        if (shad[n][1] >= 20000) { arms.push(cascadeArm('casc0:' + n, 'shadow0', objs)); arms.push(cascadeArm('casc1:' + n, 'shadow1', objs)); }
      }
    }
    // the biggest shadow casters by child, left out of one cascade only
    for (const [pass, label] of [['shadow0', 'casc0'], ['shadow1', 'casc1']]) {
      const a = cen.passes[pass]; if (!a) continue;
      for (const [n, d, t] of a.by2.filter(([n]) => n.includes('/')).slice(0, 10)) {
        const top = n.slice(0, n.indexOf('/')), kid = n.slice(n.indexOf('/') + 1);
        const objs = topByName(top).flatMap((o) => o.children.filter((c) => (c.name || c.type) === kid));
        if (objs.length) arms.push(cascadeArm(`${label}k:${n}`, pass, objs));
      }
    }
    const kids = Object.entries(sum2).filter(([n, [d, t]]) => n.includes('/') && (t >= kidTris || d >= kidDraws)).sort((a, b) => b[1][1] - a[1][1]).slice(0, maxKids);
    for (const [n] of kids) {
      const [top, kid] = [n.slice(0, n.indexOf('/')), n.slice(n.indexOf('/') + 1)];
      const objs = topByName(top).flatMap((o) => o.children.filter((c) => (c.name || c.type) === kid));
      if (objs.length) arms.push(hideArm('hide2:' + n, objs));
    }
    return arms;
  };
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  // P.run: round 1 over every arm, rounds 2..rounds only over the arms whose round-1 saving is at least `keep` ms
  P.run = async ({ rounds = 3, warm = 300, win = 1300, keep = 0.25, extra = [], cen = null, maxMs = 20 * 60 * 1000, only = null } = {}) => {
    const t0 = performance.now();
    cen = cen || await P.census(6);
    const kidArms = (top, kids) => kids.map((k) => { const objs = topByName(top).flatMap((o) => o.children.filter((c) => (c.name || c.type) === k)); return objs.length ? hideArm(`hide2:${top}/${k}`, objs) : null; }).filter(Boolean);
    const arms = only === 'shadowonly' ? [...P.onlyShadowArms(), ...P.namedArms().filter((a) => ['shadows-all', 'shadow-cascade0', 'shadow-cascade1'].includes(a.id))] : only === 'ground' ? kidArms('CityGround', ['StreetLevel', 'RoadCutRoadway', 'RoadCutSidewalks', 'RoadCutBanks', 'RoadCutKerbs', 'Walkways', 'Lawns', 'Yards', 'Forecourts', 'RailLands', 'OpenLand', 'LakeOntario', 'Streams', 'PilotPond', 'Mesh', 'BikeSeparators', 'Kerbs', 'Walkways_HighPark', 'Lawns_HighPark', 'StreetLevel_HighPark', 'Kerbs_HighPark'])
      : only === 'post' ? [...P.postArms()] : [...P.namedArms(), ...P.postArms(), ...P.onlyShadowArms(), ...P.mkArms(cen), ...extra];
    const res = {}; let prev = await P.meas(warm, win); const bases = [prev.ms];
    const natBase = await P.nat(30); const natArms = {};
    const one = async (arm, first) => {
      arm.on(); await sleep(250);
      let drawn = null;
      if (first) { const c = await P.census(3); drawn = { draws: +Object.values(c.passes).reduce((s, p) => s + p.draws, 0).toFixed(1), tris: Object.values(c.passes).reduce((s, p) => s + p.tris, 0),
        byPass: Object.fromEntries(Object.entries(c.passes).map(([k, p]) => [k, [p.draws, p.tris]])) }; }
      const a = await P.meas(warm, win);
      if (first && ['scale-0.25', 'hide-all', 'hide:Trees', 'shadows-all'].includes(arm.id)) natArms[arm.id] = await P.nat(30);
      arm.off(); await sleep(250);
      const b = await P.meas(warm, win); bases.push(b.ms);
      const r = res[arm.id] ||= { runs: [] };
      r.runs.push({ a: a.ms, amed: a.med, cpu: a.cpu, sim: a.sim, sub: a.sub, b0: prev.ms, b1: b.ms, bcpu: (prev.cpu + b.cpu) / 2, d: +(a.ms - (prev.ms + b.ms) / 2).toFixed(2), dcpu: +(a.cpu - (prev.cpu + b.cpu) / 2).toFixed(2) });
      if (drawn) r.drawn = drawn;
      prev = b;
    };
    for (const arm of arms) { if (performance.now() - t0 > maxMs) { res.__timeout = arm.id; break; } await one(arm, true); }
    for (let k = 2; k <= rounds; k++) {
      for (const arm of arms) {
        const r = res[arm.id]; if (!r || r.runs.length < k - 1) continue;
        if (Math.abs(med(r.runs.map((x) => x.d))) < keep) continue;
        if (performance.now() - t0 > maxMs) { res.__timeout = arm.id; break; }
        await one(arm, false);
      }
    }
    for (const r of Object.values(res)) if (r.runs) { r.d = +med(r.runs.map((x) => x.d)).toFixed(2); r.dcpu = +med(r.runs.map((x) => x.dcpu)).toFixed(2); r.n = r.runs.length;
      r.spread = +(Math.max(...r.runs.map((x) => x.d)) - Math.min(...r.runs.map((x) => x.d))).toFixed(2); }
    const bs = [...bases].sort((x, y) => x - y);
    return { place: P.place, nat: { base: natBase, ...natArms }, armsRun: arms.length, base: { median: bs[bs.length >> 1], min: bs[0], max: bs.at(-1), n: bs.length }, arms: res, census: cen, elapsedS: Math.round((performance.now() - t0) / 1000) };
  };
  return 'lib ok';
})()
