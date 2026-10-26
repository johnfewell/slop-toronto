# tools/blender/bikeshare_props.py — Bike Share Toronto's station parts, modelled from measurements (no source mesh):
# run through bake_props.py (`... bake_props.py -- bikeshare - <out dir> <workdir>`), which hands over KIND/OUT/WORK.
# Writes three models into <out dir>, each one mesh, metres, base on z = 0, glTF +z (Blender -y) the front:
#   bike-share-dock.glb   one docking point as on the street in 2026 (Street View, Queens Quay & Yonge, York & Queens
#                         Quay): an orange moulded shell with a tall slot in its front for the bike's front wheel, a dark
#                         lock head at its top front, on its 0.80 m slice of the light grey base plate (docks stand side by
#                         side, so the plate runs on unbroken down the row). Centred on the shell; +z = the slot side,
#                         where the bike stands.
#   bike-share-kiosk.glb  the pay station: a slim black box on a foot, an orange panel with its screen at the top of the
#                         front, a black pole up to two black solar panels in a shallow V (3.2 m overall).
#   bike-share-bike.glb   the PBSC "Iconic" city bike as it docks in Toronto: matte black step-through frame, orange rear
#                         skirt & chain guard, black front basket with an orange plate on its front, black tyres. Its
#                         front wheel's axle is at the origin's z = -0.56 (Blender y), so js/bike-share.js can set it in
#                         a dock. A few hundred triangles: thousands of them line the city's streets.
# All three share one 32 x 32 palette texture (4 x 4 swatches of flat sRGB colour) with every face's UVs on a swatch's
# centre, so the city draws them with one material (js/bike-share.js) and Workbench renders their colours for
# compare_views.py. Sizes and sources: ~/.cache/slop-toronto/props/bike-share/PROVENANCE.json.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

OUT_DIR = OUT
os.makedirs(OUT_DIR, exist_ok=True)

