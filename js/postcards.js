(function () {
const POSTCARD_LIMITS = Object.freeze({ maxItems: 60, maxBytes: 64 * 1024 * 1024, maxImageBytes: 2 * 1024 * 1024, maxThumbnailBytes: 64 * 1024 });
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const text = (value, length) => typeof value === 'string' && value.length <= length;
function normalizeComposition(input) {
  const point = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  if (!input || input.schemaVersion !== 1 || !validId(input.id) || !Number.isFinite(Date.parse(input.createdAtUtc))
      || !text(input.appBuild, 128) || !text(input.locationLabel, 160) || !text(input.caption, 280)
      || !text(input.qualityTier, 24) || !text(input.cloudPreset, 64)
      || (input.viewId != null && !text(input.viewId, 100))
      || !point(input.camera?.position) || !point(input.camera?.target) || !Number.isFinite(input.camera.fov)
      || (input.camera.space !== undefined && !['world', 'interior'].includes(input.camera.space))
      || input.camera.fov < 10 || input.camera.fov > 120 || !text(input.environment?.presetId, 64)
      || (input.postcard !== undefined && typeof input.postcard !== 'boolean')
      || (input.encoding != null && (!Number.isSafeInteger(input.encoding.width) || !Number.isSafeInteger(input.encoding.height)
        || input.encoding.width < 1 || input.encoding.height < 1 || input.encoding.width > 1920 || input.encoding.height > 1920
        || !Number.isFinite(input.encoding.quality) || input.encoding.quality <= 0 || input.encoding.quality > 1))
      || !Number.isFinite(input.environment.cloudPhase) || input.environment.cloudPhase < 0) throw new Error('Invalid postcard composition');
  return { schemaVersion: 1, id: input.id, createdAtUtc: new Date(input.createdAtUtc).toISOString(), appBuild: input.appBuild,
    viewId: input.viewId ?? null, locationLabel: input.locationLabel, caption: input.caption,
    qualityTier: input.qualityTier, cloudPreset: input.cloudPreset, postcard: input.postcard === true,
    encoding: input.encoding ? { width: input.encoding.width, height: input.encoding.height, quality: input.encoding.quality } : null,
    camera: { position: [...input.camera.position], target: [...input.camera.target], fov: input.camera.fov, space: input.camera.space || 'world' },
    environment: { weatherMode: 'cinematic', timeMode: 'preset', presetId: input.environment.presetId, cloudPhase: input.environment.cloudPhase } };
}
function validatePostcardItem(item) {
  if (!item || !validId(item.id) || item.id !== item.composition?.id || !Number.isFinite(Date.parse(item.savedAtUtc))
      || new Date(item.savedAtUtc).toISOString() !== item.savedAtUtc
      || !Number.isSafeInteger(item.imageBytes) || item.imageBytes <= 0 || item.imageBytes > POSTCARD_LIMITS.maxImageBytes
      || !Number.isSafeInteger(item.thumbnailBytes) || item.thumbnailBytes <= 0 || item.thumbnailBytes > POSTCARD_LIMITS.maxThumbnailBytes
      || item.bytes !== item.imageBytes + item.thumbnailBytes) throw new Error('Postcard album metadata is damaged');
  return { id: item.id, composition: normalizeComposition(item.composition), savedAtUtc: item.savedAtUtc,
    bytes: item.bytes, imageBytes: item.imageBytes, thumbnailBytes: item.thumbnailBytes };
}
function planPostcardEviction(items, candidate, limits = POSTCARD_LIMITS) {
  if (!Number.isSafeInteger(limits.maxItems) || limits.maxItems < 1 || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1) throw new Error('Invalid album limits');
  const previous = items.map(validatePostcardItem).filter((v) => v.id !== candidate.id)
    .sort((a, b) => a.savedAtUtc.localeCompare(b.savedAtUtc) || a.id.localeCompare(b.id));
  candidate = validatePostcardItem(candidate);
  if (candidate.bytes > limits.maxBytes) throw new Error('Postcard exceeds album capacity');
  let bytes = previous.reduce((n, v) => n + v.bytes, candidate.bytes), count = previous.length + 1;
  const evict = [];
  for (const item of previous) {
    if (count <= limits.maxItems && bytes <= limits.maxBytes) break;
    evict.push(item.id); bytes -= item.bytes; count--;
  }
  return { evict, bytes, count };
}
function createPostcardStore({ databaseAPI, databaseName = 'toronto-postcards-v1', limits = POSTCARD_LIMITS } = {}) {
  limits = { ...POSTCARD_LIMITS, ...limits };
  if (!Number.isSafeInteger(limits.maxItems) || limits.maxItems < 1 || limits.maxItems > POSTCARD_LIMITS.maxItems
      || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || limits.maxBytes > POSTCARD_LIMITS.maxBytes) throw new Error('Invalid album limits');
  let db = null, opening = null, generation = 0;
  function close() { generation++; db?.close(); db = null; opening = null; }
  function open() {
    if (db) return Promise.resolve(db);
    if (opening) return opening;
    const requested = generation;
    const attempt = new Promise((resolve, reject) => {
      let cancelled = false;
      try {
        const api = databaseAPI === undefined ? window.indexedDB : databaseAPI;
        if (!api) throw new Error('Album storage is unavailable');
        const request = api.open(databaseName, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('items')) database.createObjectStore('items', { keyPath: 'id' });
          if (!database.objectStoreNames.contains('images')) database.createObjectStore('images', { keyPath: 'id' });
        };
        request.onerror = () => reject(request.error || new Error('Could not open album'));
        request.onblocked = () => { cancelled = true; reject(new Error('Close other Toronto tabs to open the album')); };
        request.onsuccess = () => {
          if (cancelled || requested !== generation) { request.result.close(); reject(new Error('Album open was cancelled')); return; }
          db = request.result; db.onversionchange = close; resolve(db);
        };
      } catch (error) { reject(error); }
    }).finally(() => { if (opening === attempt) opening = null; });
    opening = attempt;
    return attempt;
  }
  async function transaction(mode, use) {
    const database = await open();
    return new Promise((resolve, reject) => {
      let result, failure = null, tx;
      try {
        tx = database.transaction(['items', 'images'], mode);
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || tx.error || new Error('Album transaction was cancelled'));
        use(tx, (value) => { result = value; }, (error) => { failure = error; tx.abort(); });
      } catch (error) { try { tx?.abort(); } catch { /* already inactive */ } reject(error); }
    });
  }
  return {
    open, close,
    async list() {
      return transaction('readonly', (tx, result, fail) => {
        const request = tx.objectStore('items').getAll();
        request.onsuccess = () => {
          try { result(request.result.map(validatePostcardItem).sort((a, b) => b.savedAtUtc.localeCompare(a.savedAtUtc) || a.id.localeCompare(b.id))); }
          catch (error) { fail(error); }
        };
      });
    },
    async get(id) {
      if (!validId(id)) throw new Error('Invalid postcard ID');
      return transaction('readonly', (tx, result, fail) => {
        const metadata = tx.objectStore('items').get(id), image = tx.objectStore('images').get(id);
        let item, files, metadataDone = false, imageDone = false;
        const finish = () => {
          if (!metadataDone || !imageDone) return;
          if (!item) { result(null); return; }
          try {
            item = validatePostcardItem(item);
            if (!(files?.blob instanceof Blob) || !(files?.thumbnail instanceof Blob)
                || files.blob.type !== 'image/jpeg' || files.thumbnail.type !== 'image/jpeg'
                || files.blob.size !== item.imageBytes || files.thumbnail.size !== item.thumbnailBytes) throw new Error('Postcard image is damaged');
            result({ ...item, blob: files.blob, thumbnail: files.thumbnail });
          } catch (error) { fail(error); }
        };
        metadata.onsuccess = () => { item = metadata.result; metadataDone = true; finish(); };
        image.onsuccess = () => { files = image.result; imageDone = true; finish(); };
      });
    },
    async save(composition, blob, thumbnail) {
      composition = normalizeComposition(composition);
      if (!(blob instanceof Blob) || blob.type !== 'image/jpeg' || !blob.size || blob.size > POSTCARD_LIMITS.maxImageBytes
          || !(thumbnail instanceof Blob) || thumbnail.type !== 'image/jpeg' || !thumbnail.size || thumbnail.size > POSTCARD_LIMITS.maxThumbnailBytes) throw new Error('Postcard image exceeds its limit');
      const item = { id: composition.id, composition, savedAtUtc: new Date().toISOString(),
        bytes: blob.size + thumbnail.size, imageBytes: blob.size, thumbnailBytes: thumbnail.size };
      return transaction('readwrite', (tx, result, fail) => {
        const metadata = tx.objectStore('items'), images = tx.objectStore('images'), request = metadata.getAll();
        request.onsuccess = () => {
          try {
            const plan = planPostcardEviction(request.result, item, limits);
            for (const id of plan.evict) { metadata.delete(id); images.delete(id); }
            metadata.put(item); images.put({ id: item.id, blob, thumbnail });
            result({ item, evicted: plan.evict, count: plan.count, bytes: plan.bytes });
          } catch (error) { fail(error); }
        };
      });
    },
    async delete(id) {
      if (!validId(id)) throw new Error('Invalid postcard ID');
      return transaction('readwrite', (tx, result) => { tx.objectStore('items').delete(id); tx.objectStore('images').delete(id); result(true); });
    }
  };
}
Object.assign(window.CITY, { POSTCARD_LIMITS, normalizeComposition, planPostcardEviction, createPostcardStore });
})();
