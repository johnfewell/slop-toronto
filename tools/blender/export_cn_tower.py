# tools/blender/export_cn_tower.py — exports the CN Tower for the city (assets/landmarks/cn-tower.glb) from "CN Tower low
# poly model base mesh" by C.J..Goldman (Sketchfab, CC BY 4.0; see CREDITS.md), downloaded by John as GLB to
# tools/prop-src/cn-tower-goldman.glb. On the way out: the display plinth under it goes, the tower stands on z=0 at its
# real 553.3 m, centred, and the glass (KHR_materials_transmission, costly) becomes the dark glass of the city's other
# towers. Then: npx @gltf-transform/cli@4 meshopt <out> <out>.
# usage: Blender --background --factory-startup --python tools/blender/export_cn_tower.py -- <src.glb> <out.glb>
import bpy, bmesh, sys
from mathutils import Matrix, Vector
argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
HEIGHT = 553.3
GROUND = 20.22  # the model's ground: the plinth's top (the shaft's foot sinks a few metres below it)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in objs:
    o.data = o.data.copy()
    o.data.transform(o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
top = max((v.co.z for o in objs for v in o.data.vertices))
k = HEIGHT / (top - GROUND)
for o in objs:
    bm = bmesh.new(); bm.from_mesh(o.data)
    # the plinth: the disc (out past the shaft) up to its top
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if (c := f.calc_center_median()).z < GROUND + 0.1 and c.xy.length > 1.0],
                     context='FACES')
    bm.to_mesh(o.data); bm.free()
    o.data.transform(Matrix.Scale(k, 4) @ Matrix.Translation(Vector((0, 0, -GROUND))))
    for m in o.data.materials:
        b = m.node_tree.nodes.get('Principled BSDF') if m and m.use_nodes else None
        if b and m.name.startswith('Glass'):
            b.inputs['Transmission Weight'].default_value = 0.0
            b.inputs['Base Color'].default_value = (0.013, 0.035, 0.06, 1)  # 0x1e3546
            b.inputs['Roughness'].default_value = 0.1
            b.inputs['Metallic'].default_value = 0.8
            b.inputs['Alpha'].default_value = 1.0
            m.surface_render_method = 'DITHERED'
xs = [v.co.x for o in objs for v in o.data.vertices]; ys = [v.co.y for o in objs for v in o.data.vertices]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
for o in objs: o.data.transform(Matrix.Translation(Vector((-cx, -cy, 0))))
print('HEIGHT', round(max(v.co.z for o in objs for v in o.data.vertices), 1), 'RADIUS', round(max(max(xs) - cx, max(ys) - cy), 1), 'k', round(k, 3))
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_normals=True,
                          export_texcoords=False, export_materials='EXPORT')
print('WROTE', OUT)
