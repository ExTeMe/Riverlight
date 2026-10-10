"""Riverlight shopping gallery. Run through Blender MCP or Blender's editor.

The existing scene is retained. The generated scene and editable source are
saved separately; only this scene is exported to the browser asset.
"""
import bpy
import math
import os
from pathlib import Path
from mathutils import Vector

def _project_root():
    configured = globals().get('RIVERLIGHT_PROJECT_ROOT') or os.environ.get('RIVERLIGHT_PROJECT_ROOT')
    if configured:
        root = Path(configured).expanduser().resolve()
        if (root / 'assets' / 'catalog-reference.json').is_file():
            return str(root)
        raise RuntimeError('RIVERLIGHT_PROJECT_ROOT must point to the Riverlight repository.')
    origins = [Path.cwd()]
    if globals().get('__file__'):
        origins.insert(0, Path(__file__).resolve().parent)
    if bpy.data.filepath:
        origins.append(Path(bpy.data.filepath).resolve().parent)
    for origin in origins:
        for root in (origin, *origin.parents):
            if (root / 'assets' / 'catalog-reference.json').is_file() and (root / 'package.json').is_file():
                return str(root)
    raise RuntimeError('Open a Riverlight source BLEND or set RIVERLIGHT_PROJECT_ROOT locally before running this script.')

ROOT = _project_root()
os.makedirs(os.path.join(ROOT, 'assets', 'blender'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'public', 'models'), exist_ok=True)
scene = bpy.data.scenes.new('Riverlight_Shopping_Gallery')
bpy.context.window.scene = scene
scene.unit_settings.system = 'METRIC'
scene.render.fps = 30
scene.frame_start, scene.frame_end = 1, 241
scene.world = bpy.data.worlds.new('Riverlight_Studio_World')
scene.world.color = (.2, .2, .2)

