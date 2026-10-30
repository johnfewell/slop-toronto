(function () {
async function encodePhotoJPEG(source, { resources, maxEdge = 1920, maxBytes = 2 * 1024 * 1024, quality = 0.88 } = {}) {
  maxEdge = Math.min(1920, maxEdge);
  if (!source.width || !source.height || maxEdge < 1 || maxBytes < 1) throw new Error('Invalid photo size');
  let canvas = null, lease = null;
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  let width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale));
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      let target = source;
      if (width !== source.width || height !== source.height || typeof source.toBlob !== 'function') {
        if (!canvas) {
          canvas = document.createElement('canvas');
          lease = resources?.track({ owner: 'photo', kind: 'canvas', resource: canvas, cpuBytes: width * height * 4, gpuBytes: null });
        }
        canvas.width = width; canvas.height = height; lease?.update({ cpuBytes: width * height * 4 });
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Photo encoding is unavailable');
        context.drawImage(source, 0, 0, width, height); target = canvas;
      }
      const blob = await new Promise((resolve, reject) => target.toBlob((value) => value ? resolve(value) : reject(new Error('The photo could not be encoded')), 'image/jpeg', quality));
      if (blob.type !== 'image/jpeg') throw new Error('JPEG encoding is unavailable');
      if (blob.size <= maxBytes) return { blob, width, height, quality };
      if (quality > 0.5) quality = Math.max(0.48, quality - 0.1);
      else { width = Math.max(1, Math.floor(width * 0.8)); height = Math.max(1, Math.floor(height * 0.8)); }
    }
    throw new Error('The photo exceeds its size limit');
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    lease?.release();
  }
}
async function preparePostcardImage(clean, { caption = '', postcard = false, resources } = {}) {
  const bitmap = await createImageBitmap(clean.blob);
  let canvas = null, canvasLease = null, imageLease = null;
  try {
    imageLease = resources?.track({ owner: 'photo', kind: 'image', resource: bitmap, cpuBytes: bitmap.width * bitmap.height * 4, gpuBytes: null });
    // Validate the clean scene before adding a border/caption, which could disguise a blank capture.
    const sample = document.createElement('canvas'); sample.width = sample.height = 64;
    let sampleLease = null;
    try {
      sampleLease = resources?.track({ owner: 'photo', kind: 'canvas', resource: sample, cpuBytes: 64 * 64 * 4, gpuBytes: null });
      const ctx = sample.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Photo validation is unavailable');
      ctx.drawImage(bitmap, 0, 0, 64, 64); const pixels = ctx.getImageData(0, 0, 64, 64).data;
      let min = 255, max = 0;
      for (let i = 0; i < pixels.length; i += 4) for (let k = 0; k < 3; k++) { min = Math.min(min, pixels[i + k]); max = Math.max(max, pixels[i + k]); }
      if (max - min < 3) throw new Error('The captured scene is blank');
    } finally { sample.width = sample.height = 0; sampleLease?.release(); }
    let final = clean, thumbnailSource = bitmap;
    if (postcard) {
      const w = bitmap.width, h = bitmap.height, pad = Math.max(10, Math.round(w * 0.025)), footer = Math.max(84, Math.round(w * 0.095));
      canvas = document.createElement('canvas'); canvas.width = w + 2 * pad; canvas.height = h + 2 * pad + footer;
      canvasLease = resources?.track({ owner: 'photo', kind: 'canvas', resource: canvas, cpuBytes: canvas.width * canvas.height * 4, gpuBytes: null });
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Postcard framing is unavailable');
      ctx.fillStyle = '#f5f1e7'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, pad, pad);
      ctx.fillStyle = '#263a49'; ctx.textBaseline = 'top';
      const size = Math.max(14, Math.min(24, Math.round(w / 45)));
      ctx.font = `600 ${Math.max(12, size * 0.7)}px system-ui, sans-serif`;
      ctx.fillText('Postcard from Toronto', pad, h + 2 * pad);
      ctx.font = `400 ${size}px system-ui, sans-serif`;
      const words = caption.trim().split(/\s+/), lines = []; let line = '';
      for (const word of words) {
        const next = line ? line + ' ' + word : word;
        if (ctx.measureText(next).width > w && line) { lines.push(line); line = word; } else line = next;
      }
      if (line) lines.push(line);
      lines.slice(0, 3).forEach((value, i) => ctx.fillText(value, pad, h + 2 * pad + size + 7 + i * size * 1.25, w));
      final = await encodePhotoJPEG(canvas, { resources }); thumbnailSource = canvas;
    }
    const thumbnail = await encodePhotoJPEG(thumbnailSource, { resources, maxEdge: 256, maxBytes: 64 * 1024 });
    return { final, thumbnail: thumbnail.blob };
  } finally {
    bitmap.close(); imageLease?.release();
    if (canvas) canvas.width = canvas.height = 0;
    canvasLease?.release();
  }
}
Object.assign(window.CITY, { encodePhotoJPEG, preparePostcardImage });
})();
