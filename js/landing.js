// js/landing.js: the home page (index.html). The issue line, computed live in America/Toronto; the cover footage,
// chosen by the sun over Toronto; listings that put their place on the cover; the place search; the WebGPU check.
// Clips live in assets/site/clips/<name>.{webm,mp4,webp}. Any that are missing fall back to the stills in
// assets/site/*.webp, so the page is whole without them. Muted loops only; no autoplay under reduced motion or Save-Data.
(() => {
  const TZ = 'America/Toronto';
  const TORONTO = { lat: 43.6453, lon: -79.3806 }; // the city's origin, Union Station (js/city-config.js GEO.frame)
  const CLIPS = './assets/site/clips/';
  const LIGHT = { golden: 'golden hour', midday: 'midday', sunset: 'sunset', night: 'night' };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const motionOK = () => !reducedMotion.matches && !saveData;
  const twoColumn = matchMedia('(min-width: 861px)');
  const canHover = matchMedia('(hover: hover) and (pointer: fine)');

  // ------------------------------------------------------------------------------------------- The place search
  // The full placeholder runs past a phone's search box (cut off from 390 px down), so the phone layout (the one-column
  // breakpoint, css/landing.css's max-width: 860px) shows the short one from data-placeholder-phone. Only the text
  // changes: the box's size is set by the CSS, so nothing moves
  const where = $('#where-q');
  const placeholders = { wide: where.placeholder, phone: where.dataset.placeholderPhone || where.placeholder };
  const fitPlaceholder = () => { where.placeholder = twoColumn.matches ? placeholders.wide : placeholders.phone; };
  fitPlaceholder();
  twoColumn.addEventListener('change', fitPlaceholder);
  const form = $('#hero-search');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = where.value.trim();
    location.href = q ? `./explore.html#place=${encodeURIComponent(q)}` : './explore.html';
  });

  // The cover fills the rest of the first viewport below the masthead and the section strip
  const head = () => document.documentElement.style.setProperty('--head', `${Math.ceil($('.mast').offsetHeight + $('.strip').offsetHeight)}px`);
  head();
  addEventListener('resize', head, { passive: true });
  if (document.fonts) document.fonts.ready.then(head);

  if (!('gpu' in navigator)) for (const note of $$('[data-webgpu-note]')) note.hidden = false;

  // ------------------------------------------------------------------------------------------- Time and light
  // The sun's elevation over Toronto (degrees) and whether it is still rising (NOAA's low-precision solar position)
  function sun(date) {
    const r = Math.PI / 180;
    const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
    const g = (357.529 + 0.98560028 * d) * r;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r;
    const e = (23.439 - 0.00000036 * d) * r;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / r;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = 18.697374558 + 24.06570982441908 * d;
    const ha = ((((gmst * 15 + TORONTO.lon - ra) % 360) + 540) % 360) - 180; // hour angle, -180..180
    const lat = TORONTO.lat * r;
    const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha * r)) / r;
    return { el, rising: ha < 0 };
  }
  // The app's four kinds of light, by where the sun is: night below civil twilight, a low sun golden in the morning
  // and sunset in the evening, midday otherwise
  function lightNow(date = new Date()) {
    const { el, rising } = sun(date);
    if (el < -6) return 'night';
    if (el < 12) return rising ? 'golden' : 'sunset';
    return 'midday';
  }

  function torontoParts(date) {
    const parts = {};
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });
    for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    const [y, m, d] = ymd.split('-').map(Number);
    return { ...parts, y, m, d };
  }
  // ISO 8601 week number of a calendar date: the issue number
  function isoWeek(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    const dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);
    const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return { week: Math.ceil(((t - jan1) / 86400000 + 1) / 7), year: t.getUTCFullYear() };
  }

  const issueEl = $('[data-issue]');
  const dateEl = $('[data-date]');
  const lightEl = $('[data-light]');
  function stamp() {
    const now = new Date();
    const p = torontoParts(now);
    const { week, year } = isoWeek(p.y, p.m, p.d);
    const ampm = (p.dayPeriod || '').replace(/\./g, '').toLowerCase();
    issueEl.textContent = `Free · No. ${week}, ${year}`;
    issueEl.title = `Issue number: the ISO week of ${year}`;
    // two unbreakable phrases, so a narrow masthead breaks between them, never mid-phrase or after a dot
    dateEl.textContent = `${p.weekday} ${p.month} ${p.day} · ${p.hour}:${p.minute} ${ampm}`;
    lightEl.textContent = `in Toronto, ${LIGHT[lightNow(now)]}`; // the light outside now, not what the cover shows
  }
  stamp();
  setInterval(stamp, 20000);

  // ------------------------------------------------------------------------------------------- Clips and posters
  const failed = new Set(); // clips whose video failed to load
  const posters = new Map(); // clip -> Promise<poster URL | null>
  function poster(name) {
    if (!posters.has(name)) {
      posters.set(name, new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.src);
        img.onerror = () => resolve(null);
        img.src = `${CLIPS}${name}.webp`;
      }));
    }
    return posters.get(name);
  }
  function setStill(frame, src) {
    let img = $('.still', frame);
    if (!img) {
      img = document.createElement('img');
      img.className = 'still';
      img.alt = '';
      img.decoding = 'async';
      frame.prepend(img);
    }
    if (img.getAttribute('src') !== src) img.src = src;
  }
  // Show a clip's poster in the frame once it exists (the frame keeps its still until then)
  function showPoster(frame, name) {
    return poster(name).then((src) => {
      if (src && frame.dataset.showing === name && !frame.classList.contains('is-playing')) setStill(frame, src);
      return src;
    });
  }
  function stop(frame) {
    const v = $('video', frame);
    if (v) v.pause();
  }
  // Play a muted loop of the clip in the frame; returns false when motion is off or the clip is known missing
  function play(frame, name, onChange) {
    if (!motionOK() || failed.has(name)) return false;
    let v = $('video', frame);
    if (v && v.dataset.clip === name) {
      if (!paused || frame.closest('[data-cover]') === null) v.play().catch(() => {});
      return true;
    }
    if (v) v.remove();
    frame.classList.remove('is-playing');
    v = document.createElement('video');
    v.dataset.clip = name;
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.tabIndex = -1;
    for (const [ext, type] of [['webm', 'video/webm'], ['mp4', 'video/mp4']]) {
      const s = document.createElement('source');
      s.src = `${CLIPS}${name}.${ext}`;
      s.type = type;
      v.append(s);
    }
    // the last source failing means neither format is there: keep the still
    v.lastElementChild.addEventListener('error', () => {
      failed.add(name);
      v.remove();
      frame.classList.remove('is-playing');
      if (onChange) onChange();
    });
    v.addEventListener('playing', () => {
      frame.classList.add('is-playing');
      if (onChange) onChange();
    });
    frame.append(v);
    v.play().catch(() => {});
    return true;
  }

  // ------------------------------------------------------------------------------------------- The cover
  const cover = $('[data-cover]');
  const rest = $('[data-frame="rest"]', cover);
  const peek = $('[data-frame="peek"]', cover);
  const sticker = $('[data-sticker]', cover);
  const caption = $('[data-caption]', cover);
  const pauseBtn = $('[data-pause]', cover);
  const restCaption = caption.textContent; // the still in the HTML: assets/site/hero.webp, a golden-hour shot
  // ?light=golden|midday|sunset|night forces the cover's light, for testing (not offered in the page)
  const forced = new URLSearchParams(location.search).get('light');
  const light = LIGHT[forced] ? forced : lightNow();
  const restClip = `cover-${light}`;
  let restPoster = false; // the time-of-day poster has replaced the golden-hour still
  let peekPoster = null; // the listing clip whose poster is on the cover
  let paused = false;
  let peeking = null; // the listing on the cover

  function coverState() {
    const frame = peeking ? peek : rest;
    const moving = frame.classList.contains('is-playing');
    sticker.textContent = moving ? 'Footage from the app' : 'Screenshot from the app';
    // the caption describes what is on screen: the clip or its poster when there is one, else the still
    if (peeking) {
      const clipShown = peek.classList.contains('is-playing') || peekPoster === peeking.dataset.clip;
      caption.textContent = `Now on the cover: ${clipShown ? peeking.dataset.clipName : peeking.dataset.name}, in the app.`;
    } else caption.textContent = rest.classList.contains('is-playing') || restPoster
      ? `On the cover: the CN Tower and the skyline from over the harbour at ${LIGHT[light]}, in the app.`
      : restCaption;
    pauseBtn.hidden = !(rest.classList.contains('is-playing') || peek.classList.contains('is-playing'));
  }

  // On a narrow cover, crop the cover clips so their tower (68.5 % across the 16:9 source) lands 65 % across the
  // visible frame: the image is scaled to the frame's height, so its offset follows from the frame's aspect ratio
  const TOWER_X = 0.685, TOWER_AT = 0.65;
  function coverCrop() {
    const V = rest.clientWidth, W = (rest.clientHeight * 16) / 9;
    if (twoColumn.matches || !V || W <= V) { cover.style.removeProperty('--cover-x'); return; }
    const p = Math.min(1, Math.max(0, (TOWER_X * W - TOWER_AT * V) / (W - V)));
    cover.style.setProperty('--cover-x', `${(p * 100).toFixed(1)}%`);
  }
  coverCrop();
  addEventListener('resize', coverCrop, { passive: true });
  if (document.fonts) document.fonts.ready.then(coverCrop);

  rest.dataset.showing = restClip;
  showPoster(rest, restClip).then((src) => {
    restPoster = !!src;
    coverState();
  });
  play(rest, restClip, coverState);

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.setAttribute('aria-pressed', String(paused));
    $('span', pauseBtn).textContent = paused ? 'Play footage' : 'Pause footage';
    $('use', pauseBtn).setAttribute('href', paused ? '#l-play' : '#l-pause');
    for (const v of $$('video', cover)) {
      if (paused) v.pause();
      else if ((v.parentElement === peek) === !!peeking) v.play().catch(() => {});
    }
  });

  function putOnCover(li) {
    if (peeking === li) return;
    for (const other of $$('.listing.is-active')) other.classList.remove('is-active');
    li.classList.add('is-active');
    peeking = li;
    const name = li.dataset.clip;
    peek.dataset.showing = name;
    peek.classList.remove('is-playing');
    const old = $('video', peek);
    if (old && old.dataset.clip !== name) old.remove();
    setStill(peek, li.dataset.still);
    peekPoster = null;
    showPoster(peek, name).then((src) => {
      if (src && peeking === li) { peekPoster = name; coverState(); }
    });
    cover.classList.add('is-peeking');
    stop(rest);
    if (!paused) play(peek, name, coverState);
    coverState();
  }
  function offCover() {
    if (!peeking) return;
    peeking.classList.remove('is-active');
    peeking = null;
    cover.classList.remove('is-peeking');
    stop(peek);
    if (!paused && rest.classList.contains('is-playing')) $('video', rest).play().catch(() => {});
    coverState();
  }

  // ------------------------------------------------------------------------------------------- Listings
  const list = $('.listings');
  let enterTimer = 0;
  let leaveTimer = 0;
  for (const li of $$('.listing', list)) {
    li.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || !twoColumn.matches) return;
      clearTimeout(leaveTimer);
      clearTimeout(enterTimer);
      enterTimer = setTimeout(() => putOnCover(li), peeking ? 40 : 110);
    });
    li.addEventListener('focusin', () => {
      if (!twoColumn.matches) return;
      clearTimeout(leaveTimer);
      putOnCover(li);
    });
    // On a touch screen the play button previews: on the cover beside the rail, or in the listing itself on a phone
    const btn = $('.peek', li);
    btn.addEventListener('click', () => {
      if (twoColumn.matches) {
        if (peeking === li) offCover();
        else putOnCover(li);
        btn.setAttribute('aria-pressed', String(peeking === li));
        return;
      }
      openInline(li, btn);
    });
    btn.setAttribute('aria-pressed', 'false');
  }
  // the thumbnails are the clips' posters; any that is missing falls back to the listing's still
  for (const li of $$('.listing', list)) {
    const img = $(':scope > img', li);
    const fallback = () => { if (img.getAttribute('src') !== li.dataset.still) img.src = li.dataset.still; };
    img.addEventListener('error', fallback, { once: true });
    if (img.complete && img.naturalWidth === 0) fallback();
  }
  // without a delivered clip the touch preview would only repeat the thumbnail: show the button once a poster exists
  if (!canHover.matches) {
    for (const li of $$('.listing', list)) {
      const btn = $('.peek', li);
      btn.hidden = true;
      poster(li.dataset.clip).then((src) => { btn.hidden = !src; });
    }
  }
  list.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(enterTimer);
    leaveTimer = setTimeout(offCover, 280);
  });
  $('.rail').addEventListener('focusout', (e) => {
    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) leaveTimer = setTimeout(offCover, 120);
  });
  twoColumn.addEventListener('change', () => {
    offCover();
    for (const li of $$('.listing.is-open')) closeInline(li);
  });

  function openInline(li, btn) {
    if (li.classList.contains('is-open')) {
      closeInline(li);
      return;
    }
    for (const other of $$('.listing.is-open')) closeInline(other);
    const frame = document.createElement('div');
    frame.className = 'listing-frame frame';
    frame.dataset.showing = li.dataset.clip;
    frame.setAttribute('aria-hidden', 'true');
    li.prepend(frame);
    setStill(frame, li.dataset.still);
    showPoster(frame, li.dataset.clip);
    play(frame, li.dataset.clip);
    li.classList.add('is-open');
    btn.setAttribute('aria-pressed', 'true');
  }
  function closeInline(li) {
    const frame = $('.listing-frame', li);
    if (frame) frame.remove();
    li.classList.remove('is-open');
    $('.peek', li).setAttribute('aria-pressed', 'false');
  }

  // ------------------------------------------------------------------------------------------- Ride the TTC
  // The panels look for their clip's poster once they come near the screen; the preview button appears only when the
  // clip has been delivered, and the clip loads only on hover or a tap.
  const stories = $$('.ride-story');
  const near = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { near.unobserve(entry.target); arm(entry.target); }
  }, { rootMargin: '300px 0px' }) : null;
  for (const story of stories) {
    const btn = $('.peek', story);
    btn.hidden = true;
    btn.setAttribute('aria-pressed', 'false');
    if (near) near.observe(story); else arm(story);
  }
  function arm(story) {
    const frame = $('.ride-media', story);
    const name = story.dataset.clip;
    const btn = $('.peek', story);
    frame.dataset.showing = name;
    showPoster(frame, name).then((src) => {
      const cap = $('[data-ride-caption]', story);
      if (src && cap) { cap.textContent = cap.dataset.clipCaption; cap.hidden = false; }
      if (!src || !motionOK()) return;
      btn.hidden = false;
      const start = () => {
        if (!play(frame, name, () => { if (failed.has(name)) btn.hidden = true; })) return;
        story.classList.add('is-open');
        btn.setAttribute('aria-pressed', 'true');
        $('span', btn).textContent = 'Pause';
      };
      const halt = () => {
        stop(frame);
        story.classList.remove('is-open');
        btn.setAttribute('aria-pressed', 'false');
        $('span', btn).textContent = 'Preview';
      };
      btn.addEventListener('click', () => (story.classList.contains('is-open') ? halt() : start()));
      if (canHover.matches) {
        frame.addEventListener('pointerenter', start);
        frame.addEventListener('pointerleave', halt);
      }
    });
  }

  // ------------------------------------------------------------------------------------------- The weather ear
  // The latest observation at Toronto Pearson from Environment and Climate Change Canada's MSC GeoMet (keyless, CORS,
  // Open Government Licence – Canada). Fetched once per load, kept 10 minutes per tab, never polled. Any failure, or a
  // reading older than three hours, leaves every weather line hidden.
  const WEATHER = 'https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&lang=en&identifier=on-143&limit=1';
  const WEATHER_KEY = 'slop-toronto:weather';
  async function reading() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(WEATHER_KEY) || 'null');
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;
    } catch { /* storage blocked: fetch instead */ }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 4000);
    try {
      const res = await fetch(WEATHER, { signal: abort.signal, credentials: 'omit' });
      if (!res.ok) return null;
      const cc = (await res.json()).features[0].properties.currentConditions;
      const data = {
        temp: Number(cc.temperature.value.en),
        condition: (cc.condition && cc.condition.en) || '',
        time: cc.timestamp.en,
        station: (cc.station && cc.station.value && cc.station.value.en) || ''
      };
      if (!Number.isFinite(data.temp) || !/pearson/i.test(data.station)) return null;
      try { sessionStorage.setItem(WEATHER_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* fine */ }
      return data;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  reading().then((w) => {
    const observed = w && new Date(w.time);
    if (!w || !(observed > 0) || Date.now() - observed > 3 * 3600 * 1000) return;
    const t = Math.round(w.temp);
    const deg = `${t < 0 ? '−' : ''}${Math.abs(t)} °C`;
    const sky = w.condition && !/not observed|n\/a/i.test(w.condition) ? w.condition.toLowerCase() : '';
    const at = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
      .format(observed).replace(/\./g, '').toLowerCase();
    const ear = $('[data-weather]');
    const text = $('[data-weather-text]', ear);
    text.textContent = '';
    const b = document.createElement('b');
    b.textContent = deg;
    text.append(b, sky ? `, ${sky}` : ''); // under its "Outside, at Pearson" line
    ear.title = `${w.station}, observed ${at}. Environment and Climate Change Canada.`;
    ear.classList.add('is-live');
    const row = $('[data-weather-row]');
    if (row) {
      $('[data-weather-temp]', row).textContent = deg;
      $('[data-weather-what]', row).textContent =
        `at Pearson as of ${at}${sky ? `, ${sky}` : ''}. The city in the app is under the same sky.`;
      row.hidden = false;
    }
    const aside = $('[data-weather-aside]');
    if (aside) {
      // (" Pearson says 8 °C and mostly cloudy right now: see it in the app.")
      const link = document.createElement('a');
      link.href = './explore.html';
      link.textContent = 'see it in the app';
      aside.replaceChildren(` Pearson says ${deg}${sky ? ` and ${sky}` : ''} right now: `, link, '.');
      aside.hidden = false;
    }
  });

  // ------------------------------------------------------------------------------------------- Background tabs
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      for (const v of $$('video')) if (!v.paused) { v.dataset.resume = '1'; v.pause(); }
    } else {
      for (const v of $$('video[data-resume]')) { delete v.dataset.resume; v.play().catch(() => {}); }
    }
  });
})();
