"""Editable civic sample. Run through Blender MCP with a local project root."""
import os
from pathlib import Path
import bpy

root = Path(globals().get('RIVERLIGHT_PROJECT_ROOT') or os.environ['RIVERLIGHT_PROJECT_ROOT'])
ns = {'RIVERLIGHT_PROJECT_ROOT': str(root), 'REQUESTED_ASSETS': []}
exec(compile((root / 'scripts/blender/build_city_assets.py').read_text(encoding='utf-8'), 'build_city_assets.py', 'exec'), ns)
a = ns['Architect'](ns['CATALOG']['library'])
material = ns['material']
stone = material('#c8c1ac', 'Wall')
timber = material('#937152', 'Solid')
bronze = material('#575e57', 'Metal')
roof = material('#637e79', 'Roof')
glass = material('#405f69', 'Glass')
warm = material('#ad9574', 'WindowWarm')

# Low reading wing and a taller book hall frame a recessed public entrance.
a.box('Civic_Paving', 0, .12, 0, 11.6, .24, 11.6, a.stone)
a.box('Reading_Floor', 0, .38, -.7, 10.5, .24, 8.7, timber)
a.box('Rear_Stone_Wall', 0, 2.6, -4.9, 10.5, 4.4, .3, stone)
a.box('West_Stone_Wall', -5.1, 2.6, -.7, .3, 4.4, 8.7, stone)
a.box('East_Stone_Wall', 5.1, 2.6, -.7, .3, 4.4, 8.7, stone)
a.box('Upper_Book_Hall', -2.75, 5.25, -.8, 4.7, 1.6, 8.2, stone)
a.box('Book_Hall_Coping', -2.75, 6.15, -.8, 5.05, .22, 8.6, roof)
a.box('Reading_Wing_Roof', 2.25, 4.9, -.8, 5.75, .28, 8.6, roof)
# Repeated stone joints and deep vertical timber fins provide real relief.
for y in [.8, 1.6, 2.4, 3.2, 4.0]:
    a.box('Stone_Course_Reveal', -5.26, y, -.7, .03, .035, 8.5, bronze, 0)
for z in [-4.3, -2.9, -1.5, -.1, 1.3, 2.7]:
    a.window(5.27, 2.6, z, .95, 2.8, True)
    a.box('Side_Window_Fin', 5.4, 2.6, z+.55, .28, 3.1, .1, timber)
for x in [-4.5, -3.5, -2.5, -1.5]:
    a.box('Clerestory_Glass', x, 5.45, 3.33, .76, .78, .08, glass)
    a.box('Clerestory_Fin', x+.44, 5.45, 3.43, .09, 1.05, .28, timber)

# Open front bays reveal books and reading counters without transparent sorting.
for x in [-4.25, -2.7, 1.8, 3.5]:
    a.box('Reading_Bay_Back', x, 2.15, 2.65, 1.35, 2.9, .08, warm if x in [-2.7,3.5] else glass)
    for y in [1.15,1.8,2.45]:
        a.box('Bookshelf', x, y, 3.05, 1.3, .09, .5, timber)
        for j in range(7):
            book = material(['#82624f','#6c827b','#bdac83','#8e6d64'][j%4], 'Solid')
            a.box('Book_Spine', x-.53+j*.17, y+.23, 3.12, .12, .25+(j%3)*.07, .22, book, .006)
    a.box('Reading_Bay_Sill', x, .7, 3.45, 1.5, .22, .8, stone)
for x in [-5,-3.48,-1.9,.85,2.65,4.95]:
    a.box('Front_Timber_Pier', x, 2.55, 3.55, .17, 4.1, .42, timber)
a.box('Front_Lintel', 0, 4.5, 3.55, 10.4, .26, .45, stone)

# Double doors, handles and an accessible flush forecourt.
a.box('Recessed_Double_Door', -.55, 1.65, 3.05, 2.1, 2.5, .1, glass)
for x in [-1.65,-.55,.55]: a.box('Door_Frame', x, 1.65, 3.16, .07, 2.6, .12, bronze)
for x in [-.72,-.38]: a.rod('Door_Pull', (x,1.25,3.28), (x,1.95,3.28), .025, bronze)
a.box('Entrance_Canopy', -.55, 3.65, 4.1, 3.3, .2, 2.35, roof)
for x in [-1.95,.85]: a.box('Canopy_Post', x, 1.9, 5.12, .09, 3.4, .09, bronze)
a.label('LIBRARY', -.55, 4.12, 3.68, 3.4)
a.box('Entrance_Walk', -.55, .25, 4.55, 2.45, .02, 2.5, stone, 0)
a.bench(-3.6, 4.8)
a.planter(3.85, .24, 4.7, 2.8, 1.25)
# Book-shaped civic emblem on the taller roof fascia.
for x, tilt in [(-3.0,-.15),(-2.5,.15)]:
    page = a.box('Open_Book_Emblem', x, 5.45, 3.52, .46, .65, .1, a.white)
    page.rotation_euler.y = tilt
a.empty('Entrance', (-.55, .24, 5.6))
a.empty('Shelter', (-.55, .24, 4.15))
a.scene['sample_revision'] = 1
a.scene['asset_id'] = 'library'
a.scene['front'] = '+Z in runtime; -Y in Blender'
generated = a.export()
# A dedicated file avoids capturing unrelated open scenes or previous samples.
bpy.data.libraries.write(str(root / 'assets/blender/riverlight-library-sample.blend'), {a.scene}, fake_user=True)
result = {'generated': generated, 'scene': a.scene.name}
