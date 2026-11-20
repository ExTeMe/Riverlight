"""Finish the two West Bank Blender studies from their editable massing files.

Run Blender in background with this script, followed by -- HOUSE.blend MARKET.blend OUTPUT.
"""

import json
import math
import random
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import bpy
from mathutils import Vector


def srgb(value):
    value /= 255
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


def color(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) for i in (0, 2, 4))


def png(path, size, pixels):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    stride = size * 3
    scanlines = b"".join(b"\0" + pixels[i:i + stride] for i in range(0, len(pixels), stride))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" +
                     chunk(b"IHDR", struct.pack(">2I5B", size, size, 8, 2, 0, 0, 0)) +
                     chunk(b"IDAT", zlib.compress(scanlines, 7)) + chunk(b"IEND", b""))


def surface_samples(kind, size):
    rng = random.Random(44)
    tau = 2 * math.pi
    values = []
    for y in range(size):
        for x in range(size):
            u, v = x / size, y / size
            broad = math.sin(tau * (u - v)) * .2 + math.cos(tau * (3 * u + 2 * v)) * .15
            fine = rng.uniform(-1, 1)
            if kind == "wood":
                grain = math.sin(tau * (14 * v + .13 * math.sin(tau * u))) * .45
                value = broad + grain + .25 * math.sin(tau * (29 * v + u)) + fine * .09
            elif kind == "stone":
                value = broad + .16 * math.sin(tau * (9 * u - 8 * v)) + fine * .33
            elif kind == "tile":
                value = broad + .30 * math.cos(tau * (u * 4 + v)) + fine * .17
            else:
                value = fine * .30 + .06 * math.cos(tau * (7 * u + 11 * v))
            values.append(value)
    return values


def packed_image(name, size, pixels, directory, *, normal=False):
    path = directory / (name + ".png")
    png(path, size, bytes(pixels))
    image = bpy.data.images.load(str(path))
    image.name = name
    if normal:
        image.colorspace_settings.name = "Non-Color"
    image.pack()
    image.filepath = "//" + path.name
    return image


def make_material(name, rgb, roughness, *, metal=0, texture=None, alpha=1, emission=None, day_glow=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*map(srgb, color(rgb)), alpha)
    nodes = mat.node_tree.nodes
    wiring = mat.node_tree.links
    shader = nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = mat.diffuse_color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metal
    shader.inputs["Alpha"].default_value = alpha
    if alpha < 1:
        mat.surface_render_method = "BLENDED"
    if emission:
        shader.inputs["Emission Color"].default_value = (*map(srgb, color(emission)), 1)
        shader.inputs["Emission Strength"].default_value = .8
        mat["riverlightDayGlow"] = day_glow
    if texture:
        size = 160
        relief = surface_samples(texture, size)
        base = color(rgb)
        albedo = [max(0, min(255, int(channel * (1 + level * .12)))) for level in relief for channel in base]
        strength = {"wood": 15, "stone": 12, "tile": 13, "plaster": 6}[texture]
        normal = []
        for i in range(size * size):
            x, y = i % size, i // size
            dx = relief[y * size + (x - 1) % size] - relief[y * size + (x + 1) % size]
            dy = relief[((y + 1) % size) * size + x] - relief[((y - 1) % size) * size + x]
            normal.extend((int(128 + dx * strength), int(128 + dy * strength), 253))
        for data, suffix, target in ((albedo, "color", shader.inputs["Base Color"]),
                                     (normal, "normal", None)):
            image_node = nodes.new("ShaderNodeTexImage")
            image_node.image = packed_image(name + "_" + suffix, size, data, scratch, normal=target is None)
            image_node.location = (-560, 160 if target else -140)
            if target is None:
                normal_node = nodes.new("ShaderNodeNormalMap")
                normal_node.location = (-240, -140)
                normal_node.inputs["Strength"].default_value = .7
                wiring.new(image_node.outputs["Color"], normal_node.inputs["Color"])
                wiring.new(normal_node.outputs["Normal"], shader.inputs["Normal"])
            else:
                wiring.new(image_node.outputs["Color"], target)
    return mat


