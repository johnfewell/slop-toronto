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
#   ttc-pylon <ttc-logo.webp> <out.glb> <workdir> [id-face.png]: the TTC's insignia pylon, modelled from its drawing
#   bikeshare - <out dir> <workdir>: Bike Share Toronto's dock, kiosk & bike, modelled from measurements (bikeshare_props.py)
#   sources (John's Meshy originals, tools/prop-src/, gitignored): shelter s-orig.glb, bin b-orig.glb, hydrant h-orig.glb
#   (Rusted_Hydrant_with_C), postbox p-orig.glb (Graffiti_Mailbox_by_C), bikering cand-calga.glb (From_Toronto_to_Calga)
import bpy, bmesh, sys, os, math, mathutils, numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
KIND, SRC, OUT, WORK = argv[0], argv[1], argv[2], argv[3]
os.makedirs(WORK, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------- bikeshare: Bike Share Toronto's dock, kiosk & bike
# modelled from measurements in their own file (SRC unused, OUT the output directory): bikeshare_props.py
if KIND == 'bikeshare':
    exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bikeshare_props.py')).read())
    sys.exit(0)

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

# ---------------------------------------------------------------- ttc-pylon: modelled from its drawing, no source mesh
# The TTC's subway entrance pylon as adopted (the City/TTC "Insignia Pylon, w/ Entry ID Sign" John supplied; seen in
# 2026 Street View at King & Yonge): a slim dark round pole on a flat base plate, topped by the TTC insignia, a thick
# lit sign cut to the logo's own outline (traced here from the logo file's alpha), and lower on the same pole a black
# horizontal entry ID sign on a mounting collar, reaching out to the pole's +x side. The insignia's faces carry the logo
# (UVs 0..1 over the logo image, glTF v down from its top; the back's u mirrored so it reads right from behind); the ID
# sign's faces carry each station's name (UVs 0..1 over the face), printed at runtime by js/ttc-pylons.js.
# Sizes: the insignia 1.25 m wide (the logo's 1920 x 753), 0.22 m deep, its bottom 3.55 m up; pole 0.104 m (0.083 of
# the insignia, as drawn), base plate 0.64 m; the ID sign 1.30 x 0.30 x 0.07 m (as long as the insignia, 4.3 : 1),
# its bottom 2.25 m up (clear of heads). SRC is the logo image (the preview's texture & the outline's source);
# <workdir>/ttc-pylon-preview.glb carries the logo, <workdir>/ttc-pylon-drawing.glb is the drawing's own layout (the
# pole shortened at its break mark, the ID sign standing off to the right) for the comparison against it.
if KIND == 'ttc-pylon':
    LW, LD, LB = 1.25, 0.22, 3.55            # insignia: width, depth, bottom
    IW, IH, ID, IB = 1.30, 0.30, 0.07, 2.25  # entry ID sign: width, height, depth, bottom
    PR = 0.052                               # pole radius
    BASE = [(0.32, 0.0), (0.32, 0.025), (0.11, 0.04), (0.09, 0.10), (0.07, 0.115), (PR, 0.12)]  # (r, z): plate, foot
    MATS = ['ttc-pylon-logo', 'ttc-pylon-id', 'ttc-pylon-edge', 'ttc-pylon-metal']
    # the logo's outline: its alpha, downsampled, traced round (Moore neighbours), simplified
    img = bpy.data.images.load(SRC)
    IWpx, IHpx = img.size
    A = np.array(img.pixels[:], dtype=np.float32).reshape(IHpx, IWpx, 4)[::-1, :, 3]  # rows top-down
    K = 5
    h, w = IHpx // K, IWpx // K
    M = A[:h * K, :w * K].reshape(h, K, w, K).mean(axis=(1, 3)) > 0.5
    M = np.pad(M, 1)
    ys, xs = np.nonzero(M)
    start = (ys[0], xs[0])
    nb = [(-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1)]  # clockwise from NW
    path = [start]; cur = start; back = 7  # entered from the west
    for _ in range(100000):
        found = False
        for k in range(8):
            d = (back + 1 + k) % 8
            ny, nx = cur[0] + nb[d][0], cur[1] + nb[d][1]
            if M[ny, nx]:
                back = (d + 4) % 8; cur = (ny, nx); found = True; break
        if not found or cur == start: break
        path.append(cur)
    def rdp(pts, eps):
        if len(pts) < 3: return pts
        a, b = np.array(pts[0], float), np.array(pts[-1], float)
        ab = b - a; L = np.hypot(*ab) or 1.0
        d = [abs(np.cross(ab, np.array(p, float) - a)) / L for p in pts[1:-1]]
        i = int(np.argmax(d)) + 1
        if d[i - 1] > eps: return rdp(pts[:i + 1], eps)[:-1] + rdp(pts[i:], eps)
        return [pts[0], pts[-1]]
    half = len(path) // 2
    outline = rdp(path[:half + 1], 0.9)[:-1] + rdp(path[half:] + [path[0]], 0.9)[:-1]
    # px (padded, downsampled) -> metres: x across, z up; and the logo UV (u, v up)
    S = LW / w
    OUT2D = [((x - 1 + 0.5) * S - LW / 2, (h - (y - 1 + 0.5)) * S) for y, x in outline]
    UV2D = [((x - 1 + 0.5) / w, 1 - (y - 1 + 0.5) / h) for y, x in outline]
    LH = h * S
    def build(layout):
        bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
        def face(ps, mat, uvs=None, toward=None):
            if toward is not None:
                n = Vector((0, 0, 0))
                for i in range(len(ps)):  # Newell's normal (an ngon may be concave)
                    a, b = Vector(ps[i]), Vector(ps[(i + 1) % len(ps)])
                    n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
                if n.dot(Vector(toward)) < 0:
                    ps = ps[::-1]
                    if uvs: uvs = uvs[::-1]
            f = bm.faces.new([bm.verts.new(p) for p in ps]); f.material_index = MATS.index(mat); f.smooth = False
            if uvs:
                for lp, uv in zip(f.loops, uvs): lp[uvl].uv = uv
            return f
        def box(x0, x1, y0, y1, z0, z1, mat):
            for ps, t in ((((x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)), (-1, 0, 0)), (((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)), (1, 0, 0)),
                          (((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)), (0, -1, 0)), (((x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)), (0, 1, 0)),
                          (((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)), (0, 0, 1)), (((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)), (0, 0, -1))):
                face(list(ps), mat, toward=t)
        def lathe(prof, n=16):
            for (ra, za), (rb, zb) in zip(prof, prof[1:]):
                for i in range(n):
                    a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n; am = (a0 + a1) / 2
                    p = lambda r, z, a: (r * math.cos(a), r * math.sin(a), z)
                    face([p(ra, za, a0), p(ra, za, a1), p(rb, zb, a1), p(rb, zb, a0)], 'ttc-pylon-metal', toward=(math.cos(am) * (zb - za), math.sin(am) * (zb - za), ra - rb))
        lb = layout['logo_bottom']
        # the insignia: its outline extruded, both faces printed, the sides its dark edge
        for s in (-1, 1):
            ps = [(x, s * LD / 2, lb + z) for x, z in OUT2D]
            uvs = [(u if s < 0 else 1 - u, v) for u, v in UV2D]
            face(ps, 'ttc-pylon-logo', uvs, toward=(0, s, 0))
        for i in range(len(OUT2D)):
            (ax, az), (bx, bz) = OUT2D[i], OUT2D[(i + 1) % len(OUT2D)]
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            nx, nz = (bz - az), -(bx - ax)  # (a normal; flipped below if it points into the outline's centroid side)
            face([(ax, -LD / 2, lb + az), (bx, -LD / 2, lb + bz), (bx, LD / 2, lb + bz), (ax, LD / 2, lb + az)], 'ttc-pylon-edge', toward=(nx * layout['wind'], 0, nz * layout['wind']))
        # the pole on its base, up into the insignia
        lathe(BASE + [(PR, layout['pole_top'])])
        # the entry ID sign: its faces printed, its edges the metal; on its collar & two brackets (when on the pole)
        ix0 = layout['id_x0']; ix1 = ix0 + IW; ib = layout['id_bottom']
        for s in (-1, 1):
            y = s * ID / 2
            P = [(ix0, y, ib), (ix1, y, ib), (ix1, y, ib + IH), (ix0, y, ib + IH)]
            face(P, 'ttc-pylon-id', [(0, 0), (1, 0), (1, 1), (0, 1)] if s < 0 else [(1, 0), (0, 0), (0, 1), (1, 1)], toward=(0, s, 0))
        for ps, t in ((((ix0, -ID / 2, ib), (ix0, ID / 2, ib), (ix0, ID / 2, ib + IH), (ix0, -ID / 2, ib + IH)), (-1, 0, 0)),
                      (((ix1, -ID / 2, ib), (ix1, ID / 2, ib), (ix1, ID / 2, ib + IH), (ix1, -ID / 2, ib + IH)), (1, 0, 0)),
                      (((ix0, -ID / 2, ib + IH), (ix1, -ID / 2, ib + IH), (ix1, ID / 2, ib + IH), (ix0, ID / 2, ib + IH)), (0, 0, 1)),
                      (((ix0, -ID / 2, ib), (ix1, -ID / 2, ib), (ix1, ID / 2, ib), (ix0, ID / 2, ib)), (0, 0, -1))):
            face(list(ps), 'ttc-pylon-metal', toward=t)
        if layout['collar']:
            lathe([(0.0001, ib - 0.07), (0.085, ib - 0.07), (0.085, ib + IH + 0.07), (0.0001, ib + IH + 0.07)])
            for zc in (ib + 0.05, ib + IH - 0.09):
                box(0.06, ix0 + 0.02, -0.025, 0.025, zc, zc + 0.04, 'ttc-pylon-metal')
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        me = bpy.data.meshes.new('ttc-pylon'); bm.normal_update(); bm.to_mesh(me); bm.free()
        obj = bpy.data.objects.new('ttc-pylon', me); bpy.context.scene.collection.objects.link(obj)
        return obj, me
    # which way round the outline runs (its signed area): the edge faces must face out
    area = sum(OUT2D[i][0] * OUT2D[(i + 1) % len(OUT2D)][1] - OUT2D[(i + 1) % len(OUT2D)][0] * OUT2D[i][1] for i in range(len(OUT2D)))
    WIND = 1 if area < 0 else -1
    COL = {  # sRGB, roughness, metallic
        'ttc-pylon-logo': ((1.0, 1.0, 1.0), 0.35, 0.0),
        'ttc-pylon-id': ((0.08, 0.08, 0.08), 0.4, 0.0),
        'ttc-pylon-edge': ((0x2a / 255, 0x2b / 255, 0x2d / 255), 0.5, 0.2),
        'ttc-pylon-metal': ((0x3a / 255, 0x3c / 255, 0x3f / 255), 0.45, 0.4),
    }
    def lin(c): return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
    mats = []
    for name in MATS:
        m = bpy.data.materials.new(name); m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']; c, r, mt = COL[name]
        b.inputs['Base Color'].default_value = (*lin(c), 1.0); b.inputs['Roughness'].default_value = r; b.inputs['Metallic'].default_value = mt
        mats.append(m)
    def export(obj, path):
        bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                                  export_normals=True, export_texcoords=True, export_tangents=False, export_materials='EXPORT', export_image_format='AUTO')
        print('WROTE', path)
    def finish(obj, me):
        for m in mats: me.materials.append(m)
        me.set_sharp_from_angle(angle=math.radians(40))
        print('LOW', sum(len(p.vertices) - 2 for p in me.polygons), 'tris; outline', len(OUT2D), 'points; size', [round(v, 3) for v in obj.dimensions])
    REAL = {'logo_bottom': LB, 'pole_top': LB + 0.15, 'id_x0': 0.10, 'id_bottom': IB, 'collar': True, 'wind': WIND}
    obj, me = build(REAL); finish(obj, me)
    export(obj, OUT)
    nt = mats[0].node_tree
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; nt.nodes.active = t
    nt.links.new(t.outputs[0], nt.nodes['Principled BSDF'].inputs['Base Color'])
    if len(argv) > 4:  # an ID face image for the preview
        nt2 = mats[1].node_tree; t2 = nt2.nodes.new('ShaderNodeTexImage'); t2.image = bpy.data.images.load(argv[4]); nt2.nodes.active = t2
        nt2.links.new(t2.outputs[0], nt2.nodes['Principled BSDF'].inputs['Base Color'])
    export(obj, os.path.join(WORK, 'ttc-pylon-preview.glb'))
    bpy.data.objects.remove(obj)
    # the drawing's layout (4x drawing px / insignia 360 px wide): pole 640 px to the insignia, ID sign x 375-745 & y 705-785
    k = LW / 360
    DRAW = {'logo_bottom': (985 - 345) * k + 0.12, 'pole_top': (985 - 345) * k + 0.25, 'id_x0': (375 - 320) * k, 'id_bottom': (1000 - 785) * k, 'collar': False, 'wind': WIND}
    obj2, me2 = build(DRAW); finish(obj2, me2)
    export(obj2, os.path.join(WORK, 'ttc-pylon-drawing.glb'))
    sys.exit(0)

