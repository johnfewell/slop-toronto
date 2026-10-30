import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { time, deltaTime } from 'three/tsl';

test('capture holds actual shader clocks across advancing renderer frames and restores them on success/error', () => {
  const window = { CITY: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../js/capture-clock.js', import.meta.url), 'utf8'), { window, performance });
  const updateTime = time.update, updateDelta = deltaTime.update, previousTime = time.value, previousDelta = deltaTime.value;
  const hold = window.CITY.createShaderTimeHold(time, deltaTime);
  try {
    time.update({ time: 12 }); deltaTime.update({ deltaTime: 0.016 });
    assert.equal(time.value, 12, 'positive control: the unheld shader clock advances');
    for (let i = 0; i < 20; i++) {
      hold.render(() => {
        time.update({ time: 100 + i }); deltaTime.update({ deltaTime: 2 });
        assert.equal(time.value, 12); assert.equal(deltaTime.value, 0);
      });
      assert.equal(time.update, updateTime); assert.equal(deltaTime.update, updateDelta);
    }
    assert.throws(() => hold.render(() => { throw new Error('render failed'); }), /render failed/);
    assert.equal(time.update, updateTime); assert.equal(deltaTime.update, updateDelta);
    hold.release(); hold.release();
    time.update({ time: 34 }); deltaTime.update({ deltaTime: 0.02 });
    assert.equal(time.value, 34, 'release lets the renderer clock advance again');
    hold.render(() => { time.update({ time: 900 }); assert.equal(time.value, 34); });
  } finally {
    time.update = updateTime; deltaTime.update = updateDelta;
    time.value = previousTime; deltaTime.value = previousDelta;
  }
});


test('presentation holds resume shader phase without adding paused wall time', () => {
  const window = { CITY: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../js/capture-clock.js', import.meta.url), 'utf8'), { window });
  let wall = 1000;
  const shader = { value: 10, update(frame) { this.value = frame.time; } };
  const delta = { value: 0.016, update(frame) { this.value = frame.deltaTime; } };
  const clock = window.CITY.createShaderTimeHold(shader, delta, { now: () => wall });
  clock.pause(); wall += 10000;
  clock.render(() => { shader.update({ time: 20 }); assert.equal(shader.value, 10); });
  clock.release({ resume: true }); clock.release({ resume: true });
  clock.render(() => { shader.update({ time: 20.016 }); delta.update({ deltaTime: 0.016 }); }, { hold: false });
  assert.ok(Math.abs(shader.value - 10.016) < 1e-9);
  assert.equal(delta.value, 0.016);
  wall += 1000; clock.pause(); wall += 5000;
  clock.release({ resume: true });
  clock.render(() => shader.update({ time: 26.016 }), { hold: false });
  assert.ok(Math.abs(shader.value - 11.016) < 1e-9, 'paused intervals accumulate once across repeated holds');
});
