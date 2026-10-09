"""Exports apps/web/public/models/pokedex-hand.glb: Hand mesh, HandRig and its
three actions (HandRaise, ThumbOpen, HandHold), in the rest pose.

Run inside Blender after rig_hand.py:
    exec(open('assets-src/dex/export_hand.py').read())
"""
import os

import bpy

OUT = os.path.join(os.path.dirname(bpy.data.filepath), "..", "..", "apps", "web", "public", "models", "pokedex-hand.glb")


def export():
    bpy.context.scene.frame_set(1)
    rig = bpy.data.objects["HandRig"]
    hand = bpy.data.objects["Hand"]
    hidden = rig.hide_get()
    rig.hide_set(False)
    keep = rig.animation_data.action
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    rig.select_set(True)
    hand.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=os.path.normpath(OUT), export_format="GLB", use_selection=True,
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_def_bones=False, export_skins=True, export_apply=False, export_yup=True,
        export_materials="EXPORT", export_cameras=False, export_lights=False, export_extras=False,
    )
    rig.animation_data.action = keep
    rig.hide_set(hidden)
    return os.path.getsize(OUT)


SIZE = export()
