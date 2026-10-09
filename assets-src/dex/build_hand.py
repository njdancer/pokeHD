"""Builds the stylised glove hand that holds the dex (p2-dex).

Run inside Blender with assets-src/dex/pokedex.blend open:
    exec(open('assets-src/dex/build_hand.py').read())
It (re)creates the `Hand` collection: the `Hand` mesh and nothing else.
The rig and actions come from rig_hand.py.

Coordinates are metres in the device's frame: closed dex spans
x -0.094..-0.005, y -0.009 (cover face)..0.015 (back), z 0..0.14; the hinge
axis is the Z axis and the cover swings forward (-y) and right.
It is a chunky cartoon left glove: the palm sits under the lower-left of the
back, the fingers run up-right across the back with their tips peeking past
the hinge edge (behind it, clear of the cover's swing), and the thumb wraps
the free (left) edge to rest by the front's bottom-left corner.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

A = math.radians(65)
D = Vector((math.sin(A), 0, math.cos(A)))  # finger direction
T = Vector((-math.cos(A), 0, math.sin(A)))  # toward the thumb
B = Vector((0, -1, 0))  # palm normal, toward the device back
W = Vector((-0.112, 0.042, -0.036))  # wrist
K = W + 0.080 * D  # knuckle line centre
FA = Vector((-0.30, -0.42, -0.86)).normalized()  # forearm, toward the player
PALM_Y = 0.0285  # finger centres: back (0.015) + radius + a hair

# name: (knuckle, fan angle toward thumb, length, radius)
FINGERS = {
    "Index": (K + 0.027 * T, math.radians(5), 0.058, 0.0118),
    "Middle": (K + 0.004 * T + 0.004 * D, math.radians(0), 0.064, 0.0122),
    "Ring": (K - 0.019 * T, math.radians(-5), 0.058, 0.0116),
    "Pinky": (K - 0.040 * T - 0.006 * D, math.radians(-10), 0.046, 0.0104),
}
SEGS = (0.43, 0.31, 0.26)
THENAR = W + 0.026 * D + 0.026 * T + Vector((0, -0.006, 0))
# Thumb wraps the left edge; its tip rests on the closed cover's face.
THUMB = [
    Vector((-0.113, 0.026, -0.016)),
    Vector((-0.123, 0.006, 0.002)),
    Vector((-0.114, -0.0180, 0.012)),
    Vector((-0.088, -0.0245, 0.017)),
]
THUMB_R = 0.0130


def finger_chains():
    chains = {}
    for name, (base, ang, length, r) in FINGERS.items():
        d = (D * math.cos(ang) + T * math.sin(ang)).normalized()
        p = base.copy()
        p.y = PALM_Y
        chain = [p.copy()]
        for i, s in enumerate(SEGS):
            p = p + d * length * s
            p.y = PALM_Y - 0.0008 * (i + 1)  # fingertips press lightly on the back
            if p.x > 0.012:  # past the hinge: curl round the edge, behind the cover
                p.y -= min(0.004, (p.x - 0.012) * 0.4)
            chain.append(p.copy())
        chains[name] = (chain, r)
    chains["Thumb"] = ([v.copy() for v in THUMB], THUMB_R)
    return chains


def material(name, rgba, rough):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = rgba
    p.inputs["Roughness"].default_value = rough
    m.diffuse_color = rgba
    return m


def skin_chain(name, pts, radii):
    """One unbranched skin tube; branches fuse later in the voxel remesh."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in pts], [(i, i + 1) for i in range(len(pts) - 1)], [])
    ob = bpy.data.objects.new(name, me)
    sk = ob.modifiers.new("Skin", "SKIN")
    sk.use_smooth_shade = True
    for i, sv in enumerate(me.skin_vertices[0].data):
        sv.radius = (radii[i], radii[i])
    me.skin_vertices[0].data[0].use_root = True
    ob.modifiers.new("Subd", "SUBSURF").levels = 2
    return ob


def skeleton_objects(chains):
    palm_mid = W + 0.040 * D
    obs = [
        skin_chain("Forearm", [W + 0.064 * FA, W, palm_mid], [0.0255, 0.0255, 0.028]),
        skin_chain("Thenar", [W + 0.010 * D, THENAR], [0.024, 0.024]),
    ]
    for name, (chain, r) in chains.items():
        if name == "Thumb":
            pts = [THENAR] + chain
            radii = [0.024] + [r * (1.08 - 0.07 * j) for j in range(len(chain))]
        else:
            root = chain[0] - 0.018 * (chain[1] - chain[0]).normalized()
            pts = [root] + chain
            radii = [r * 1.05] + [r * (1.0 - 0.06 * j) for j in range(len(chain))]
        obs.append(skin_chain(name, pts, radii))
    return obs


