"""Rigs the Hand mesh from build_hand.py and authors its actions.

Run inside Blender after build_hand.py:
    exec(open('assets-src/dex/rig_hand.py').read())

Armature `HandRig` (object at the origin, rest pose = holding the closed dex):
  Root    forearm, parent of everything; HandRaise and HandHold move it
  Palm    palm
  Grip    non-deforming, at the dex origin. The dex rides it:
          dexWorld = Grip.matrixWorld * inverse(Grip rest matrixWorld)
  Thumb0..3, Index1..3, Middle1..3, Ring1..3, Pinky1..3
Actions (24 fps):
  HandRaise  1-20  rises into frame holding the closed dex
  ThumbOpen  1-24  same frames as CoverOpen: the thumb rides the cover's free
                   edge open, then rests on the body below the screen
  HandHold   1-72  looping idle, thumb in its open-dex rest
"""
import math

import bpy
from mathutils import Euler, Matrix, Vector

H = bpy.app.driver_namespace["pokehd_hand"]
CH, W, K, D, T, FA, THENAR = (H[k] for k in ("chains", "W", "K", "D", "T", "FA", "THENAR"))
PALM_N = Vector((0, -1, 0))
COLL = bpy.data.collections["Hand"]
SCENE = bpy.context.scene


def cover_angle(frame):
    """CoverOpen's Z rotation at a frame (closed = -pi)."""
    act = bpy.data.objects["Cover"].animation_data.action
    for layer in act.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    if fc.data_path == "rotation_euler" and fc.array_index == 2:
                        return fc.evaluate(frame)
    raise RuntimeError("CoverOpen has no Z rotation curve")


def cover_to_world(local, frame, z):
    """A point given in the cover's own (open-pose) XY frame, at a frame."""
    a = cover_angle(frame)
    x, y = local
    return Vector((x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a), z))


def clear_old():
    for name in ("HandRig", "ThumbTarget"):
        ob = bpy.data.objects.get(name)
        if ob:
            data = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if data is not None and data.users == 0:
                bpy.data.armatures.remove(data)
    for name in ("HandRaise", "ThumbOpen", "HandHold"):
        act = bpy.data.actions.get(name)
        if act:
            bpy.data.actions.remove(act)


def build_armature():
    arm = bpy.data.armatures.new("HandRig")
    rig = bpy.data.objects.new("HandRig", arm)
    COLL.objects.link(rig)
    arm.display_type = "STICK"
    rig.show_in_front = True
    with bpy.context.temp_override(active_object=rig, object=rig, selected_objects=[rig]):
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="EDIT")
        eb = arm.edit_bones

        def bone(name, head, tail, parent=None, connect=False, roll_to=PALM_N, deform=True):
            b = eb.new(name)
            b.head, b.tail = head, tail
            b.align_roll(roll_to)
            if parent:
                b.parent = eb[parent]
                b.use_connect = connect
            b.use_deform = deform
            return b

        bone("Root", W + 0.07 * FA, W)
        bone("Palm", W, K, "Root", True)
        bone("Grip", Vector((0, 0, 0)), Vector((0, 0, 0.03)), "Palm", roll_to=Vector((0, -1, 0)), deform=False)
        th = CH["Thumb"][0]
        bone("Thumb0", THENAR, th[0], "Palm", roll_to=Vector((1, 0, 0)))
        for i in range(3):
            bone(f"Thumb{i + 1}", th[i], th[i + 1], f"Thumb{i}", True, roll_to=Vector((1, 0, 0)))
        for name in ("Index", "Middle", "Ring", "Pinky"):
            ch = CH[name][0]
            for i in range(3):
                bone(f"{name}{i + 1}", ch[i], ch[i + 1], "Palm" if i == 0 else f"{name}{i}", i > 0)
        bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def skin(rig):
    hand = bpy.data.objects["Hand"]
    hand.parent = None
    for m in list(hand.modifiers):
        hand.modifiers.remove(m)
    hand.vertex_groups.clear()
    for o in bpy.context.selected_objects:
        o.select_set(False)
    hand.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    # The cuff is cloth on the forearm: give it wholly to Root.
    sleeve = [p for p in hand.data.polygons if p.material_index == 1]
    vids = sorted({v for p in sleeve for v in p.vertices})
    for g in hand.vertex_groups:
        g.remove(vids)
    root = hand.vertex_groups.get("Root") or hand.vertex_groups.new(name="Root")
    root.add(vids, 1.0, "REPLACE")
    for o in bpy.context.selected_objects:
        o.select_set(False)


def new_action(rig, name):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    return act


def key_bone(rig, bone, frame, loc=None, rot=None):
    pb = rig.pose.bones[bone]
    pb.rotation_mode = "QUATERNION"
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame, group=bone)
    if rot is not None:
        pb.rotation_quaternion = Euler(rot).to_quaternion() if len(rot) == 3 else rot
        pb.keyframe_insert("rotation_quaternion", frame=frame, group=bone)


def reset_pose(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)


