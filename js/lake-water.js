(function () {
// js/lake-water.js
// Lake Ontario & the harbour in John's stylized water (js/stylized-water.js, built from vendor/stylized-water): the
// LakeOntario mesh (city-grid.js) takes the donor material with John's `lake` kit entry; ponds & streams keep mrdoob's
// water. The sky it reflects is the scene's baked environment (lighting.js), its colours scale with the time of day's
// sunlight, and ?waterTune opens a lil-gui panel for the preset, colours & brightness with a "Copy kit JSON" button.

const { THREE, TSL } = window.CITY;

// John's `lake` entry from ride-anywhere's kits/water.json (stylized.kinds.lake, tuned with ?waterTune, 2026-10-16)
const LAKE_ENTRY = {
  preset: 'tropical',
  detailFadeScale: 1,
  colours: {
    shallow: { colour: '#2aeafe', alpha: 0.412 },
    deep: { colour: '#0088c2', alpha: 1 },
    crest: { colour: '#4cebec', alpha: 1 },
    shoreFoam: { colour: '#ffffff', alpha: 0.682 },
    edgeFoam: { colour: '#f6e976', alpha: 0.682 },
    surfaceFoam: { colour: '#ffffff', alpha: 1 },
    underwater: { colour: '#000000', alpha: 0.502 },
    shadow: { colour: '#000000', alpha: 0.6 }
  }
};
// The donor's colours are display-referred (Unity, light colour 1); the scene's sunlit white is about this share of the
// preset's sun intensity, so the water sits in the same brightness as the city around it
const RADIANCE_PER_SUN = { value: 0.13 };

function setupLakeWater(scene, renderer, lightingSystem) {
  const lake = scene.getObjectByName('LakeOntario');
  const SW = window.CITY.StylizedWater;
  if (!lake || !SW) return { update() {} };
  const { pmremTexture, float } = TSL;
  const sky = (dir) => pmremTexture(scene.environment, dir, float(0.0)).rgb;
  const w = SW.createStylizedWater(LAKE_ENTRY, { sky, reversedDepth: true /* main.js: reversedDepthBuffer */ });
  lake.material = w.material;
  lake.renderOrder = 1;
  const { cityUniforms } = window.CITY;
  if (new URLSearchParams(location.search).has('waterTune')) openTunePanel(w);
  return {
    water: w,
    update(elapsed) {
      w.time.value = elapsed;
      w.sunDirection.value.copy(cityUniforms.uSkySunDir.value);
      w.radiance.value = Math.max(0.15, cityUniforms.uSunIntensity.value * RADIANCE_PER_SUN.value);
    }
  };
}

// ?waterTune: the preset, every hue colour (sRGB hex & alpha), the distance fades and the brightness, live
async function openTunePanel(w) {
  const { default: GUI } = await import('https://cdn.jsdelivr.net/npm/lil-gui@0.21.0/+esm');
  const SW = window.CITY.StylizedWater;
  const entry = w.water.entry;
  const gui = new GUI({ title: 'Lake Ontario water (?waterTune)', width: 340 });
  const state = { preset: entry.preset, brightness: RADIANCE_PER_SUN.value, copy: () => copyJSON() };
  const colourFolder = () => {
    const f = gui.addFolder('Colours');
    for (const name of Object.keys(SW.COLOUR_SLOTS)) {
      const c = entry.colours[name];
      f.addColor(c, 'colour').name(name).onChange(() => w.water.applyColours());
      f.add(c, 'alpha', 0, 1, 0.001).name(`${name} alpha`).onChange(() => w.water.applyColours());
    }
    return f;
  };
  let colours = null;
  gui.add(state, 'preset', SW.PRESET_NAMES).onChange((p) => {
    w.water.setPreset(p);
    colours.destroy();
    colours = colourFolder();
  });
  gui.add(entry, 'detailFadeScale', 0.25, 20, 0.05).name('detail fade × (1 = 100 m)').onChange(() => w.water.applyChoices());
  gui.add(state, 'brightness', 0.05, 2, 0.01).name('brightness × sun').onChange((v) => { RADIANCE_PER_SUN.value = v; });
  gui.add(state, 'copy').name('Copy kit JSON');
  colours = colourFolder();
  const out = document.createElement('textarea');
  out.style.cssText = 'width:100%;height:120px;font:11px monospace;box-sizing:border-box';
  gui.domElement.appendChild(out);
  function copyJSON() {
    const text = JSON.stringify({ lake: { ...entry, brightnessPerSun: RADIANCE_PER_SUN.value } }, null, 1);
    out.value = text;
    navigator.clipboard?.writeText(text).catch(() => {});
  }
}

Object.assign(window.CITY, { setupLakeWater, LAKE_RADIANCE: RADIANCE_PER_SUN });
})();
