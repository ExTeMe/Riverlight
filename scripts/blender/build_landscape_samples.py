"""Build the R1 pocket park and bridge-side landing as editable Blender scenes."""
import math
import os
from pathlib import Path

import bpy

root = Path(globals().get('RIVERLIGHT_PROJECT_ROOT') or os.environ['RIVERLIGHT_PROJECT_ROOT'])
namespace = {'RIVERLIGHT_PROJECT_ROOT': str(root), 'REQUESTED_ASSETS': []}
library = root / 'scripts/blender/build_city_assets.py'
exec(compile(library.read_text(encoding='utf-8'), library.name, 'exec'), namespace)
Architect, material = namespace['Architect'], namespace['material']


def pocket_park(a):
    turf = material('#869573', 'Ground')
    paving = material('#c8bca5', 'Ground')
    stone = material('#b4ac99', 'Ground')
    cedar = material('#92694f', 'Solid')
    roof = material('#61776b', 'Roof')
    metal = material('#586e68', 'Metal')
    lamp = material('#ebc99a', 'Light')
    foliage = material('#7f936c', 'Leaf')

    a.box('Park_Turf', 0, .055, 0, 7.94, .11, 7.94, turf, .045)
    # The walk bends around a planted island into a sheltered seating court.
    walk = [(1.2, 3.99), (2.8, 3.99), (2.8, 2.4), (1.3, .85), (.05, .37),
            (.05, -2.6), (-2.98, -2.6), (-2.98, .76), (-.5, 1.88), (1.2, 2.8)]
    a.mesh('Walk_and_Seating_Court', [(x, .126, z) for x, z in walk], [tuple(range(len(walk)))], paving)
    for z in [3.01, 3.51]:
        a.box('Entry_Paver_Joint', 2, .129, z, 1.53, .006, .018, stone, 0)

    a.tree(-2.56, 2.13, .89)
    a.tree(2.39, -2.54, .82)
    a.cylinder('Circular_Seat_Plinth', -2.48, .22, 2.08, 1.22, .31, stone, n=20)
    for segment in range(7):
        angle = (segment - 3) * .24
        x, z = -2.48 + math.cos(angle) * 1.01, 2.08 + math.sin(angle) * 1.01
        seat = a.box('Seat_Timber_Slat', x, .44, z, .38, .09, .24, cedar, .012)
        seat.rotation_euler.z = -angle
    for x, z, sx, sz in [(2.68, .26, 1.95, 1.12), (2.62, 1.42, 1.26, .76), (.64, -2.91, 1.56, .68)]:
        a.box('Low_Stone_Planting_Bed', x, .19, z, sx, .23, sz, stone, .07)
        for side in [-1, 1]:
            a.sphere('Planting_Mound', x + side * sx * .23, .31, z, .36, foliage, (sx * .52, .58, sz))
    for i, color in enumerate(['#c99d73', '#b88078', '#d1ad88']):
        a.sphere('Flower_Bloom', 2.2 + i * .4, .54, .27, .12, material(color))

    # Offset pavilion with an open front, timber screen and a bench under cover.
    for x in [-2.66, -.3]:
        for z in [-2.43, -.34]:
            a.box('Pavilion_Post', x, 1.2, z, .13, 2.2, .13, cedar)
    a.box('Pavilion_Eaves', -1.48, 2.3, -1.38, 2.99, .16, 2.59, cedar, .03)
    a.roof(-1.48, 2.36, -1.38, 3.08, 2.7, roof, .57)
    for x in [-2.36, -2.05, -1.74, -1.43, -1.12, -.81, -.5]:
        a.box('Window_Mullion_Timber_Screen', x, 1.22, -2.39, .06, 1.95, .1, cedar, .01)
    a.bench(-1.49, -1.94)
    a.box('Pavilion_Light', -1.48, 2.19, -.72, 1.28, .055, .1, lamp, 0)
    a.box('Path_Bollard', .86, .39, 3.54, .115, .58, .115, metal)
    a.box('Bollard_Light', .86, .68, 3.54, .12, .065, .12, lamp, 0)
    a.empty('Entrance', (2, .126, 3.93))
    a.empty('Shelter', (-1.48, .126, -1.08))