def palette(is_house):
    return {
        "wall": make_material("Wall_Lime", "d9c8a8" if is_house else "c3b393", .84, texture="plaster"),
        "stone": make_material("Stone_Foundation", "9f9682" if is_house else "a39c8a", .82, texture="stone"),
        "stone2": make_material("Stone_Warm", "afa58d", .8),
        "stone3": make_material("Stone_Weathered", "928b79", .82),
        "ground": make_material("Ground_Sandstone", "bdb294", .8, texture="stone"),
        "slate": make_material("Ground_Terrace", "98745d", .82),
        "wood": make_material("Oak_Structure", "76513b" if is_house else "744b36", .63, texture="wood"),
        "trim": make_material("Painted_Wood", "566d64" if is_house else "67755d", .59),
        "fitting": make_material("Beech_Joinery", "ba8d62", .66, texture="wood"),
        "lining": make_material("Wood_Lining", "aa8564", .67, texture="wood"),
        "roof": make_material("Roof_Clay" if is_house else "Roof_Seamed_Zinc", "9e5744" if is_house else "5b6c68",
                              .73 if is_house else .47, metal=0 if is_house else .25, texture="tile"),
        "seam": make_material("Roof_Edge", "864a3b" if is_house else "4e5f5b", .57, metal=0 if is_house else .28),
        "glass": make_material("Glass_Clear", "bad8db", .15, alpha=.11 if is_house else .26),
        "metal": make_material("Gunmetal", "535b58" if is_house else "4e4f4a", .39, metal=.54),
        "brass": make_material("Bronze", "95784d", .38, metal=.72),
        "ivory": make_material("Glazed_Ceramic", "e8d8b8", .43),
        "linen": make_material("Linen_Sage", "879183", .89),
        "cloth": make_material("Linen_Sienna", "b2674d", .92),
        "dark": make_material("Cast_Iron", "373938", .48, metal=.25),
        "soil": make_material("Garden_Soil", "665342", .94),
        "leaf": make_material("Leaf_Herb", "667846", .84),
        "leaf2": make_material("Leaf_Soft", "8b965a", .83),
        "moss": make_material("Leaf_Groundcover", "7b8659", .94),
        "red": make_material("Produce_Tomato", "bf634a", .64),
        "fruit": make_material("Produce_Citrus", "d8a75d", .68),
        "greens": make_material("Produce_Greens", "798551", .76),
        "shade": make_material("Canvas_Ecru", "dbccac", .85),
        "lamp": make_material("Light_Opal", "ead8af", .39, emission="ffd7a3", day_glow=.10 if is_house else .28),
        "cool_lamp": make_material("Light_Task", "e6e2c7", .43, emission="e8eed4", day_glow=.15),
    }


def section(name):
    group = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(group)
    return group


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    if mat.name in {materials[k].name for k in ("wood", "wall", "stone", "ground", "roof", "lining", "fitting")}:
        geo = obj.data
        uv = geo.uv_layers.active or geo.uv_layers.new(name="Surface")
        longest = max(range(3), key=lambda axis: max(v.co[axis] for v in geo.vertices) -
                      min(v.co[axis] for v in geo.vertices))
        timber = mat in (materials["wood"], materials["lining"], materials["fitting"])
        for face in geo.polygons:
            normal = max(range(3), key=lambda axis: abs(face.normal[axis]))
            axes = [i for i in range(3) if i != normal]
            if timber and longest in axes:
                axes.remove(longest)
                axes.insert(0, longest)
            for loop in face.loop_indices:
                co = geo.vertices[geo.loops[loop].vertex_index].co
                uv.data[loop].uv = (co[axes[0]] / (1.7 if timber else .95),
                                    co[axes[1]] / (.26 if timber else .95))
    return obj


def mesh(name, vertices, faces, mat, group, fine=False):
    geo = bpy.data.meshes.new(name)
    geo.from_pydata(vertices, [], faces)
    geo.update()
    obj = bpy.data.objects.new(name, geo)
    group.objects.link(obj)
    assign(obj, materials[mat])
    if fine:
        obj["near_detail"] = True
    return obj


def box(name, center, size, mat, group, *, rounding=0, fine=False):
    a, b, c = [v / 2 for v in size]
    vertices = [(-a, -b, -c), (a, -b, -c), (a, b, -c), (-a, b, -c),
                (-a, -b, c), (a, -b, c), (a, b, c), (-a, b, c)]
    obj = mesh(name, vertices, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
                                (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat, group, fine)
    obj.location = center
    if rounding:
        bevel(obj, rounding)
    return obj


def bevel(obj, width):
    modifier = obj.modifiers.new("Machined and worn edges", "BEVEL")
    modifier.width = width
    modifier.segments = 1


def beam(name, start, end, section_size, mat, group, fine=False):
    start, end = Vector(start), Vector(end)
    direction = end - start
    obj = box(name, (start + end) / 2, (*section_size, direction.length), mat, group, fine=fine)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


def cylinder(name, center, radius, height, mat, group, *, top=None, sides=10, fine=False):
    top = radius if top is None else top
    vertices = [(r * math.cos(i * math.tau / sides), r * math.sin(i * math.tau / sides), z)
                for r, z in ((radius, -height / 2), (top, height / 2)) for i in range(sides)]
    faces = [tuple(reversed(range(sides))), tuple(range(sides, 2 * sides))]
    faces.extend((i, (i + 1) % sides, (i + 1) % sides + sides, i + sides) for i in range(sides))
    obj = mesh(name, vertices, faces, mat, group, fine)
    obj.location = center
    return obj


def orb(name, center, scale, mat, group, fine=True):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=center)
    obj = bpy.context.object
    obj.name = name
    for previous in list(obj.users_collection):
        previous.objects.unlink(obj)
    group.objects.link(obj)
    obj.scale = scale
    assign(obj, materials[mat])
    if fine:
        obj["near_detail"] = True
    return obj


