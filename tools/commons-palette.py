#!/usr/bin/env python3
"""usage: python3 -I tools/commons-palette.py [cache_dir]

Measures the colours of Toronto's buildings from freely licensed photos on Wikimedia Commons and writes them to
tools/data/commons_palette.json, with every photo that contributed listed (author, licence, link) in
tools/data/commons_photos.md. The photos themselves stay in the cache directory (default: a temp dir); the game ships
only the measured colours, which buildings.js & towers.js use as facade base colours.
(From aalghooneh/slop-toronto, MIT; in this city js/buildings.js uses them: see its TORONTO_MASONRY.)

Each photo is cut down to its building pixels: foliage, sky (bright or bluish above the skyline, or smooth) and the dark & washed-out are
dropped. What's left is split into masonry (warm hues: brick, sandstone) and glass & concrete (cool or grey, textured).
A photo whose masonry fills enough of it gives one masonry sample (its median); same for glass. The samples of all the
photos are then clustered in CIELAB, and each cluster's median becomes a palette entry with the share of photos in it.

Needs Pillow & numpy. Wikimedia's API etiquette: a descriptive User-Agent and one request at a time.
"""
import json, os, re, sys, tempfile, time, urllib.parse, urllib.request
from html import unescape

import numpy as np
from PIL import Image

UA = 'slop-toronto-palette/1.0 (https://github.com/aalghooneh/slop-toronto)'
API = 'https://commons.wikimedia.org/w/api.php'
FREE = re.compile(r'^(cc0|public domain|pd|cc by(-sa)?( \d\.\d)?|cc-by(-sa)?-\d\.\d)', re.I)
HERE = os.path.dirname(os.path.abspath(__file__))

# Which categories feed which palette (subcategories are walked one level down)
GROUPS = {
    'masonry': ['Houses in Toronto', 'Bay-and-gable houses', 'Cabbagetown, Toronto', 'Brick buildings in Toronto',
                'Distillery District'],
    'towers': ['Condominiums in Toronto', 'Skyscrapers in Toronto'],
}
PER_GROUP = 260  # photos read per group


