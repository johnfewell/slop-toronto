// js/early-models.js — the start-up models' downloads begin when the app starts, not when the build reaches them (st-tw6z).
//
// The city builds in one long sequence (street details, then the trees, then the street props, the bike share, the park
// signs, the TTC pylons...), and each step asked for its own .glb files only when it got there: the 11 tree models (5.5 MB)
// at about a third of the way in, the street props a second later, the pylons later still. On a slow link the connection sat
// idle through the first part of the build and the build then sat idle waiting for the models. Now each model's module says
// which files it will want (`want`, while its script runs, before anything is built), main.js calls `start()` once the
// scripts are in (so the downloads never compete with the scripts), and the module's own `load` takes the bytes that are
// already on their way (or arrived) and parses them, the same GLTFLoader and the same parse as `loader.loadAsync(url)`.
// A download that failed falls back to a plain `loadAsync`, so a flaky link behaves as before.
(function () {
  const wanted = []; // urls in the order the build will want them (the order they are asked for)
  const early = new Map(); // url -> Promise<ArrayBuffer> (kept until release(): two modules may take the same file)
  let started = false;

  const bytesOf = (url) => fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.arrayBuffer();
  });
  const begin = (url) => {
    if (early.has(url)) return;
    const p = bytesOf(url);
    p.catch(() => {}); // (an unused failed download is not an unhandled rejection; load() falls back)
    early.set(url, p);
  };

  window.CITY = window.CITY || {};
  window.CITY.earlyModels = {
    /** Registers the files a module will load (page-relative urls, './assets/...'). Before start() they queue; after, they begin at once */
    want(urls) {
      for (const u of urls) {
        if (!wanted.includes(u)) wanted.push(u);
        if (started) begin(u);
      }
    },
    /** Starts the downloads (main.js, when the scripts are in; ?earlyModels=0 leaves them to each module as before) */
    start() {
      if (started) return;
      started = true;
      if (new URLSearchParams(location.search).get('earlyModels') === '0') { wanted.length = 0; return; }
      for (const u of wanted) begin(u);
    },
    /** `loader.loadAsync(url)` for a GLTFLoader, from the early download when there is one */
    load(loader, url) {
      const p = early.get(url);
      if (!p) return loader.loadAsync(url);
      return p.then((buf) => loader.parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1)), () => loader.loadAsync(url));
    },
    /** The bytes of a file (a texture's image, say) from the early download, else a plain fetch */
    bytes(url) { return early.get(url) || bytesOf(url); },
    /** Resolves when every download begun so far has finished (or failed); at once when none was begun */
    settled() { return Promise.allSettled([...early.values()]); },
    /** Lets go of the downloaded bytes (once the city is ready: every module has taken what it wanted) */
    release() { early.clear(); wanted.length = 0; },
    // (for the tests and the load timing tool)
    wantedUrls: () => wanted.slice(),
    pending: () => early.size
  };
})();