def lamp(group, name, at, color_hex, day, night, reach, shade_material="lamp", length=.52, *, mount, primary=False):
    x, y, z = at
    box(name + " shade", (x, y, z + .10), (length + .12, .27, .12), "metal", group, rounding=.025)
    box(name + " diffuser", (x, y, z + .024), (length, .17, .045), shade_material, group, rounding=.012)
    for dx in (-length * .30, length * .30):
        beam(name + " suspension rod", (x + dx, y, z + .15), (x + dx, mount[0], mount[1]), (.026, .026), "metal", group)
    empty = bpy.data.objects.new(name + ("_Light" if primary else "_Fixture"), None)
    group.objects.link(empty)
    empty.location = (x, y, z - .06)
    empty.empty_display_size = .15
    empty["riverlightLightColor"] = "#" + color_hex
    empty["riverlightLightDay"] = day
    empty["riverlightLightNight"] = night
    empty["riverlightLightRange"] = reach
    # Blender's inspection render uses the same positions as the gameplay lights.
    data = bpy.data.lights.new(name, "POINT")
    data.color = tuple(map(srgb, color(color_hex)))
    data.energy = 26 * night
    data.shadow_soft_size = .23
    obj = bpy.data.objects.new(name + " Blender preview", data)
    group.objects.link(obj)
    obj.location = empty.location


def flowerpot(group, x, y, z, r, seed):
    rng = random.Random(seed)
    cylinder("Plant pot", (x, y, z + r * .76), r * .71, r * 1.52, "slate", group,
             top=r, sides=10, fine=True)
    cylinder("Soil in pot", (x, y, z + r * 1.49), r * .92, .043, "soil", group, fine=True)
    for i in range(11):
        angle = i * 2.4
        offset = r * rng.uniform(.18, .86)
        scale = r * rng.uniform(.4, .85)
        obj = orb("Herb leaf", (x + math.cos(angle) * offset, y + math.sin(angle) * offset,
                               z + r * rng.uniform(1.6, 2.5)),
                  (scale, scale * .44, scale * .38), "leaf" if i % 3 else "leaf2", group)
        obj.rotation_euler = (.2, .46, angle)


def recolor_massing(is_house, model_name):
    for obj in list(bpy.context.scene.objects):
        if obj.type == "EMPTY":
            obj.name = model_name + "_" + obj.name.rsplit("_", 1)[-1]
            continue
        name = obj.name
        old = obj.data.materials[0].name
        target = "wall"
        if "Glass" in old:
            target = "glass"
        elif "Roof" in old:
            target = "roof"
        elif "Ground" in old:
            target = "ground" if not is_house or any(s in name for s in ("path", "porch")) else "stone"
        elif "Timber" in old or "Column" in old:
            target = "wood"
        elif "Furniture" in old or "Fittings" in old:
            target = "fitting"
        if any(s in name for s in ("floor west slab", "floor east strip", "front slab", "stair landing")):
            target = "lining"
        if name.startswith(("Rear living terrace", "Backstock privacy", "Principal column pier", "Waiting bench stone")):
            target = "stone"
        if name.startswith(("Sofa", "Dining seat", "Reading window seat")):
            target = "linen"
        if name.startswith(("Hood", "Wash station")):
            target = "metal"
        if name.startswith(("Reading bay window", "Street living window", "Recessed door", "Upper street high window",
                            "Stair natural light", "Upper rear recessed window")) and target != "glass":
            target = "trim"
        assign(obj, materials[target])
        if target in ("trim", "wood", "fitting", "linen", "stone") and min(obj.dimensions) > .055:
            bevel(obj, .012)
        if "glass" in name.lower() and "clerestory" not in name.lower():
            center = sum((vertex.co for vertex in obj.data.vertices), Vector()) / len(obj.data.vertices)
            xs = [vertex.co.x for vertex in obj.data.vertices]
            zs = [vertex.co.z for vertex in obj.data.vertices]
            group = obj.users_collection[0]
            bpy.data.objects.remove(obj, do_unlink=True)
            mesh(name, [(min(xs), center.y, min(zs)), (max(xs), center.y, min(zs)),
                        (max(xs), center.y, max(zs)), (min(xs), center.y, max(zs))],
                 [(0, 1, 2, 3)], "glass", group)


