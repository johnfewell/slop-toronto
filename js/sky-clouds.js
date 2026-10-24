(function () {
// js/sky-clouds.js
// Volumetric clouds over Toronto: John's three-clouds-webgpu (js/clouds.js, bundled from vendor/clouds by
// tools/build-clouds.mjs), lit by the takram atmosphere it is built on. The city keeps its own sky, lights & fog
// (lighting.js): the clouds march through the scene pass's depth and composite over its colour before the grade
// (main.js). The world sits on the globe at Union Station, turned by the street grid's bearing, and the clouds see the
// same 22 August sun as the city. On by default (about 4-5 fps on the M4 mini); ?clouds=0 turns them off.

const { THREE, TSL } = window.CITY;
const CLOUD_GAIN = 4;
const CLOUD_CLOCK = 4;
const CLOUD_SPEED = (() => {
  const v = parseFloat(new URLSearchParams(location.search).get('cloudSpeed'));
  return Number.isFinite(v) ? v : CLOUD_CLOCK;
})();

// Called right after renderer.init(), before anything renders or builds (the contexts must be on the renderer first);
// attach() hands it the camera & the lighting once they exist
async function setupClouds(renderer) {
  // on by default; ?clouds=0 turns them off
  if (new URLSearchParams(location.search).get('clouds') === '0') return null;
  let M;
  try {
    M = await import('./clouds.js');
  } catch (e) {
    console.warn('[clouds] js/clouds.js did not load:', e);
    return null;
  }
  const { Clouds, Atmosphere, Geospatial } = M;
  const { cityUniforms, GEO } = window.CITY;

  // The atmosphere lights the clouds in its own luminance units, which came out far darker than the city's sun & sky
  // (grey-brown clouds at noon): its luminance scale is raised to the city's exposure. ?cloudGain=<n> tries another
  const params = new Atmosphere.AtmosphereParameters();
  params.luminanceScale *= parseFloat(new URLSearchParams(location.search).get('cloudGain')) || CLOUD_GAIN;
  const atmosphere = new Atmosphere.AtmosphereContext(params);
  atmosphere.raymarchScattering = false;
  atmosphere.accurateShadowScattering = false;
  const cloudsPass = Clouds.clouds({ sceneDepth: null });
  const ctx = cloudsPass.cloudsContext;
  renderer.contextNode = TSL.context({
    ...(renderer.contextNode?.value ?? {}),
    getAtmosphere: () => atmosphere,
    getClouds: () => ctx
  });
  ctx.qualityPreset = 'medium';
  // The medium & low presets' approximate sun & sky light breaks the clouds pass on three's dev build: its shader reads
  // the atmosphere's parameters without ever declaring their struct ('Member "bottomRadius" not found in struct
  // "AtmosphereParameters"', then nothing renders). The accurate light costs nothing measurable here
  ctx.clouds.accurateSunSkyLight = true;
  Clouds.applyCloudTypePreset(ctx, 'fairWeatherCumulus');
  // The sky lives: cells grow & dissipate on a swirling wind (the library's evolvingWeather), on a clock running
  // CLOUD_CLOCK times real time so a few minutes' ride sees it change (a cell's life: 600 s of cloud time). The whole
  // sky still drifts with the local weather's velocity. ?cloudSpeed=<n> sets the clock, 0 holds the sky still
  ctx.experimental = { evolvingWeather: true, windReprojection: true };
  ctx.stbnTexture = Clouds.createJitterTexture();
  Clouds.loadBakedCloudTextures({
    localWeather: Clouds.DEFAULT_LOCAL_WEATHER_URL,
    turbulence: Clouds.DEFAULT_TURBULENCE_URL,
    shape: Clouds.DEFAULT_SHAPE_URL,
    shapeDetail: Clouds.DEFAULT_SHAPE_DETAIL_URL
  }).then((baked) => { Object.assign(ctx, baked); ctx.resetHistory(); });

  // World -> ECEF: the city's frame (x grid east, y up, z grid south, turned theta from true north) into east-north-up
  // at Union Station, then the ellipsoid's ENU frame there
  const P = GEO.frame.projection;
  const c = Math.cos(P.theta), s = Math.sin(P.theta);
  const worldToENU = new THREE.Matrix4().set(c, 0, -s, 0, -s, 0, -c, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  const rad = Math.PI / 180;
  const originECEF = new Geospatial.Geodetic(GEO.frame.lon * rad, GEO.frame.lat * rad, GEO.frame.elevation || 76).toECEF();
  const enuToECEF = Geospatial.Ellipsoid.WGS84.getEastNorthUpFrame(originECEF);
  const worldToECEF = new THREE.Matrix4().multiplyMatrices(enuToECEF, worldToENU);
  const rotation = new THREE.Matrix4().extractRotation(worldToECEF);
  atmosphere.matrixWorldToECEF.value.copy(worldToECEF);
  const sunECEF = new THREE.Vector3();

  let frame = 0;
  let camera = null, lightingSystem = null;
  return {
    attach(cam, lighting) {
      camera = cam;
      lightingSystem = lighting;
      atmosphere.camera = cam;
      cloudsPass.camera = cam;
    },
    pass: cloudsPass,
    context: ctx,
    composite: (colorNode) => cloudsPass.composite(colorNode),
    resetHistory: () => ctx.resetHistory(),
    update(dt) {
      // the clouds replace the sky dome's painted ones
      if (lightingSystem.sky && lightingSystem.sky.cloudCoverage) lightingSystem.sky.cloudCoverage.value = 0;
      sunECEF.copy(cityUniforms.uSkySunDir.value).applyMatrix4(rotation).normalize();
      atmosphere.sunDirectionECEF.value.copy(sunECEF);
      ctx.sunDirection.copy(sunECEF);
      ctx.worldToECEFMatrix.copy(worldToECEF);
      ctx.correctAltitude = atmosphere.correctAltitude;
      ctx.time += dt * CLOUD_SPEED;
      ctx.frame = frame++;
      ctx.updateCamera(camera);
    }
  };
}

Object.assign(window.CITY, { setupClouds });
})();
