"""Build the editable R1 office sample in a dedicated Blender scene."""
import os
from pathlib import Path

import bpy

root = Path(globals().get('RIVERLIGHT_PROJECT_ROOT') or os.environ['RIVERLIGHT_PROJECT_ROOT'])
namespace = {'RIVERLIGHT_PROJECT_ROOT': str(root), 'REQUESTED_ASSETS': []}
library = root / 'scripts/blender/build_city_assets.py'
exec(compile(library.read_text(encoding='utf-8'), library.name, 'exec'), namespace)
a = namespace['Architect'](namespace['CATALOG']['office'])
material = namespace['material']

limestone = material('#c4bba7', 'Wall')
concrete = material('#a69f8b', 'Ground')
bronze = material('#586e68', 'Metal')
roof = material('#6d7770', 'Roof')
glass = material('#446874', 'Glass')
corner_glass = material('#63828a', 'Glass')
warm = material('#7d8580', 'WindowWarm')
cool = material('#728d98', 'WindowSoft')
wood = material('#92694f', 'Solid')
downlight = material('#d3b089', 'Light')

# Set the lobby back behind its canopy and keep a clear walk from the street.
a.box('Forecourt', 0, .11, 0, 11.6, .22, 11.6, concrete, .04)
a.box('Podium_Back', 0, 2.57, -2.6, 10.55, 4.7, 5.4, limestone, .07)
a.box('Lobby_Soffit', 0, 4.55, 1.18, 10.55, .7, 2.3, limestone, .04)
a.box('Podium_Coping', 0, 5.08, -1.5, 10.8, .28, 7.7, roof, .035)
a.box('Lobby_Floor', 0, .25, 1.48, 10.5, .1, 3.1, concrete, 0)
for x in [-4.86, -2.78, 2.7, 4.86]:
    a.box('Lobby_Stone_Pier', x, 2.25, 2.29, .32, 4.05, .44, limestone, .035)
for x in [-3.75, 3.78]:
    a.box('Lobby_Window', x, 2.2, 1.43, 1.68, 3.35, .09, warm, 0)
    a.box('Lobby_Display_Ledge', x, .8, 1.86, 1.55, .13, .68, wood)
a.box('Entrance_Double_Door', -.08, 1.61, 1.79, 2.6, 2.65, .1, glass, 0)
for x in [-1.4, -.08, 1.24]:
    a.box('Entrance_Frame', x, 1.61, 1.87, .08, 2.68, .13, bronze, 0)
for x in [-.33, .17]:
    a.box('Entrance_Handle', x, 1.36, 1.96, .05, .63, .09, bronze, .01)
a.box('Arrival_Canopy', -.08, 3.85, 3.11, 4.62, .22, 3.05, bronze, .05)
a.box('Canopy_Light', -.08, 3.72, 3.55, 2.8, .04, .12, downlight, 0)
a.label('WHITE ELM', -.08, 4.42, 2.37, 4.25)
a.planter(-3.91, .22, 4.49, 2.24, 1.1)
a.bench(3.82, 4.52)
a.empty('Entrance', (-.08, .22, 5.61))
a.empty('Shelter', (-.08, .22, 3.68))


def office_wing(name, x, z, width, depth, floors, offset):
    base = 5.22
    step = 2.97
    height = floors * step
    a.box(name + '_Stone_Core', x, base + height / 2, z, width, height, depth, limestone, .07)
    for floor in range(floors):
        y = base + (floor + .53) * step
        for side in [-1, 1]:
            for bay in [-1, 0, 1]:
                # A sparse, fixed lighting pattern makes individual rooms legible at night.
                state = (floor * 7 + bay * 3 + side + offset) % 13
                pane = warm if state in [2, 7] else cool if state == 11 else glass
                a.box('Curtain_Pane', x + bay * width * .285, y, z + side * (depth / 2 + .025),
                      width * .257, 2.14, .07, pane, 0)
            a.box('Corner_Return_Glass', x + side * (width / 2 + .03), y, z + depth * .13,
                  .07, 2.14, depth * .61, corner_glass, 0)
        a.box('Floor_Spandrel', x, y - 1.27, z + depth / 2 + .07,
              width, .18, .15, bronze, .015)
    for x_offset in [-.43, -.145, .145, .43]:
        a.box('Continuous_Stone_Fin', x + width * x_offset, base + height / 2, z + depth / 2 + .16,
              .12, height + .1, .35, limestone, .02)
    a.box(name + '_Roof_Coping', x, base + height + .12, z, width + .2, .24, depth + .22, roof, .04)
    return base + height + .24


main_roof = office_wing('Main_Tower', -1.95, -1.35, 5.85, 6.25, 6, 0)
terrace = office_wing('East_Wing', 2.86, -.83, 3.73, 5.2, 3, 5)

# Offset the crown behind a usable terrace and retain its profile in the distant export.
a.box('Inset_Crown', -2.21, main_roof + 1.18, -2.1, 4.55, 2.36, 3.92, limestone, .055)
a.box('Crown_Glazing', -2.21, main_roof + 1.3, -.11, 3.81, 1.3, .09, cool, 0)
a.box('Crown_Screen_Cap', -2.21, main_roof + 2.47, -2.1, 4.85, .22, 4.2, bronze, .055)
for i in range(9):
    a.box('Window_Mullion_Crown_Screen', -4.04 + i * .46, main_roof + 1.3, .005,
          .06, 1.56, .19, bronze, .007)
a.box('Terrace_Parapet', 2.86, terrace + .4, 1.76, 3.92, .8, .13, limestone, .025)
a.box('Terrace_Parapet', 4.75, terrace + .4, -.79, .13, .8, 5.2, limestone, .025)
a.planter(3.02, terrace, 1.02, 2.85, .75)
for x in [1.48, 4.18]:
    a.box('Terrace_Pergola_Post', x, terrace + 1.22, -.48, .13, 2.44, .13, bronze)
for z in [-.98, -.48, .02]:
    a.box('Terrace_Pergola_Rafter', 2.83, terrace + 2.47, z, 3.13, .11, .13, bronze, .01)

a.scene['sample_revision'] = 1
a.scene['asset_id'] = 'office'
a.scene['front'] = '+Z in runtime; -Y in Blender'
a.export()
bpy.data.libraries.write(str(root / 'assets/blender/riverlight-office-sample.blend'), {a.scene}, fake_user=True)
