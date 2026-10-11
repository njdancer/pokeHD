"""Exports the Pokédex with a taller, phone-shaped screen (p2-dex, Nick 2026-10-11: "if you were
writing Pokémon today it would probably look like a smart phone"). A deliberate departure from
the anime's square screen.

The body is cut through the middle of the screen and everything above the cut moves up, so the
screen, its bezel, the body and the hinge grow while the top band (lens, lights) and the
buttons below the screen keep their size. The cover grows by the same amount, split between two
cuts that miss its keys and display (below the keypad, and between the keypad and the display),
so its inside stays evenly spaced and it still lines up with the body when shut. Moving along z
only, which the cover's hinge turns about, so the CoverOpen action is untouched. The screen
quad keeps its UVs, so model.ts finds its corners as before.

The width stays 4.6 cm; each variant sets the screen's width:height.

Run with Blender 5.2 (or the bpy 5.2 module) from the repo root; it doesn't save the .blend:
    blender -b assets-src/dex/pokedex.blend -P assets-src/dex/tall_screen.py
    python assets-src/dex/tall_screen.py            # with `pip install bpy==5.2.2`
"""
import os

import bpy

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
BLEND = os.path.join(ROOT, "assets-src", "dex", "pokedex.blend")
OUT = os.path.join(ROOT, "apps", "web", "public", "models")

# Screen width over height. The anime's (and pokedex.glb's) is 4.6 × 3.9 cm, about 1.18.
VARIANTS = {"3x4": 3 / 4, "9x16": 9 / 16, "9x19": 9 / 19.5}

SCREEN_W = 0.046
SCREEN_H = 0.039
# Heights in metres (Blender z, the device standing up). The body's cut crosses the screen and
# nothing else small; the cover's miss its keys (5.0–7.4 cm), white keys (3.7–4.5) and display
# (7.9–10.5).
BODY_CUTS = [(0.0765, 1.0)]
COVER_CUTS = [(0.0475, 0.5), (0.0765, 0.5)]


def stretch(ob, cuts, grow):
    """Moves each vertex of `ob` up by its share of `grow` for every cut below it (world z)."""
    me = ob.data
    to_world = ob.matrix_world
    to_local = to_world.inverted()
    for v in me.vertices:
        w = to_world @ v.co
        w.z += sum(share * grow for z, share in cuts if w.z > z)
        v.co = to_local @ w
    me.update()


def build(aspect):
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    scene = bpy.context.scene
    scene.frame_set(1)
    grow = SCREEN_W / aspect - SCREEN_H
    body = bpy.data.objects["Body"]
    cover = bpy.data.objects["Cover"]
    done = set()
    for top, cuts in ((cover, COVER_CUTS), (body, BODY_CUTS)):
        for ob in [top, *top.children_recursive]:
            if ob.type != "MESH" or ob.name in done:
                continue
            # A mesh shared with another object (the voxel copy's) is its own copy here.
            if ob.data.users > 1:
                ob.data = ob.data.copy()
            stretch(ob, cuts, grow)
            done.add(ob.name)
    return grow


def export(path):
    root = bpy.data.objects["Pokedex"]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in [root, *root.children_recursive]:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_apply=True, export_yup=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_extras=False,
    )


def main():
    for name, aspect in VARIANTS.items():
        grow = build(aspect)
        path = os.path.join(OUT, f"pokedex-{name}.glb")
        export(path)
        print(f"{name}: screen 4.6 × {(SCREEN_H + grow) * 100:.2f} cm, body +{grow * 100:.2f} cm, {os.path.getsize(path)} bytes")


main()
