(function () {
// Renderer RAF time keeps advancing after setAnimationLoop(null). Hold the shared shader clocks
// only during a synchronous capture render; restore their real update functions even on failure.
function createShaderTimeHold(time, deltaTime, { now = () => performance.now() } = {}) {
  let held = null, heldAt = 0, offset = 0;
  return {
    get value() { return held; },
    pause() { if (held === null) { held = time.value; heldAt = now(); } },
    release({ resume = false } = {}) {
      if (resume && held !== null) offset += Math.max(0, now() - heldAt) / 1000;
      held = null;
    },
    render(draw, { hold = true } = {}) {
      if (!hold && offset === 0) return draw();
      if (hold && held === null) { held = time.value; heldAt = now(); }
      const timeUpdate = time.update, deltaUpdate = deltaTime.update;
      try {
        time.update = (frame) => {
          if (hold) time.value = held;
          else { timeUpdate.call(time, frame); time.value -= offset; }
        };
        if (hold) {
          deltaTime.update = () => { deltaTime.value = 0; };
          time.value = held; deltaTime.value = 0;
        }
        return draw();
      } finally {
        time.update = timeUpdate; deltaTime.update = deltaUpdate;
      }
    }
  };
}
Object.assign(window.CITY, { createShaderTimeHold });
})();