# ---------------------------------------------------------------- ttc-lantern: modelled from Street View, no source mesh
# The TTC's older subway entrance sign, still at many stations (2026 Street View: Osgoode NW & SW, St Patrick NE & NW,
# Chester, Ossington, Wellesley...): a square lantern, a frustum wider at the top (its corners chamfered), painted cream,
# lit from inside through four translucent white faces each printed with the TTC logo, the logo larger than the face so
# its wings run out to the corners and seem to wrap round them; a flared rim round the top, a recessed tray on top, a
# square block under it, on a brushed stainless pole. Two mountings, two objects in one GLB: 'ttc-lantern-top' (the
# lantern on the pole's top, Osgoode NW, Chester) and 'ttc-lantern-arm' (hung from an arm off the pole's top, reaching
# out to +x, St Patrick NW, Ossington). No station name: the real lanterns carry only the logo.
# Each side is folded: the logo's shield on a flat middle facet, its wings on facets angled back (Chester E, St Patrick
# NE), the cream corners between the sides. The printed facets' UVs run over each side's panel unfolded (u 0..1 across
# its top width, v 0..1 up), so js/ttc-pylons.js maps the logo onto it with LANTERN_LOGO's scale (printed below); the preview GLB carries the panel
# drawn with the logo (<workdir>/ttc-lantern-face.png). Sizes: from Street View at Osgoode NW (a person beside the pole:
# the lantern ~0.65 m tall & as wide at the top, its bottom ~3.5 m up) and close-ups at Chester W & St Patrick NE (the
# body 0.52 m, the hood 0.12 m, the bottom 0.68 of the top's width, the block). SRC is the logo image (the preview's
# only); <workdir>/ttc-lantern-head-preview.glb is the lantern alone, no pole, for the comparison with Street View.
if KIND == 'ttc-lantern':
    PR = 0.052                               # pole radius (as the insignia pylon's)
    BASE = [(0.32, 0.0), (0.32, 0.025), (0.11, 0.04), (0.09, 0.10), (0.07, 0.115), (PR, 0.12)]
    BH, HB, HT = 0.52, 0.21, 0.31            # the body's height, its half width at the bottom & top
    # a side's plan (half width 1, the -y side, left to right from outside): the shield's facet flat across the middle,
    # the wings' facets folded back 40 degrees; then the corner: a post standing out between the sides (Chester W)
    SHW, WING, FOLD = 0.42, 0.28, math.radians(40)
    we = (SHW + WING * math.cos(FOLD), -1 + WING * math.sin(FOLD))
    POST = 0.10                              # the corner posts stand out this far (along the diagonal) past the wings' ends
    pa = (we[0] + POST * 0.7071, we[1] - POST * 0.7071)
    SIDE = [(-we[0], we[1]), (-SHW, -1.0), (SHW, -1.0), we, pa, (-pa[1], -pa[0])]  # (then the next side's first)
    UNF = [-(SHW + WING), -SHW, SHW, SHW + WING]  # each point's unfolded distance from the side's middle
    STRIP = 0.04                             # the frame's band above & below each face's panel
    RIM, FLARE, LIP, TRAY = 0.12, 0.02, 0.045, 0.05   # the hood round the top: its height & flare; the lip, the tray's depth
    BLK, BLKH = 0.15, 0.12                   # the block under the body: half width, height
    LOGO_H = 0.40                            # the logo's printed height on a side (its width 2.546x)
    LOGO_AR = 960 / 377
    PW = 2 * (SHW + WING) * HT               # a side's printed strip, unfolded: its top width ...
    PH = BH - 2 * STRIP                      # ... and height
    print('LANTERN_LOGO', {'sx': round(PW / (LOGO_H * LOGO_AR), 4), 'sy': round(PH / LOGO_H, 4)})
    MATS = ['ttc-lantern-face', 'ttc-lantern-frame', 'ttc-lantern-metal']
    COL = {'ttc-lantern-face': ((0.96, 0.95, 0.92), 0.35, 0.0), 'ttc-lantern-frame': ((0xd6 / 255, 0xd2 / 255, 0xc6 / 255), 0.55, 0.0),
           'ttc-lantern-metal': ((0x9a / 255, 0xa0 / 255, 0xa5 / 255), 0.3, 0.85)}
    def lin(c): return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
    mats = []
    for name in MATS:
        m = bpy.data.materials.new(name); m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']; c, r, mt = COL[name]
        b.inputs['Base Color'].default_value = (*lin(c), 1.0); b.inputs['Roughness'].default_value = r; b.inputs['Metallic'].default_value = mt
        mats.append(m)
    def build(name, arm, head=False):
        bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
        def face(ps, mat, uvs=None, toward=None):
            if toward is not None:
                n = Vector((0, 0, 0))
                for i in range(len(ps)):
                    a, b = Vector(ps[i]), Vector(ps[(i + 1) % len(ps)])
                    n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
                if n.dot(Vector(toward)) < 0:
                    ps = ps[::-1]
                    if uvs: uvs = uvs[::-1]
            f = bm.faces.new([bm.verts.new(p) for p in ps]); f.material_index = MATS.index(mat); f.smooth = False
            if uvs:
                for lp, uv in zip(f.loops, uvs): lp[uvl].uv = uv
            return f
        def box(x0, x1, y0, y1, z0, z1, mat, faces='xXyYzZ'):
            for k, ps, t in (('x', ((x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)), (-1, 0, 0)), ('X', ((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)), (1, 0, 0)),
                             ('y', ((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)), (0, -1, 0)), ('Y', ((x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)), (0, 1, 0)),
                             ('Z', ((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)), (0, 0, 1)), ('z', ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)), (0, 0, -1))):
                if k in faces: face(list(ps), mat, toward=t)
        def lathe(prof, n=16, mat='ttc-lantern-metal', cx=0.0):
            for (ra, za), (rb, zb) in zip(prof, prof[1:]):
                for i in range(n):
                    a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n; am = (a0 + a1) / 2
                    p = lambda r, z, a: (cx + r * math.cos(a), r * math.sin(a), z)
                    face([p(ra, za, a0), p(ra, za, a1), p(rb, zb, a1), p(rb, zb, a0)], mat, toward=(math.cos(am) * (zb - za), math.sin(am) * (zb - za), ra - rb))
        # the plan at half width h: 24 points counter-clockwise, 6 a side (from the -y side's left: its left wing's end,
        # the folds either side of the shield, its right wing's end, the corner post's two outer edges); each side's
        # first 3 facets are printed (the logo folded round them: u runs on unfolded), the post's 3 are the frame
        def plan(h, cx):
            out = []
            for k in range(4):
                c, s_ = (0, 1, 0, -1)[k], (1, 0, -1, 0)[k]  # cos, sin of k * 90 degrees (counter-clockwise from above)
                for x, y in SIDE:
                    out.append((cx + (x * c - y * s_) * h, (x * s_ + y * c) * h))
            return out
        cx = 0.62 if arm else 0.0
        zb = 3.65 if arm else 3.50           # the body's bottom (the block under it)
        zt = zb + BH
        # the block, and (on a pole's top) the collar the pole goes into
        box(cx - BLK, cx + BLK, -BLK, BLK, zb - BLKH, zb, 'ttc-lantern-frame', 'xXyYz')
        # the body: the printed facets (frame bands above & below their panels) & the corners; its bottom
        rings = [(zb, HB), (zb + STRIP, HB + (HT - HB) * STRIP / BH), (zt - STRIP, HB + (HT - HB) * (BH - STRIP) / BH), (zt, HT)]
        O = [plan(h, cx) for _, h in rings]
        for i in range(24):
            j = (i + 1) % 24
            for r in range(3):
                (za, ha), (zc, hc) = rings[r], rings[r + 1]
                a0, a1, b1, b0 = O[r][i], O[r][j], O[r + 1][j], O[r + 1][i]
                ps = [(a0[0], a0[1], za), (a1[0], a1[1], za), (b1[0], b1[1], zc), (b0[0], b0[1], zc)]
                t = ((a0[0] + a1[0]) / 2 - cx, (a0[1] + a1[1]) / 2, 0.0)
                if i % 6 < 3 and r == 1:
                    # a printed facet: u the unfolded distance from its side's middle (seen from outside), v up
                    U0, U1 = UNF[i % 6], UNF[(i % 6) + 1]
                    uv = lambda U, h, z: (0.5 + U * h / PW, (z - (zb + STRIP)) / PH)
                    face(ps, 'ttc-lantern-face', [uv(U0, ha, za), uv(U1, ha, za), uv(U1, hc, zc), uv(U0, hc, zc)], toward=t)
                else:
                    face(ps, 'ttc-lantern-frame', toward=t)
        face([(x, y, zb) for x, y in O[0]], 'ttc-lantern-frame', toward=(0, 0, -1))
        # the hood: a square band flaring out round the top (over the posts), its underside, its lip, the tray sunk in it
        sq = lambda h: [(cx - h, -h), (cx + h, -h), (cx + h, h), (cx - h, h)]
        H0, H1, Hin = sq(HT), sq(HT + FLARE), sq(HT + FLARE - LIP)
        face([(x, y, zt) for x, y in H0], 'ttc-lantern-frame', toward=(0, 0, -1))
        for i in range(4):
            j = (i + 1) % 4
            mx, my = (H0[i][0] + H0[j][0]) / 2 - cx, (H0[i][1] + H0[j][1]) / 2
            face([(*H0[i], zt), (*H0[j], zt), (*H1[j], zt + RIM), (*H1[i], zt + RIM)], 'ttc-lantern-frame', toward=(mx, my, 0.0))
            face([(*H1[i], zt + RIM), (*H1[j], zt + RIM), (*Hin[j], zt + RIM), (*Hin[i], zt + RIM)], 'ttc-lantern-frame', toward=(0, 0, 1))
            face([(*Hin[i], zt + RIM), (*Hin[j], zt + RIM), (*Hin[j], zt + RIM - TRAY), (*Hin[i], zt + RIM - TRAY)], 'ttc-lantern-frame', toward=(-mx, -my, 0.0))
        face([(x, y, zt + RIM - TRAY) for x, y in Hin], 'ttc-lantern-frame', toward=(0, 0, 1))
        if head: pass
        elif not arm:
            lathe(BASE + [(PR, zb - BLKH - 0.12)])
            lathe([(PR, zb - BLKH - 0.12), (0.075, zb - BLKH - 0.10), (0.075, zb - BLKH + 0.001)])
        else:
            pt = zt + RIM + 0.28             # the pole's top, its cap
            lathe(BASE + [(PR, pt)])
            lathe([(PR, pt), (0.065, pt), (0.065, pt + 0.04), (0.0001, pt + 0.06)])
            za = pt - 0.10                   # the arm: a square tube out to past the lantern's middle
            box(0.0, cx + 0.16, -0.035, 0.035, za, za + 0.07, 'ttc-lantern-metal', 'XyYzZ')
            box(cx - 0.02, cx + 0.02, -0.02, 0.02, zt + RIM - TRAY, za, 'ttc-lantern-metal', 'xXyY')   # the hanger
            # the brace, pole to arm
            p0, p1 = Vector((PR, 0, za - 0.38)), Vector((cx * 0.62, 0, za))
            d = (p1 - p0).normalized(); nrm = Vector((-d.z, 0, d.x)) * 0.018
            for s in (-1, 1):
                q = [p0 - nrm, p1 - nrm, p1 + nrm, p0 + nrm]
                face([(v.x, s * 0.018, v.z) for v in q], 'ttc-lantern-metal', toward=(0, s, 0))
            for s in (-1, 1):
                a, b = p0 + nrm * s, p1 + nrm * s
                face([(a.x, -0.018, a.z), (b.x, -0.018, b.z), (b.x, 0.018, b.z), (a.x, 0.018, a.z)], 'ttc-lantern-metal', toward=(nrm.x * s, 0, nrm.z * s))
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        me = bpy.data.meshes.new(name); bm.normal_update(); bm.to_mesh(me); bm.free()
        for m in mats: me.materials.append(m)
        me.set_sharp_from_angle(angle=math.radians(40))
        obj = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(obj)
        print('LOW', name, sum(len(p.vertices) - 2 for p in me.polygons), 'tris; size', [round(v, 3) for v in obj.dimensions])
        return obj
    objs = [build('ttc-lantern-top', False), build('ttc-lantern-arm', True)]
    def export(sel, path):
        bpy.ops.object.select_all(action='DESELECT')
        for o in sel: o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                                  export_normals=True, export_texcoords=True, export_tangents=False, export_materials='EXPORT', export_image_format='AUTO')
        print('WROTE', path)
    export(objs, OUT)
    # the preview: the panel drawn white with the logo over it, as js/ttc-pylons.js prints it
    img = bpy.data.images.load(SRC)
    lw, lh = img.size
    L = np.array(img.pixels[:], dtype=np.float32).reshape(lh, lw, 4)  # rows bottom-up
    TW = 512; TH = int(round(TW * PH / PW))
    us = (np.arange(TW) + 0.5) / TW; vs = (np.arange(TH) + 0.5) / TH
    lu = 0.5 + (us - 0.5) * PW / (LOGO_H * LOGO_AR); lv = 0.5 + (vs - 0.5) * PH / LOGO_H
    xi = np.clip((lu * lw).astype(int), 0, lw - 1); yi = np.clip((lv * lh).astype(int), 0, lh - 1)
    inside = ((lv >= 0) & (lv <= 1))[:, None] & ((lu >= 0) & (lu <= 1))[None, :]
    P = L[yi][:, xi]
    a = P[..., 3:4] * inside[..., None]
    white = np.array(COL['ttc-lantern-face'][0], np.float32)  # (8-bit images' pixels are sRGB values)
    out = np.concatenate([P[..., :3] * a + white * (1 - a), np.ones((TH, TW, 1), np.float32)], axis=2)
    face_img = bpy.data.images.new('ttc-lantern-face', TW, TH); face_img.pixels = out.ravel()
    face_img.filepath_raw = os.path.join(WORK, 'ttc-lantern-face.png'); face_img.file_format = 'PNG'; face_img.save()
    nt = mats[0].node_tree
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = face_img; t.extension = 'EXTEND'; nt.nodes.active = t
    nt.links.new(t.outputs[0], nt.nodes['Principled BSDF'].inputs['Base Color'])
    export([objs[0]], os.path.join(WORK, 'ttc-lantern-top-preview.glb'))
    export([objs[1]], os.path.join(WORK, 'ttc-lantern-arm-preview.glb'))
    export([build('ttc-lantern-head', False, head=True)], os.path.join(WORK, 'ttc-lantern-head-preview.glb'))
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
