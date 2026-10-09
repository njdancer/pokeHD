"""Voxel variant of the dex (p2-dex): cube housing, smooth screen/buttons/lens.

Run inside Blender with assets-src/dex/pokedex.blend open:
    exec(open('assets-src/dex/voxel_dex.py').read())
Copies the Pokedex hierarchy into the `PokedexVoxel` collection as `<name>.vox`
and rebuilds only the housing (SHELL) as cubes on a VOXEL grid aligned to
the origin, so the front (y=0) and back faces stay where the smooth parts expect
them. Each cube face takes the material of the nearest original face.
export_voxel() writes apps/web/public/models/pokedex-voxel.glb with the original
object names, so it drops in for pokedex.glb (same Screen quad, CoverOpen).
"""
import math
import os

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

VOXEL = 0.0045  # 3 mm also tried: reads as noise at screen size
SHELL = ("Body", "BodyTop", "Cover", "Hinge", "HingeTop", "HingeBottom")
SUFFIX = ".vox"
COLL_NAME = "PokedexVoxel"
SHADES = (("Light", 1.25), ("Dark", 0.78))  # per-cube shade variants of Red
DIRS = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))


def shade_material(base, tag, factor):
    name = f"{base.name}Vox{tag}"
    m = bpy.data.materials.get(name)
    if m is None:
        m = base.copy()
        m.name = name
    p = m.node_tree.nodes["Principled BSDF"]
    src = base.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value
    col = tuple(min(1.0, c * factor) for c in src[:3]) + (1.0,)
    p.inputs["Base Color"].default_value = col
    m.diffuse_color = col
    return m


def voxel_mesh(src):
    me = src.data
    verts = [v.co.copy() for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    lo = Vector(tuple(min(v[i] for v in verts) for i in range(3)))
    hi = Vector(tuple(max(v[i] for v in verts) for i in range(3)))
    rng = [range(math.floor(lo[i] / VOXEL), math.ceil(hi[i] / VOXEL)) for i in range(3)]
    cells = {}
    for i in rng[0]:
        for j in rng[1]:
            for k in rng[2]:
                c = Vector(((i + 0.5) * VOXEL, (j + 0.5) * VOXEL, (k + 0.5) * VOXEL))
                loc, normal, idx, _ = tree.find_nearest(c)
                if loc is not None and (loc - c).dot(normal) > 0:
                    cells[(i, j, k)] = me.polygons[idx].material_index
    vmap, out_v, out_f, mats, cell_of_face = {}, [], [], [], []

    def vid(p):
        if p not in vmap:
            vmap[p] = len(out_v)
            out_v.append(Vector(p) * VOXEL)
        return vmap[p]

    for (i, j, k), mat in cells.items():
        for d in DIRS:
            if (i + d[0], j + d[1], k + d[2]) in cells:
                continue
            ax = next(a for a in range(3) if d[a])
            u, w = [a for a in range(3) if a != ax]
            base = [i, j, k]
            if d[ax] > 0:
                base[ax] += 1
            quad = []
            for du, dw in ((0, 0), (1, 0), (1, 1), (0, 1)):
                p = list(base)
                p[u] += du
                p[w] += dw
                quad.append(vid(tuple(p)))
            # wind outward
            if (d[ax] > 0) != ((ax == 1)):
                quad.reverse()
            out_f.append(quad)
            mats.append(mat)
            cell_of_face.append((i, j, k))
    new = bpy.data.meshes.new(me.name + SUFFIX)
    new.from_pydata([tuple(v) for v in out_v], [], out_f)
    for m in me.materials:
        new.materials.append(m)
    # Red cubes get one of three close shades so the grid reads at a glance.
    red = next((i for i, m in enumerate(me.materials) if m and m.name == "Red"), None)
    variants = []
    if red is not None:
        for tag, factor in SHADES:
            new.materials.append(shade_material(me.materials[red], tag, factor))
            variants.append(len(new.materials) - 1)
    for p, m, cell in zip(new.polygons, mats, cell_of_face):
        if m == red and variants:
            h = (cell[0] * 73856093 ^ cell[1] * 19349663 ^ cell[2] * 83492791) % 5
            m = variants[0] if h == 0 else variants[1] if h == 1 else m
        p.material_index = m
        p.use_smooth = False
    new.validate()
    # outward normals regardless of winding guesswork
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(new)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(new)
    bm.free()
    return new, len(cells)


def build(offset=Vector((0.0, 0.0, 0.0))):
    scene = bpy.context.scene
    coll = bpy.data.collections.get(COLL_NAME)
    if coll:
        for o in list(coll.objects):
            data = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if isinstance(data, bpy.types.Mesh) and data.users == 0 and data.name.endswith(SUFFIX):
                bpy.data.meshes.remove(data)
    else:
        coll = bpy.data.collections.new(COLL_NAME)
        scene.collection.children.link(coll)
    root = bpy.data.objects["Pokedex"]
    copies = {}
    stats = {}
    for src in [root] + list(root.children_recursive):
        dup = src.copy()
        dup.name = src.name + SUFFIX
        if src.name in SHELL:
            dup.data, stats[src.name] = voxel_mesh(src)
        coll.objects.link(dup)
        copies[src.name] = dup
    for name, dup in copies.items():
        src = bpy.data.objects[name]
        if src.parent:
            dup.parent = copies[src.parent.name]
            dup.matrix_parent_inverse = src.matrix_parent_inverse.copy()
    copies["Pokedex"].location = offset
    return stats


def export_voxel():
    """Write pokedex-voxel.glb with the original names (renames back after)."""
    out = os.path.normpath(os.path.join(
        os.path.dirname(bpy.data.filepath), "..", "..", "apps", "web", "public", "models", "pokedex-voxel.glb"))
    coll = bpy.data.collections[COLL_NAME]
    vox = list(coll.objects)
    root = bpy.data.objects["Pokedex" + SUFFIX]
    keep_loc = root.location.copy()
    root.location = (0, 0, 0)
    originals = {o.name[: -len(SUFFIX)]: bpy.data.objects[o.name[: -len(SUFFIX)]] for o in vox}
    try:
        for name, o in originals.items():
            o.name = name + ".smooth"
        for o in vox:
            o.name = o.name[: -len(SUFFIX)]
        for o in bpy.context.selected_objects:
            o.select_set(False)
        for o in vox:
            o.hide_set(False)
            o.select_set(True)
        bpy.ops.export_scene.gltf(
            filepath=out, export_format="GLB", use_selection=True,
            export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
            export_apply=True, export_yup=True, export_materials="EXPORT",
            export_cameras=False, export_lights=False, export_extras=False,
        )
    finally:
        for o in vox:
            o.name = o.name + SUFFIX
        for name, o in originals.items():
            o.name = name
        root.location = keep_loc
    return os.path.getsize(out)
