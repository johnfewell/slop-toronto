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
  return { controls, input, press, handlers, window, document, pad, get interactions() { return interactions; }, setAvailable(v) { available = v; } };
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

test('overlay gamepad actions cannot board, drive or change mode, and held actions stay suppressed on return', () => {
  const h = harness(); let confirmations = 0;
  h.controls.callbacks.onOverlayInput = ({ confirm }) => { confirmations += Number(confirm); };
  h.window.CITY.uiOverlay = 'photo'; h.controls.setEnabled(false); h.pad.axes[1] = -1;
  h.press(true); h.press(true);
  assert.equal(confirmations, 1); assert.equal(h.interactions, 0); assert.ok(!h.input.forward); assert.ok(!h.input.up);
  h.window.CITY.uiOverlay = null; h.controls.setEnabled(true); h.press(true);
  assert.equal(h.interactions, 0);
  h.press(false); h.press(true); assert.equal(h.interactions, 1);
});

test('a focused photo caption accepts only the controller back action', () => {
  const h = harness(), actions = [];
  h.window.CITY.uiOverlay = 'photo'; h.document.activeElement = { tagName: 'TEXTAREA' };
  h.controls.callbacks.onOverlayInput = (input) => actions.push(input);
  h.pad.axes[1] = -1; h.press(true);
  assert.ok(actions.every((input) => input.reset)); assert.ok(!h.input.forward); assert.equal(h.interactions, 0);
  h.pad.buttons[1] = { pressed: true, value: 1 }; h.controls.update(0.016);
  const back = actions.filter((input) => input.back);
  assert.equal(back.length, 1); assert.equal(back[0].back, true); assert.equal(back[0].confirm, undefined);
});

test('disconnecting a controller resets the photo overlay axes', () => {
  const h = harness(), actions = [];
  h.window.CITY.uiOverlay = 'photo'; h.controls.callbacks.onOverlayInput = (input) => actions.push(input);
  h.pad.connected = false; h.controls.update(0.016);
  assert.equal(actions.length, 1); assert.equal(actions[0].reset, true);
});

// Upstream 67ef6be: in the car and on the bicycle the left stick only steers, and the triggers alone drive.
test('driving modes steer with the stick X axis and accelerate only with the triggers', () => {
  for (const mode of ['car', 'cyclist']) {
    const h = harness(); h.controls.controller.activeMode = mode;
    h.pad.axes[0] = 0.6; h.pad.axes[1] = -1; h.controls.update(0.016);
    assert.equal(h.input.forward, 0, `${mode}: pushing the stick up must not accelerate`);
    assert.equal(h.input.backward, 0);
    assert.ok(Math.abs(h.input.right - (0.6 - 0.15) / 0.85) < 1e-9, `${mode}: steering is dead-zone rescaled on X alone`);
    assert.equal(h.input.left, 0);
    h.pad.axes[0] = -0.1; h.controls.update(0.016);
    assert.equal(h.input.left, 0, `${mode}: inside the dead zone the wheel is centred`);
    h.pad.axes[0] = -1; h.pad.buttons[7] = { pressed: true, value: 0.7 }; h.controls.update(0.016);
    assert.equal(h.input.forward, 0.7); assert.equal(h.input.left, 1);
    h.pad.buttons[6] = { pressed: true, value: 1 }; h.controls.update(0.016);
    assert.equal(h.input.forward, 0); assert.ok(Math.abs(h.input.backward - 0.3) < 1e-9, `${mode}: LT outweighs RT to brake`);
  }
});

test('on foot and in the helicopter the left stick still moves and the triggers do not drive', () => {
  const h = harness();
  h.pad.axes[1] = -1; h.pad.buttons[6] = { pressed: true, value: 1 }; h.controls.update(0.016);
  assert.equal(h.input.forward, 1); assert.equal(h.input.backward, 0);
  h.controls.controller.activeMode = 'helicopter'; h.pad.buttons[6] = { pressed: false, value: 0 };
  h.pad.buttons[7] = { pressed: true, value: 1 }; h.controls.update(0.016);
  assert.equal(h.input.forward, 1); assert.equal(h.input.up, 1);
});
