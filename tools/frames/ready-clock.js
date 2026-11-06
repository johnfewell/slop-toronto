// tools/frames/ready-clock.js — CAPTURE_INIT_SCRIPT for tools/shots/map-scale.json: the time since navigation at which
// the city first reports ready (__CITY_APP.ready: the first frame drawn and the GPU through it), as
// window.__mapScaleReadyAt, read back by tools/frames/probe.js
(() => {
  const poll = setInterval(() => {
    if (window.__CITY_APP && window.__CITY_APP.ready) { window.__mapScaleReadyAt = Math.round(performance.now()); clearInterval(poll); }
  }, 20);
})();
// and the stack of an uncaught error (capture.mjs logs only its message)
window.addEventListener('error', (e) => console.error(`[stack] ${e.error && e.error.stack}`));
window.addEventListener('unhandledrejection', (e) => console.error(`[stack] ${e.reason && e.reason.stack}`));