# ---------------------------------------------------------------- the palette (sRGB): swatch index -> colour
PAL = [
    (0xE4, 0x64, 0x2C),  # 0 dock shell & bike skirt: Bike Share Toronto orange (2026 Street View, in sun ~ e4642c)
    (0x3A, 0x3D, 0x40),  # 1 lock head, dark grey
    (0xA9, 0xAD, 0xB0),  # 2 base plate, light galvanised grey
    (0x26, 0x28, 0x2A),  # 3 bike frame, matte black
    (0x16, 0x16, 0x17),  # 4 tyres
    (0x8A, 0x8E, 0x92),  # 5 hubs & cranks, grey metal
    (0x1E, 0x20, 0x22),  # 6 kiosk box & pole, black
    (0x1A, 0x22, 0x30),  # 7 solar cells, blue-black
    (0x2B, 0x34, 0x40),  # 8 kiosk screen
    (0xA8, 0x46, 0x1C),  # 9 the slot's inside (the shell's own orange, in its shade)
    (0x1B, 0x1B, 0x1B),  # 10 saddle & grips
    (0xC8, 0x5A, 0x28),  # 11 the basket's orange plate (a touch deeper than the shell)
]
N, PX = 4, 8
def swatch_uv(i):
    # glTF v runs down from the image's top row; Blender's UV v runs up: (u, 1 - v) here lands on row i // N from the top
    cx, cy = (i % N + 0.5) / N, (i // N + 0.5) / N
    return (cx, 1 - cy)

def palette_image():
    img = bpy.data.images.new('bike-share-palette', N * PX, N * PX, alpha=False)
    px = [0.0] * (N * PX * N * PX * 4)
    for y in range(N * PX):
        for x in range(N * PX):
            i = ((N * PX - 1 - y) // PX) * N + x // PX  # pixel rows run bottom-up in Blender
            c = PAL[i] if i < len(PAL) else (255, 0, 255)
            o = (y * N * PX + x) * 4
            px[o:o + 4] = [c[0] / 255, c[1] / 255, c[2] / 255, 1.0]
    img.pixels[:] = px
    path = os.path.join(WORK, 'bike-share-palette.png')
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    return img

# ---------------------------------------------------------------- builders
class Mesh:
    def __init__(self):
        self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.new('UVMap')
    def face(self, vs, sw):
        f = self.bm.faces.new([self.bm.verts.new(v) for v in vs]); f.smooth = False
        u = swatch_uv(sw)
        for lp in f.loops: lp[self.uv].uv = u
        return f
    def box(self, x0, x1, y0, y1, z0, z1, sw, M=Matrix(), faces=None, bottom=False, top=True):
        """an axis box (in its own frame, then M); faces: {'-y': swatch, ...} overrides per side"""
        P = lambda x, y, z: tuple(M @ Vector((x, y, z)))
        c = {(i, j, k): P((x0, x1)[i], (y0, y1)[j], (z0, z1)[k]) for i in (0, 1) for j in (0, 1) for k in (0, 1)}
        sides = {'-x': [(0,0,0), (0,0,1), (0,1,1), (0,1,0)], '+x': [(1,0,0), (1,1,0), (1,1,1), (1,0,1)],
                 '-y': [(0,0,0), (1,0,0), (1,0,1), (0,0,1)], '+y': [(0,1,0), (0,1,1), (1,1,1), (1,1,0)],
                 '+z': [(0,0,1), (1,0,1), (1,1,1), (0,1,1)], '-z': [(0,0,0), (0,1,0), (1,1,0), (1,0,0)]}
        for s, q in sides.items():
            if (s == '-z' and not bottom) or (s == '+z' and not top): continue
            self.face([c[k] for k in q], (faces or {}).get(s, sw))
    def tube(self, a, b, w, d, sw):
        """a square bar from point a to point b (Blender coords), w across x, d across the bar's other side"""
        a, b = Vector(a), Vector(b); t = b - a; L = t.length
        z = t.normalized(); x = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 1, 0))
        y = z.cross(x).normalized(); x = y.cross(z).normalized()
        M = Matrix((x, y, z)).transposed().to_4x4(); M.translation = a
        self.box(-w / 2, w / 2, -d / 2, d / 2, 0, L, sw, M, top=False)  # (open ends: a bar's ends never show)
    def ring(self, cy, cz, ro, ri, hw, seg, sw, a0=0.0, a1=2 * math.pi, cx=0.0, sides=True, inner=True):
        """a ring (a tyre, a fender arc) in the y-z plane round (cx, cy, cz): radii ro / ri, half width hw across x;
        angle 0 = +y (behind), pi/2 = up"""
        full = abs(a1 - a0 - 2 * math.pi) < 1e-6
        n = seg if full else seg + 1
        A = [a0 + (a1 - a0) * i / seg for i in range(n)]
        P = lambda r, a, x: (cx + x, cy + r * math.cos(a), cz + r * math.sin(a))
        for i in range(seg):
            a, b = A[i], A[(i + 1) % n] if full else A[i + 1]
            self.face([P(ro, a, -hw), P(ro, b, -hw), P(ro, b, hw), P(ro, a, hw)], sw)      # outer band
            if inner:
                self.face([P(ri, a, hw), P(ri, b, hw), P(ri, b, -hw), P(ri, a, -hw)], sw)  # inner band
            if sides:
                self.face([P(ri, a, -hw), P(ri, b, -hw), P(ro, b, -hw), P(ro, a, -hw)], sw)
                self.face([P(ro, a, hw), P(ro, b, hw), P(ri, b, hw), P(ri, a, hw)], sw)
    def finish(self, name, img):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name); bm.normal_update(); bm.to_mesh(me); bm.free()
        obj = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(obj)
        mat = bpy.data.materials.get('bike-share')
        if not mat:
            mat = bpy.data.materials.new('bike-share'); mat.use_nodes = True
            nt = mat.node_tree; b = nt.nodes['Principled BSDF']
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; t.interpolation = 'Closest'; nt.nodes.active = t
            nt.links.new(t.outputs[0], b.inputs['Base Color'])
            b.inputs['Roughness'].default_value = 0.6; b.inputs['Metallic'].default_value = 0.0
        me.materials.append(mat)
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        print('LOW', name, tris, 'tris; size', [round(v, 3) for v in obj.dimensions])
        bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
        path = os.path.join(OUT_DIR, name + '.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                                  export_normals=True, export_texcoords=True, export_tangents=False, export_materials='EXPORT',
                                  export_image_format='AUTO')
        print('WROTE', path)
        return tris

img = palette_image()