def api(**params):
    params.update(format='json', formatversion=2)
    req = urllib.request.Request(API + '?' + urllib.parse.urlencode(params), headers={'User-Agent': UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:
            time.sleep(2 + attempt * 3)
    raise RuntimeError('Commons API unreachable')


def members(cat, kind):
    out, cont = [], {}
    while True:
        res = api(action='query', list='categorymembers', cmtitle='Category:' + cat, cmtype=kind, cmlimit=500, **cont)
        out += [m['title'] for m in res['query']['categorymembers']]
        if 'continue' not in res:
            return out
        cont = {'cmcontinue': res['continue']['cmcontinue']}


def files_of(cats):
    seen = []
    for cat in cats:
        for title in members(cat, 'file') + [f for sub in members(cat, 'subcat') for f in members(sub[9:], 'file')]:
            if title not in seen and re.search(r'\.(jpe?g|png)$', title, re.I):
                seen.append(title)
    return seen


def info(titles):
    out = {}
    for i in range(0, len(titles), 40):
        res = api(action='query', prop='imageinfo', titles='|'.join(titles[i:i + 40]), iiprop='url|extmetadata',
                  iiurlwidth=640)
        for p in res['query']['pages']:
            if 'imageinfo' not in p:
                continue
            ii = p['imageinfo'][0]
            meta = ii.get('extmetadata', {})
            lic = meta.get('LicenseShortName', {}).get('value', '')
            if not FREE.match(lic):
                continue
            artist = re.sub(r'<[^>]+>', '', unescape(meta.get('Artist', {}).get('value', ''))).strip() or 'unknown'
            out[p['title']] = {'thumb': ii['thumburl'], 'page': ii['descriptionurl'], 'license': lic, 'artist': artist}
    return out


def fetch(url, path):
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=60) as r, open(path, 'wb') as f:
            f.write(r.read())
        time.sleep(0.15)
    return Image.open(path).convert('RGB')


def srgb_to_lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    xyz = c @ np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]).T
    xyz /= np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def classify(img):
    """Masonry & glass/concrete pixel masks of one photo."""
    a = np.asarray(img, dtype=np.float32)
    h, w, _ = a.shape
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(-1), a.min(-1)
    v = mx / 255
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    hue = np.zeros_like(v)
    d = np.maximum(mx - mn, 1e-3)
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    # texture: mean gradient over a 9 px window (sky & haze are smooth)
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    gy, gx = np.abs(np.diff(lum, axis=0, append=lum[-1:])), np.abs(np.diff(lum, axis=1, append=lum[:, -1:]))
    grad = gx + gy
    k = 9
    ii = np.pad(grad, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    y0, x0 = np.clip(np.arange(h) - k // 2, 0, h), np.clip(np.arange(w) - k // 2, 0, w)
    y1, x1 = np.clip(np.arange(h) + k // 2 + 1, 0, h), np.clip(np.arange(w) + k // 2 + 1, 0, w)
    area = (y1 - y0)[:, None] * (x1 - x0)[None, :]
    tex = (ii[y1][:, x1] - ii[y0][:, x1] - ii[y1][:, x0] + ii[y0][:, x0]) / area
    rows = np.arange(h)[:, None] / h
    # sky: everything above each column's first hard edge that's bright or bluish (and the smooth bits among it)
    edge = grad > 40
    above = np.cumsum(edge, 0) == 0
    bluish = (hue > 180) & (hue < 260) & (s > 0.08)
    sky = above & (bluish | (v > 0.62)) | (tex < 5) & (bluish | (v > 0.75))
    foliage = (hue > 58) & (hue < 170) & (s > 0.16)
    usable = ~foliage & ~sky & (v > 0.12) & (v < 0.95) & (rows > 0.03) & (rows < 0.78)  # (the street's at the foot)
    masonry = usable & ((hue < 55) | (hue > 340)) & (s > 0.16) & (s < 0.8)
    glass = usable & (tex > 7) & ~masonry & (((hue > 165) & (hue < 250)) | (s < 0.14))
    return a, masonry, glass


def kmeans(x, k, iters=40, seed=7):
    rng = np.random.default_rng(seed)
    c = x[rng.choice(len(x), k, replace=False)]
    for _ in range(iters):
        lab = np.argmin(((x[:, None] - c[None]) ** 2).sum(-1), 1)
        c = np.array([x[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(k)])
    return lab


def palette(samples, k):
    rgb = np.array([s['rgb'] for s in samples], dtype=np.float32)
    lab = kmeans(srgb_to_lab(rgb), k)
    out = []
    for j in range(k):
        sel = rgb[lab == j]
        if not len(sel):
            continue
        med = np.median(sel, 0).round().astype(int)
        out.append({'hex': '#%02x%02x%02x' % tuple(med), 'share': round(len(sel) / len(rgb), 3), 'photos': int(len(sel)),
                    'lightness': round(float(srgb_to_lab(med[None].astype(np.float32))[0, 0]), 1)})
    return sorted(out, key=lambda e: -e['share'])


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), 'slop-toronto-commons')
    os.makedirs(cache, exist_ok=True)
    samples = {'masonry': [], 'glass': []}
    credits = {}
    for group, cats in GROUPS.items():
        titles = files_of(cats)[:PER_GROUP * 2]
        meta = info(titles)
        print(f'{group}: {len(titles)} photos listed, {len(meta)} freely licensed', file=sys.stderr)
        for title in list(meta)[:PER_GROUP]:
            m = meta[title]
            path = os.path.join(cache, re.sub(r'[^\w.-]', '_', title[5:])[:120])
            try:
                a, masonry, glass = classify(fetch(m['thumb'], path))
            except Exception as e:
                print('  skip', title, e, file=sys.stderr)
                continue
            if (a.max(-1) - a.min(-1)).mean() < 12:
                continue  # black & white (or near enough)
            for kind, mask, need in (('masonry', masonry, 0.08), ('glass', glass, 0.1 if group == 'towers' else 1)):
                if mask.mean() >= need:
                    px = a[mask]
                    if kind == 'masonry':  # the wall in sun, not its shadows & mortar: the upper half of its lightness
                        lum = px @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
                        px = px[(lum >= np.percentile(lum, 50)) & (lum <= np.percentile(lum, 92))]
                    samples[kind].append({'rgb': np.median(px, 0).tolist(), 'title': title})
                    credits[title] = m
    out = {'source': 'Wikimedia Commons, freely licensed photos (see commons_photos.md)',
           'masonry': palette(samples['masonry'], 5), 'glass': palette(samples['glass'], 5)}
    with open(os.path.join(HERE, 'data', 'commons_palette.json'), 'w') as f:
        json.dump(out, f, indent=2)
    with open(os.path.join(HERE, 'data', 'commons_photos.md'), 'w') as f:
        f.write('# Photos measured for the facade colours\n\nThe facade base colours in `js/buildings.js` and '
                '`js/towers.js` were measured from these photos on Wikimedia Commons (by `tools/commons-palette.py`).'
                ' The photos are not part of this repository; only colours derived from them are.\n\n')
        for title in sorted(credits):
            m = credits[title]
            f.write(f"- [{title[5:]}]({m['page']}) by {m['artist'][:80]}, {m['license']}\n")
    print(json.dumps(out, indent=2))
    print(f"{len(samples['masonry'])} masonry & {len(samples['glass'])} glass samples from {len(credits)} photos",
          file=sys.stderr)


if __name__ == '__main__':
    main()