THUMB1_STIFFNESS = 0.75
THUMB_BONES = ("Thumb0", "Thumb1", "Thumb2", "Thumb3")
TIP_Z = 0.017
# (frame, ("cover", (x, y)) in the cover's frame | ("world", (x, y, z)))
THUMB_PATH = [
    (1, ("cover", (0.088, 0.0245))),  # resting on the closed cover's bottom-left corner
    (2, ("cover", (0.1010, 0.0215))),  # slides to the free edge
    (3, ("cover", (0.1075, 0.0085))),  # round the edge
    (4, ("cover", (0.1075, -0.0040))),  # catches the inner lip
    (5, ("cover", (0.1065, -0.0070))),  # pushes it outward
    (6, ("world", (-0.1180, -0.0340, TIP_Z))),  # flicks past the edge; the cover swings on
    (8, ("world", (-0.1160, -0.0330, 0.016))),
    (12, ("world", (-0.1010, -0.0250, 0.015))),
    (16, ("world", (-0.0850, -0.0145, 0.015))),  # settles below the round button
    (24, ("world", (-0.0850, -0.0145, 0.015))),
]


def thumb_open(rig):
    tgt = bpy.data.objects.new("ThumbTarget", None)
    tgt.empty_display_size = 0.006
    COLL.objects.link(tgt)
    pb = rig.pose.bones["Thumb3"]
    ik = pb.constraints.new("IK")
    ik.target = tgt
    ik.chain_count = 3
    ik.use_tail = True
    # keep the base knuckle out past the dex's left edge; the outer joints reach
    b1 = rig.pose.bones["Thumb1"]
    b1.ik_stiffness_x = b1.ik_stiffness_y = b1.ik_stiffness_z = THUMB1_STIFFNESS
    tgt.animation_data_create()
    tgt_act = bpy.data.actions.new("ThumbTargetPath")
    tgt.animation_data.action = tgt_act
    for frame, (space, p) in THUMB_PATH:
        tgt.location = cover_to_world(p, frame, TIP_Z) if space == "cover" else Vector(p)
        tgt.keyframe_insert("location", frame=frame)
    reset_pose(rig)
    act = new_action(rig, "ThumbOpen")
    # bake the IK into plain rotations (visual keys), dropping the constraint
    for o in bpy.context.selected_objects:
        o.select_set(False)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    for b in rig.pose.bones:
        sel = b.name in THUMB_BONES
        if hasattr(b, "select"):
            b.select = sel
        else:
            b.bone.select = sel
    bpy.ops.nla.bake(
        frame_start=1, frame_end=24, only_selected=True, visual_keying=True,
        clear_constraints=True, use_current_action=True, bake_types={"POSE"},
        channel_types={"ROTATION"},
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.data.objects.remove(tgt, do_unlink=True)
    bpy.data.actions.remove(tgt_act)
    rig.animation_data.action = act
    return act


def smooth(t):
    return t * t * (3 - 2 * t)


def hand_raise(rig, thumb_rest):
    reset_pose(rig)
    act = new_action(rig, "HandRaise")
    # Root's local frame: Y along the forearm toward the wrist.
    keys = [
        (1, (0.0, -0.17, 0.0), (math.radians(-28), 0, math.radians(6))),
        (13, (0.0, 0.006, 0.0), (math.radians(2.5), 0, 0)),
        (20, (0.0, 0.0, 0.0), (0, 0, 0)),
    ]
    for f, loc, rot in keys:
        key_bone(rig, "Root", f, loc=loc, rot=rot)
    for f in (1, 20):
        for n, q in thumb_rest.items():
            key_bone(rig, n, f, rot=q)
    return act


def hand_hold(rig, thumb_open_pose):
    reset_pose(rig)
    act = new_action(rig, "HandHold")
    for f in range(1, 74, 6):
        t = (f - 1) / 72 * 2 * math.pi
        loc = (0.0, 0.0012 * math.sin(t), 0.0008 * math.sin(2 * t))
        rot = (math.radians(0.7) * math.sin(t + 0.6), 0, math.radians(0.5) * math.sin(t))
        key_bone(rig, "Root", f, loc=loc, rot=rot)
        for n, q in thumb_open_pose.items():
            if f in (1, 73):
                key_bone(rig, n, f, rot=q)
    for fc in act.layers[0].strips[0].channelbags[0].fcurves:
        fc.modifiers.new("CYCLES")
    act.use_frame_range = True
    act.frame_range = (1, 72)
    return act


def run():
    clear_old()
    rig = build_armature()
    skin(rig)
    open_act = thumb_open(rig)
    SCENE.frame_set(24)
    open_pose = {n: rig.pose.bones[n].rotation_quaternion.copy() for n in THUMB_BONES}
    closed_pose = {n: (1, 0, 0, 0) for n in THUMB_BONES}
    hand_raise(rig, closed_pose)
    hand_hold(rig, open_pose)
    rig.animation_data.action = open_act
    SCENE.frame_set(1)
    return rig


RIG = run()
