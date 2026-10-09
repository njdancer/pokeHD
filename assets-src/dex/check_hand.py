"""Intersection check: hand vs every dex part, frame by frame.

Run inside Blender after rig_hand.py:
    exec(open('assets-src/dex/check_hand.py').read())
    result = check(actions=("HandRaise", "ThumbOpen", "HandHold"))
For ThumbOpen the cover plays CoverOpen on the same frames; HandRaise holds
it closed and HandHold (the open-dex idle) holds it open. Device parts follow the armature's Grip bone, the way the
game parents the dex to the hand.
"""
import bpy
from mathutils.bvhtree import BVHTree

DEVICE_ROOT = "Pokedex"


def _tree(ob, dg, matrix):
    e = ob.evaluated_get(dg)
    m = e.to_mesh()
    verts = [matrix @ v.co for v in m.vertices]
    polys = [tuple(p.vertices) for p in m.polygons]
    e.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)


def _device_parts():
    root = bpy.data.objects[DEVICE_ROOT]
    return [o for o in root.children_recursive if o.type == "MESH"]


def check_frame(dg, grip_matrix=None, where=False):
    hand = bpy.data.objects["Hand"]
    e = hand.evaluated_get(dg)
    m = e.to_mesh()
    hv = [hand.matrix_world @ v.co for v in m.vertices]
    hp = [tuple(p.vertices) for p in m.polygons]
    e.to_mesh_clear()
    ht = BVHTree.FromPolygons(hv, hp)
    hits = {}
    for part in _device_parts():
        mw = part.matrix_world if grip_matrix is None else grip_matrix @ part.matrix_world
        pairs = ht.overlap(_tree(part, dg, mw))
        if pairs:
            if where:
                c = sum((hv[i] for i in hp[pairs[0][0]]), hv[0] * 0) / len(hp[pairs[0][0]])
                hits[part.name] = (len(pairs), tuple(round(x, 4) for x in c))
            else:
                hits[part.name] = len(pairs)
    return hits


def check(actions=("ThumbOpen",)):
    scene = bpy.context.scene
    rig = bpy.data.objects["HandRig"]
    cover = bpy.data.objects["Cover"]
    cover_action = cover.animation_data.action
    report = {}
    saved = (rig.animation_data.action, scene.frame_current)
    for name in actions:
        act = bpy.data.actions[name]
        rig.animation_data.action = act
        cover.animation_data.action = cover_action if name == "ThumbOpen" else None
        if name != "ThumbOpen":  # HandRaise holds it closed, HandHold open
            cover.rotation_euler.z = 0.0 if name == "HandHold" else -3.141592653589793
        f0, f1 = (int(x) for x in act.frame_range)
        bad = {}
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            # dex rides the Grip bone: transform it by the bone's pose delta
            pb = rig.pose.bones["Grip"]
            delta = rig.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted() @ rig.matrix_world.inverted()
            hits = check_frame(dg, delta, where=True)
            if hits:
                bad[f] = hits
        report[name] = bad or "clean"
    cover.animation_data.action = cover_action
    rig.animation_data.action = saved[0]
    scene.frame_set(saved[1])
    return report
