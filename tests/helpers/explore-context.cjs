const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const selection = fs.readFileSync(path.join(__dirname, '../../js/city-map-selection.js'), 'utf8');

function exploreContext(globals, { eglintonOnDesktop = true } = {}) {
  const context = vm.createContext({ window: {}, navigator: {}, URLSearchParams, ...globals });
  const source = eglintonOnDesktop ? selection : selection.replace('const EGLINTON_ON_DESKTOP = true;', 'const EGLINTON_ON_DESKTOP = false;');
  vm.runInContext(source, context);
  return context;
}

module.exports = { exploreContext };
