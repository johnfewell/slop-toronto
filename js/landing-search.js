import { searchIntersections } from './search-intersections.js';
import { key } from './search-text.js';
import { askable, createLookup, GEOCODE_ATTRIBUTION, inBounds, lookup, parseAddress, selectionKey } from './search-geocode.js';

await import('./city-map-selection.js');

const LIMIT = 6;
const NEAR = { x: 0, z: 0 };

function localPlaces(query, catalog) {
  const normalized = key(query);
  if (!normalized) return [];
  const hits = searchIntersections(query, catalog.crossings, NEAR);
  if (hits.length) return hits;
  return catalog.places.flatMap((p) => {
    if (!p.key.startsWith(normalized)) return [];
    return [{ ...p, strong: normalized === p.key }];
  }).sort((a, b) => Number(b.strong) - Number(a.strong));
}

export function bindLandingSearch(form, input) {
  const popup = form.querySelector('.where-results');
  const options = popup.querySelector('[role=listbox]');
  const status = popup.querySelector('[role=status]');
  const credit = popup.querySelector('.where-credit');
  const { map, touchFirst } = window.selectCityMap();
  let catalog, rows = [], active = -1, pending = false, enter = false, picking = false;

  function getCatalog() {
    catalog ??= fetch(`/assets/geocoder/landing-${map}.json`).then((response) => {
      if (!response.ok) throw new Error('City search index failed to load');
      return response.json();
    }).then((data) => {
      for (const place of data.places) place.key = key(place.name);
      return data;
    }).catch((error) => {
      catalog = null;
      throw error;
    });
    return catalog;
  }

  const request = createLookup(async (query, signal) => {
    const catalog = await getCatalog();
    signal.throwIfAborted();
    const onMap = (x, z) => inBounds(catalog.bounds, x, z);
    const address = parseAddress(query);
    const local = address ? [] : localPlaces(query, catalog);
    if (local.some((p) => p.strong)) {
      return local.slice(0, LIMIT).map((p) => ({ ...p, outside: !onMap(p.x, p.z) }));
    }
    const { lat0, lon0, kx, ky, theta, ox, oz } = catalog.projection;
    const c = Math.cos(theta), s = Math.sin(theta);
    const project = (lat, lon) => {
      const e = (lon - lon0) * kx, n = (lat - lat0) * ky;
      return { x: e * c - n * s - ox, z: -(e * s + n * c) - oz };
    };
    let results;
    try {
      results = await lookup(query, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        project, onMap, near: NEAR, local: (name) => localPlaces(name, catalog).slice(0, LIMIT)
      });
    } catch {
      signal.throwIfAborted();
      if (!local.length) return null;
      results = [];
    }
    const additions = results.filter((r) => !local.some((p) => p.key === key(r.name) && Math.hypot(p.x - r.x, p.z - r.z) < 60));
    return [...additions, ...local.map((p) => ({ ...p, outside: !onMap(p.x, p.z) }))].slice(0, LIMIT);
  });

  function choose(index) {
    active = index;
    for (const [i, row] of Array.from(options.children).entries()) row.setAttribute('aria-selected', String(i === index));
    if (index < 0) input.removeAttribute('aria-activedescendant');
    else input.setAttribute('aria-activedescendant', options.children[index].id);
  }

  function render(message = '') {
    options.replaceChildren(...rows.map((p, i) => {
      const row = document.createElement('div');
      row.id = `where-option-${i}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      if (p.outside) row.setAttribute('aria-disabled', 'true');
      const name = document.createElement('strong');
      name.textContent = p.name;
      const detail = document.createElement('span');
      const outside = touchFirst ? 'Outside the downtown map on phones' : 'Outside the map';
      detail.textContent = [p.sub, p.outside && outside].filter(Boolean).join(' · ');
      row.append(name, detail);
      row.addEventListener('pointerdown', (event) => event.preventDefault());
      row.addEventListener('pointermove', () => { if (!p.outside) choose(i); });
      row.addEventListener('click', () => void pick(p));
      return row;
    }));
    status.textContent = message;
    if (rows.some((p) => p.provider) && credit.childElementCount === 0) {
      for (const [file, label] of GEOCODE_ATTRIBUTION) {
        const img = document.createElement('img');
        img.src = `/assets/geocoder/${file}`;
        img.alt = label;
        credit.append(img);
      }
    }
    credit.hidden = !rows.some((p) => p.provider);
    popup.hidden = !rows.length && !message;
    input.setAttribute('aria-expanded', String(!popup.hidden));
    choose(-1);
  }

  async function pick(place) {
    if (place.outside || picking) return;
    const query = input.value.trim();
    const url = new URL('/explore', location.origin);
    url.searchParams.set('map', map);
    picking = true;
    try {
      const params = new URLSearchParams();
      if (place.provider || place.kind === 'address') {
        params.set('search', query);
        params.set('selection', await selectionKey(place));
      } else if (place.kind === 'intersection') {
        params.set('place', query);
        params.set('junction', place.id);
      } else params.set('place', place.name);
      url.hash = params.toString();
      if (input.value.trim() === query) location.href = url.href;
    } catch {
      render('That result could not be opened. Try again.');
    } finally {
      picking = false;
    }
  }

  function close() {
    request.cancel();
    rows = [];
    pending = false;
    enter = false;
    render();
  }

  function update(immediate = false) {
    close();
    const query = input.value.trim();
    if (!askable(query)) return;
    pending = true;
    enter = immediate;
    render('Searching…');
    request.start(query, (results) => {
      pending = false;
      rows = results ?? [];
      const first = rows.find((p) => !p.outside);
      render(rows.length ? '' : results ? 'No matching destinations in Toronto' : 'Place search is unavailable. Try again.');
      if (enter && first) void pick(first);
    }, immediate);
  }

  input.addEventListener('input', (event) => { if (!event.isComposing) update(); });
  input.addEventListener('compositionend', () => update());
  input.addEventListener('focus', () => update());
  form.addEventListener('focusout', (event) => {
    if (!form.contains(event.relatedTarget)) close();
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && !popup.hidden) {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const playable = rows.flatMap((p, i) => p.outside ? [] : [i]);
      if (!playable.length) return;
      event.preventDefault();
      const current = playable.indexOf(active);
      const next = event.key === 'ArrowDown' ? current + 1 : current === -1 ? playable.length - 1 : current - 1;
      choose(playable[(next + playable.length) % playable.length]);
      options.children[active].scrollIntoView({ block: 'nearest' });
    }
  });
  if (document.activeElement === input) update();

  return () => {
    if (pending) {
      enter = true;
      request.flush();
      return;
    }
    const place = rows[active] || rows.find((p) => !p.outside);
    if (place) void pick(place);
    else if (!rows.length) update(true);
  };
}