def palm_mesh():
    bm = bmesh.new()
    vs = []
    for d, hw, ht in ((0.010, 0.030, 0.013), (0.080, 0.042, 0.0145)):
        for t in (-hw, hw):
            for b in (-ht, ht):
                c = W + d * D + (t - 0.002) * T
                c.y = PALM_Y + 0.003
                vs.append(bm.verts.new(c + b * B))

    def v(di, ti, bi):
        return vs[di * 4 + ti * 2 + bi]

    for f in (
        (v(0, 0, 0), v(0, 1, 0), v(0, 1, 1), v(0, 0, 1)),
        (v(1, 0, 0), v(1, 0, 1), v(1, 1, 1), v(1, 1, 0)),
        (v(0, 0, 0), v(0, 0, 1), v(1, 0, 1), v(1, 0, 0)),
        (v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1)),
        (v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)),
        (v(0, 0, 1), v(0, 1, 1), v(1, 1, 1), v(1, 0, 1)),
    ):
        bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("PalmBlock")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("PalmBlock", me)
    bv = ob.modifiers.new("Bevel", "BEVEL")
    bv.width = 0.013
    bv.segments = 3
    ob.modifiers.new("Subd", "SUBSURF").levels = 2
    return ob


def sleeve_bmesh(bm):
    """Blue cuff around the forearm, appended to bm with material index 1."""
    start = W + 0.024 * FA
    length = 0.036
    sb = bmesh.new()
    bmesh.ops.create_cone(sb, cap_ends=False, segments=24, radius1=0.0285, radius2=0.0305, depth=length)
    bmesh.ops.translate(sb, verts=sb.verts, vec=(0, 0, length / 2))
    rot = Vector((0, 0, 1)).rotation_difference(FA).to_matrix().to_4x4()
    bmesh.ops.transform(sb, verts=sb.verts, matrix=Matrix.Translation(start) @ rot)
    tmp = bpy.data.meshes.new("SleeveTmp")
    sb.to_mesh(tmp)
    sb.free()
    so = bpy.data.objects.new("SleeveTmp", tmp)
    sol = so.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.004
    sol.offset = 1
    sol.use_rim = True
    bv = so.modifiers.new("Bevel", "BEVEL")
    bv.width = 0.0015
    bv.segments = 2
    bv.limit_method = "ANGLE"
    return so


def evaluated_into(bm, ob, coll, mat_index):
    coll.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    e = ob.evaluated_get(dg)
    m = e.to_mesh()
    m.transform(ob.matrix_world)
    before = len(bm.faces)
    bm.from_mesh(m)
    bm.faces.ensure_lookup_table()
    for f in bm.faces[before:]:
        f.material_index = mat_index
    e.to_mesh_clear()
    me = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)


def apply_mod(ob, mod):
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def build():
    scene = bpy.context.scene
    coll = bpy.data.collections.get("Hand") or bpy.data.collections.new("Hand")
    if coll.name not in scene.collection.children:
        scene.collection.children.link(coll)
    for o in list(coll.objects):
        if o.type == "MESH":
            me = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if me.users == 0:
                bpy.data.meshes.remove(me)

    chains = finger_chains()
    bm = bmesh.new()
    for sk in skeleton_objects(chains):
        evaluated_into(bm, sk, coll, 0)
    evaluated_into(bm, palm_mesh(), coll, 0)
    me = bpy.data.meshes.new("HandMesh")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Hand", me)
    coll.objects.link(ob)
    me.materials.append(material("GloveGreen", (0.10, 0.42, 0.16, 1), 0.65))
    me.materials.append(material("SleeveBlue", (0.05, 0.16, 0.55, 1), 0.75))

    rm = ob.modifiers.new("Remesh", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = 0.0011
    apply_mod(ob, rm)
    sm = ob.modifiers.new("Smooth", "CORRECTIVE_SMOOTH")
    sm.iterations = 6
    sm.use_only_smooth = True
    apply_mod(ob, sm)
    dec = ob.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = min(1.0, 4600 / max(1, len(me.polygons)))
    apply_mod(ob, dec)

    # cuff joins as a separate shell (it overlaps the glove's forearm)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    evaluated_into(bm, sleeve_bmesh(bm), coll, 1)
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob, chains


HAND, CHAINS = build()
bpy.app.driver_namespace["pokehd_hand"] = dict(
    chains=CHAINS, W=W, K=K, D=D, T=T, FA=FA, THENAR=THENAR
)
