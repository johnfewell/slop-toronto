# tools/blender/bake_props.py — rebuilds John's Meshy street props (tools/prop-src/s-orig.glb, the TTC/astral transit
# shelter; b-orig.glb, the three-chamber litter & recycling bin) as clean low-poly models and bakes their look onto them.
# Meshy's meshes are 0.5-1.3M lumpy triangles on a shattered UV atlas, so decimating them smears the texture: instead
# each prop is re-modelled here as a few dozen straight boxes following the original's measured silhouette (posts,
# roof, panes, ad box, map case; the bin's stacked bands, lid with its three openings, plinth), given one clean UV layout,
# and the original's albedo is baked onto it (Cycles, selected-to-active, emission = base colour so no lighting gets in).
# Faces carry a tag: detail tags (poster, map, signs, the bin's labels) keep the bake; structure tags (frame, glass,
# roof) are flattened to the bake's own median colour so flat panels read flat, then a soft AO bake grounds everything.
# Roughness/metallic come from the tags too (glossy glass, painted steel). No normal map: the geometry is the shape.
# Output: one mesh, metres, base on z=0, centred, glTF +z (Blender -y) the front — what js/street-props.js instances —
# with one baked material, plus a second, see-through one for the shelter's glass (panes & roof: they're clear glass). Then: npx @gltf-transform/cli@4 webp <out> <out>; npx @gltf-transform/cli@4 meshopt <out> <out>.
# Round props (the hydrant, the post-and-ring bike stand, the post box's feet) are lathes & a bent band whose strips carry
# their own unrolled UVs, so a barrel or the ring's lettering bakes without a seam on every facet.
# usage: Blender --background --factory-startup --python tools/blender/bake_props.py -- shelter|bin|hydrant|postbox|bikering <src.glb> <out.glb> <workdir>
#   park-sign <face-template.jpg> <out.glb> <workdir>: modelled from measurements, no source mesh (see its block below)
#   sources (John's Meshy originals, tools/prop-src/, gitignored): shelter s-orig.glb, bin b-orig.glb, hydrant h-orig.glb
#   (Rusted_Hydrant_with_C), postbox p-orig.glb (Graffiti_Mailbox_by_C), bikering cand-calga.glb (From_Toronto_to_Calga)
import bpy, bmesh, sys, os, math, mathutils, numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
KIND, SRC, OUT, WORK = argv[0], argv[1], argv[2], argv[3]
os.makedirs(WORK, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------- park-sign: modelled from its measurements, no source mesh
# The City's park name sign ("A CITY WITHIN A PARK"): two square blue posts on base collars, an arched aluminium panel
# between them with a thin silver trim along the arch, a plain aluminium back. The printed face is its own material with
# UVs 0..1 over the blank face template's whole 2048 x 1072 rectangle (glTF v down from the template's top row), cut to
# the template's arch, so the template (and each park's name & address, js/park-signs.js) lands on it exactly.
# SRC is the face template image: OUT ships without it (the page draws the face), <workdir>/park-sign-preview.glb carries
# it for the comparisons. Sizes: John's photo & Street View (Ritchie Avenue & Beaty Avenue Parkettes), see PROVENANCE.json.
if KIND == 'park-sign':
    FACE_W, TPL_W, TPL_H = 1.75, 2048, 1072
    S = FACE_W / TPL_W                       # metres per template pixel
    PB = 1.60                                # the panel's bottom edge above the ground
    PW, CW, CH = 0.15, 0.21, 0.28            # post, base collar (square) and collar height
    YF, YB, YT = -0.026, 0.026, 0.034        # face & back planes, the trim's half depth (Blender -y is the front)
    TOP = PB + TPL_H * S                     # the arch's apex
    # the template's arch: its white cut-off, measured from the centre out (px from centre, px down from the top)
    ARCH = [(0, 0), (128, 0.5), (256, 3), (384, 14), (512, 29), (640, 50), (768, 77), (832, 93), (896, 111), (960, 131.5), (1024, 155)]
    def arch_px(d):
        d = abs(d)
        for (d0, y0), (d1, y1) in zip(ARCH, ARCH[1:]):
            if d <= d1: return y0 + (y1 - y0) * (d - d0) / (d1 - d0)
        return ARCH[-1][1]
    XS = sorted({-d for d, _ in ARCH} | {d for d, _ in ARCH})   # template px from the centre, left to right
    INSET = 2.0                                                  # px under the cut-off, so no white shows
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    MATS = ['park-sign-face', 'park-sign-post', 'park-sign-trim', 'park-sign-back']
    def quad(vs, mat, uvs=None):
        f = bm.faces.new(vs); f.material_index = MATS.index(mat); f.smooth = False
        if uvs:
            for lp, uv in zip(f.loops, uvs): lp[uvl].uv = uv
        return f
    def box(x0, x1, y0, y1, z0, z1, mat, bottom=False):
        v = [bm.verts.new((x, y, z)) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        V = lambda i, j, k: v[i * 4 + j * 2 + k]
        quad([V(0,0,0), V(0,0,1), V(0,1,1), V(0,1,0)], mat); quad([V(1,0,0), V(1,1,0), V(1,1,1), V(1,0,1)], mat)
        quad([V(0,0,0), V(1,0,0), V(1,0,1), V(0,0,1)], mat); quad([V(0,1,0), V(0,1,1), V(1,1,1), V(1,1,0)], mat)
        quad([V(0,0,1), V(1,0,1), V(1,1,1), V(0,1,1)], mat)
        if bottom: quad([V(0,0,0), V(0,1,0), V(1,1,0), V(1,0,0)], mat)
    zt = lambda d, inset=INSET: TOP - (arch_px(d) + inset) * S
    # face (front, -y) and back (+y): one quad per arch step from the bottom edge up to the arch
    for a, b in zip(XS, XS[1:]):
        xa, xb = a * S, b * S
        ua, ub = (a + TPL_W / 2) / TPL_W, (b + TPL_W / 2) / TPL_W
        va, vb = 1 - (arch_px(a) + INSET) / TPL_H, 1 - (arch_px(b) + INSET) / TPL_H
        fa = [bm.verts.new(p) for p in ((xa, YF, PB), (xb, YF, PB), (xb, YF, zt(b)), (xa, YF, zt(a)))]
        quad(fa, 'park-sign-face', [(ua, 0), (ub, 0), (ub, vb), (ua, va)])
        ba = [bm.verts.new(p) for p in ((xa, YB, PB), (xa, YB, zt(a)), (xb, YB, zt(b)), (xb, YB, PB))]
        quad(ba, 'park-sign-back')
        # the panel's bottom edge
        quad([bm.verts.new(p) for p in ((xa, YF, PB), (xa, YB, PB), (xb, YB, PB), (xb, YF, PB))], 'park-sign-back')
    # the trim: a thin silver channel capping the arch, a little proud of the face and the back
    TH = 0.014
    for a, b in zip(XS, XS[1:]):
        xa, xb = a * S, b * S
        za, zb = zt(a, 0), zt(b, 0)
        quad([bm.verts.new(p) for p in ((xa, -YT, za - TH), (xb, -YT, zb - TH), (xb, -YT, zb + TH), (xa, -YT, za + TH))], 'park-sign-trim')
        quad([bm.verts.new(p) for p in ((xa, -YT, za + TH), (xb, -YT, zb + TH), (xb, YT, zb + TH), (xa, YT, za + TH))], 'park-sign-trim')
        quad([bm.verts.new(p) for p in ((xa, YT, za - TH), (xa, YT, za + TH), (xb, YT, zb + TH), (xb, YT, zb - TH))], 'park-sign-trim')
    # posts (their inner faces 1 cm over the panel's ends) up to the arch's corners, on their base collars
    ZC = zt(1024, 0)
    for sgn in (-1, 1):
        cx = sgn * (FACE_W / 2 + PW / 2 - 0.01)
        box(cx - PW / 2, cx + PW / 2, -PW / 2, PW / 2, 0.0, ZC, 'park-sign-post')
        box(cx - CW / 2, cx + CW / 2, -CW / 2, CW / 2, 0.0, CH, 'park-sign-post')
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new('park-sign'); bm.normal_update(); bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new('park-sign', me); bpy.context.scene.collection.objects.link(obj)
    print('LOW', sum(len(p.vertices) - 2 for p in me.polygons), 'tris; size', [round(v, 3) for v in obj.dimensions])
    COL = {  # sRGB, roughness, metallic
        'park-sign-face': ((0.83, 0.84, 0.86), 0.55, 0.0),
        'park-sign-post': ((0x2F / 255, 0x7D / 255, 0xC0 / 255), 0.5, 0.0),
        'park-sign-trim': ((0.80, 0.81, 0.83), 0.35, 0.6),
        'park-sign-back': ((0.62, 0.64, 0.66), 0.5, 0.4),
    }
    def lin(c): return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
    for name in MATS:
        m = bpy.data.materials.new(name); m.use_nodes = True; me.materials.append(m)
        b = m.node_tree.nodes['Principled BSDF']; c, r, mt = COL[name]
        b.inputs['Base Color'].default_value = (*lin(c), 1.0); b.inputs['Roughness'].default_value = r; b.inputs['Metallic'].default_value = mt
    me.set_sharp_from_angle(angle=math.radians(30))
    def export(path):
        bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                                  export_normals=True, export_texcoords=True, export_tangents=False, export_materials='EXPORT', export_image_format='AUTO')
        print('WROTE', path)
    export(OUT)
    # the preview: the blank face template printed on the face
    fm = bpy.data.materials['park-sign-face']; nt = fm.node_tree
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(SRC); nt.nodes.active = t
    nt.links.new(t.outputs[0], nt.nodes['Principled BSDF'].inputs['Base Color'])
    export(os.path.join(WORK, 'park-sign-preview.glb'))
    # the face alone (its outline & print against the template)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != 0], context='FACES')
    bm.to_mesh(me); bm.free()
    export(os.path.join(WORK, 'park-sign-face.glb'))
    sys.exit(0)

# ---------------------------------------------------------------- tags: (texel density, keep bake 0..1, AO strength, roughness, metallic, emission, flat colour override sRGB)
if KIND == 'shelter':
    HEIGHT, ATLAS, MR_SIZE = 2.5, 1024, 512
    TAGS = {
        'poster': (6.0, 1.0, 0.25, 0.18, 0.0, 0.22, None),
        'map':    (6.0, 1.0, 0.25, 0.18, 0.0, 0.30, None),
        'sign':   (4.0, 1.0, 0.25, 0.40, 0.0, 0.0, None),
        'frame':  (1.0, 0.0, 0.55, 0.42, 0.35, 0.0, None),
        'glass':  (0.6, 0.0, 0.45, 0.06, 0.0, 0.0, None),
        'roof':   (0.5, 0.0, 0.35, 0.10, 0.0, 0.0, None),
        'hidden': (0.05, 0.0, 0.0, 0.5, 0.0, 0.0, None),
    }
elif KIND == 'hydrant':  # John's rusted cream hydrant: the paint keeps its rust & scrawl, the steel shoe & black cap read clean
    HEIGHT, ATLAS, MR_SIZE = None, 1024, 128
    TAGS = {
        'paint':  (1.0, 0.8, 0.45, 0.55, 0.0, 0.0, None),
        'cap':    (1.0, 0.6, 0.45, 0.45, 0.3, 0.0, None),
        'nut':    (1.0, 0.8, 0.40, 0.50, 0.4, 0.0, None),
        'steel':  (0.8, 0.45, 0.50, 0.35, 0.6, 0.0, None),
        'hidden': (0.05, 0.0, 0.0, 0.7, 0.0, 0.0, None),
    }
elif KIND == 'postbox':  # John's graffiti-covered Canada Post box: the graffiti & stickers are the point, so the faces keep the bake
    HEIGHT, ATLAS, MR_SIZE = None, 1024, 128
    TAGS = {
        'face':   (1.0, 1.0, 0.35, 0.45, 0.1, 0.0, None),
        'skirt':  (1.0, 0.9, 0.45, 0.50, 0.45, 0.0, None),
        'top':    (0.6, 0.6, 0.30, 0.45, 0.1, 0.0, None),
        'hood':   (1.0, 0.7, 0.40, 0.45, 0.1, 0.0, None),
        'slot':   (0.3, 0.0, 0.60, 0.90, 0.0, 0.0, (0.03, 0.03, 0.035)),
        'foot':   (0.3, 0.0, 0.50, 0.60, 0.4, 0.0, (0.30, 0.30, 0.30)),
        'hidden': (0.05, 0.0, 0.0, 0.7, 0.0, 0.0, None),
    }
elif KIND == 'bikering':  # John's Toronto post-and-ring: galvanised steel, the ring's lettering kept
    HEIGHT, ATLAS, MR_SIZE = None, 1024, 128
    TAGS = {
        'ring':   (1.4, 0.75, 0.40, 0.40, 0.6, 0.0, None),
        'post':   (1.0, 0.35, 0.45, 0.40, 0.6, 0.0, None),
        'hidden': (0.05, 0.0, 0.0, 0.7, 0.0, 0.0, None),
    }
else:
    HEIGHT, ATLAS, MR_SIZE = None, 1024, 128
    TAGS = {
        'label':  (1.0, 1.0, 0.35, 0.50, 0.15, 0.0, None),
        'body':   (0.8, 0.55, 0.45, 0.55, 0.15, 0.0, None),
        'grey':   (0.8, 0.5, 0.35, 0.38, 0.55, 0.0, None),
        'top':    (0.5, 0.25, 0.30, 0.50, 0.20, 0.0, None),
        'base':   (0.4, 0.3, 0.50, 0.70, 0.0, 0.0, None),
        'groove': (0.2, 0.0, 0.40, 0.70, 0.0, 0.0, (0.06, 0.06, 0.065)),
        'hole':   (0.15, 0.0, 0.60, 0.90, 0.0, 0.0, (0.035, 0.035, 0.04)),
        'hidden': (0.05, 0.0, 0.0, 0.7, 0.0, 0.0, None),
    }
TAG_NAMES = list(TAGS)
# per kind: output texture size, smoothing angle (an 8-sided post must stay smooth), the original's own axis (the hydrant's
# barrel sits 4.5 cm behind its bounding-box centre: the pumper nozzle sticks out the front) moved to the origin
TEX = {'shelter': 1024, 'bin': 1024}.get(KIND, 512)
SHARP = {'hydrant': 50, 'bikering': 65}.get(KIND, 35)
AXIS = {'hydrant': (0.005, 0.045)}.get(KIND, (0.0, 0.0))
SLIVER = {'shelter': 1.0, 'bin': 1.0}.get(KIND, 0.15)  # the small props' many little faces (nuts, feet) would eat the atlas

# ---------------------------------------------------------------- the high-poly original: one object, metres, centred
bpy.ops.import_scene.gltf(filepath=SRC)
hs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in hs: o.select_set(True)
bpy.context.view_layer.objects.active = hs[0]
if len(hs) > 1: bpy.ops.object.join()
high = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
co = np.empty(len(high.data.vertices) * 3); high.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
lo, hi = co.min(0), co.max(0)
s = HEIGHT / (hi[2] - lo[2]) if HEIGHT else 1.0
high.data.transform(Matrix.Translation(Vector((-AXIS[0], -AXIS[1], 0))) @ Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
print('HIGH', len(high.data.polygons), 'tris; size', ((hi - lo) * s).round(3))
for m in high.data.materials:  # flat albedo: base colour straight into emission
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; em = nt.nodes.new('ShaderNodeEmission')
    if b.inputs['Base Color'].links: nt.links.new(b.inputs['Base Color'].links[0].from_socket, em.inputs[0])
    else: em.inputs[0].default_value = b.inputs['Base Color'].default_value
    nt.links.new(em.outputs[0], [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0].inputs[0])

# ---------------------------------------------------------------- low-poly builders (Blender coords: z up, -y front)
bm = bmesh.new()
UVL = bm.loops.layers.uv.new('UVMap')    # strips (lathes, the ring) carry their own unrolled UVs in metres ...
PRE = bm.faces.layers.int.new('preuv')   # ... and are flagged so the planar projection below leaves them alone
def axis_key(n):
    a = max(range(3), key=lambda i: abs(n[i])); return ('+' if n[a] > 0 else '-') + 'xyz'[a]
def tag_new(faces, tag, faces_tag=None):
    for f in faces:
        f.normal_update(); t = (faces_tag or {}).get(axis_key(f.normal), tag); f.material_index = TAG_NAMES.index(t)
def add_box(x0, x1, y0, y1, z0, z1, tag, ft=None, shear=0.0, sy=None):
    """axis box; shear lifts z by shear*(y - sy) (the sloped roof)"""
    sy = y0 if sy is None else sy
    vs = [bm.verts.new((x, y, z + shear * (y - sy))) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    v = lambda i, j, k: vs[i * 4 + j * 2 + k]
    quads = [(v(0,0,0), v(0,0,1), v(0,1,1), v(0,1,0)), (v(1,0,0), v(1,1,0), v(1,1,1), v(1,0,1)),
             (v(0,0,0), v(1,0,0), v(1,0,1), v(0,0,1)), (v(0,1,0), v(0,1,1), v(1,1,1), v(1,1,0)),
             (v(0,0,0), v(0,1,0), v(1,1,0), v(1,0,0)), (v(0,0,1), v(1,0,1), v(1,1,1), v(0,1,1))]
    fs = [bm.faces.new(q) for q in quads]; tag_new(fs, tag, ft); return fs
def add_cyl(x, y, z0, z1, r0, r1, seg, tag, ft=None, rot=0.0, sx=1.0, sy=1.0, smooth=True):
    before = set(bm.faces)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=z1 - z0,
                          matrix=Matrix.Translation((x, y, (z0 + z1) / 2)) @ Matrix.Diagonal((sx, sy, 1, 1)) @ Matrix.Rotation(rot, 4, 'Z'))
    fs = [f for f in bm.faces if f not in before]; tag_new(fs, tag, ft)
    for f in fs: f.smooth = smooth and abs(f.normal.z) < 0.5
    return fs
def add_panel_with_holes(x0, x1, z0, z1, y, holes, depth, tag, hole_tag):
    """a -y facing panel at y with rectangular openings (x0,x1,z0,z1) recessed depth back"""
    xs = sorted({x0, x1, *[h[0] for h in holes], *[h[1] for h in holes]}); zs = sorted({z0, z1, *[h[2] for h in holes], *[h[3] for h in holes]})
    vid = {}
    def V(x, z):
        if (x, z) not in vid: vid[(x, z)] = bm.verts.new((x, y, z))
        return vid[(x, z)]
    fs = []
    for i in range(len(xs) - 1):
        for k in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[k] + zs[k + 1]) / 2
            if any(h[0] < cx < h[1] and h[2] < cz < h[3] for h in holes): continue
            fs.append(bm.faces.new((V(xs[i], zs[k]), V(xs[i + 1], zs[k]), V(xs[i + 1], zs[k + 1]), V(xs[i], zs[k + 1]))))
    tag_new(fs, tag)
    for (a, b, c, d) in holes:
        f = [bm.verts.new(p) for p in ((a, y, c), (b, y, c), (b, y, d), (a, y, d))]
        r = [bm.verts.new(p) for p in ((a, y + depth, c), (b, y + depth, c), (b, y + depth, d), (a, y + depth, d))]
        hf = [bm.faces.new((f[i], f[(i + 1) % 4], r[(i + 1) % 4], r[i])) for i in range(4)] + [bm.faces.new(r)]
        tag_new(hf, hole_tag)
        for q in hf:  # tunnel faces look inward (toward the opening's axis) and the back looks out the front
            q.normal_update()
            cen = q.calc_center_median(); axis = Vector(((a + b) / 2, cen.y, (c + d) / 2))
            want = (axis - cen) if q is not hf[-1] else Vector((0, -1, 0))
            if q.normal.dot(want) < 0: q.normal_flip()
def add_grid(P, tags, wrap=True, smooth=True, isl=0.45):
    """quad strips between rows of points P[i][j] (j runs around, closed when wrap): each band i..i+1 is unrolled by arc
    length into UV strips at most isl metres long (long thin strips pack badly); faces face (P[i][j+1]-P[i][j]) x
    (P[i+1][j]-P[i][j]). A row that is one point (a pole) makes triangles. tags: one tag, or one per band"""
    V = [[bm.verts.new(p) for p in row] if len(row) > 1 else [bm.verts.new(row[0])] for row in P]
    fs = []
    for i in range(len(P) - 1):
        a, b = V[i], V[i + 1]; n = max(len(a), len(b)); cols = n if wrap else n - 1
        at = lambda r, j: r[j % len(r)] if len(r) > 1 else r[0]
        # u: arc length along the band's middle; v: across the band
        mid = [(at(a, j).co + at(b, j).co) / 2 for j in range(n + 1)]
        us = [0.0]
        for j in range(n): us.append(us[-1] + (mid[j + 1] - mid[j]).length)
        h = sum((at(a, j).co - at(b, j).co).length for j in range(n)) / n
        tag = tags if isinstance(tags, str) else tags[i]
        k = max(1, math.ceil(us[cols] / isl)); start = [round(c * cols / k) for c in range(k)]
        for j in range(cols):
            u0 = us[max(c for c in start if c <= j)]  # this face's strip starts here
            corners = [(at(a, j), us[j] - u0, 0), (at(a, j + 1), us[j + 1] - u0, 0), (at(b, j + 1), us[j + 1] - u0, h), (at(b, j), us[j] - u0, h)]
            seen, cs = set(), []
            for c in corners:
                if c[0] not in seen: seen.add(c[0]); cs.append(c)
            f = bm.faces.new([c[0] for c in cs]); f.material_index = TAG_NAMES.index(tag); f.smooth = smooth; f[PRE] = 1
            uvs = {c[0]: (c[1], c[2]) for c in cs}
            for lp in f.loops: lp[UVL].uv = uvs[lp.vert]
            fs.append(f)
    return fs
def add_cap(ring, tag, flip=False):
    """flat n-gon over a closed row of verts' positions (planar-projected UVs)"""
    vs = [bm.verts.new(p) for p in (ring[::-1] if flip else ring)]
    f = bm.faces.new(vs); f.material_index = TAG_NAMES.index(tag); f.smooth = False; return f
def lathe(prof, seg, tags, M=Matrix(), sx=1.0, sy=1.0, phase=0.0, cap_end=None, cap_start=None):
    """surface of revolution about local z: prof [(r, z), ...] bottom to top (r = 0 is a pole), placed by M;
    cap_end/cap_start: tag for a flat cap over the last/first ring"""
    rows = []
    for r, z in prof:
        if r == 0: rows.append([M @ Vector((0, 0, z))]); continue
        rows.append([M @ Vector((r * sx * math.cos(phase + 2 * math.pi * j / seg), r * sy * math.sin(phase + 2 * math.pi * j / seg), z)) for j in range(seg)])
    fs = add_grid(rows, tags)
    if cap_end: fs.append(add_cap(rows[-1], cap_end))
    if cap_start: fs.append(add_cap(rows[0], cap_start, flip=True))
    return fs
def ring_band(cz, ro, ri, t, seg, tag, phase=0.0):
    """a flat band bent into a ring in the x-z plane about (0, cz): outer & inner radius and thickness (y +/- t/2) are functions of the angle"""
    def row(r, s): return [Vector((r(p) * math.cos(p), s * t(p) / 2, cz + r(p) * math.sin(p))) for p in (phase + 2 * math.pi * j / seg for j in range(seg))]
    o_b, o_f, i_b, i_f = row(ro, 1), row(ro, -1), row(ri, 1), row(ri, -1)
    fs = []
    for rows in ([o_b, o_f], [i_f, i_b], [o_f, i_f], [i_b, o_b]):  # outer, inner, front (-y), back (+y)
        fs += add_grid(rows, tag, isl=0.25)
    for f in fs: f.smooth = True
    return fs

if KIND == 'shelter':
    POSTS = (-1.99, -0.672, 0.672, 1.99)
    SL = -0.19 / 1.10  # the glass roof falls 19 cm from the street edge to the back
    add_box(-2.21, 2.21, -0.55, 0.55, 2.475, 2.50, 'roof', shear=SL)
    add_box(-2.15, 2.15, 0.30, 0.44, 2.15, 2.33, 'frame')                       # back beam
    add_box(-2.15, 2.15, -0.19, -0.14, 2.365, 2.415, 'frame', shear=SL, sy=-0.165)  # purlin under the glass
    for x in POSTS:
        add_box(x - 0.025, x + 0.025, -0.52, 0.42, 2.40, 2.465, 'frame', shear=SL)  # rafter under the roof
        add_cyl(x, 0.30, 0.06, 2.20, 0.075, 0.075, 8, 'frame', rot=math.pi / 8, sx=0.72, sy=0.72, smooth=False)  # post
        add_cyl(x, 0.30, 0.0, 0.08, 0.15, 0.12, 16, 'frame', ft={'-z': 'hidden'})  # round foot
    # back wall: tinted panes between the posts, a rail at hand height; the right bay is open above the rail (the map)
    for (a, b) in ((-1.935, -0.727), (0.727, 1.935)):
        add_box(a, b, 0.28, 0.32, 1.115, 1.155, 'frame')
        add_box(a, b, 0.29, 0.31, 0.19, 1.10, 'glass')
    add_box(-1.935, -0.727, 0.29, 0.31, 1.17, 2.09, 'glass')
    # end wings: two panes, a rail, the blue stop sign on top
    for x in (-1.99, 1.99):
        add_box(x - 0.01, x + 0.01, -0.22, 0.25, 0.19, 1.10, 'glass')
        add_box(x - 0.01, x + 0.01, -0.22, 0.25, 1.17, 1.955, 'glass')
        add_box(x - 0.02, x + 0.02, -0.22, 0.25, 1.115, 1.155, 'frame')
        add_box(x - 0.02, x + 0.02, -0.225, 0.25, 1.955, 2.09, 'frame', ft={'-x': 'sign', '+x': 'sign', '-y': 'sign'})
    # the lit ad box (poster both faces, astral above it) and the TTC map case
    add_box(-0.625, 0.625, 0.10, 0.225, 0.17, 2.11, 'frame', ft={'-y': 'poster', '+y': 'poster', '-z': 'hidden'})
    add_box(0.93, 1.78, 0.30, 0.43, 1.23, 2.06, 'frame', ft={'-y': 'map', '+y': 'map'})
    CAGE, RAY = 0.03, 0.12
elif KIND == 'hydrant':
    # one lathe from the steel shoe to the dome (radii measured about the barrel's axis), the bolted flange a crisp step
    # (the flange's underside is never seen from a sidewalk or a saddle: the shoe just runs up into it)
    lathe([(0.150, 0.0), (0.122, 0.035), (0.122, 0.180)], 12, 'steel')
    lathe([(0.186, 0.176), (0.186, 0.245), (0.120, 0.258), (0.153, 0.600), (0.156, 0.730), (0.128, 0.835), (0.0, 0.866)], 16, 'paint')
    lathe([(0.028, 0.85), (0.028, 0.90)], 5, 'nut', cap_end='nut')                                  # operating nut
    for sgn in (1, -1):                                                                              # hose nozzles
        M = Matrix.Translation((0, 0, 0.65)) @ Matrix.Rotation(sgn * math.pi / 2, 4, 'Y')
        lathe([(0.065, 0.12), (0.065, 0.208)], 8, 'paint', M=M, cap_end='paint')
        lathe([(0.026, 0.20), (0.026, 0.235)], 5, 'nut', M=M, cap_end='nut')
    M = Matrix.Translation((0, 0, 0.655)) @ Matrix.Rotation(math.pi / 2, 4, 'X')                   # pumper nozzle, out the front
    lathe([(0.105, 0.10), (0.105, 0.205)], 16, 'paint', M=M, cap_end='paint')
    lathe([(0.090, 0.20), (0.090, 0.228)], 16, 'cap', M=M, cap_end='cap')
    lathe([(0.030, 0.22), (0.030, 0.272)], 5, 'cap', M=M, cap_end='cap', phase=math.pi / 2)
    CAGE, RAY = 0.02, 0.06
elif KIND == 'postbox':
    up = add_box(-0.266, 0.266, -0.26, 0.285, 0.475, 1.30, 'face', ft={'+z': 'top', '-z': 'hidden'})   # red letter box
    bm.faces.remove([f for f in up if f.normal.y < -0.9][0])
    add_panel_with_holes(-0.266, 0.266, 0.475, 1.30, -0.26, [(-0.20, 0.20, 1.199, 1.215)], 0.05, 'face', 'slot')  # front, mail slot
    add_box(-0.215, 0.215, -0.29, -0.26, 1.215, 1.27, 'hood', ft={'+y': 'hidden'})                 # the slot's hood
    add_box(-0.262, 0.262, -0.252, 0.28, 0.06, 0.475, 'skirt', ft={'+z': 'hidden', '-z': 'foot'})  # ribbed grey base
    for x in (-0.23, 0.23):
        for y in (-0.2175, 0.2425):
            lathe([(0.026, 0.0), (0.022, 0.062)], 6, 'foot', M=Matrix.Translation((x, y, 0)))         # round feet
    CAGE, RAY = 0.03, 0.10
elif KIND == 'bikering':
    lathe([(0.042, 0.0), (0.030, 0.035), (0.030, 0.93)], 8, 'post', cap_end='post')               # the post
    # the ring: a circle whose band swells into a lens-shaped clamp, wider & thicker, where it grips the post top & bottom
    lens = lambda p: max(0.0, (abs(math.sin(p)) - 0.85) / 0.15)
    ring_band(0.55, lambda p: 0.235, lambda p: 0.196 - 0.046 * lens(p) ** 1.5, lambda p: 0.028 + 0.06 * lens(p), 20, 'ring')
    CAGE, RAY = 0.02, 0.06
else:
    add_box(-0.70, 0.70, -0.30, 0.30, 1.185, 1.20, 'top')                        # lid plate
    lid = add_box(-0.655, 0.655, -0.265, 0.27, 0.91, 1.185, 'body', ft={'-y': 'label', '+z': 'hidden', '-z': 'hidden'})
    bm.faces.remove([f for f in lid if f.material_index == TAG_NAMES.index('label')][0])
    holes = [(c - 0.17, c + 0.17, 0.975, 1.16) for c in (-0.435, 0.0, 0.435)]
    add_panel_with_holes(-0.655, 0.655, 0.91, 1.185, -0.265, holes, 0.09, 'label', 'hole')
    add_box(-0.655, 0.655, -0.255, 0.26, 0.785, 0.90, 'body', ft={'-y': 'label', '+z': 'hidden', '-z': 'hidden'})   # icon band
    add_box(-0.672, 0.672, -0.265, 0.265, 0.62, 0.765, 'grey', ft={'+z': 'hidden', '-z': 'hidden'})                 # steel band
    add_box(-0.66, 0.66, -0.255, 0.26, 0.095, 0.60, 'body', ft={'+z': 'hidden', '-z': 'hidden'})                      # doors
    add_box(-0.645, 0.645, -0.20, 0.25, 0.0, 0.085, 'base', ft={'-z': 'hidden'})                                     # plinth
    add_box(-0.64, 0.64, -0.24, 0.25, 0.08, 1.186, 'groove', ft={'-z': 'hidden'})                                    # core (shows in the joints)
    CAGE, RAY = 0.025, 0.08

me = bpy.data.meshes.new('low'); bm.normal_update(); bm.to_mesh(me); bm.free()
low = bpy.data.objects.new('low', me); bpy.context.scene.collection.objects.link(low)
print('LOW', sum(len(p.vertices) - 2 for p in me.polygons), 'tris')

# ---------------------------------------------------------------- UVs: every face projected flat at its tag's density, then packed
uv = me.uv_layers['UVMap']; pre = me.attributes['preuv'].data
for p in me.polygons:
    d = TAGS[TAG_NAMES[p.material_index]][0]
    if pre[p.index].value:  # an unrolled strip: its own UVs (metres) at the tag's density
        for li in p.loop_indices: uv.data[li].uv = uv.data[li].uv * d
        continue
    n = p.normal; up = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((0, 1, 0))
    ua = up.cross(n).normalized(); va = n.cross(ua)
    pts = [Vector((me.vertices[me.loops[li].vertex_index].co.dot(ua) * d, me.vertices[me.loops[li].vertex_index].co.dot(va) * d)) for li in p.loop_indices]
    # a sliver (a 2 cm roof edge) is stretched to a few texels across, or the mask & bake miss it and it bakes black
    mn = (0.25 if d >= 0.3 else 0.08) * SLIVER
    for ax in (0, 1):
        a0, a1 = min(q[ax] for q in pts), max(q[ax] for q in pts)
        if a1 - a0 < mn:
            for q in pts: q[ax] = (a0 + a1) / 2 + (q[ax] - (a0 + a1) / 2) * mn / max(a1 - a0, 1e-4)
    for li, q in zip(p.loop_indices, pts): uv.data[li].uv = q
bpy.context.view_layer.objects.active = low
bpy.ops.object.select_all(action='DESELECT'); low.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.pack_islands(rotate=True, rotate_method='CARDINAL', scale=True, margin_method='FRACTION', margin=0.006, shape_method='AABB')
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- bakes
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
for t in TAG_NAMES:
    m = bpy.data.materials.new(t); m.use_nodes = True; me.materials.append(m)
def target(img):
    for m in me.materials:
        nt = m.node_tree; n = nt.nodes.get('bake') or nt.nodes.new('ShaderNodeTexImage'); n.name = 'bake'; n.image = img
        nt.nodes.active = n
def fimg(name, size):
    im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True); im.colorspace_settings.name = 'Non-Color'; return im
