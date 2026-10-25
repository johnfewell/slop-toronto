(function () {
// js/sky-clouds.js
// Volumetric clouds over Toronto: John's three-clouds-webgpu (js/clouds.js, bundled from vendor/clouds by
// tools/build-clouds.mjs), lit by the takram atmosphere it is built on. The city keeps its own lights (lighting.js):
// the clouds march through the scene pass's depth and composite over its colour before the grade (main.js). The world
// sits on the globe at Union Station, turned by the street grid's bearing, and the clouds see the same 22 August sun as
// the city. On by default; ?clouds=0 turns them off.
//
// The atmosphere (on by default, John 2026-10-25; ?atmosphere=0 brings back the city's own sky dome & fog): takram's
// physical sky replaces the city's sky dome, and its aerial
// perspective (the light the air between the camera and a surface scatters in, and the share of the surface's own light
// it lets through) goes over the whole scene before the clouds composite, in the library's order: scene -> clouds march
// -> aerial -> clouds composite -> the city's grade. The city keeps its own lights and materials (lighting = false: the
// aerial node adds haze and paints the sky, it does not relight), so shadows, windows, street lights & the night city
// are untouched. Night takes the real 23:00 sun (well below the horizon), the moon where the city's moonlight comes from,
// the star catalogue and the moonlit clouds, over the city's own night-glow gradient so the skyline keeps a horizon.
// Knobs: ?atmoHaze=<n> (aerosol multiple, a hazy August day by default), ?atmoGain=<n> (sky & haze brightness, the
// clouds' gain by default), ?atmoFog=<n> & ?atmoNightFog=<n> (how much of the city's own fog stays by day & at night),
// ?atmoMoon=<n> (moonlight on the clouds), ?atmoStars=<n> (the stars' brightness at night).

const { THREE, TSL } = window.CITY;
const URL_PARAMS = new URLSearchParams(location.search);
const CLOUD_GAIN = 4;
const CLOUD_CLOCK = 4;
const CLOUD_SPEED = (() => {
  const v = parseFloat(URL_PARAMS.get('cloudSpeed'));
  return Number.isFinite(v) ? v : CLOUD_CLOCK;
})();
const ATMOSPHERE = (() => {
  const v = URL_PARAMS.get('atmosphere');
  return v !== '0' && v !== 'false';
})();
const numParam = (name, fallback) => {
  const v = parseFloat(URL_PARAMS.get(name));
  return Number.isFinite(v) ? v : fallback;
};
// A hazy late-August day over the lake: 20x takram's clear-air aerosol (about 10 km visibility), so the skyline across
// the harbour softens and the far city & the lake horizon go warm & blue, while everything within a few hundred metres
// stays clear (the art bible's rule; the clear default reads as a mountain-air day, 30x goes milky at midday)
const ATMO_HAZE = numParam('atmoHaze', 20);
// The city's own (stylised, sky-coloured) fog kept on top of the physical haze, by time of day (at night half of it: the
// whole of it buried the skyline's lit windows in navy from across the lake)
const ATMO_CITY_FOG = { golden: numParam('atmoFog', 0), midday: numParam('atmoFog', 0), twilight: numParam('atmoFog', 0.35), midnight: numParam('atmoNightFog', 0.5) };
// The city's night-sky gradient (its sky colours) under the physical night sky: light pollution over the city
const ATMO_NIGHT_GLOW = { golden: 0, midday: 0, twilight: 0, midnight: 1 };

// Called right after renderer.init(), before anything renders or builds (the contexts must be on the renderer first);
// attach() hands it the camera & the lighting once they exist
async function setupClouds(renderer) {
  // on by default; ?clouds=0 turns them off, ?clouds=low|medium|high picks the library's quality preset (the tier's by
  // default, quality.js: none leaves the sky dome's painted clouds)
  const Q = window.CITY.QUALITY;
  const choice = URL_PARAMS.get('clouds');
  const preset = choice && choice !== '0' ? choice : Q.clouds;
  const withClouds = !(choice === '0' || !preset);
  if (!withClouds && !ATMOSPHERE) return null;
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
  params.luminanceScale *= parseFloat(URL_PARAMS.get(ATMOSPHERE ? 'atmoGain' : 'cloudGain')) || parseFloat(URL_PARAMS.get('cloudGain')) || CLOUD_GAIN;
  if (ATMOSPHERE) {
    params.mieScattering.multiplyScalar(ATMO_HAZE);
    params.mieExtinction.multiplyScalar(ATMO_HAZE);
  }
  const atmosphere = new Atmosphere.AtmosphereContext(params);
  atmosphere.raymarchScattering = false;
  atmosphere.accurateShadowScattering = false;
  const cloudsPass = withClouds ? Clouds.clouds({ sceneDepth: null }) : null;
  const ctx = cloudsPass ? cloudsPass.cloudsContext : null;
  renderer.contextNode = TSL.context({
    ...(renderer.contextNode?.value ?? {}),
    getAtmosphere: () => atmosphere,
    ...(ctx ? { getClouds: () => ctx } : {})
  });
  if (ctx) {
    ctx.qualityPreset = preset;
    ctx.resolutionScale = Q.cloudScale;
    // The medium & low presets' approximate sun & sky light breaks the clouds pass on three's dev build: its shader
    // reads the atmosphere's parameters without ever declaring their struct ('Member "bottomRadius" not found in struct
    // "AtmosphereParameters"', then nothing renders). The accurate light costs nothing measurable here
    ctx.clouds.accurateSunSkyLight = true;
    Clouds.applyCloudTypePreset(ctx, 'fairWeatherCumulus');
    // The sky lives: cells grow & dissipate on a swirling wind (the library's evolvingWeather), on a clock running
    // CLOUD_CLOCK times real time so a few minutes' ride sees it change (a cell's life: 600 s of cloud time). The whole
    // sky still drifts with the local weather's velocity. ?cloudSpeed=<n> sets the clock, 0 holds the sky still.
    // With the physical sky the clouds also take the moon's light once the sun is 6 degrees down (moonlight)
    ctx.experimental = { evolvingWeather: true, windReprojection: true, ...(ATMOSPHERE ? { moonlight: true } : {}) };
    if (ATMOSPHERE) {
      // the physical moon-to-sun ratio (2.5e-6) is far below the city's fixed exposure: the moonlit clouds are lifted
      // to sit with the city's night (silver-grey against the stars; 6e4 left them dark smoke, 8e5 nearly daylit)
      ctx.moonGain = numParam('atmoMoon', 3e5);
      ctx.moonColor.set(0.72, 0.8, 1);
    }
    // (The city's reversed depth buffer: the library fits its shadow cascades & reads the scene depth the reversed way
    // itself since PR #382 (tools/build-clouds.mjs), so the ordinary-depth camera copy f0b2133 handed it is gone)
    ctx.stbnTexture = Clouds.createJitterTexture();
    Clouds.loadBakedCloudTextures({
      localWeather: Clouds.DEFAULT_LOCAL_WEATHER_URL,
      turbulence: Clouds.DEFAULT_TURBULENCE_URL,
      shape: Clouds.DEFAULT_SHAPE_URL,
      shapeDetail: Clouds.DEFAULT_SHAPE_DETAIL_URL
    }).then((baked) => { Object.assign(ctx, baked); ctx.resetHistory(); });
  }

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
  const moonECEF = new THREE.Vector3();

  // ?atmosphere=1: the stars turn with the Earth. ECI -> ECEF is a turn about the pole by the Greenwich sidereal angle
  // at 23:00 EDT on 22 August (the night preset's clock); the catalogue is J2000, close enough for a city sky
  if (ATMOSPHERE) {
    const now = new Date();
    const night = Date.UTC(now.getUTCFullYear(), 7, 23, 3, 0, 0); // 23:00 EDT = 03:00 UTC the next day
    const jd = night / 86400000 + 2440587.5;
    const gmst = ((280.46061837 + 360.98564736629 * (jd - 2451545)) % 360) * rad;
    atmosphere.matrixECIToECEF.value.makeRotationZ(-gmst);
  }

  let frame = 0;
  let camera = null, lightingSystem = null;
  // ?atmosphere=1 state, made in attach()
  const nightGlow = TSL.uniform(0);
  let starsNode = null;
  let skyGlow = null;
  const camProjInv = TSL.uniform(new THREE.Matrix4());
  const camWorld = TSL.uniform(new THREE.Matrix4());
  return {
    atmosphereEnabled: ATMOSPHERE,
    attach(cam, lighting) {
      camera = cam;
      lightingSystem = lighting;
      atmosphere.camera = cam;
      if (cloudsPass) cloudsPass.camera = cam;
      if (!ATMOSPHERE) return;
      // The physical sky replaces the city's dome in the view; the dome still bakes the city's image-based light (its
      // materials are tuned to it) and the colour the city's own fog takes
      const sky = lighting.sky;
      const bake = lighting.bakeEnvironmentMap.bind(lighting);
      lighting.bakeEnvironmentMap = () => { bake(); lighting.scene.remove(sky); };
      lighting.scene.remove(sky);
      const apply = lighting.applyPreset.bind(lighting);
      lighting.applyPreset = (id, force) => {
        apply(id, force);
        const p = lighting.activePreset;
        if (lighting.uFogDensity && p) lighting.uFogDensity.value = p.fogDensity * (ATMO_CITY_FOG[p.id] ?? 0);
        nightGlow.value = (p && ATMO_NIGHT_GLOW[p.id]) || 0;
        // the catalogue is drawn under the sky whatever the sun's height: at night only, or it shows through the day
        if (starsNode) starsNode.intensity.value = p && p.id === 'midnight' ? numParam('atmoStars', 1e7) : 0;
      };
      lighting.applyPreset(lighting.activePresetId, true);
    },
    pass: cloudsPass,
    context: ctx,
    atmosphere,
    // The aerial perspective over the scene colour, in the scene pass's depth. three's
    // perspectiveDepthToViewZ follows the renderer's reversed depth, takram's sky test reads it too, and its position
    // reconstruction only needs the view z (the unprojected x, y & z don't depend on the clip z), so the reversed depth
    // buffer needs no workaround here (checked with ?atmoHaze=40: near walls clear, the far city white)
    aerial(colorNode, depthNode) {
      const { Fn, vec2, vec4, uv, mix, max, pow } = TSL;
      const node = Atmosphere.aerialPerspective(colorNode, depthNode, null, cloudsPass ? cloudsPass.cloudShadowLength : null);
      node.lighting = false; // the city's own lights stay (see the top of the file)
      node.moonScattering = true;
      const skyNode = node.skyNode;
      skyNode.showStars = true;
      skyNode.moonScattering = true;
      // the catalogue served from here, not from GitHub's media host (CREDITS.md)
      skyNode.starsNode = new Atmosphere.StarsNode('./assets/atmosphere/stars.bin');
      // (takram's 1000 leaves them below the city's night exposure and glow: 1e7 gives a sparse, light-polluted sky)
      starsNode = skyNode.starsNode;
      starsNode.intensity.value = lightingSystem && lightingSystem.activePresetId === 'midnight' ? numParam('atmoStars', 1e7) : 0;
      // The city's night-sky gradient (its preset sky colours) after dark, added over every far-plane pixel once the
      // clouds have composited (composite() below): the stars and the moon sit on the glow of a lit city, the cloud
      // bases take it too, as clouds over a city do, and the skyline keeps a horizon to stand against (under the sky
      // alone, the low far clouds hid it and came out as a dark band that swallowed the skyline from the lake)
      const glow = Fn(() => {
        const ndc = vec2(uv().x.mul(2).sub(1), uv().y.oneMinus().mul(2).sub(1));
        const v = camProjInv.mul(vec4(ndc, 0.5, 1));
        const dir = camWorld.mul(vec4(v.xyz.div(v.w), 0)).xyz.normalize();
        const h = max(dir.y, 0);
        const far = depthNode.r.lessThanEqual(0).select(1, 0); // (the reversed depth buffer clears to 0)
        return mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, pow(h, 0.45)).mul(nightGlow).mul(far);
      })();
      skyGlow = glow;
      return node;
    },
    composite: (colorNode) => {
      const c = cloudsPass ? cloudsPass.composite(colorNode) : colorNode;
      return skyGlow ? TSL.vec4(c.rgb.add(skyGlow), c.a) : c;
    },
    resetHistory: () => ctx && ctx.resetHistory(),
    update(dt) {
      // the clouds replace the sky dome's painted ones
      if (ctx && lightingSystem.sky && lightingSystem.sky.cloudCoverage) lightingSystem.sky.cloudCoverage.value = 0;
      // The physical sky takes the real sun: at night that is far below the horizon (the city lights its streets from
      // the moon's direction with uSkySunDir, the sky gets the moon there instead)
      const preset = lightingSystem.activePreset;
      const sunWorld = (ATMOSPHERE && preset && preset.trueSunDir) || cityUniforms.uSkySunDir.value;
      sunECEF.copy(sunWorld).applyMatrix4(rotation).normalize();
      atmosphere.sunDirectionECEF.value.copy(sunECEF);
      if (ATMOSPHERE) {
        moonECEF.copy((preset && preset.moonDir) || sunWorld).applyMatrix4(rotation).normalize();
        atmosphere.moonDirectionECEF.value.copy(moonECEF);
        camera.updateMatrixWorld();
        camProjInv.value.copy(camera.projectionMatrixInverse);
        camWorld.value.copy(camera.matrixWorld);
      }
      if (!ctx) return;
      ctx.sunDirection.copy(sunECEF);
      if (ATMOSPHERE) ctx.moonDirection.copy(moonECEF);
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