def mat(name, color, roughness=.6, metallic=0, emission=0):
    m = bpy.data.materials.new('RL_' + name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    return m

stone = mat('Wall_Limestone', (.72, .66, .53))
ivory = mat('Roof_Ivory', (.88, .85, .75))
brass = mat('Metal_Brass', (.48, .32, .13), .3, .55)
frame = mat('Metal_Frame', (.075, .12, .13), .4, .3)
glass = mat('Glass_Blue', (.12, .27, .31), .19, .3)
warm = mat('WindowWarm_Storefront', (.52, .4, .24), .35, .05, .45)
soft = mat('WindowSoft_Atrium', (.35, .46, .49), .32, .1, .15)
wood = mat('Wood_Terrace', (.39, .23, .12))
leaf = mat('Leaf_Planting', (.20, .33, .15))
paving = mat('Ground_Paving', (.52, .49, .42))
sign = mat('Sign_Lettering', (.95, .77, .43), .4, .12, .5)
water = mat('Glass_Pool', (.16, .46, .49), .16, .2)

def finish(obj, name, material, bevel=0):
    obj.name = name
    obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new('Soft architectural edges', 'BEVEL')
        mod.width, mod.segments = bevel, 2
        mod = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
    return obj

def box(name, loc, size, material, bevel=.04, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    finish(obj, name, material, bevel)
    if parent:
        obj.parent = parent
    return obj

def cyl(name, loc, radius, depth, material, vertices=20, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = finish(bpy.context.object, name, material, .025)
    if parent:
        obj.parent = parent
    return obj

def rod(name, a, b, radius, material):
    a, b = Vector(a), Vector(b)
    obj = cyl(name, (a+b)/2, radius, (b-a).length, material, 8)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (b-a).to_track_quat('Z', 'Y')
    return obj

def text(name, body, loc, size, material):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body, curve.size = body, size
    curve.align_x = 'CENTER'
    curve.extrude, curve.bevel_depth = .018, .005
    obj = bpy.data.objects.new(name, curve)
    scene.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (math.pi/2, 0, 0)
    curve.materials.append(material)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object

def planter(x, y, z, length=2):
    box('Terrace_Planter', (x,y,z+.2), (length,.85,.4), ivory)
    box('Terrace_Hedge', (x,y,z+.54), (length-.18,.66,.35), leaf, .12)

box('Shopping_Plaza', (0,0,.12), (19.7,15.7,.24), paving, .2)
# Asymmetric stepped galleries around the glazed central hall.
for x, height in [(-6.4,5.7),(6.4,7.1)]:
    box('Gallery_Limestone', (x,.5,height/2+.3), (5.7,11.3,height), stone, .24)
    box('Gallery_Cornice', (x,.5,height+.38), (6,11.6,.25), ivory, .13)
    for level in range(2):
        z=1.6+level*2.55
        for k in range(3):
            xx=x+(k-1)*1.7
            box('Boutique_Window', (xx,-5.2,z), (1.45,.12,1.85), warm if (k+level)%3 else glass, .015)
            box('Boutique_Mullion', (xx,-5.29,z), (.055,.055,1.85), brass, .01)
        box('Gallery_Shadow_Reveal', (x,-5.26,z+1.1), (5.7,.15,.13), ivory)
    # Tall vertical louvers cast real shadows down the side elevations.
    for y in [-4,-2.7,-1.4,-.1,1.2,2.5,3.8,5.1]:
        box('Side_Bronze_Fin', (x+(-2.86 if x<0 else 2.86),y,3.1), (.18,.18,5.2), brass)
    for y in [-3.4,0,3.5]:
        planter(x,y,height+.52,3.2)
    for side in [-1,1]:
        box('Rooftop_Parapet', (x+side*2.85,.5,height+.8), (.12,11.4,.65), ivory)

# Barrel-vaulted atrium with individually modeled structural ribs.
vertices=[]
faces=[]
for y in [-5.4,6.1]:
    for k in range(33):
        a=k*math.pi/32
        vertices.append((math.cos(a)*3.55,y,5.1+math.sin(a)*2.7))
for k in range(32):
    faces.append((k,k+1,k+34,k+33))
mesh=bpy.data.meshes.new('Atrium_Glass_Vault')
mesh.from_pydata(vertices,[],faces)
mesh.update()
obj=bpy.data.objects.new('Atrium_Glass_Vault',mesh)
scene.collection.objects.link(obj)
obj.data.materials.append(glass)
for y in [-5.4,-3.5,-1.6,.3,2.2,4.1,6]:
    for k in range(20):
        a=k*math.pi/20
        b=(k+1)*math.pi/20
        rod('Vault_Arc_Rib',(math.cos(a)*3.6,y,5.1+math.sin(a)*2.75),(math.cos(b)*3.6,y,5.1+math.sin(b)*2.75),.065,ivory)
for x in [-3.55,3.55]:
    box('Atrium_Side_Glazing',(x,.3,2.7),(.12,11.5,4.8),glass,.01)
box('Atrium_Front_Glazing',(0,-5.45,3),(6.9,.12,4.4),soft,.01)
for x in [-3.45,-1.7,0,1.7,3.45]:
    box('Atrium_Front_Mullion',(x,-5.55,3.1),(.085,.08,4.7),brass,.01)
box('Entrance_Canopy',(0,-6.15,3.9),(8,2.2,.24),ivory,.16)
for x in [-3.3,3.3]:
    cyl('Canopy_Column',(x,-6.7,2.1),.13,3.7,brass)
box('Shopping_Gallery_Sign',(0,-7.3,4.48),(7.9,.22,.9),frame,.1)
text('Mall_Sign_Text','RIVERLIGHT', (0,-7.43,4.25),.55,sign)

# Revolving door: editable pivot and a genuine looping glTF animation.
pivot=bpy.data.objects.new('Mall_RevolvingDoor',None)
scene.collection.objects.link(pivot)
pivot.location=(0,-6.1,.35)
cyl('Entrance_Door_Cap',(0,0,2.2),1.1,.12,brass,32,pivot)
cyl('Entrance_Door_Spindle',(0,0,1.1),.07,2.2,brass,12,pivot)
for i in range(3):
    a=i*math.tau/3
    door=box('Revolving_Glass_Panel',(math.cos(a)*.49,math.sin(a)*.49,1.1),(.96,.055,2.05),glass,.01,pivot)
    door.rotation_euler.z=a
pivot.rotation_euler.z=0
pivot.keyframe_insert(data_path='rotation_euler',frame=1,index=2)
pivot.rotation_euler.z=math.tau
pivot.keyframe_insert(data_path='rotation_euler',frame=241,index=2)
scene.frame_set(1)
if pivot.animation_data and pivot.animation_data.action:
    pivot.animation_data.action.name='Mall_Revolving_Door_Loop'

# Roof lounge, reflecting pool, pergola and external stairs.
box('Roof_Reflecting_Pool',(-6.4,3.7,6.15),(3.4,2.5,.12),water,.12)
for x in [4.4,8.3]:
    for y in [-2.7,1.5]:
        box('Pergola_Column',(x,y,8.35),(.14,.14,2.3),wood)
for y in [-2.7,-2,-1.3,-.6,.1,.8,1.5]:
    box('Pergola_Louver',(6.35,y,9.5),(4.3,.17,.17),wood)
for x in [-7.3,7.3]:
    for y in [-6.2,-7.1]:
        cyl('Cafe_Table',(x,y,.95),.48,.09,wood)
        cyl('Cafe_Table_Leg',(x,y,.55),.06,.75,brass,8)
        for dx in [-.65,.65]:
            box('Cafe_Chair',(x+dx,y,.57),(.42,.44,.12),wood)
            box('Cafe_Chair_Back',(x+dx,y+.2,.85),(.42,.08,.6),wood)
for x in [-9.1,9.1]:
    for y in [-6.6,5.8]:
        planter(x,y,.27,1.05)

# Studio camera and lights are kept in the .blend, excluded from GLB.
bpy.ops.object.camera_add(location=(30,-37,27))
camera=bpy.context.object
camera.name='Mall_Studio_Camera'
camera.rotation_euler=(Vector((0,0,3))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'
camera.data.ortho_scale=29
scene.camera=camera
for loc,energy,size in [((0,-10,23),2300,12),((-15,4,14),1800,10),((13,10,18),1800,9)]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    light=bpy.context.object
    light.data.energy,light.data.shape,light.data.size=energy,'DISK',size
    light.rotation_euler=(Vector((0,0,2))-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.render.resolution_x=1100
scene.render.resolution_y=900
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=True
bpy.context.view_layer.update()
blend_path=os.path.join(ROOT,'assets','blender','riverlight-shopping-gallery.blend')
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
glb_path=os.path.join(ROOT,'public','models','shopping-gallery.glb')
bpy.ops.export_scene.gltf(filepath=glb_path,export_format='GLB',use_active_scene=True,export_apply=True,export_cameras=False,export_lights=False,export_animations=True,export_animation_mode='SCENE',export_frame_range=True,export_frame_step=8,export_extras=True)
bpy.ops.object.select_all(action='DESELECT')
omitted=['Boutique_Mullion','Side_Bronze_Fin','Cafe_Chair','Mall_Sign_Text','Vault_Arc_Rib']
modified=[]
for obj in scene.objects:
    obj.select_set(obj.type not in ['CAMERA','LIGHT'] and not any(name in obj.name for name in omitted))
    for mod in obj.modifiers:
        if mod.type in ['BEVEL','WEIGHTED_NORMAL']:modified.append((mod,mod.show_viewport));mod.show_viewport=False
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'public','models','shopping-gallery_lod.glb'),export_format='GLB',use_active_scene=True,use_selection=True,export_apply=True,export_animations=False,export_extras=True)
for mod,visible in modified:mod.show_viewport=visible
result={'scene':scene.name,'objects':len(scene.objects),'blend':blend_path,'glb':glb_path,'glb_bytes':os.path.getsize(glb_path),'animation':'Mall_Revolving_Door_Loop'}
