import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';

test('native modal input closes from a field and resize cancels a pending capture', {
  skip: !fs.existsSync(chromium.executablePath()) ? 'Playwright Chromium is not installed' : false, timeout: 20000
}, async () => {
  // CPU-only DOM test. No canvas or 3D context. Renderer/session adapters are contract stubs;
  // their real cancellation and camera restoration are checked separately on gpu2.
  const source = fs.readFileSync(new URL('../js/photo-mode.js', import.meta.url), 'utf8');
  const html = `<!doctype html><div id="canvas-container"><div id="view"></div></div><script>
    window.CITY = { CITY_BOUNDS: {minX:-100,maxX:100,minZ:-100,maxZ:100}, GEO:{points:{cnTower:[0,0]}},
      getLocationLabel:()=> 'Toronto', isTypingInField:(e)=>['INPUT','SELECT'].includes(e.target?.tagName),
      createPostcardStore:()=>({close(){}}) };
    const vector = (value)=>({toArray:()=>value}); let active = null, captureLease = null;
    window.app = { resources:{track(){throw Error('Unexpected image allocation');}},
      cameraSystem:{domElement:document.getElementById('view'),currentPos:vector([0,2,0]),currentLookAt:vector([0,2,10]),camera:{fov:45,near:.35,layers:{mask:1}}},
      rideSession:{active:false},subwayRide:{inside:false},lightingSystem:{activePresetId:'golden'},
      controllerManager:{getActiveEntity:()=>({position:{x:0,z:0}})},resetPhotoHistory(){},
      openOverlay(id,options){if(active)return false; CITY.uiOverlay=id;
        const lease={release(){if(active!==lease)return false;active=null;options.onClose();captureLease?.release();CITY.uiOverlay=null;return true;}};return active=lease;},
      beginPhotoCapture(){let reject;return captureLease={renderHeld:()=>new Promise((_,fail)=>{reject=fail;}),release(){reject?.(Error('cancelled'));return true;}}}
    };
  </script><script src="/photo-mode.js"></script><script>window.photo=CITY.createPhotoMode(app);</script>`;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/photo-mode.js' ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(req.url === '/photo-mode.js' ? source : req.url.endsWith('.css') ? '' : html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); let browser;
  try {
    browser = await chromium.launch({ args: ['--disable-gpu', '--disable-software-rasterizer'] });
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => photo.open()); await page.locator('input[type=range]').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => photo.state), 'inactive');
    assert.equal(await page.evaluate(() => CITY.uiOverlay), null);
    await page.evaluate(() => { photo.open(); window.pendingPhoto = photo.capture(); });
    await page.setViewportSize({ width: 800, height: 600 });
    assert.equal(await page.evaluate(() => pendingPhoto), false);
    assert.equal(await page.evaluate(() => photo.state), 'inactive');
    assert.equal(await page.locator('.photo-ui').isVisible(), false);
    assert.match(await page.locator('.photo-toast').textContent(), /Window resized/);
    assert.equal(await page.evaluate(() => photo.open()), true);
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
});