# ---------------------------------------------------------------- the dock (one docking point on its slice of plate)
# Shell: 0.26 wide, 0.42 deep at its foot, narrowing to 0.22 x 0.36 at the top; its top slopes from 0.95 at the front
# down to 0.86 at the back. The slot: 0.08 wide, from 0.10 up to 0.80, 0.12 deep into the shell. Plate: 0.80 along the
# row (the spacing of the docks), 0.62 deep, 0.05 thick.
d = Mesh()
SP, PD0, PD1, PT = 0.80, -0.36, 0.26, 0.05
d.box(-SP / 2, SP / 2, PD0, PD1, 0, PT, 2, faces={'+z': 2})
W0, W1, Y0, Y1, Y0t, Y1t, ZF, ZB = 0.13, 0.11, -0.22, 0.20, -0.19, 0.17, 0.95, 0.86
SW, SZ0, SZ1, SD = 0.04, 0.10, 0.80, 0.12
def shell_pt(sx, front, z, inset=0.0):
    t = (z - PT) / (ZF - PT)
    w = W0 + (W1 - W0) * t
    y = (Y0 + (Y0t - Y0) * t) if front else (Y1 + (Y1t - Y1) * t)
    return (sx * w, y + inset, z)
ztop = lambda front: ZF if front else ZB
# sides & back (orange), the top (orange), the front in three strips round the slot
for sx in (-1, 1):
    a, b = shell_pt(sx, True, PT), shell_pt(sx, False, PT)
    c, e = shell_pt(sx, False, ZB), shell_pt(sx, True, ZF)
    d.face([a, b, c, e] if sx > 0 else [a, e, c, b], 0)
d.face([shell_pt(-1, False, PT), shell_pt(1, False, PT), shell_pt(1, False, ZB), shell_pt(-1, False, ZB)][::-1], 0)
d.face([shell_pt(-1, True, ZF), shell_pt(1, True, ZF), shell_pt(1, False, ZB), shell_pt(-1, False, ZB)], 0)
def front_x(sx, z):  # the front face's half width at z
    return shell_pt(1, True, z)[0] * sx
def fy(z): return shell_pt(1, True, z)[1]
# front: left & right of the slot (full height), the bridge over it, the strip under it
for sx in (-1, 1):
    q = [(front_x(sx, PT), fy(PT), PT), (sx * SW, fy(PT), PT), (sx * SW, fy(ZF), ZF), (front_x(sx, ZF), fy(ZF), ZF)]
    d.face(q if sx < 0 else q[::-1], 0)
d.face([(-SW, fy(SZ1), SZ1), (SW, fy(SZ1), SZ1), (SW, fy(ZF), ZF), (-SW, fy(ZF), ZF)], 0)
d.face([(-SW, fy(PT), PT), (SW, fy(PT), PT), (SW, fy(SZ0), SZ0), (-SW, fy(SZ0), SZ0)], 0)
# the slot's inside: its back wall, its two side walls, its roof & floor (in the shell's shade)
yb = lambda z: fy(z) + SD
d.face([(-SW, yb(SZ0), SZ0), (-SW, yb(SZ1), SZ1), (SW, yb(SZ1), SZ1), (SW, yb(SZ0), SZ0)], 9)
for sx in (-1, 1):
    q = [(sx * SW, fy(SZ0), SZ0), (sx * SW, yb(SZ0), SZ0), (sx * SW, yb(SZ1), SZ1), (sx * SW, fy(SZ1), SZ1)]
    d.face(q if sx > 0 else q[::-1], 9)
d.face([(-SW, fy(SZ1), SZ1), (-SW, yb(SZ1), SZ1), (SW, yb(SZ1), SZ1), (SW, fy(SZ1), SZ1)][::-1], 9)
d.face([(-SW, fy(SZ0), SZ0), (-SW, yb(SZ0), SZ0), (SW, yb(SZ0), SZ0), (SW, fy(SZ0), SZ0)], 9)
# the lock head: a dark block on the top front, standing a little proud of the front face
d.box(-0.085, 0.085, fy(0.86) - 0.06, fy(0.86) + 0.10, 0.80, 0.93, 1, bottom=True)
dock_tris = d.finish('bike-share-dock', img)

# ---------------------------------------------------------------- the kiosk
k = Mesh()
k.box(-0.28, 0.28, -0.22, 0.22, 0, 0.04, 6)                                  # foot
k.box(-0.225, 0.225, -0.16, 0.16, 0.04, 1.85, 6)                             # box
k.box(-0.18, 0.18, -0.178, -0.16, 1.44, 1.78, 11, faces={'-y': 0})           # orange panel
k.box(-0.11, 0.11, -0.185, -0.178, 1.54, 1.72, 8)                            # screen
k.box(-0.04, 0.04, 0.02, 0.10, 1.85, 3.06, 6)                                # pole
for sx in (-1, 1):                                                            # solar panels: a shallow V, front edge low
    M = Matrix.Translation((sx * 0.33, 0.06, 3.10)) @ Matrix.Rotation(sx * math.radians(-6), 4, 'Y') @ Matrix.Rotation(math.radians(24), 4, 'X')
    k.box(-0.31, 0.31, -0.27, 0.27, -0.018, 0.018, 6, M, faces={'+z': 7}, bottom=True)
