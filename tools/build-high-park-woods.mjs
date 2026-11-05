// tools/build-high-park-woods.mjs → js/high-park-woods-data.js: High Park's entry in tools/build-park-woods.mjs
// (docs/high-park-woods.md). Usage: node tools/build-high-park-woods.mjs [--out js/high-park-woods-data.js]
process.env.PARK_WOODS = 'high-park';
await import('./build-park-woods.mjs');
