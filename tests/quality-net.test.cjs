'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// The quality safety net (quality.js attach): desktop high steps its render resolution to x0.75 while frames run long
// and back when there is room, with hysteresis; the phone tiers keep their distance-only rungs (st-z51b)
const source = readFileSync(join(__dirname, '../js/quality.js'), 'utf8');
function net(search) {
  const window = { CITY: {}, matchMedia: () => ({ matches: false }), innerWidth: 1600, innerHeight: 900 };
  const sizes = [];
  vm.runInNewContext(source, {
    window, location: { search }, URLSearchParams, console: { info() {} },
    navigator: { maxTouchPoints: 0, hardwareConcurrency: 8 }, screen: { width: 1600, height: 900 },
    document: { hidden: false, createElement() {}, body: { appendChild() {} } }
  });
  const Q = window.CITY.QUALITY;
  const renderer = { setPixelRatio: (r) => sizes.push(r), setSize() {}, domElement: {}, info: { render: {} } };
  const n = Q.attach({ renderer });
  // `seconds` of frames, each `ms` long
  const run = (ms, seconds) => { for (let t = 0; t < seconds; t += ms / 1000) n.tick(ms / 1000); };
  return { Q, n, run, sizes };
}

test('desktop high drops to x0.75 after two slow windows and returns after ten fast seconds', () => {
  const { Q, n, run, sizes } = net('?quality=high');
  run(16.7, 8); // (settling, then steady 60)
  assert.equal(n.state().rung, 0);
  run(25, 5); // frames running long: mean 25 ms
  assert.equal(n.state().rung, 1);
  assert.equal(Q.scale, 0.75);
  assert.deepEqual(sizes, [0.75]);
  assert.equal(Q.dist, 1, 'high keeps its draw distances');
  run(16.7, 15); // room again (after the 4 s hold that follows a resolution change)
  assert.equal(n.state().rung, 0);
  assert.equal(Q.scale, 1);
  assert.deepEqual(sizes, [0.75, 1], 'stepping back up restores the full resolution');
});

test('vsync-paced frames: a third of them late steps down; a few late frames do not', () => {
  const a = net('?quality=high');
  a.run(16.7, 8);
  for (let i = 0; i < 400; i++) a.n.tick((i % 3 ? 16.7 : 33.4) / 1000); // a third late: mean 22.3 ms
  assert.equal(a.n.state().rung, 1);
  const b = net('?quality=high');
  b.run(16.7, 8);
  for (let i = 0; i < 1200; i++) b.n.tick((i % 14 ? 16.7 : 33.4) / 1000); // 7 % late, as at King & Bay: mean 17.9 ms
  assert.equal(b.n.state().rung, 0);
});

test('no flicker: a rung left again soon after stepping up is held for a minute, then tried again', () => {
  const { n, run } = net('?quality=high');
  run(16.7, 8);
  run(25, 5); // down
  run(16.7, 15); // up
  run(25, 9); // down again within 15 s: x1 becomes the ceiling
  assert.equal(n.state().rung, 1);
  const changes = n.state().changes;
  run(16.7, 40); // fast at x0.75, but the ceiling holds
  assert.equal(n.state().rung, 1);
  assert.equal(n.state().changes, changes);
  run(16.7, 30); // past the minute: it tries x1 again
  assert.equal(n.state().rung, 0);
});

test('the phone tier keeps its distance-only rungs and its median rule', () => {
  const { Q, n, run, sizes } = net('?quality=low');
  run(33.3, 8);
  run(45, 7);
  assert.equal(n.state().rung, 1);
  assert.equal(Q.scale, 1);
  assert.equal(Q.dist, 0.8);
  assert.deepEqual(sizes, [], 'no resolution change on the phone tiers');
});

test('desktop high ignores the slow seconds right after a resolution change', () => {
  const { n, run } = net('?quality=high');
  run(16.7, 8);
  run(25, 5); // down
  run(16.7, 15); // up
  assert.equal(n.state().rung, 0);
  run(24, 3); // the reallocated targets' slow seconds after stepping up
  run(16.7, 10);
  assert.equal(n.state().rung, 0, 'no step back down');
});

test('?autoscale=0 and ?scale= hold the rung', () => {
  for (const q of ['?quality=high&autoscale=0', '?quality=high&scale=1']) {
    const { n, run } = net(q);
    run(16.7, 8);
    run(30, 10);
    assert.equal(n.state().rung, 0, q);
  }
});

// st-olaf: ?fps=1's readout shows the share of the last 5 s of frames over 16.7 ms and high's resolution step
function readoutNet(search) {
  const el = { style: {}, textContent: '' };
  const window = { CITY: {}, matchMedia: () => ({ matches: false }), innerWidth: 1600, innerHeight: 900 };
  vm.runInNewContext(source, {
    window, location: { search }, URLSearchParams, console: { info() {} },
    navigator: { maxTouchPoints: 0, hardwareConcurrency: 8 }, screen: { width: 1600, height: 900 },
    document: { hidden: false, createElement: () => el, body: { appendChild() {} } }
  });
  const renderer = { setPixelRatio() {}, setSize() {}, domElement: { width: 1600, height: 900 }, info: { render: { drawCalls: 700, triangles: 5e6 } } };
  const n = window.CITY.QUALITY.attach({ renderer });
  return { el, n, run: (ms, seconds) => { for (let t = 0; t < seconds; t += ms / 1000) n.tick(ms / 1000); } };
}

test('?fps=1 reads the late share over the last 5 s and high\'s resolution step', () => {
  const held = readoutNet('?quality=high&fps=1&autoscale=0');
  held.run(16.7, 6); // vsync-paced, every frame fits
  assert.match(held.el.textContent, /late 0% \(>16\.7 ms, 5 s\)  step x1\.00 held/);
  for (let i = 0; i < 300; i++) held.n.tick((i % 4 ? 16.7 : 33.4) / 1000); // a quarter of the frames miss
  assert.match(held.el.textContent, /late 2[4-6]%/);
  const net = readoutNet('?quality=high&fps=1');
  net.run(16.7, 8);
  net.run(25, 5); // frames running long: the net steps to x0.75
  net.run(25, 1);
  assert.match(net.el.textContent, /late 100% \(>16\.7 ms, 5 s\)  step x0\.75\n/);
  assert.match(net.el.textContent, /rung 1/);
});

test('without ?fps=1 there is no readout', () => {
  let made = 0;
  const window = { CITY: {}, matchMedia: () => ({ matches: false }), innerWidth: 1600, innerHeight: 900 };
  vm.runInNewContext(source, {
    window, location: { search: '?quality=high' }, URLSearchParams, console: { info() {} },
    navigator: { maxTouchPoints: 0, hardwareConcurrency: 8 }, screen: { width: 1600, height: 900 },
    document: { hidden: false, createElement: () => { made++; return {}; }, body: { appendChild() {} } }
  });
  window.CITY.QUALITY.attach({ renderer: { setPixelRatio() {}, setSize() {}, domElement: {}, info: { render: {} } } }).tick(0.0167);
  assert.equal(made, 0);
});