def house_detail():
    street_edges = {"Upper street wall": 2.89, "Upper east wall": 2.89,
                    "Upper west wall": 2.89, "Upper rear wall": 2.91}
    for obj in bpy.context.scene.objects:
        for name, top in street_edges.items():
            if obj.name.startswith(name):
                for v in obj.data.vertices:
                    if abs(v.co.z - 2.92) < .001:
                        v.co.z = top
        if obj.name.startswith(("Upper floor west slab", "Upper floor east strip", "Upper front slab")):
            for v in obj.data.vertices:
                v.co.x = min(2.41, max(-3.62, v.co.x))
                v.co.y = min(4.09, max(-3.90, v.co.y))
        if obj.name == "Upper stair landing":
            for v in obj.data.vertices:
                v.co.y = min(4.09, v.co.y)
    site = section("06 - Garden thresholds and planted edges")
    box("Street-facing sandstone footing", (-.62, -3.96, .165), (6.10, .15, .31), "stone", site)
    box("Reading nook footing", (-3.49, -4.36, .169), (1.82, .12, .30), "stone", site)
    for i in range(12):
        x = -3.45 + i * .48
        if .20 < x < 2.28 or x < -2.7:
            continue
        box("Cut footing stone", (x, -4.055, .192), (.462, .08, .21),
            ("stone2", "stone", "stone3")[i % 3], site, rounding=.021, fine=True)
    for center, width, front in ((1.32, 1.64, -5.96), (1.16, 2.18, -4.60)):
        box("Stone threshold nosing", (center, front, .19 if front < -5 else .226),
            (width, .075, .035), "stone2", site, rounding=.009, fine=True)
    for y in (-5.45, -4.98):
        box("Entrance paving joint", (1.32, y, .192), (1.62, .022, .004), "stone3", site, fine=True)
    box("Garden bed under the rear screen", (-1.52, 5.49, .081), (3.48, .67, .10), "soil", site)
    for i in range(8):
        x = -3.05 + i * .43
        orb("Kitchen herb border", (x, 5.51, .28), (.28, .30, .23),
            "leaf" if i % 3 else "leaf2", site, fine=False)
    flowerpot(site, .28, -4.38, .24, .145, 20)
    flowerpot(site, 2.23, 4.87, .15, .19, 25)
    for x, y in ((-1.90, -4.77), (-1.38, -4.81), (-.88, -4.78), (-.45, -4.75)):
        orb("Low planting under sill", (x, y, .21), (.32, .28, .24), "moss", site, fine=False)
    for i in range(7):
        x = -3.30 + i * .78
        box("Rear terrace clay paver", (x, 4.71, .15), (.746, 1.10, .026), "slate", site, rounding=.008)

    joinery = section("07 - Recessed street joinery and eaves")
    # A side rebate gives the actual window seat two sources of daylight.
    bpy.data.objects.remove(bpy.data.objects["Reading bay west wall"], do_unlink=True)
    for center, size in (((-4.275, -3.58, 1.35), (.21, 1.54, 2.22)),
                         ((-4.275, -.51, 1.35), (.21, 1.50, 2.22)),
                         ((-4.275, -2.035, .524), (.21, 1.55, .568)),
                         ((-4.275, -2.035, 2.264), (.21, 1.55, .392))):
        box("Reading bay side wall around opening", center, size, "wall", joinery)
    for y in (-2.79, -2.03, -1.29):
        box("Side window jamb", (-4.289, y, 1.435), (.105, .056, 1.274), "trim", joinery, rounding=.01)
    for z in (.818, 2.055):
        box("Side window rail", (-4.289, -2.035, z), (.105, 1.53, .065), "trim", joinery, rounding=.01)
    mesh("Side window glass", [(-4.30, -2.81, .813), (-4.30, -2.81, 2.066),
                               (-4.30, -1.26, 2.066), (-4.30, -1.26, .813)], [(0, 1, 2, 3)], "glass", joinery)
    box("Side reading sill", (-4.399, -2.035, .778), (.222, 1.67, .091), "stone2", joinery, rounding=.02)
    specs = [(-4.03, -2.85, -4.36, .78, 2.13), (-2.43, -1.12, -3.95, .90, 2.23),
             (-2.36, -1.02, -3.95, 3.98, 4.63), (1.03, 1.57, -3.94, 3.86, 4.72)]
    for x0, x1, y, bottom, top in specs:
        box("Stone sill with drip edge", ((x0 + x1) / 2, y - .044, bottom - .036),
            (x1 - x0 + .14, .23, .08), "stone2", joinery, rounding=.014)
        box("Oak head in plaster reveal", ((x0 + x1) / 2, y + .03, top + .05),
            (x1 - x0 + .11, .15, .11), "wood", joinery, rounding=.013)
    box("Reading bay lower tongue and groove", (-3.42, -4.391, .553),
        (1.48, .082, .426), "trim", joinery, rounding=.013)
    for i in range(10):
        x = -4.113 + i * .151
        box("Reading bay boarding joint", (x, -4.434, .552), (.015, .014, .416), "wood", joinery, fine=True)
    box("Door matching the private vestibule", (1.23, -3.789, 1.08),
        (1.00, .079, 1.47), "trim", joinery, rounding=.018)
    box("Recessed kick panel", (1.23, -3.842, .69), (.76, .045, .53), "wood", joinery, rounding=.022)
    box("Horizontal push rail", (1.23, -3.838, 1.26), (.87, .047, .084), "wood", joinery, rounding=.015)
    box("Bronze house number plate", (1.992, -3.967, 1.65), (.22, .040, .15), "brass", joinery, rounding=.016)
    box("Door handle", (1.61, -3.885, 1.19), (.167, .066, .045), "brass", joinery, rounding=.015)
    for x in (.67, 1.79):
        box("Inset porch frame", (x, -3.88, 1.35), (.112, .22, 2.20), "wood", joinery, rounding=.013)
    for start, end in (((-3.91, -4.207, 4.825), (-.68, -4.207, 6.433)),
                       ((-.68, -4.207, 6.433), (2.71, -4.207, 4.807)),
                       ((-3.91, 4.428, 4.825), (-.68, 4.428, 6.433)),
                       ((-.68, 4.428, 6.433), (2.71, 4.428, 4.807))):
        beam("Gable edge trim", start, end, (.10, .165), "wood", joinery)
    beam("Terracotta ridge cap", (-.68, -4.18, 6.505), (-.68, 4.4, 6.505),
         (.14, .135), "seam", joinery)
    box("Kitchen flue against the west wall", (-3.28, 1.52, 3.67), (.38, .49, 4.48), "wall", joinery, rounding=.025)
    box("Weathered chimney stack", (-3.28, 1.52, 5.63), (.50, .58, 1.0), "stone", joinery, rounding=.023)
    box("Chimney rain cap", (-3.28, 1.52, 6.15), (.61, .67, .105), "seam", joinery, rounding=.021)
    for x in (-2.59, -.79):
        box("Louvred shutter around upstairs landing", (x, -3.999, 4.309), (.26, .082, .71), "trim", joinery, rounding=.018)
        for z in (4.08, 4.19, 4.30, 4.41, 4.52):
            box("Shutter blade", (x, -4.043, z), (.213, .032, .048), "linen", joinery, fine=True)
    for x, height in ((-3.94, 4.77), (2.74, 4.75)):
        beam("Rain gutter under eave", (x, -4.18, height), (x, 4.41, height), (.105, .115), "metal", joinery)
        beam("Gutter downpipe", (x + .07, 4.22, height), (x + .07, 4.22, .29), (.082, .082), "metal", joinery)
    for a, b in (((-3.90, 4.887), (-.75, 6.46)), ((-.61, 6.464), (2.70, 4.867))):
        for i in range(1, 13):
            t = i / 13
            x, z = (a[j] + (b[j] - a[j]) * t for j in (0, 1))
            beam("Clay tile course edge", (x, -4.171, z + .008), (x, 4.386, z + .008),
                 (.043, .029), "seam", joinery, fine=True)
    for i in range(7):
        x = -1.23 + i * .159
        box("Attic air vent louvre", (x, -3.952, 5.49),
            (.067, .046, .38 - .045 * abs(i - 3)), "wood", joinery, fine=True)
    for x in (-3.1, -2.95, -2.8):
        box("Porch screen timber fin", (x + 2.97, -4.50, 1.09), (.066, .115, 1.68),
            "wood", joinery, rounding=.009)
    beam("Porch post brace", (2.23, -4.58, 2.18), (1.82, -4.58, 2.64), (.095, .10), "wood", joinery)

    rooms = section("08 - Furniture and room lighting")
    box("Reading seat cushion", (-3.47, -3.84, .697), (1.20, .56, .12), "cloth", rooms, rounding=.069)
    box("Linen reading cushion", (-3.90, -4.04, .81), (.32, .24, .30), "ivory", rooms, rounding=.08)
    for i, mat in enumerate(("cloth", "ivory", "trim", "slate", "linen", "fitting")):
        books = box("Window seat book", (-3.30 + i * .071, -2.722, 1.414),
                    (.058, .18, .18 - .016 * (i % 3)), mat, rooms, fine=True)
        books.rotation_euler.y = -.09 * (i % 3)
    box("Oak drawer fronts", (2.01, -3.51, .57), (.26, .049, .40), "wood", rooms, rounding=.011)
    box("Deep linen sofa back", (-1.69, -.33, .90), (1.84, .16, .39), "trim", rooms, rounding=.07)
    for x in (-2.12, -1.27):
        box("Seat with side welt", (x, -.68, .81), (.79, .50, .15), "linen", rooms, rounding=.045)
    box("Woven rug beneath dining table", (-1.20, 1.98, .255), (2.35, 2.21, .028), "linen", rooms, rounding=.012)
    for x in (-2.01, -.30):
        box("Dining chair seat", (x, 1.75, .72), (.42, .43, .079), "wood", rooms, rounding=.015)
        box("Dining chair back", (x, 1.54, .98), (.42, .052, .39), "wood", rooms, rounding=.018)
        for dx in (-.14, .14):
            for y in (1.58, 1.91):
                box("Chair leg", (x + dx, y, .48), (.045, .049, .45), "wood", rooms, fine=True)
    box("Kitchen worktop", (-3.075, 2.38, 1.154), (.635, 2.78, .055), "stone2", rooms, rounding=.016)
    box("Inset enamel kitchen basin", (-3.07, 2.93, 1.188), (.43, .60, .041), "ivory", rooms, rounding=.048)
    box("Basin inner bowl", (-3.075, 2.93, 1.211), (.32, .44, .010), "stone3", rooms, rounding=.038)
    beam("Kitchen faucet", (-3.26, 2.94, 1.20), (-3.26, 2.94, 1.415), (.041, .042), "metal", rooms, True)
    beam("Kitchen faucet spout", (-3.26, 2.94, 1.41), (-3.10, 2.94, 1.41), (.038, .04), "metal", rooms, True)
    box("Cooktop", (-3.07, 1.59, 1.188), (.47, .59, .031), "dark", rooms, rounding=.015)
    for y in (1.45, 1.73):
        cylinder("Kitchen burner", (-3.08, y, 1.213), .094, .021, "metal", rooms, fine=True)
    box("Bedroom quilt", (-2.07, 2.39, 3.488), (1.70, 2.06, .18), "linen", rooms, rounding=.081)
    box("Folded cover at foot of bed", (-2.06, 1.52, 3.584), (1.72, .53, .068), "cloth", rooms, rounding=.03)
    for x in (-2.44, -1.68):
        box("Pillow", (x, 3.15, 3.62), (.60, .37, .16), "ivory", rooms, rounding=.074)
    lamp(rooms, "Reading pendant", (-3.60, -3.48, 1.99), "ffd49c", .8, 13, 2.65, length=.34, mount=(-3.48, 2.52), primary=True)
    lamp(rooms, "Dining pendant", (-1.25, 2.20, 2.18), "f8cfa1", 1.0, 15, 4.1, length=.43, mount=(2.20, 2.76))
    lamp(rooms, "Recessed porch lamp", (1.61, -4.38, 2.44), "f3b77c", 0, 6.5, 2.2, length=.20, mount=(-4.38, 2.66))
    lamp(rooms, "Bedroom reading lamp", (-.79, 3.57, 3.70), "f6b58b", 0, 4.0, 2.3, length=.20, mount=(3.90, 3.87))