def bridge_landing(a):
    cedar = material('#9b785c', 'Solid')
    beam = material('#6f5547', 'Solid')
    metal = material('#586e68', 'Metal')
    stone = material('#b4ac99', 'Ground')
    roof = material('#637e79', 'Roof')
    light = material('#ebc99a', 'Light')

    # +Z faces the bank. The ramp starts flush with the current 0.025 m quay.
    x, y0, y1, z0, z1 = 1.12, .025, .23, 3.98, 1.58
    vertices = [(-x, y0, z0), (x, y0, z0), (x, y1, z1), (-x, y1, z1),
                (-x, y0-.12, z0), (x, y0-.12, z0), (x, y1-.12, z1), (-x, y1-.12, z1)]
    a.mesh('Quay_Ramp', vertices, [(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)], cedar)
    a.box('Bank_Threshold', 0, .013, 3.87, 2.26, .024, .24, stone, 0)
    a.box('Deck_Stem', 0, .13, -.13, 2.3, .20, 3.5, cedar, .028)
    a.box('Boarding_Head', 0, .13, -2.58, 6.54, .20, 2.41, cedar, .04)
    for z in [-1.54, -1.08, -.62, -.16, .3, .76, 1.22]:
        a.box('Deck_Joint', 0, .231, z, 2.25, .006, .018, beam, 0)
    for x in [-2.78, -1.85, -.92, 0, .92, 1.85, 2.78]:
        a.box('Boarding_Deck_Joint', x, .231, -2.6, .018, .006, 2.3, beam, 0)
    for x in [-2.92, 2.92]:
        for z in [-3.33, -1.83]:
            a.cylinder('Timber_Pile', x, -.58, z, .148, 1.82, beam, n=10)
    for x in [-.87, .87]:
        a.cylinder('Stem_Pile', x, -.53, .21, .125, 1.62, beam, n=10)
        a.box('Deck_Stringer', x, -.06, -.13, .22, .23, 3.5, beam, .022)

    for side in [-1, 1]:
        for z in [-1.19, .05, 1.32]:
            a.box('Stem_Rail_Post', side * 1.05, .64, z, .085, .84, .085, metal, .012)
        a.box('Stem_Handrail', side * 1.05, 1.08, .05, .085, .075, 2.7, metal)
        for x in [1.25, 2.21, 3.13]:
            a.box('Head_Rail_Post', side * x, .65, -1.49, .085, .84, .085, metal)
        a.box('Head_Handrail', side * 2.2, 1.08, -1.49, 2.05, .075, .085, metal)
        for x in [2.38, 2.94]:
            a.box('Mooring_Cleat_Base', side * x, .28, -3.48, .12, .1, .12, metal)
            a.box('Mooring_Cleat_Horn', side * x, .35, -3.48, .25, .07, .095, metal)
        a.box('Deck_Edge_Light', side * .83, .25, -2.05, .14, .05, .13, light, 0)

    # Keep the centre line clear for boarding, with a shelter on one side.
    for x in [-2.97, -1.44]:
        for z in [-3.3, -1.88]:
            a.box('Shelter_Post', x, 1.32, z, .11, 2.19, .11, metal)
    a.box('Shelter_Fascia', -2.2, 2.43, -2.57, 1.98, .18, 1.97, beam, .025)
    a.roof(-2.2, 2.51, -2.57, 2.06, 2.02, roof, .41)
    a.box('Shelter_Bench', -2.24, .65, -3.15, 1.35, .1, .36, cedar)
    for x in [-2.73, -1.76]:
        a.box('Shelter_Bench_Support', x, .42, -3.14, .12, .35, .23, metal)
    a.box('Shelter_Light', -2.2, 2.32, -2.27, .9, .055, .1, light, 0)
    a.empty('Entrance', (0, .025, 3.96))
    a.empty('Shelter', (-2.2, .23, -2.56))


scenes = set()
for asset_id, build in [('park', pocket_park), ('pier', bridge_landing)]:
    author = Architect(namespace['CATALOG'][asset_id])
    build(author)
    author.scene['sample_revision'] = 1
    author.scene['asset_id'] = asset_id
    author.scene['front'] = '+Z in runtime; -Y in Blender'
    author.export()
    scenes.add(author.scene)

bpy.data.libraries.write(str(root / 'assets/blender/riverlight-landscape-samples.blend'), scenes, fake_user=True)
