const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/gamepad-controls.js'), 'utf8');
function harness() {
  const handlers = {};
  const window = { CITY: { isTypingInField: () => false }, addEventListener: (k, fn) => { handlers[k] = fn; } };
  const document = { hidden: false, hasFocus: () => true, addEventListener() {} };
  const pad = { connected: true, index: 0, id: 'test', mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
  const input = {};
  const controller = { activeMode: 'person', clearGamepadInput() { for (const k in input) input[k] = 0; }, setGamepadInput(k, v) { input[k] = v; } };
  const camera = { applyGamepadInput() {}, resetOrbit() {} };
  let interactions = 0, available = true;
  vm.runInNewContext(source, { window, document, navigator: { getGamepads: () => [pad] } });
  const controls = new window.CITY.GamepadControls(controller, camera, { onInteract() { if (!available) return false; interactions++; return true; } });
  const press = (value) => { pad.buttons[0] = { pressed: value, value: Number(value) }; controls.update(0.016); };
  controls.update(0.016);
  return { controls, input, press, handlers, get interactions() { return interactions; }, setAvailable(v) { available = v; } };
}

test('the contextual gamepad action boards once and preserves normal jumping away from transit', () => {
  const h = harness();
  h.press(true); assert.equal(h.interactions, 1); assert.ok(!h.input.up);
  h.press(true); assert.equal(h.interactions, 1);
  h.press(false); h.setAvailable(false); h.press(true);
  assert.equal(h.interactions, 1); assert.equal(h.input.up, 1);
});

test('map and focus resets suppress a held passenger action until released', () => {
  const h = harness();
  h.press(true); h.controls.reset(); h.press(true);
  assert.equal(h.interactions, 1);
  h.press(false); h.controls.setEnabled(false); h.press(true);
  assert.equal(h.interactions, 1);
  h.controls.setEnabled(true); h.press(true);
  assert.equal(h.interactions, 1);
  h.press(false); h.press(true);
  assert.equal(h.interactions, 2);
  h.handlers.blur(); h.handlers.focus(); h.press(true);
  assert.equal(h.interactions, 2);
});