def market_sign(group):
    box("Painted entry signboard on tie beam", (0, -4.36, 3.35), (2.43, .12, .48), "trim", group, rounding=.037)
    curve = bpy.data.curves.new("Market entry lettering", "FONT")
    curve.body = "M A R K E T"
    curve.size = .255
    curve.align_x = "CENTER"
    curve.extrude = .003
    obj = bpy.data.objects.new("Painted market lettering", curve)
    group.objects.link(obj)
    obj.location = (0, -4.428, 3.257)
    obj.rotation_euler.x = math.pi / 2
    obj.data.materials.append(materials["ivory"])
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")


def market_detail():
    shell = section("05 - Eaves, stall fronts and covered loading")
    for x, z in ((-7.08, 3.06), (7.08, 3.11), (2.62, 5.88)):
        beam("Folded zinc edge", (x, -4.94 if z < 4 else -5.13, z),
             (x, 5.18 if z < 4 else 5.25, z), (.09, .12), "seam", shell)
    pitches = [(-7.085, 3.076, -1.98, 4.104), (1.97, 4.108, 7.085, 3.129),
               (-2.31, 4.844, 2.63, 5.902)]
    for i in range(14):
        y = -4.79 + i * .75
        for a, h, b, k in pitches:
            beam("Standing seam in formed roof", (a, y, h), (b, y, k), (.046, .044), "seam", shell, fine=True)
    for x in (-6.62, 6.62):
        for y in (-4.17, -1.21, 1.75, 4.72):
            box("Metal shoe on masonry pier", (x, y, .38), (.25, .26, .31), "stone2", shell, rounding=.022)
    for x in (-1.97, 1.97):
        for y in (-4.17, -1.21, 1.75, 4.72):
            box("Column connection strap", (x, y, 3.72), (.28, .238, .28), "metal", shell, rounding=.012, fine=True)
    for x in (-7.09, 7.09):
        beam("Rainwater gutter", (x, -4.84, 3.012), (x, 5.13, 3.012), (.105, .107), "metal", shell)
        beam("Gutter downpipe", (x, 4.76, 2.98), (x, 4.76, .25), (.083, .086), "metal", shell)
    for i in range(15):
        y = -3.78 + i * .387
        box("West lower bay picket", (-6.64, y, 1.20), (.080, .075, .34), "wood", shell, fine=True)
        box("East lower bay picket", (6.64, y, .98), (.080, .075, .35), "wood", shell, fine=True)
    for x, z in ((-6.64, 1.38), (6.64, 1.17)):
        beam("Side bay handrail", (x, -4.0, z), (x, 1.97, z), (.13, .09), "wood", shell)
    for y in (2.38, 4.65):
        box("Receiving bay door frame", (-6.68, y, 1.42), (.14, .13, 2.35), "wood", shell, rounding=.014)
    box("Side sliding loading door", (-6.64, 4.31, 1.43), (.105, .68, 2.26), "trim", shell, rounding=.025)
    beam("Sliding door rail", (-6.75, 2.42, 2.61), (-6.75, 4.68, 2.61), (.082, .09), "metal", shell)
    for i in range(8):
        x = 3.59 + i * .294
        box("Courtyard bench slat", (x, -4.914, .69), (.271, .435, .058), "wood", shell, rounding=.017)
    for y in (-5.72, -5.04):
        box("Splayed sandstone entry nosing", (.020, y, .191), (4.00, .055, .018),
            "stone2", shell, rounding=.009, fine=True)
    for x in (-5.9, -3.75, 3.86, 5.75):
        box("Channeled paver strip", (x, -3.70, .192), (.023, 1.71, .005), "stone3", shell, fine=True)
    flowerpot(shell, 6.23, -5.05, .16, .32, 18)
    box("Rear approach landing", (.04, 5.311, .101), (4.07, .878, .177), "ground", shell, rounding=.01)
    box("Raised bed at rear aisle", (-3.38, 5.27, .364), (1.40, .72, .44), "stone", shell, rounding=.05)
    box("Soil within market rear bed", (-3.38, 5.27, .591), (1.28, .60, .036), "soil", shell)
    for i in range(6):
        orb("Market rear bed shrub", (-3.88 + i * .2, 5.26, .70), (.22, .25, .24), "leaf" if i % 2 else "leaf2", shell, fine=False)
    flowerpot(shell, 5.92, 4.51, .19, .28, 32)
    market_sign(shell)

    stalls = section("06 - Produce, pantry, hot food and work lights")
    rng = random.Random(53)
    for j, x in enumerate((-5.56, -4.51, -3.46)):
        box("Produce tray wood facing", (x + .42, -3.34, 1.294),
            (.84, .064, .16), "wood", stalls, rounding=.017)
        box("Produce tray inner shadow", (x + .42, -3.03, 1.343),
            (.70, .49, .040), "soil", stalls, rounding=.018)
        for k in range(20):
            row, col = divmod(k, 5)
            xx = x + .13 + col * .145 + rng.uniform(-.024, .024)
            yy = -3.226 + row * .122 + rng.uniform(-.018, .018)
            r = rng.uniform(.070, .104)
            orb("Produce in front tray", (xx, yy, 1.369 + .016 * row),
                (r, r, r * (.83 if j == 0 else 1.06)), ("red", "fruit", "greens")[j], stalls)
        box("Produce card", (x + .41, -3.375, 1.394), (.246, .034, .124), "ivory", stalls, rounding=.015)
    for z in (.89, 1.22, 1.52):
        for i in range(14):
            x = -5.54 + .213 * i
            r = rng.uniform(.056, .093)
            height = rng.uniform(.13, .224)
            mat = ("ivory", "linen", "cloth", "fruit")[i % 4]
            cylinder("Pantry jar", (x, -.55, z + height / 2), r, height, mat, stalls, sides=8, fine=True)
            cylinder("Wood jar lid", (x, -.55, z + height + .016), r * 1.03, .032, "wood", stalls, sides=8, fine=True)
    box("Queue and pickup counter wood facing", (2.401, -2.20, .79), (.1, 3.00, .64),
        "trim", stalls, rounding=.022)
    for i in range(14):
        y = -3.62 + i * .216
        box("Pickup counter broad fluting", (2.338, y, .78), (.051, .042, .607),
            "wood", stalls, rounding=.008, fine=True)
    box("Hot food serving ledge", (2.744, -2.21, 1.196), (.76, 3.15, .072),
        "wood", stalls, rounding=.026)
    box("Working griddle", (4.94, -2.74, 1.17), (1.02, .95, .058), "dark", stalls, rounding=.018)
    box("Exhaust coupling through the zinc roof", (4.92, -2.78, 3.416), (.32, .32, .257), "metal", stalls, rounding=.018)
    box("Raised rain cowl above the hot stall", (4.92, -2.78, 3.665), (.43, .42, .30), "seam", stalls, rounding=.025)
    for y in (-2.90, -2.55):
        cylinder("Cast pot on the hot line", (4.90, y, 1.318), .166, .23, "metal", stalls, top=.18)
        cylinder("Pot lid", (4.90, y, 1.442), .184, .038, "dark", stalls)
        cylinder("Pot handle", (4.90, y, 1.478), .040, .055, "metal", stalls, fine=True)
    for x in (2.60, 2.84):
        for z in (1.246, 1.274, 1.301):
            cylinder("Stack of serving bowls", (x, -1.14, z), .089, .053, "ivory", stalls, top=.125, fine=True)
    for i in range(4):
        x, y = -5.84 + i % 2 * .71, 3.68 + i // 2 * .42
        box("Receiving crate", (x, y, .425), (.61, .38, .43), "fitting", stalls, rounding=.026)
        box("Crate strap", (x, y - .203, .43), (.063, .028, .435), "wood", stalls, fine=True)
    for i in range(9):
        x = -5.79 + i * .373
        box("Canvas produce shade", (x, -2.88, 2.43), (.363, .92, .073), "shade" if i % 3 else "cloth", stalls,
            rounding=.012)
        box("Canvas rolled hem", (x, -3.347, 2.416), (.36, .064, .108), "shade" if i % 3 else "cloth", stalls,
            rounding=.018)
    for x in (-6.26, -2.50):
        box("Shade support rising from counter", (x, -2.39, 1.75), (.10, .10, 1.84), "wood", stalls, rounding=.014)
        beam("Counter shade stay", (x, -3.31, 2.41), (x, -2.30, 2.65), (.062, .062), "metal", stalls)
    beam("Continuous rail behind produce shade", (-6.26, -2.42, 2.59), (-2.50, -2.42, 2.59), (.089, .106), "wood", stalls)
    beam("Continuous rail holding the front valance", (-6.24, -3.29, 2.49), (-2.49, -3.29, 2.49), (.078, .090), "wood", stalls)
    beam("Hot stall suspended rail", (3.14, -4.17, 3.66), (3.14, -1.21, 3.66), (.092, .108), "wood", stalls)
    beam("Rear aisle lamp carrier", (.09, 1.75, 3.75), (.09, 4.72, 3.75), (.115, .118), "wood", stalls)
    lamp(stalls, "Produce stall pendant", (-4.19, -3.39, 2.21), "ffe4b9", 5.5, 19, 5.6, length=1.60, mount=(-3.31, 2.49), primary=True)
    lamp(stalls, "Pantry pendant", (-4.08, -.92, 2.48), "f9d5a0", 3, 15, 4.9, length=1.55, mount=(-1.21, 3.40))
    lamp(stalls, "Hot-food task light", (3.14, -2.43, 2.49), "ebeed3", 8, 20, 5.8, "cool_lamp", 1.05, mount=(-2.43, 3.66))
    lamp(stalls, "Rear public aisle light", (.09, 2.87, 3.18), "e5ebd3", 2.0, 15, 5.3, "cool_lamp", 1.11, mount=(2.87, 3.75))