k.box(-0.05, 0.05, -0.02, 0.14, 3.02, 3.10, 6, bottom=True)                   # the panels' bracket
kiosk_tris = k.finish('bike-share-kiosk', img)

# ---------------------------------------------------------------- the bike (Blender -y = its front)
b = Mesh()
R, RI = 0.33, 0.295
FY, RY = -0.56, 0.56                     # front & rear axles
for cy in (FY, RY):
    b.ring(cy, R, R, RI, 0.022, 12, 4, inner=False)                           # tyre (its inner band never reads)
    b.box(-0.05, 0.05, cy - 0.04, cy + 0.04, R - 0.04, R + 0.04, 5, bottom=True)  # hub
BB = (0.0, 0.02, 0.30)                    # bottom bracket
HT0, HT1 = (0.0, -0.43, 0.66), (0.0, -0.47, 0.92)   # head tube, bottom & top
ST1 = (0.0, 0.22, 0.82)                   # seat tube top
T = 0.055
b.tube((0, -0.43, 0.66), (0, -0.25, 0.34), 0.06, 0.08, 3)                        # the step-through's down tube, in two
b.tube((0, -0.27, 0.35), BB, 0.06, 0.08, 3)
b.tube(BB, ST1, T, T, 3)                                                      # seat tube
b.tube(HT0, HT1, 0.06, 0.06, 3)                                               # head tube
b.tube((0, FY, R), HT0, 0.06, 0.03, 3)                                        # fork
b.tube(HT1, (0, -0.42, 1.09), 0.035, 0.035, 3)                                # stem
b.tube((-0.30, -0.34, 1.10), (0.30, -0.34, 1.10), 0.03, 0.03, 3)              # handlebar, swept back ...
for sx in (-1, 1):
    b.tube((sx * 0.30, -0.34, 1.10), (sx * 0.31, -0.22, 1.08), 0.035, 0.035, 10)  # ... to its grips
    b.tube((sx * 0.06, -0.42, 1.09), (sx * 0.30, -0.34, 1.10), 0.03, 0.03, 3)
for sx in (-1, 1):
    b.tube((sx * 0.04, BB[1], BB[2]), (sx * 0.05, RY, R), 0.025, 0.03, 3)    # chain stays
    b.tube((sx * 0.03, 0.19, 0.74), (sx * 0.05, RY, R), 0.025, 0.025, 3)     # seat stays
b.tube(ST1, (0, 0.25, 0.93), 0.03, 0.03, 5)                                   # seat post
b.box(-0.08, 0.08, 0.13, 0.37, 0.93, 0.99, 10, bottom=True)                   # saddle
# the orange rear skirt over the wheel's top (both sides & the fender), and the chain guard on the right
b.ring(RY, R, 0.395, 0.345, 0.055, 5, 0, a0=math.radians(-15), a1=math.radians(115))  # the rear fender
# the skirt: a flat panel over the wheel's upper half on the chain side (the material is two-sided: one face is enough)
for i in range(4):
    a, c = math.radians(-5 + 30 * i), math.radians(-5 + 30 * (i + 1))
    P = lambda r, t: (0.075, RY + r * math.cos(t), R + r * math.sin(t))
    b.face([P(0.10, a), P(0.10, c), P(0.37, c), P(0.37, a)], 0)
b.box(0.06, 0.10, BB[1] - 0.08, RY, 0.22, 0.40, 0, bottom=True)
b.ring(FY, R, 0.37, 0.35, 0.035, 4, 3, a0=math.radians(30), a1=math.radians(140), sides=False, inner=False)  # front fender
# the front carrier: a black basket on the head tube with its flat orange plate on the front
b.box(-0.15, 0.15, -0.70, -0.52, 0.90, 1.16, 3, faces={'-y': 11}, bottom=True)
b.tube((0, -0.47, 0.90), (0, -0.55, 0.94), 0.04, 0.04, 3)
for sx in (-1, 1):                                                             # cranks & pedals
    b.tube(BB, (sx * 0.10, BB[1] + sx * 0.12, BB[2] - sx * 0.10), 0.025, 0.025, 5)
bike_tris = b.finish('bike-share-bike', img)

print('TRIS dock', dock_tris, 'kiosk', kiosk_tris, 'bike', bike_tris)
