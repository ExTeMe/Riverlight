"""First editable street samples; run through Blender MCP with project root set locally."""
from pathlib import Path
import os

root = Path(globals().get('RIVERLIGHT_PROJECT_ROOT') or os.environ['RIVERLIGHT_PROJECT_ROOT'])
namespace = {'RIVERLIGHT_PROJECT_ROOT': str(root), 'REQUESTED_ASSETS': []}
exec(compile((root / 'scripts/blender/build_city_assets.py').read_text(encoding='utf-8'), 'build_city_assets.py', 'exec'), namespace)
Architect, material = namespace['Architect'], namespace['material']
import bpy
import math

def trim_window(a, x, y, z, w, h):
    a.window(x,y,z,w,h)
    for dx in [-w/2,w/2]: a.box('Window_Frame',x+dx,y,z+.06,.09,h+.16,.12,a.white)
    for dy in [-h/2,h/2]: a.box('Window_Frame',x,y+dy,z+.06,w+.18,.09,.12,a.white)
    a.box('Window_Crossbar',x,y,z+.08,w,.055,.12,a.white)

def cottage(a):
    clay=material('#97644e','Roof'); brick=material('#b38b70','Solid')
    a.box('Stone_Foundation',0,.25,-.45,6.2,.5,5.3,a.stone)
    a.box('Limewashed_House',0,1.9,-.45,5.9,3,5,a.wall,.07)
    a.roof(0,3.45,-.45,6.5,5.7,clay,rise=1.7)
    # Raised roof battens make the clay courses readable without texture dependencies.
    for side in [-1,1]:
        for row in range(1,9):
            x=side*row*.36;y=5.15-row*.36*1.7/3.25
            a.rod('Roof_Tile_Course',(x,y+.025,-3.3),(x,y+.025,2.4),.028,clay)
    a.box('Chimney',1.65,4.7,-1.5,.65,2,.65,brick)
    a.box('Chimney_Cap',1.65,5.75,-1.5,.82,.16,.82,a.stone)
    a.box('Door_Recess',-.65,1.3,2.08,1.05,2.2,.12,a.dark)
    for i in range(6):a.box('Door_Oak_Plank',-.65+(i-2.5)*.15,1.3,2.16,.14,2.05,.06,a.wood)
    a.sphere('Brass_Door_Handle',-.3,1.25,2.23,.06,material('#b39254','Metal'))
    trim_window(a,1.6,1.95,2.09,1.35,1.45)
    trim_window(a,-1.7,2,-3,1.3,1.4)
    a.box('Porch_Deck',-.7,.33,2.85,2.6,.18,1.3,a.wood)
    for x in [-1.85,.45]:a.box('Porch_Post',x,1.5,3.3,.13,2.4,.13,a.white)
    canopy=a.box('Porch_Canopy',-.7,2.85,2.8,2.85,.14,1.65,clay)
    canopy.rotation_euler.x=.12
    for i in range(2):a.box('Entry_Step',-.7,.1+i*.09,3.65-i*.22,1.5,.18,.44,a.stone)
    a.planter(1.7,.15,2.7,1.8,.55)
    for x in [-3.65,3.65]:
        for z in [-2.8,-1.8,-.8,.2,1.2,2.2,3.2]:a.box('Garden_Picket',x,.72,z,.09,1.15,.11,a.wood)
        for y in [.45,.95]:a.box('Garden_Rail',x,y,.2,.08,.08,6.1,a.wood)
    a.empty('Entrance',(-.7,0,3.85));a.empty('Shelter',(-.7,0,2.8))

def bakery(a):
    cream=material('#e4cfac','Wall'); red=material('#9e5545','Roof')
    a.box('Shop_Plinth',0,.22,-.2,6.7,.44,5.9,a.stone)
    a.box('Upper_Residence',0,4.4,-.6,6.2,2.5,5.1,cream,.07)
    a.box('Rear_Shop_Wall',0,1.7,-3,6.2,2.7,.25,cream)
    for x in [-3,3]:a.box('Shop_Side_Wall',x,1.7,-.6,.25,2.7,4.7,cream)
    a.box('Shop_Interior_Floor',0,.48,-.6,5.8,.12,4.9,a.wood)
    a.box('Shopfront_Recess',0,1.8,1.94,5.8,2.4,.1,a.glass)
    for x in [-2.9,-.85,.85,2.9]:a.box('Shopfront_Mullion',x,1.8,2.03,.13,2.6,.16,a.dark)
    for y in [.6,2.9]:a.box('Shopfront_Transom',0,y,2.03,6,.13,.16,a.dark)
    a.box('Entrance_Door',0,1.65,2.07,1.45,2.25,.1,a.glass)
    a.rod('Door_Pull',(.5,1.1,2.18),(.5,1.8,2.18),.035,a.dark)
    for x in [-1.9,1.9]:
        a.box('Display_Counter',x,.9,2.18,1.65,.55,.55,a.wood)
        for i in range(5):a.sphere('Bread_Loaf',x+(i-2)*.26,1.23,2.25,.13,material('#c39452','Solid'),(1,.65,1.8))
    a.label('BAKERY',0,3.25,2.1,5.5)
    for i in range(12):
        m=red if i%2 else a.white
        awning=a.box('Striped_Canvas',-2.75+i*.5,2.95,2.8,.49,.08,1.4,m)
        awning.rotation_euler.x=.2
        a.box('Awning_Valance',-2.75+i*.5,2.72,3.47,.49,.23,.08,m)
    for x in [-1.65,1.65]:
        trim_window(a,x,4.5,2,1.4,1.5)
        a.planter(x,3.55,2.24,1.6,.45)
    a.roof(0,5.7,-.6,6.65,5.7,red,1.4)
    for x in [-3.2,3.2]:a.rod('Rain_Downpipe',(x,.45,1.8),(x,5.7,1.8),.045,a.dark)
    a.box('Shop_Step',0,.16,3.65,2,.28,.5,a.stone)
    a.empty('Entrance',(0,0,3.9));a.empty('Shelter',(0,0,2.8))

generated=[]
for key,recipe in [('cottage',cottage),('bakery',bakery)]:
    a=Architect(namespace['CATALOG'][key]);recipe(a)
    a.scene['sample_revision']=1
    generated.append(a.export())
# Write only the authored scenes, preserving the user's currently opened file and scenes.
sources={s for s in bpy.data.scenes if s.get('sample_revision')==1}
bpy.data.libraries.write(str(root/'assets/blender/riverlight-street-samples.blend'),sources,fake_user=True)
result={'generated':generated,'scenes':[s.name for s in sources]}