def px(im):
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32); im.pixels.foreach_get(a); return a.reshape(im.size[1], im.size[0], 4)

# 1. albedo from the original
A = fimg('A', ATLAS); target(A)
sc.cycles.samples = 16
bpy.ops.object.select_all(action='DESELECT'); high.select_set(True); low.select_set(True); bpy.context.view_layer.objects.active = low
bpy.ops.object.bake(type='EMIT', use_selected_to_active=True, cage_extrusion=CAGE, max_ray_distance=RAY, margin=8, margin_type='EXTEND')
high.hide_render = True
# 2. tag mask: each tag's material emits its index
for i, m in enumerate(me.materials):
    nt = m.node_tree; em = nt.nodes.new('ShaderNodeEmission'); em.inputs[0].default_value = ((i + 1) / 32, 0, 0, 1)
    nt.links.new(em.outputs[0], nt.nodes['Material Output'].inputs[0])
M = fimg('M', ATLAS); target(M); sc.cycles.samples = 1
bpy.ops.object.select_all(action='DESELECT'); low.select_set(True)
bpy.ops.object.bake(type='EMIT', margin=8, margin_type='EXTEND')
# 3. ambient occlusion of the low-poly on a ground plane
for m in me.materials: m.node_tree.nodes['Material Output'].inputs[0].links and m.node_tree.links.remove(m.node_tree.nodes['Material Output'].inputs[0].links[0])
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0)); ground = bpy.context.active_object
sc.cycles.samples = 128; sc.world = bpy.data.worlds.new('w')
AO = fimg('AO', ATLAS); target(AO)
bpy.ops.object.select_all(action='DESELECT'); low.select_set(True); bpy.context.view_layer.objects.active = low
bpy.ops.object.bake(type='AO', margin=8, margin_type='EXTEND')
bpy.data.objects.remove(ground)