def measure(objects):
    graph = bpy.context.evaluated_depsgraph_get()
    bounds = []
    triangles = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(graph)
        geo = evaluated.to_mesh()
        geo.calc_loop_triangles()
        triangles += len(geo.loop_triangles)
        bounds.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
        evaluated.to_mesh_clear()
    return {
        "boundsBlender": [[round(f(point[i] for point in bounds), 5) for i in range(3)] for f in (min, max)],
        "triangles": triangles, "meshObjects": sum(obj.type == "MESH" for obj in objects),
        "anchorsBlender": {obj.name: list(obj.location) for obj in objects if obj.type == "EMPTY"},
    }


def apply_export(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                              export_apply=True, export_extras=True, export_cameras=False, export_lights=False)


def build(source, name, detail, is_house, out):
    global materials
    bpy.ops.wm.open_mainfile(filepath=str(source))
    bpy.context.preferences.filepaths.save_version = 0
    bpy.context.scene.name = name
    materials = palette(is_house)
    recolor_massing(is_house, name)
    detail()
    bpy.context.view_layer.update()
    objects = [obj for obj in bpy.context.scene.objects if obj.type in {"MESH", "EMPTY"}]
    near, far = out / (name + ".glb"), out / (name + "_lod.glb")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.wm.save_as_mainfile(filepath=str(out / (name + ".blend")), compress=True, relative_remap=False)
    metrics = {"near": measure(objects)}
    apply_export(near, objects)
    interior = ("03 - Lower rooms", "08 - Furniture") if is_house else ("06 - Produce",)
    keep = ("Reading seat cushion", "Reading window seat", "Deep linen sofa", "Bed platform",
            "Queue and pickup counter", "Hot food serving", "Produce tray wood", "Canvas produce shade", "Exhaust", "Raised rain cowl")
    lod = []
    for obj in objects:
        if obj.type == "EMPTY":
            lod.append(obj)
            continue
        room = any(group.name.startswith(interior) for group in obj.users_collection)
        fixture = "shade" in obj.name or "diffuser" in obj.name
        if obj.get("near_detail") or (room and not obj.name.startswith(keep) and not fixture):
            continue
        obj.modifiers.clear()
        lod.append(obj)
    bpy.context.view_layer.update()
    metrics["far"] = measure(lod)
    apply_export(far, lod)
    metrics["near"]["bytes"] = near.stat().st_size
    metrics["far"]["bytes"] = far.stat().st_size
    return metrics


if __name__ == "__main__":
    house, market, output = map(lambda arg: Path(arg).resolve(), sys.argv[sys.argv.index("--") + 1:])
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output) as directory:
        scratch = Path(directory)
        report = {
            "west-reading-house": build(house, "west-reading-house", house_detail, True, output),
            "west-bridge-market": build(market, "west-bridge-market", market_detail, False, output),
        }
    (output / "asset-metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
