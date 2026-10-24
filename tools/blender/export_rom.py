# tools/blender/export_rom.py — exports John's ROM model (rom-heist art/blender/ROM_scene.blend: the SketchUp shell only,
# collections "SKP Mesh Objects" & "SKP Components") to assets/landmarks/rom.glb for the city, restyled on the way out:
# the heritage wings' `yellow_bricks` (its image is missing from the .blend, so it rendered white) becomes Poly Haven's
# brick_wall_07 (CC0) warmed to the wings' buff brick, box-projected at its real 1.7 m tile. The Crystal and every other
# material keep their own. Runs headless on the .blend and NEVER saves it: rom-heist's scene is John's game file.
# usage (from rom-heist): Blender --background --factory-startup art/blender/ROM_scene.blend --python <this>
import bpy, json, mathutils
from collections import Counter
keep = {'SKP Mesh Objects', 'SKP Components'}
objs = set()
for c in bpy.data.collections:
    if c.name in keep:
        for o in c.all_objects:
            if o.type != 'MESH': continue
            # the Google Earth image plane under the site never ships; SketchUp component masters sit at the origin
            if o.name.startswith('G-Google Earth'): continue
            ws = [o.matrix_world @ v.co for v in o.data.vertices]
            if ws and max(abs(w.x) for w in ws) < 5 and max(abs(w.y) for w in ws) < 2 and max(abs(w.z) for w in ws) < 0.5: continue
            objs.add(o)
# the site's asphalt is ground the city draws itself: its faces go
import bmesh
for o in objs:
    idx = [i for i, sl in enumerate(o.material_slots) if sl.material and sl.material.name.startswith('Asphalt')]
    if not idx: continue
    o.data = o.data.copy()
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in idx], context='FACES')
    bm.to_mesh(o.data); bm.free()
# The heritage wings' brick: Poly Haven brick_wall_07 (CC0), the diffuse warmed to buff (tools: ffmpeg
# colorchannelmixer rr=1 gg=.93 bb=.70, eq brightness=.07 saturation=.75 -> ~/.cache/slop-toronto/textures)
import os
PH = os.path.expanduser('~/Documents/Poly Haven/brick_wall_07/textures/')
TILE = 1.7  # metres the texture covers (its info.json dimensions)
brick = bpy.data.materials.new('ROM_BuffBrick')
brick.use_nodes = True
nt = brick.node_tree
bsdf = nt.nodes['Principled BSDF']
def img(path, colour):
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = bpy.data.images.load(path)
    if not colour: n.image.colorspace_settings.name = 'Non-Color'
    return n
diff = img(os.path.expanduser('~/.cache/slop-toronto/textures/rom_buff_brick_diff_1k.jpg'), True)
rough = img(PH + 'brick_wall_07_rough_1k.exr', False)
nor = img(PH + 'brick_wall_07_nor_gl_1k.exr', False)
nmap = nt.nodes.new('ShaderNodeNormalMap')
nt.links.new(diff.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(rough.outputs['Color'], bsdf.inputs['Roughness'])
nt.links.new(nor.outputs['Color'], nmap.inputs['Color'])
nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
restyled = 0
for o in objs:
    slots = [i for i, sl in enumerate(o.material_slots) if sl.material and sl.material.name == 'yellow_bricks']
    if not slots: continue
    if o.data.users > 1: o.data = o.data.copy()
    for i in slots: o.material_slots[i].material = brick
    bm = bmesh.new(); bm.from_mesh(o.data)
    uvl = bm.loops.layers.uv.verify()
    mw = o.matrix_world; nm = mw.to_3x3()
    for f in bm.faces:
        if f.material_index not in slots: continue
        n = (nm @ f.normal).normalized()
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for l in f.loops:
            w = mw @ l.vert.co
            # box projection in world metres: the face's dominant axis picks the plane, the vertical stays v
            if az >= ax and az >= ay: u, v = w.x, w.y
            elif ax >= ay: u, v = w.y, w.z
            else: u, v = w.x, w.z
            l[uvl].uv = (u / TILE, v / TILE)
        restyled += 1
    bm.to_mesh(o.data); bm.free()
print('ROMEXPORT restyled', restyled, 'brick faces')
# a collection of our own in the scene (some of these objects sit in collections excluded from the view layer)
exp = bpy.data.collections.new('EXPORT_ROM')
bpy.context.scene.collection.children.link(exp)
for o in objs:
    exp.objects.link(o)
    o.hide_viewport = False
    o.hide_render = False
lc = bpy.context.view_layer.layer_collection.children['EXPORT_ROM']
bpy.context.view_layer.active_layer_collection = lc
# plan footprint & height range (Blender z up, metres)
pts = []
for o in objs:
    m = o.matrix_world
    for v in o.data.vertices:
        w = m @ v.co
        pts.append((w.x, w.y, w.z))
zs = [p[2] for p in pts]
mats = Counter()
imgs = set()
for o in objs:
    for s in o.material_slots:
        if s.material:
            mats[s.material.name] += 1
            if s.material.use_nodes:
                for n in s.material.node_tree.nodes:
                    if n.type == 'TEX_IMAGE' and n.image: imgs.add((n.image.name, n.image.size[0], n.image.size[1]))
info = {'objects': len(objs), 'verts': len(pts), 'zmin': min(zs), 'zmax': max(zs),
        'xmin': min(p[0] for p in pts), 'xmax': max(p[0] for p in pts), 'ymin': min(p[1] for p in pts), 'ymax': max(p[1] for p in pts),
        'materials': mats.most_common(40), 'images': sorted(imgs)}
# ground-level plan points (lowest 3 m), thinned, for fitting to the OSM outline
low = [(round(p[0], 2), round(p[1], 2)) for p in pts if p[2] < info['zmin'] + 3.0]
info['plan'] = low[::max(1, len(low) // 4000)]
import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
out = os.path.join(ROOT, 'assets', 'landmarks', 'rom.glb')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_active_collection=True, use_visible=False, export_apply=True, export_yup=True,
                          export_image_format='WEBP', export_jpeg_quality=80, export_texcoords=True, export_normals=True,
                          export_materials='EXPORT', export_cameras=False, export_lights=False, export_animations=False)
json.dump(info, open(os.path.join(ROOT, 'assets', 'landmarks', 'rom-info.json'), 'w'))
print('ROMEXPORT ok', info['objects'], info['verts'], round(info['zmin'], 2), round(info['zmax'], 2))