# ---------------------------------------------------------------- composite in numpy (linear), write sRGB PNGs
a, mk, ao = px(A)[..., :3], np.rint(px(M)[..., 0] * 32).astype(int) - 1, px(AO)[..., 0]
def to_srgb(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
def to_lin(c): c = np.asarray(c, np.float32); return np.where(c <= 0.04045, c / 12.92, np.power((c + 0.055) / 1.055, 2.4))
alb = a.copy(); emi = np.zeros_like(a); mr = np.ones_like(a)
for i, t in enumerate(TAG_NAMES):
    d, keep, aos, rough, metal, em, flat = TAGS[t]; sel = mk == i
    if not sel.any(): continue
    c = to_lin(flat) if flat else np.median(a[sel], axis=0)
    print('TAG', t, 'px', int(sel.sum()), 'flat sRGB', to_srgb(c).round(3))
    occ = 1 - aos * (1 - ao[sel])[:, None]
    alb[sel] = (keep * a[sel] + (1 - keep) * c) * occ
    emi[sel] = a[sel] * em
    mr[sel] = (1.0, rough, metal)
def save(arr, name, size):
    im = bpy.data.images.new(name, arr.shape[1], arr.shape[0], alpha=False); im.colorspace_settings.name = 'Non-Color'
    rgba = np.concatenate([arr, np.ones(arr.shape[:2] + (1,), np.float32)], -1).astype(np.float32)
    im.pixels.foreach_set(rgba.ravel()); im.scale(size, size)
    im.filepath_raw = os.path.join(WORK, f'{KIND}-{name}.png'); im.file_format = 'PNG'; im.save(); return im.filepath_raw
p_alb = save(to_srgb(alb), 'albedo', TEX)
p_mr = save(mr, 'mr', MR_SIZE)
p_emi = save(to_srgb(emi), 'emissive', TEX // 2) if emi.max() > 0 else None

# ---------------------------------------------------------------- the baked material (+ clear glass), export
bpy.data.objects.remove(high)
GLASS = {'glass': 0.16, 'roof': 0.28}  # tag -> opacity (the roof a touch frosted)
tag_of = [TAG_NAMES[p.material_index] for p in me.polygons]
me.materials.clear(); m = bpy.data.materials.new(f'{KIND}'); m.use_nodes = True; me.materials.append(m)
for p in me.polygons: p.material_index = 0
if any(t in GLASS for t in tag_of):
    for name, alpha in GLASS.items():
        g = bpy.data.materials.new(f'{KIND}-{name}'); g.use_nodes = True; me.materials.append(g)
        gb = g.node_tree.nodes['Principled BSDF']
        gb.inputs['Base Color'].default_value = (0.80, 0.88, 0.90, 1.0)
        gb.inputs['Roughness'].default_value = 0.05
        gb.inputs['Alpha'].default_value = alpha
        g.surface_render_method = 'BLENDED'
        for p, t in zip(me.polygons, tag_of):
            if t == name: p.material_index = len(me.materials) - 1
nt = m.node_tree; b = nt.nodes['Principled BSDF']
def tex(path, cs):
    n = nt.nodes.new('ShaderNodeTexImage'); n.image = bpy.data.images.load(path); n.image.colorspace_settings.name = cs; return n
nt.links.new(tex(p_alb, 'sRGB').outputs[0], b.inputs['Base Color'])
sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(tex(p_mr, 'Non-Color').outputs[0], sep.inputs[0])
nt.links.new(sep.outputs[1], b.inputs['Roughness']); nt.links.new(sep.outputs[2], b.inputs['Metallic'])
if p_emi:
    nt.links.new(tex(p_emi, 'sRGB').outputs[0], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = 1.0
me.set_sharp_from_angle(angle=math.radians(SHARP))
if 'preuv' in me.attributes: me.attributes.remove(me.attributes['preuv'])
co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)  # centred on its footprint
me.transform(Matrix.Translation(Vector((-(co[:, 0].min() + co[:, 0].max()) / 2, -(co[:, 1].min() + co[:, 1].max()) / 2, -co[:, 2].min()))))
bpy.ops.object.select_all(action='DESELECT'); low.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_normals=True, export_texcoords=True, export_tangents=False, export_materials='EXPORT', export_image_format='AUTO')
print('WROTE', OUT)
