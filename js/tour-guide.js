(function () {
// js/tour-guide.js
// The Abuja Tour guide on screen: the search box (places, streets, districts, landmarks, "hotel near me"), the place
// card, directions from A to B (by car, on foot, by bicycle) with turn-by-turn steps, live navigation with a route
// ribbon on the road and a beacon over the destination, re-routing when you stray, and Tour Drive: the guide takes the
// wheel (or the handlebars, or your feet) and brings you there, stopping at red lights.

const { THREE, Navigation, CITY_LANDMARKS, TELEPORT_LOCATIONS, getLocationLabel, districtAt, nearestRoads, blockAt, SIGNALS } = window.CITY;
const { Fn, uniform, uv, attribute, float, color, mix, step, fract, abs, smoothstep } = window.CITY.TSL;
const { searchPlaces, findRoute, progressOnRoute, formatDistance, formatDuration, trueBearing, compassWord, CATEGORY_LABEL, locateReal } = Navigation;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const icon = (name, cls = 'icon') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`);
  svg.appendChild(use);
  return svg;
};
const KIND_ICON = { landmark: 'i-star', district: 'i-district', street: 'i-road', mylocation: 'i-gps', player: 'i-locate', locate: 'i-gps' };
const CAT_ICON = {
  hotel: 'i-bed', bank: 'i-bank', food: 'i-food', worship: 'i-worship', fuel: 'i-fuel', health: 'i-health',
  education: 'i-school', market: 'i-bag', shop: 'i-bag', government: 'i-gov', office: 'i-office', leisure: 'i-tree',
  transport: 'i-bus', place: 'i-pin'
};
const iconFor = (p) => (p.kind === 'place' ? CAT_ICON[p.cat] || 'i-pin' : KIND_ICON[p.kind] || 'i-pin');
const MANEUVER_ICON = {
  depart: 'i-straight', straight: 'i-straight', left: 'i-turn-left', right: 'i-turn-right', 'slight-left': 'i-slight-left',
  'slight-right': 'i-slight-right', uturn: 'i-uturn', arrive: 'i-flag'
};
const TRAVEL_TO_PLAYER = { car: 'car', walk: 'person', cycle: 'cyclist' };
const PLAYER_TO_TRAVEL = { car: 'car', person: 'walk', cyclist: 'cycle', helicopter: 'car' };

/**
 * Search-as-you-type on an input: a list of suggestions under it, arrow keys / Enter / Esc, click to pick
 */
class Autocomplete {
  constructor(input, list, { onPick, near, withMyLocation = false, myLocations = null, limit = 7 }) {
    this.input = input;
    this.list = list;
    this.onPick = onPick;
    this.near = near;
    this.withMyLocation = withMyLocation;
    this.myLocations = myLocations;
    this.limit = limit;
    this.items = [];
    this.active = -1;
    if (!input || !list) return;
    list.setAttribute('role', 'listbox');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.addEventListener('input', () => this.update());
    input.addEventListener('focus', () => {
      input.select();
      this.update();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.items.length) return;
        this.setActive((this.active + (e.key === 'ArrowDown' ? 1 : -1) + this.items.length) % this.items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = this.items[this.active >= 0 ? this.active : 0];
        if (it) this.pick(it);
      } else if (e.key === 'Escape') {
        if (this.isOpen()) {
          e.stopPropagation();
          this.close();
        } else input.blur();
      }
      e.stopPropagation(); // typing never drives the player
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('blur', () => setTimeout(() => this.close(), 160));
  }

  isOpen() {
    return !this.list.hidden;
  }

  update() {
    const q = this.input.value.trim();
    const near = this.near ? this.near() : null;
    this.items = q ? searchPlaces(q, { near, limit: this.limit }) : [];
    if (this.withMyLocation && this.myLocations) {
      const mine = this.myLocations().filter((m) => !q || m.name.toLowerCase().startsWith(q.toLowerCase()) || 'my location'.startsWith(q.toLowerCase()));
      this.items.unshift(...mine);
    }
    if (!q && !this.withMyLocation) {
      // nothing typed yet: the sights
      this.items = CITY_LANDMARKS.slice(0, 8).map((l) => ({ kind: 'landmark', name: l.name, x: l.x, z: l.z, sub: `Landmark · ${l.district || districtAt(l.x, l.z)}`, landmarkId: l.id,
        distance: near ? Math.hypot(l.x - near.x, l.z - near.z) : null }));
    }
    this.render(q);
  }

  render(q) {
    const rows = this.items.map((it, i) => {
      const row = el('div', 'ac-item');
      row.setAttribute('role', 'option');
      row.id = `${this.list.id}-opt-${i}`;
      const ic = el('span', `ac-icon kind-${it.kind}${it.cat ? ` cat-${it.cat}` : ''}`);
      ic.appendChild(icon(iconFor(it)));
      const text = el('div', 'ac-text');
      text.appendChild(highlight(it.name, q));
      text.appendChild(el('div', 'ac-sub', it.sub || ''));
      row.append(ic, text);
      if (Number.isFinite(it.distance) && it.kind !== 'mylocation' && it.kind !== 'player') row.appendChild(el('span', 'ac-dist', formatDistance(it.distance)));
      row.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.pick(it);
      });
      row.addEventListener('pointerenter', () => this.setActive(i));
      return row;
    });
    if (!rows.length && q) {
      const none = el('div', 'ac-empty', `No places match “${q}” in the city`);
      rows.push(none);
    }
    this.list.replaceChildren(...rows);
    this.list.hidden = rows.length === 0;
    this.input.setAttribute('aria-expanded', String(!this.list.hidden));
    this.active = -1;
  }

  setActive(i) {
    this.active = i;
    [...this.list.querySelectorAll('.ac-item')].forEach((r, k) => r.classList.toggle('active', k === i));
    this.input.setAttribute('aria-activedescendant', `${this.list.id}-opt-${i}`);
  }

  pick(it) {
    this.input.value = it.name;
    this.close();
    this.onPick(it);
  }

  close() {
    if (!this.list) return;
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
  }
}

// The matched words of a name in bold
function highlight(name, q) {
  const div = el('div', 'ac-name');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = name.toLowerCase();
  const marks = new Array(name.length).fill(false);
  for (const w of words) {
    let i = -1;
    while ((i = lower.indexOf(w, i + 1)) >= 0) {
      if (i === 0 || /[^a-z0-9]/.test(lower[i - 1])) {
        for (let k = i; k < i + w.length; k++) marks[k] = true;
        break;
      }
    }
  }
  let run = '', bold = false;
  const flush = () => {
    if (!run) return;
    div.appendChild(bold ? el('b', '', run) : document.createTextNode(run));
    run = '';
  };
  for (let i = 0; i < name.length; i++) {
    if (marks[i] !== bold) {
      flush();
      bold = marks[i];
    }
    run += name[i];
  }
  flush();
  return div;
}

/**
 * The route on the road: a ribbon of chevrons flowing towards the destination (the part already travelled fades out),
 * and a column of light over the destination
 */
function createRouteGraphics(scene, groundAt) {
  const group = new THREE.Group();
  group.name = 'TourRoute';
  scene.add(group);
  const uAlong = uniform(0);
  const uTime = uniform(0);

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -4;
  mat.polygonOffsetUnits = -4;
  const along = attribute('along', 'float');
  mat.colorNode = Fn(() => {
    const v = uv().y;
    const chevron = step(0.62, fract(along.mul(0.16).sub(uTime.mul(0.9)).sub(abs(v.sub(0.5)).mul(0.9))));
    const edge = smoothstep(0.36, 0.5, abs(v.sub(0.5)));
    const base = mix(color(0x1f7cf2), color(0x0d4fb3), edge);
    return mix(base, color(0xffffff), chevron.mul(0.75).mul(float(1).sub(edge)));
  })();
  mat.opacityNode = Fn(() => {
    const ahead = smoothstep(uAlong.sub(4), uAlong.add(2), along);
    return ahead.mul(0.92);
  })();

  const beaconMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  beaconMat.colorNode = color(0x29d17a).mul(1.6);
  beaconMat.opacityNode = Fn(() => {
    const y = uv().y;
    const pulse = float(0.75).add(fract(uTime.mul(0.6)).mul(0.25));
    return float(1).sub(y).pow(1.6).mul(0.55).mul(pulse);
  })();
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 160, 24, 1, true).translate(0, 80, 0), beaconMat);
  beacon.visible = false;
  beacon.frustumCulled = false;
  group.add(beacon);
  const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  ringMat.colorNode = color(0x29d17a);
  ringMat.opacityNode = Fn(() => float(1).sub(fract(uTime.mul(0.5))).mul(0.8))();
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.2, 40).rotateX(-Math.PI / 2), ringMat);
  ring.visible = false;
  group.add(ring);

  let ribbon = null;
  function setRoute(route) {
    if (ribbon) {
      group.remove(ribbon);
      ribbon.geometry.dispose();
      ribbon = null;
    }
    beacon.visible = ring.visible = false;
    if (!route || route.points.length < 2) return;
    const P = route.points;
    const W = route.mode === 'walk' ? 1.6 : 2.6;
    const pos = [], uvs = [], al = [], idx = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[2] - a[2];
      const L = Math.hypot(dx, dz) || 1;
      dx /= L; dz /= L;
      const rx = -dz, rz = dx; // right of the direction of travel
      const off = P[i][3] || 0;
      const cx = P[i][0] + rx * off, cz = P[i][2] + rz * off;
      const y = groundAt(cx, cz, P[i][1]) + 0.28;
      pos.push(cx - rx * W / 2, y, cz - rz * W / 2, cx + rx * W / 2, y, cz + rz * W / 2);
      uvs.push(0, 0, 0, 1);
      al.push(route.cum[i], route.cum[i]);
      if (i > 0) {
        const k = 2 * i;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('along', new THREE.Float32BufferAttribute(al, 1));
    geo.setIndex(idx);
    ribbon = new THREE.Mesh(geo, mat);
    ribbon.frustumCulled = false;
    ribbon.renderOrder = 2;
    group.add(ribbon);
    const end = P[P.length - 1];
    const gy = groundAt(end[0], end[2], end[1]);
    beacon.position.set(end[0], gy, end[2]);
    ring.position.set(end[0], gy + 0.3, end[2]);
    beacon.visible = ring.visible = true;
  }
  return { group, setRoute, uAlong, uTime };
}

function createTourGuide({ scene, controllerManager, cameraSystem, mapSystem, trafficSystem, teleportTo, selectMode }) {
  const player = () => controllerManager.getActiveEntity();
  const playerPos = () => {
    const p = player().position;
    return { x: p.x, z: p.z };
  };
  const groundAt = (x, z, y) => {
    try {
      return controllerManager.getGroundHeight(x, z, 'car', y + 1);
    } catch {
      return y;
    }
  };
  const graphics = createRouteGraphics(scene, groundAt);

  // ---- toasts --------------------------------------------------------------------------------------------------------
  const elToast = $('toast');
  let toastTimer = 0;
  function toast(text, ms = 2600) {
    if (!elToast) return;
    elToast.textContent = text;
    elToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elToast.classList.remove('show'), ms);
  }

  // ---- your real location (the device's GPS / network position) -----------------------------------------------------
  // The fix is turned into the city's own coordinates right here (city-config.js worldFromLatLon) and sent nowhere.
  const real = { fix: null, info: null, watch: null, busy: false, dismissed: false };
  const hasGeo = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const realInCity = () => Boolean(real.info && real.info.status === 'city');
  // Where "you" are: your real position when you are in the 3D city, else your character's
  const here = () => (realInCity() ? { x: real.info.x, z: real.info.z } : playerPos());
  function myLocations() {
    const p = playerPos();
    const out = [];
    if (realInCity()) out.push({ kind: 'mylocation', name: 'Your location', sub: `Real location · ${real.info.label}`, x: real.info.x, z: real.info.z });
    out.push({
      kind: 'player',
      name: realInCity() ? 'Your spot in the 3D city' : 'Your location (in the 3D city)',
      sub: real.info && !realInCity() ? `You aren't in Toronto in real life · ${getLocationLabel(p.x, p.z)}` : getLocationLabel(p.x, p.z),
      x: p.x, z: p.z
    });
    if (!real.info && hasGeo) out.push({ kind: 'locate', name: 'Use my real location', sub: 'Your device’s GPS, if you are in Toronto', x: p.x, z: p.z });
    return out;
  }

  const locCard = $('loc-card');
  const locPrompt = $('locate-prompt');
  const locateBtn = $('btn-locate');
  try {
    real.dismissed = localStorage.getItem('slopToronto.locatePrompt') === 'dismissed';
  } catch { /* storage unavailable: ask again next time */ }
  if (locPrompt) locPrompt.hidden = !hasGeo || real.dismissed;

  function setLocBusy(on) {
    real.busy = on;
    if (locateBtn) locateBtn.classList.toggle('busy', on);
    const b = $('map-real-location');
    if (b) b.classList.toggle('busy', on);
  }
  function locMessage(title, text) {
    if (!locCard) return toast(text, 5000);
    $('loc-icon').className = 'loc-icon status-error';
    $('loc-title').textContent = title;
    $('loc-sub').textContent = text;
    $('loc-acc').textContent = '';
    $('loc-actions').replaceChildren();
    locCard.hidden = false;
  }
  function requestLocation({ live = false } = {}) {
    if (locPrompt) locPrompt.hidden = true;
    if (!hasGeo) return locMessage('Location unavailable', 'This browser can’t share its location.');
    if (!window.isSecureContext) return locMessage('Location needs a secure page', 'Open Slop Toronto over https (or localhost) to use your real location.');
    setLocBusy(true);
    const opts = { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 };
    const fail = (err) => {
      setLocBusy(false);
      if (real.watch !== null && err.code === 1) stopLive();
      if (real.fix && err.code !== 1) return; // a hiccup while following: keep the last fix
      locMessage('Couldn’t find you', err.code === 1
        ? 'Location access is blocked for this site. Allow it in your browser’s site settings, then try again.'
        : err.code === 3 ? 'Finding your location took too long. Try again with Wi-Fi or GPS on.' : 'Your location isn’t available right now.');
    };
    if (live) {
      stopLive();
      real.watch = navigator.geolocation.watchPosition(onFix, fail, opts);
      renderLocCard();
    } else navigator.geolocation.getCurrentPosition(onFix, fail, opts);
  }
  function stopLive() {
    if (real.watch !== null && hasGeo) navigator.geolocation.clearWatch(real.watch);
    real.watch = null;
  }
  function onFix(pos) {
    setLocBusy(false);
    const { latitude, longitude, accuracy } = pos.coords;
    const first = !real.info;
    real.fix = { lat: latitude, lon: longitude, accuracy };
    real.info = locateReal(latitude, longitude);
    mapSystem.setRealLocation(realInCity() ? { x: real.info.x, z: real.info.z, accuracy } : null);
    renderLocCard();
    if (first && realInCity() && mapSystem.isFullMapOpen) mapSystem.flyTo(real.info.x, real.info.z, 1.2);
    // directions from "Your location" start where you really are
    if (!nav.active && panel && !panel.hidden && from && from.kind === 'mylocation') plan();
  }
  function renderLocCard() {
    if (!locCard || !real.info) return;
    const i = real.info;
    const acc = real.fix.accuracy;
    const away = `${formatDistance(i.distance)} ${compassWord(i.bearing)} of Eagle Square`;
    const ic = $('loc-icon');
    ic.className = `loc-icon status-${i.status}`;
    ic.replaceChildren(icon(i.status === 'city' ? 'i-gps' : i.status === 'fct' ? 'i-district' : 'i-globe'));
    if (i.status === 'city') {
      $('loc-title').textContent = 'You’re in the city';
      // mid-block (no street within 40 m): name the nearest street
      const street = nearestRoads(i.x, i.z, 250).find((n) => n.road.name);
      $('loc-sub').textContent = i.label !== i.district ? `${i.label} · ${i.district}`
        : street ? `Near ${window.CITY.shortName(street.road.name)} · ${i.district}` : i.district;
    } else if (i.status === 'fct') {
      $('loc-title').textContent = 'You’re in Toronto';
      $('loc-sub').textContent = `Outside the 3D city: ${away}`;
    } else {
      $('loc-title').textContent = 'You’re not in Toronto';
      $('loc-sub').textContent = `Toronto is ${formatDistance(i.distance)} ${compassWord((i.bearing + 180) % 360)} of you. Explore it from here anyway.`;
    }
    $('loc-acc').textContent = `${acc > 1000 ? `Approximate (± ${formatDistance(acc)}), estimated from your network` : `± ${formatDistance(acc)}`}${real.watch !== null ? ' · following live' : ''} · stays on this device`;
    const actions = [];
    const button = (label, ic2, fn, cls = 'btn btn-sm') => {
      const b = el('button', cls);
      b.type = 'button';
      if (ic2) b.appendChild(icon(ic2, 'icon icon-sm'));
      b.appendChild(document.createTextNode(label));
      b.addEventListener('click', fn);
      actions.push(b);
      return b;
    };
    if (i.status === 'city') {
      button('Go to my spot', 'i-pin', () => {
        teleportToPlace({ kind: 'spot', name: 'Your location', x: i.x, z: i.z });
        toast('You’re at your real location in the 3D city');
      }, 'btn btn-sm btn-primary');
      button('Directions from here', 'i-directions', () => showDirections(null, { kind: 'mylocation', name: 'Your location' }));
      button('Map', 'i-map', () => {
        if (!mapSystem.isFullMapOpen) mapSystem.toggleFullMap(true);
        mapSystem.flyTo(i.x, i.z, 1.3);
      });
    }
    const live = button(real.watch !== null ? 'Stop following' : 'Follow live', 'i-gps', () => {
      if (real.watch !== null) {
        stopLive();
        renderLocCard();
      } else requestLocation({ live: true });
    });
    live.classList.toggle('active', real.watch !== null);
    $('loc-actions').replaceChildren(...actions);
    locCard.hidden = false;
  }
  const locClose = $('loc-close');
  if (locClose) locClose.addEventListener('click', () => {
    if (locCard) locCard.hidden = true;
  });
  if (locateBtn) locateBtn.addEventListener('click', () => (real.info && locCard && locCard.hidden ? renderLocCard() : requestLocation()));
  const mapLocate = $('map-real-location');
  if (mapLocate) mapLocate.addEventListener('click', () => {
    if (realInCity()) mapSystem.flyTo(real.info.x, real.info.z, Math.max(mapSystem.viewZoom, 1.2));
    else requestLocation();
  });
  const promptYes = $('locate-yes');
  if (promptYes) promptYes.addEventListener('click', () => requestLocation());
  const promptNo = $('locate-no');
  if (promptNo) promptNo.addEventListener('click', () => {
    if (locPrompt) locPrompt.hidden = true;
    try {
      localStorage.setItem('slopToronto.locatePrompt', 'dismissed');
    } catch { /* fine: it's only a reminder */ }
  });

  // ---- the selected place --------------------------------------------------------------------------------------------
  const card = $('place-card');
  let selected = null;
  function describe(p) {
    const me = here();
    const d = Math.hypot(p.x - me.x, p.z - me.z);
    const b = trueBearing(p.x - me.x, p.z - me.z);
    return { address: getLocationLabel(p.x, p.z), distance: `${formatDistance(d)} ${compassWord(b)} of ${realInCity() ? 'you (real location)' : 'you'}` };
  }
  function showPlace(p, { fly = true } = {}) {
    selected = p;
    hideDirections();
    if (card) {
      const info = describe(p);
      $('pc-icon').replaceChildren(icon(iconFor(p)));
      $('pc-icon').className = `pc-icon kind-${p.kind}${p.cat ? ` cat-${p.cat}` : ''}`;
      $('pc-name').textContent = p.name;
      $('pc-sub').textContent = p.sub || '';
      $('pc-address').textContent = info.address;
      $('pc-distance').textContent = info.distance;
      card.hidden = false;
      document.body.classList.add('place-open');
    }
    mapSystem.setSelectedPlace({ x: p.x, z: p.z, name: p.name });
    if (p.kind === 'street' && p.bounds) mapSystem.highlightStreet(p.name);
    if (fly && mapSystem.isFullMapOpen) mapSystem.flyTo(p.x, p.z, p.kind === 'district' ? 0.3 : p.kind === 'street' ? null : 1.4, p.bounds);
  }
  function hidePlace() {
    selected = null;
    if (card) card.hidden = true;
    document.body.classList.remove('place-open');
    mapSystem.setSelectedPlace(null);
  }

  // Go there now: onto the street in front of it, facing it
  function teleportToPlace(p) {
    if (p.kind === 'mylocation') return;
    if (p.landmarkId) {
      const key = Object.keys(TELEPORT_LOCATIONS).find((k) => k.toLowerCase() === p.landmarkId.toLowerCase());
      const loc = key && TELEPORT_LOCATIONS[key];
      if (loc) {
        teleportTo(loc.x, loc.z, loc.heading);
        return;
      }
    }
    const near = nearestRoads(p.x, p.z, 400).filter((n) => !n.road.raised && n.road.cls !== 'motorway');
    let spot = null;
    for (const n of near) {
      if (!blockAt(n.px, n.pz)) {
        spot = n;
        break;
      }
    }
    if (spot) teleportTo(spot.px, spot.pz, Math.atan2(p.x - spot.px, p.z - spot.pz));
    else teleportTo(p.x, p.z);
  }

  // ---- the search box ----------------------------------------------------------------------------------------------
  const searchInput = $('place-search');
  const searchAC = new Autocomplete(searchInput, $('search-results'), {
    near: here,
    onPick: (p) => {
      showPlace(p);
      searchInput.blur();
    }
  });
  const clearBtn = $('search-clear');
  if (searchInput && clearBtn) {
    const sync = () => clearBtn.classList.toggle('show', searchInput.value.length > 0);
    searchInput.addEventListener('input', sync);
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      sync();
      hidePlace();
      mapSystem.highlightStreet('');
      searchInput.focus();
    });
  }
  // the map's own search box
  const mapSearch = $('fullmap-search');
  new Autocomplete(mapSearch, $('fullmap-search-results'), {
    near: here,
    onPick: (p) => {
      showPlace(p, { fly: true });
      if (searchInput) searchInput.value = p.name;
      mapSearch.blur();
    }
  });

  // ---- directions ----------------------------------------------------------------------------------------------------
  const panel = $('directions-panel');
  const fromInput = $('dir-from');
  const toInput = $('dir-to');
  let from = { kind: 'mylocation', name: 'Your location' };
  let to = null;
  let travel = 'car';
  let route = null;
  // picking "Use my real location" asks for it, then plans from (or to) it
  const pickLocation = (set) => (p) => {
    if (p.kind === 'locate') {
      set({ kind: 'mylocation', name: 'Your location' });
      requestLocation();
    } else set(p);
    plan();
  };
  const fromAC = new Autocomplete(fromInput, $('dir-from-results'), { near: here, withMyLocation: true, myLocations, onPick: pickLocation((p) => { from = p; }) });
  const toAC = new Autocomplete(toInput, $('dir-to-results'), { near: here, withMyLocation: true, myLocations, onPick: pickLocation((p) => { to = p; }) });
  void fromAC; void toAC;

  // "Your location" is where you really are when you're in the city, else where your character is
  const pointOf = (p) => (p.kind === 'mylocation' ? here() : p.kind === 'player' ? playerPos() : { x: p.x, z: p.z });
  function showDirections(dest = null, origin = null) {
    if (dest) to = dest;
    if (origin) from = origin;
    if (card) card.hidden = true;
    document.body.classList.remove('place-open');
    if (!panel) return;
    panel.hidden = false;
    document.body.classList.add('directions-open');
    fromInput.value = from ? from.name : '';
    toInput.value = to ? to.name : '';
    const m = PLAYER_TO_TRAVEL[controllerManager.activeMode] || 'car';
    if (!dest && !origin) setTravel(m, false);
    if (!to) toInput.focus();
    plan();
  }
  function hideDirections() {
    if (panel) panel.hidden = true;
    document.body.classList.remove('directions-open');
  }
  function setTravel(mode, replan = true) {
    travel = mode;
    document.querySelectorAll('[data-travel]').forEach((b) => b.classList.toggle('active', b.dataset.travel === mode));
    if (replan) plan();
  }
  document.querySelectorAll('[data-travel]').forEach((b) => b.addEventListener('click', () => setTravel(b.dataset.travel)));
  const swapBtn = $('dir-swap');
  if (swapBtn) swapBtn.addEventListener('click', () => {
    [from, to] = [to, from];
    fromInput.value = from ? from.name : '';
    toInput.value = to ? to.name : '';
    plan();
  });

  const elSummary = $('dir-summary');
  const elSteps = $('dir-steps');
  const elStatus = $('dir-status');
  function plan() {
    route = null;
    if (elSteps) elSteps.replaceChildren();
    if (elSummary) elSummary.hidden = true;
    if (!from || !to) {
      if (elStatus) elStatus.textContent = !to ? 'Choose a destination: a place, a street or a district' : 'Choose where to start';
      mapSystem.setRoute(null);
      graphics.setRoute(null);
      return;
    }
    const A = pointOf(from), B = pointOf(to);
    if (Math.hypot(A.x - B.x, A.z - B.z) < 15) {
      if (elStatus) elStatus.textContent = 'You are already there';
      return;
    }
    const t0 = performance.now();
    route = findRoute(A, B, travel);
    if (!route) {
      if (elStatus) elStatus.textContent = 'No route found on the mapped streets between these places';
      mapSystem.setRoute(null);
      graphics.setRoute(null);
      return;
    }
    route.from = from;
    route.to = to;
    if (elStatus) elStatus.textContent = route.approximate ? 'Includes a one-way street against its direction: the map is missing a link' : `Fastest route · found in ${Math.round(performance.now() - t0)} ms`;
    renderRoute();
    mapSystem.setRoute(route, { fit: true });
    graphics.setRoute(route);
    graphics.uAlong.value = 0;
  }
  function renderRoute() {
    if (!route) return;
    if (elSummary) {
      elSummary.hidden = false;
      $('dir-time').textContent = formatDuration(route.duration);
      $('dir-dist').textContent = formatDistance(route.distance);
      const via = route.steps.filter((s) => s.street && s.distance > 300).sort((a, b) => b.distance - a.distance).slice(0, 2).map((s) => window.CITY.shortName(s.street));
      $('dir-via').textContent = via.length ? `via ${via.join(' and ')}` : '';
    }
    if (elSteps) {
      elSteps.replaceChildren(...route.steps.map((s) => {
        const li = el('li', 'step');
        const ic = el('span', 'step-icon');
        ic.appendChild(icon(MANEUVER_ICON[s.type] || 'i-straight'));
        const text = el('div', 'step-text');
        text.appendChild(el('div', 'step-instr', s.text));
        if (s.distance) text.appendChild(el('div', 'step-dist', formatDistance(s.distance)));
        li.append(ic, text);
        li.addEventListener('click', () => {
          if (!mapSystem.isFullMapOpen) mapSystem.toggleFullMap(true);
          mapSystem.flyTo(s.x, s.z, 1.6);
        });
        return li;
      }));
    }
  }
  const closeDir = $('dir-close');
  if (closeDir) closeDir.addEventListener('click', () => {
    hideDirections();
    if (!nav.active) {
      route = null;
      mapSystem.setRoute(null);
      graphics.setRoute(null);
    }
  });
  const dirBtn = $('btn-directions');
  if (dirBtn) dirBtn.addEventListener('click', () => (panel && !panel.hidden ? closeDir.click() : showDirections()));

  // place card buttons
  const pcDir = $('pc-directions');
  if (pcDir) pcDir.addEventListener('click', () => selected && showDirections(selected, { kind: 'mylocation', name: 'Your location' }));
  const pcGo = $('pc-go');
  if (pcGo) pcGo.addEventListener('click', () => selected && teleportToPlace(selected));
  const pcMap = $('pc-map');
  if (pcMap) pcMap.addEventListener('click', () => {
    if (!selected) return;
    if (!mapSystem.isFullMapOpen) mapSystem.toggleFullMap(true);
    mapSystem.flyTo(selected.x, selected.z, selected.kind === 'district' ? 0.3 : 1.4, selected.bounds);
  });
  const pcClose = $('pc-close');
  if (pcClose) pcClose.addEventListener('click', hidePlace);

  // ---- navigation ----------------------------------------------------------------------------------------------------
  const banner = $('nav-banner');
  const nav = { active: false, route: null, hint: 0, off: 0, lastReroute: 0, arrived: false, auto: false, stuck: 0, uiTimer: 0 };
  function startNavigation({ auto = false } = {}) {
    if (!route) return;
    const wanted = TRAVEL_TO_PLAYER[route.mode];
    if (controllerManager.activeMode !== wanted) selectMode(wanted);
    // starting somewhere else than here: go to the start first
    const here = playerPos();
    const s = route.points[0];
    if (Math.hypot(here.x - s[0], here.z - s[2]) > 60) {
      const n = route.points[Math.min(route.points.length - 1, 3)];
      const off = s[3] || 0;
      const dx = n[0] - s[0], dz = n[2] - s[2], L = Math.hypot(dx, dz) || 1;
      teleportTo(s[0] - (dz / L) * off, s[2] + (dx / L) * off, Math.atan2(dx, dz));
    }
    nav.active = true;
    nav.route = route;
    nav.hint = 0;
    nav.off = 0;
    nav.arrived = false;
    nav.stuck = 0;
    setAutoDrive(auto);
    hideDirections();
    if (banner) banner.hidden = false;
    document.body.classList.add('navigating');
    cameraSystem.setCameraPreset && cameraSystem.getActivePreset().category !== 'follow' && cameraSystem.setCameraPreset('chase', true);
    toast(auto ? `Tour Drive to ${route.to.name}: sit back` : `Navigating to ${route.to.name}`);
    updateBanner(true);
  }
  function endNavigation() {
    nav.active = false;
    setAutoDrive(false);
    if (banner) banner.hidden = true;
    document.body.classList.remove('navigating');
    route = null;
    nav.route = null;
    mapSystem.setRoute(null);
    graphics.setRoute(null);
  }
  function setAutoDrive(on) {
    nav.auto = Boolean(on);
    if (!nav.auto) for (const a of ['forward', 'backward', 'left', 'right', 'boost']) controllerManager.setTouchInput(a, 0);
    const b = $('nav-autodrive');
    if (b) {
      b.classList.toggle('active', nav.auto);
      b.setAttribute('aria-pressed', String(nav.auto));
      b.querySelector('.label').textContent = nav.auto ? 'Take over' : 'Tour Drive';
    }
    document.body.classList.toggle('autodriving', nav.auto);
  }
  const startBtn = $('dir-start');
  if (startBtn) startBtn.addEventListener('click', () => startNavigation());
  const autoBtn = $('dir-autodrive');
  if (autoBtn) autoBtn.addEventListener('click', () => startNavigation({ auto: true }));
  const endBtn = $('nav-end');
  if (endBtn) endBtn.addEventListener('click', endNavigation);
  const navAuto = $('nav-autodrive');
  if (navAuto) navAuto.addEventListener('click', () => setAutoDrive(!nav.auto));
  const navSteps = $('nav-steps');
  if (navSteps) navSteps.addEventListener('click', () => {
    if (!panel) return;
    if (!panel.hidden) return hideDirections();
    panel.hidden = false;
    document.body.classList.add('directions-open');
    renderRoute();
  });

  function updateBanner(force = false) {
    if (!banner || !nav.route) return;
    const r = nav.route;
    const remaining = Math.max(0, r.distance - nav.along);
    if (nav.arrived) {
      $('nav-icon').replaceChildren(icon('i-flag', 'icon icon-lg'));
      $('nav-dist').textContent = 'You have arrived';
      $('nav-instr').textContent = r.to.name;
      $('nav-then').textContent = getLocationLabel(r.points[r.points.length - 1][0], r.points[r.points.length - 1][2]);
      $('nav-eta').textContent = '';
      $('nav-remaining').textContent = '';
      return;
    }
    const next = r.steps.find((s) => s.at > nav.along + 3) || r.steps[r.steps.length - 1];
    const k = r.steps.indexOf(next);
    const then = r.steps[k + 1];
    const toNext = Math.max(0, next.at - nav.along);
    $('nav-icon').replaceChildren(icon(MANEUVER_ICON[next.type] || 'i-straight', 'icon icon-lg'));
    $('nav-dist').textContent = formatDistance(toNext);
    $('nav-instr').textContent = next.text;
    $('nav-then').textContent = then && toNext < 400 && then.at - next.at < 250 ? `Then ${then.text.charAt(0).toLowerCase()}${then.text.slice(1)}` : r.to.name ? `To ${r.to.name}` : '';
    const speed = r.mode === 'car' ? 9 : r.mode === 'cycle' ? 4.4 : 1.39;
    const eta = remaining / speed;
    const arrival = new Date(Date.now() + eta * 1000);
    $('nav-eta').textContent = `${formatDuration(eta)} · ${arrival.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`;
    $('nav-remaining').textContent = formatDistance(remaining);
    void force;
  }

  function reroute() {
    const now = performance.now();
    if (now - nav.lastReroute < 4000) return;
    nav.lastReroute = now;
    const r = findRoute(playerPos(), pointOf(nav.route.to), nav.route.mode);
    if (!r) return;
    r.from = { kind: 'player', name: 'Your location' };
    r.to = nav.route.to;
    route = nav.route = r;
    nav.hint = 0;
    nav.off = 0;
    mapSystem.setRoute(r);
    graphics.setRoute(r);
    toast('Rerouting…', 1600);
  }

  // Signalised stop lines (network edges into a signalised junction): Tour Drive stops at the red
  const signalEdges = [];
  if (trafficSystem && trafficSystem.network) {
    for (const e of trafficSystem.network.edges) {
      if (!e.to || !e.to.signal) continue;
      signalEdges.push({ x: e.sx + e.dx * e.len, z: e.sz + e.dz * e.len, dx: e.dx, dz: e.dz, j: e.to.sigJ, p: e.sigP });
    }
  }
  function redLightAhead(x, z, hx, hz, elapsed) {
    let best = Infinity;
    for (const s of signalEdges) {
      const rx = s.x - x, rz = s.z - z;
      const ahead = rx * hx + rz * hz;
      if (ahead < 0.5 || ahead > 45) continue;
      if (Math.abs(rx * hz - rz * hx) > 6) continue; // not in our lane's line
      if (s.dx * hx + s.dz * hz < 0.8) continue; // a stop line for another approach
      const phase = SIGNALS.state(s.j, s.p, elapsed);
      if (phase === 'green' || (phase === 'amber' && ahead < 12)) continue;
      best = Math.min(best, ahead);
    }
    return best;
  }

  // Tour Drive: pure pursuit along the route, with the player's own controls (so the physics, collisions & traffic
  // treat it like any driver)
  function autodrive(dt, elapsed) {
    const ent = player();
    const r = nav.route;
    const mode = controllerManager.activeMode;
    const P = r.points;
    const pointAt = (s) => {
      let i = nav.hint;
      while (i < P.length - 2 && r.cum[i + 1] < s) i++;
      const A = P[i], B = P[i + 1];
      const L = r.cum[i + 1] - r.cum[i] || 1;
      const t = Math.max(0, Math.min(1, (s - r.cum[i]) / L));
      const dx = (B[0] - A[0]) / L, dz = (B[2] - A[2]) / L;
      const off = A[3] || 0;
      return { x: A[0] + (B[0] - A[0]) * t - dz * off, z: A[2] + (B[2] - A[2]) * t + dx * off, dx, dz };
    };
    const v = Math.abs(ent.speed || 0);
    const look = mode === 'person' ? 4 : mode === 'cyclist' ? 7 : Math.max(9, v * 1.1);
    const target = pointAt(Math.min(r.distance, nav.along + look));
    const hx = Math.sin(ent.heading), hz = Math.cos(ent.heading);
    const want = Math.atan2(target.x - ent.position.x, target.z - ent.position.z);
    let err = want - ent.heading;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    // how much the route bends over the next stretch: slow down for corners
    let bend = 0;
    const d0 = pointAt(nav.along + 2);
    for (const ahead of [12, 24, 40]) {
      const d1 = pointAt(Math.min(r.distance, nav.along + ahead));
      bend = Math.max(bend, Math.acos(Math.max(-1, Math.min(1, d0.dx * d1.dx + d0.dz * d1.dz))));
    }
    const remaining = r.distance - nav.along;
    let vt;
    if (mode === 'car') vt = Math.min(15, 15 - bend * 9, 3 + remaining * 0.35);
    else if (mode === 'cyclist') vt = Math.min(6.5, 6.5 - bend * 2.5, 1.5 + remaining * 0.3);
    else vt = Math.min(4.2, 1 + remaining * 0.5);
    vt = Math.max(mode === 'person' ? 1 : 3, vt);
    if (mode !== 'person') {
      const red = redLightAhead(ent.position.x, ent.position.z, hx, hz, elapsed);
      if (red < Infinity) vt = Math.min(vt, Math.max(0, (red - 3) * 0.6));
    }
    if (remaining < 3) vt = 0;
    // steering: yaw towards the pursuit point
    let steer = 0;
    if (mode === 'car') steer = Math.max(-1, Math.min(1, err / (0.52 * 2.4 * Math.min(1, Math.max(v, 1) / 8) * 0.55)));
    else if (mode === 'cyclist') steer = Math.max(-1, Math.min(1, err * 2.2));
    else steer = Math.max(-1, Math.min(1, err * 2.5));
    const speedErr = vt - v;
    controllerManager.setTouchInput('left', Math.max(0, steer));
    controllerManager.setTouchInput('right', Math.max(0, -steer));
    if (mode === 'person') {
      controllerManager.setTouchInput('forward', vt > 0.2 ? Math.min(1, vt / 4.4) : 0);
      controllerManager.setTouchInput('backward', 0);
    } else {
      controllerManager.setTouchInput('forward', speedErr > 0.3 ? Math.min(1, speedErr * 0.4) : 0);
      controllerManager.setTouchInput('backward', speedErr < -1.2 && ent.speed > 0.5 ? Math.min(1, -speedErr * 0.25) : 0);
    }
    // stuck (against a car, a kerb, a bollard): hop a few metres down the route
    if (vt > 2 && v < 0.4) nav.stuck += dt;
    else nav.stuck = Math.max(0, nav.stuck - dt);
    if (nav.stuck > 4) {
      nav.stuck = 0;
      const p = pointAt(Math.min(r.distance, nav.along + 12));
      controllerManager.teleportActiveTo(p.x, p.z, Math.atan2(p.dx, p.dz));
      cameraSystem.resetForTeleport();
    }
  }

  // The user takes the wheel: any driving key ends Tour Drive
  window.addEventListener('keydown', (e) => {
    if (!nav.auto || window.CITY.isTypingInField(e)) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      setAutoDrive(false);
      toast('You have the wheel. Tour Drive is off', 1800);
    }
  });

  // ---- the map: tap a spot for what's there & directions -------------------------------------------------------------
  const ctx = $('map-context');
  let ctxPoint = null;
  mapSystem.onMapClick = (world, sx, sy) => {
    if (!ctx) return mapSystem.onTeleport && mapSystem.onTeleport(world.x, world.z);
    const label = getLocationLabel(world.x, world.z);
    // a named place right there?
    const near = (window.CITY.GEO.pois || []).map(([x, z, name, cat]) => ({ x, z, name, cat, d: Math.hypot(x - world.x, z - world.z) }))
      .filter((p) => p.d < 14 / Math.max(0.05, mapSystem.viewZoom) + 8).sort((a, b) => a.d - b.d)[0];
    ctxPoint = near ? { kind: 'place', name: near.name, cat: near.cat, x: near.x, z: near.z, sub: `${CATEGORY_LABEL[near.cat] || 'Place'} · ${districtAt(near.x, near.z)}` }
      : { kind: 'point', name: label, x: world.x, z: world.z, sub: label === districtAt(world.x, world.z) ? 'Neighbourhood of Toronto' : districtAt(world.x, world.z) };
    $('ctx-title').textContent = ctxPoint.name;
    $('ctx-sub').textContent = ctxPoint.sub;
    const rect = ctx.parentElement.getBoundingClientRect();
    ctx.hidden = false;
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = `${Math.max(8, Math.min(rect.width - w - 8, sx - w / 2))}px`;
    ctx.style.top = `${Math.max(8, sy - h - 16 < 70 ? sy + 16 : sy - h - 16)}px`;
    mapSystem.setSelectedPlace({ x: ctxPoint.x, z: ctxPoint.z, name: ctxPoint.name });
  };
  const hideCtx = () => {
    if (ctx) ctx.hidden = true;
  };
  mapSystem.onViewChange = hideCtx;
  const bind = (id, fn) => {
    const b = $(id);
    if (b) b.addEventListener('click', () => {
      if (ctxPoint) fn(ctxPoint);
      hideCtx();
    });
  };
  bind('ctx-dir-to', (p) => showDirections(p, from && from.kind !== 'mylocation' && route ? from : { kind: 'mylocation', name: 'Your location' }));
  bind('ctx-dir-from', (p) => showDirections(null, p));
  bind('ctx-teleport', (p) => {
    mapSystem.toggleFullMap(false);
    teleportToPlace(p.kind === 'point' ? { ...p, kind: 'spot' } : p);
  });
  bind('ctx-details', (p) => showPlace(p, { fly: false }));
  const ctxClose = $('ctx-close');
  if (ctxClose) ctxClose.addEventListener('click', hideCtx);

  // ---- keyboard: / or Ctrl+K focuses the search, Esc closes panels ----------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (window.CITY.isTypingInField(e)) return;
    if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && searchInput) {
      e.preventDefault();
      if (mapSystem.isFullMapOpen && mapSearch) mapSearch.focus();
      else searchInput.focus();
    } else if (e.code === 'Escape' && !mapSystem.isFullMapOpen) {
      if (panel && !panel.hidden) hideDirections();
      else if (card && !card.hidden) hidePlace();
    }
  });

  // ---- every frame ---------------------------------------------------------------------------------------------------
  function update(dt, elapsed) {
    graphics.uTime.value = elapsed;
    if (!nav.active || !nav.route) return;
    const pos = playerPos();
    const pr = progressOnRoute(nav.route, pos.x, pos.z, nav.hint);
    nav.hint = pr.index;
    nav.along = pr.along;
    graphics.uAlong.value = pr.along;
    mapSystem.routeProgress = pr.along;
    const limit = nav.route.mode === 'walk' ? 30 : 40;
    if (controllerManager.activeMode !== 'helicopter' && !nav.arrived && pr.offRoute > limit) {
      nav.off += dt;
      if (nav.off > 1.5) reroute();
    } else nav.off = 0;
    const end = nav.route.points[nav.route.points.length - 1];
    if (!nav.arrived && (nav.route.distance - pr.along < 15 || Math.hypot(end[0] - pos.x, end[2] - pos.z) < 18)) {
      nav.arrived = true;
      setAutoDrive(false);
      toast(`You have arrived at ${nav.route.to.name}`, 4000);
      updateBanner(true);
    }
    if (nav.auto && !nav.arrived) autodrive(dt, elapsed);
    nav.uiTimer -= dt;
    if (nav.uiTimer <= 0) {
      nav.uiTimer = 0.25;
      updateBanner();
    }
  }

  return {
    update,
    showPlace,
    showDirections,
    startNavigation,
    endNavigation,
    setTravel,
    teleportToPlace,
    get route() { return route; },
    // a stand-in route for the start-up shader compile (main.js, phone tiers): the ribbon, beacon & ring materials
    // compile behind the loading screen instead of freezing the first Tour Drive or directions
    warmGraphics(on) {
      if (!on) { graphics.setRoute(route); return; }
      const p = playerPos();
      graphics.setRoute({ mode: 'cycle', points: [[p.x, 0, p.z, 0], [p.x + 2, 0, p.z, 0], [p.x + 4, 0, p.z, 0]], cum: [0, 2, 4] });
    },
    get navigation() { return nav; },
    plan,
    setFrom: (p) => { from = p; },
    requestLocation,
    get realLocation() { return real.info; },
    // for testing without a GPS: as if the device reported this fix
    simulateFix: (lat, lon, accuracy = 15) => onFix({ coords: { latitude: lat, longitude: lon, accuracy } }),
    setTo: (p) => { to = p; },
    search: (q) => searchPlaces(q, { near: playerPos() })
  };
}

Object.assign(window.CITY, { createTourGuide });
})();
