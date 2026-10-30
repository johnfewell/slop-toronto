"""Clean City InfoPillar solids from the City's 2011 drawing, attachment 1 p6.
3.0 m mast, .50 m wide, .26 m deep, 1.34 m overall wing, 2.044 m
wing height, .40 x 1.816 m map. One vertex-colour material; no ad artwork.
Blender -Y / glTF +Z is the narrow map face. Base at zero, footprint centred.
Usage: Blender -b --factory-startup --python-exit-code 1 --python this.py -- out.glb
"""
import bpy,bmesh,sys,math
from mathutils import Matrix
bpy.ops.wm.read_factory_settings(use_empty=True)
bm=bmesh.new();colour=bm.loops.layers.float_color.new('Color')
STEEL=(.09,.105,.11,1);PANEL=(.025,.04,.035,1);TRIM=(.25,.27,.27,1);YELLOW=(.80,.78,.025,1);INK=(.01,.015,.01,1)
def paint(faces,c):
    for f in faces:
        for lp in f.loops:lp[colour]=c
def box(x0,x1,y0,y1,z0,z1,c):
    before=set(bm.faces)
    bmesh.ops.create_cube(bm,size=1,matrix=Matrix.Translation(((x0+x1)/2,(y0+y1)/2,(z0+z1)/2))@Matrix.Diagonal((x1-x0,y1-y0,z1-z0,1)))
    paint([f for f in bm.faces if f not in before],c)
def cylinder(x,y,z,r,depth,c,sy=1,rot=None):
    before=set(bm.faces)
    M=Matrix.Translation((x,y,z))@(rot or Matrix.Identity(4))@Matrix.Diagonal((1,sy,1,1))
    bmesh.ops.create_cone(bm,cap_ends=True,segments=16,radius1=r,radius2=r,depth=depth,matrix=M)
    paint([f for f in bm.faces if f not in before],c)
# The slim map mast and its oval ground shoe.
cylinder(0,-.54,.018,.28,.036,TRIM,sy=.13/.28)
cylinder(0,-.54,1.5,.25,3.0,STEEL,sy=.52)
# Narrow map inset; the runtime draws its local street map over this surface.
box(-.205,.205,-.671,-.666,.724,2.540,PANEL)
# Side wing with a visible slim frame, elevated above the pavement.
box(-.06,.06,-.47,.671,.496,2.540,TRIM)
box(-.062,.062,-.43,.63,.54,2.49,PANEL)
# Information insignia, visible from both narrow approaches.
for side in [-1,1]:
    y=-.54+side*.132
    cylinder(0,y,2.79,.112,.004,YELLOW,rot=Matrix.Rotation(math.pi/2,4,'X'))
    box(-.017,.017,y-.003,y+.003,2.72,2.82,INK)
    box(-.040,.040,y-.003,y+.003,2.71,2.73,INK)
    cylinder(0,y,2.855,.019,.006,INK,rot=Matrix.Rotation(math.pi/2,4,'X'))
bm.normal_update();me=bpy.data.meshes.new('CityInfoPillar');bm.to_mesh(me);bm.free()
o=bpy.data.objects.new('CityInfoPillar',me);bpy.context.collection.objects.link(o)
m=bpy.data.materials.new('painted-metal');m.use_nodes=True
nt=m.node_tree;b=nt.nodes['Principled BSDF'];v=nt.nodes.new('ShaderNodeVertexColor');v.layer_name='Color';nt.links.new(v.outputs['Color'],b.inputs['Base Color']);b.inputs['Roughness'].default_value=.6;b.inputs['Metallic'].default_value=.25;me.materials.append(m)
bpy.context.view_layer.objects.active=o;o.select_set(True)
out=sys.argv[sys.argv.index('--')+1]
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
print('INFO_PILLAR',sum(len(p.vertices)-2 for p in me.polygons),'triangles',list(o.dimensions))
