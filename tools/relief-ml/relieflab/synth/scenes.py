import os
"""Random scenes of small game-like objects, and random Game Boy styles to render them in.

Ranges come from calibrating against real ROM art (calibrate.py):
- light from above and front-left (boulder fit az 15-60, el 50-70; cast shadows fall right/down)
- tops and floors are bright and almost never black; black is outlines and creases
- big flat areas carry material texture (stripes, bricks, dither) that says nothing about shape
"""
import numpy as np
from .render import Prim, Scene, rot_y, rot_x, rot_z

ALB = [0.97, 0.72, 0.5, 0.3]
import os as _os
ROOM_SHARE = float(_os.environ.get('ROOM_SHARE', '0'))
WHITE_SHARE = float(_os.environ.get('WHITE_SHARE', '0'))  # creature parts drawn flat white


# ---------- textures (albedo modulation in local coords) ----------

def tex_stripes(axis, period, width, dark):
    def f(q, a):
        on = (np.floor(q[:, axis] / period * 1.0) % 1 == 0) & ((q[:, axis] % period) < width)
        return np.where(on, a * dark, a)
    return f


def tex_bricks(h, w, dark):
    def f(q, a):
        row = np.floor(q[:, 1] / h)
        x = q[:, 0] + (row % 2) * w / 2
        m = ((q[:, 1] % h) < 0.6) | ((x % w) < 0.6)
        return np.where(m, a * dark, a)
    return f


def tex_checker(s, dark):
    def f(q, a):
        m = (np.floor(q[:, 0] / s) + np.floor(q[:, 1] / s) + np.floor(q[:, 2] / s)) % 2 == 0
        return np.where(m, a * dark, a)
    return f


def tex_speckle(rng, density, dark, scale=1.0):
    seed = rng.integers(1 << 30)
    def f(q, a):
        k = np.floor(q / scale).astype(np.int64)
        h = (k[:, 0] * 73856093 ^ k[:, 1] * 19349663 ^ k[:, 2] * 83492791 ^ seed) & 0xFFFF
        return np.where(h / 65535.0 < density, a * dark, a)
    return f


def tex_panel(rng, dark):
    """A rectangle-ish inset (window, door, picture, book spines)."""
    cx, cy, w, h = rng.uniform(-3, 3), rng.uniform(-2, 4), rng.uniform(1, 4), rng.uniform(1, 4)
    def f(q, a):
        m = (np.abs(q[:, 0] - cx) < w) & (np.abs(q[:, 1] - cy) < h)
        return np.where(m, a * dark, a)
    return f


def random_tex(rng):
    r = rng.random()
    dark = rng.uniform(0.35, 0.75)
    if r < 0.35: return None
    if r < 0.55: return tex_stripes(int(rng.integers(0, 3)), rng.uniform(1.5, 4), rng.uniform(0.5, 1.2), dark)
    if r < 0.65: return tex_bricks(rng.uniform(1.5, 3), rng.uniform(3, 6), dark)
    if r < 0.75: return tex_checker(rng.choice([1.0, 2.0]), dark)
    if r < 0.9: return tex_speckle(rng, rng.uniform(0.05, 0.3), dark, rng.choice([1.0, 2.0]))
    return tex_panel(rng, dark)


def tex_tufts(rng, density, dark):
    """Grass tufts: small 2-3 px tick marks scattered on a grid, like the game's lawns."""
    seed = rng.integers(1 << 30); cell = int(rng.choice([4, 6, 8]))
    glyph = rng.random((3, 4)) < 0.45
    def f(q, a):
        cx = np.floor(q[:, 0] / cell).astype(np.int64); cz = np.floor(q[:, 2] / cell).astype(np.int64)
        h = (cx * 73856093 ^ cz * 19349663 ^ seed) & 0xFFFF
        on = h / 65535.0 < density
        lx = np.floor(q[:, 0] - cx * cell).astype(int); lz = np.floor(q[:, 2] - cz * cell).astype(int)
        inside = (lx < 4) & (lz < 3)
        g = glyph[np.clip(lz, 0, 2), np.clip(lx, 0, 3)]
        return np.where(on & inside & g, a * dark, a)
    return f


def tex_dither(rng, dark, fill):
    """Dense ordered dither over a whole area (tall grass, gravel, sand)."""
    pat = rng.random((2, 2)) < fill
    def f(q, a):
        x = np.floor(q[:, 0]).astype(int) % 2; z = np.floor(q[:, 2]).astype(int) % 2
        return np.where(pat[z, x], a * dark, a)
    return f


def ground_tex(rng):
    r = rng.random()
    if r < 0.15: return None
    if r < 0.4: return tex_tufts(rng, rng.uniform(0.2, 0.8), rng.uniform(0.4, 0.75))
    if r < 0.55: return tex_dither(rng, rng.uniform(0.3, 0.75), rng.uniform(0.25, 0.6))
    if r < 0.7: return tex_stripes(2, rng.choice([2.0, 3.0, 4.0]), 1.0, rng.uniform(0.5, 0.8))
    if r < 0.7: return tex_speckle(rng, rng.uniform(0.03, 0.2), rng.uniform(0.5, 0.8), rng.choice([1.0, 2.0]))
    if r < 0.85: return tex_checker(rng.choice([1.0, 2.0]), rng.uniform(0.6, 0.85))
    return tex_stripes(rng.choice([0, 2]), rng.uniform(2, 6), rng.uniform(0.5, 1.5), rng.uniform(0.6, 0.85))


def alb(rng, top_bias=0.0):
    p = np.array([0.35 + top_bias, 0.35, 0.2, 0.1]); p /= p.sum()
    return ALB[rng.choice(4, p=p)]


# ---------- objects (each returns prims, footprint radius) ----------

def obj_box(rng, x, z):
    w, h, d = rng.uniform(2, 10), rng.uniform(2, 12), rng.uniform(2, 8)
    rad = rng.choice([0, 0, 0.5, 1.0]) * min(w, h, d) * 0.3
    return [Prim("box", (x, h, z), rot_y(rng.choice([0, 0, 0, rng.uniform(-0.6, 0.6)])), b=(w, h, d), rad=rad,
                 albedo=alb(rng), tex=random_tex(rng))]


def obj_shelf(rng, x, z):
    """A box with recessed shelves (real geometry) and a lid."""
    w, h, d = rng.uniform(4, 12), rng.uniform(5, 14), rng.uniform(2, 5)
    a = alb(rng)
    prims = [Prim("box", (x, h, z), b=(w, h, d), albedo=a, tex=random_tex(rng))]
    n = int(rng.integers(1, 4))
    for i in range(n):
        y = h * 2 * (i + 0.5) / n
        prims.append(Prim("box", (x, y, z + d), b=(w - 1, h / n - 1.2, 0.8), albedo=ALB[rng.integers(1, 4)], tex=random_tex(rng)))
    # recesses are carved by drawing inner boxes slightly in front: emulate with darker inset panels
    return prims


def obj_house(rng, x, z):
    w, h, d = rng.uniform(6, 16), rng.uniform(4, 9), rng.uniform(4, 9)
    rh = rng.uniform(2, 8)
    over = rng.uniform(0, 1.5)
    hip = rng.choice([0, 0, rng.uniform(1, min(w, 6))])
    return [
        Prim("box", (x, h, z), b=(w, h, d), albedo=alb(rng, 0.2), tex=random_tex(rng)),
        Prim("roof", (x, 2 * h, z), w=w + over, d=d + over, h=rh, hip=hip, albedo=alb(rng), tex=random_tex(rng)),
    ]


def obj_cyl(rng, x, z):
    r, h = rng.uniform(1, 7), rng.uniform(1, 10)
    rad = rng.choice([0, 0.3, 0.8]) * r * 0.5
    return [Prim("cyl", (x, h, z), r=r, h=h, rad=rad, albedo=alb(rng), tex=random_tex(rng))]


def obj_tree(rng, x, z):
    r = rng.uniform(3, 8); th = rng.uniform(1, 4)
    top = rng.choice(["sphere", "cyl", "cone", "ellipsoid"])
    prims = [Prim("cyl", (x, th, z), r=rng.uniform(0.6, 1.8), h=th, albedo=alb(rng), tex=random_tex(rng))]
    y = 2 * th
    if top == "sphere": prims.append(Prim("sphere", (x, y + r * 0.9, z), r=r, albedo=alb(rng), tex=random_tex(rng)))
    elif top == "cyl": prims.append(Prim("cyl", (x, y + r * 0.6, z), r=r, h=r * 0.6, rad=r * 0.2, albedo=alb(rng), tex=random_tex(rng)))
    elif top == "cone": prims.append(Prim("cone", (x, y, z), r=r, h=r * 2, albedo=alb(rng), tex=random_tex(rng)))
    else: prims.append(Prim("ellipsoid", (x, y + r * 0.7, z), r=(r, r * 0.7, r), albedo=alb(rng), tex=random_tex(rng)))
    return prims


def obj_blob(rng, x, z):
    """Boulders, bushes, creatures: smooth unions of ellipsoids."""
    prims = []
    for i in range(int(rng.integers(1, 5))):
        r = rng.uniform(1.5, 6, 3)
        p = (x + rng.uniform(-3, 3), r[1] * rng.uniform(0.6, 1.2), z + rng.uniform(-3, 3))
        prims.append(Prim("ellipsoid", p, rot_y(rng.uniform(0, np.pi)), blend=rng.uniform(0, 2.5), r=r,
                          albedo=alb(rng), tex=random_tex(rng)))
    return prims


def obj_stairs(rng, x, z):
    n = int(rng.integers(2, 6)); w = rng.uniform(3, 8); sh = rng.uniform(0.8, 2.5); sd = rng.uniform(0.8, 2.5)
    a, t = alb(rng), random_tex(rng)
    return [Prim("box", (x, sh * (i + 1) / 2, z - sd * i), b=(w, sh * (i + 1) / 2, sd / 2), albedo=a, tex=t) for i in range(n)]


def obj_slope(rng, x, z):
    """Ramps, ledges and cliff faces: a tilted slab."""
    w, h, d = rng.uniform(3, 12), rng.uniform(0.5, 2), rng.uniform(3, 8)
    a = rng.uniform(0.2, 1.2)
    return [Prim("box", (x, d * np.sin(a) * 0.5 + h, z), rot_x(a * rng.choice([-1, 1])), b=(w, h, d), albedo=alb(rng), tex=random_tex(rng))]


def obj_table(rng, x, z):
    w, d, h = rng.uniform(3, 9), rng.uniform(2, 6), rng.uniform(2, 5)
    a = alb(rng, 0.2)
    prims = [Prim("box", (x, 2 * h, z), b=(w, rng.uniform(0.4, 1.2), d), albedo=a, tex=random_tex(rng))]
    for sx in (-1, 1):
        for sz in (-1, 1):
            prims.append(Prim("box", (x + sx * (w - 0.6), h, z + sz * (d - 0.6)), b=(0.5, h, 0.5), albedo=ALB[rng.integers(1, 4)]))
    return prims


def obj_torus(rng, x, z):
    R = rng.uniform(2, 6); r = rng.uniform(0.6, R * 0.6)
    tilt = rng.choice([0, np.pi / 2])
    return [Prim("torus", (x, r if tilt == 0 else R + r, z), rot_x(tilt) @ rot_y(rng.uniform(0, 3)), R=R, r=r, albedo=alb(rng), tex=random_tex(rng))]


def obj_table_game(rng, x, z):
    """A table as the game draws them: a big top, a short front (legs or a skirt)."""
    w, d, h = rng.uniform(6, 16), rng.uniform(4, 12), rng.uniform(2, 5)
    a = alb(rng, 0.3); t = rng.uniform(0.5, 1.5)
    prims = [Prim("box", (x, 2 * h - t, z), b=(w, t, d), rad=rng.choice([0, 0.3]), albedo=a, tex=random_tex(rng) if rng.random() < 0.5 else None)]
    if rng.random() < 0.5:  # skirt: a solid front just under the top
        prims.append(Prim("box", (x, h - t, z), b=(w - 0.8, h - t, d - 0.8), albedo=ALB[rng.integers(1, 4)], tex=random_tex(rng)))
    else:
        for sx in (-1, 1):
            for sz in (-1, 1):
                prims.append(Prim("box", (x + sx * (w - 0.8), h, z + sz * (d - 0.8)), b=(0.6, h, 0.6), albedo=ALB[rng.integers(1, 4)]))
    for _ in range(int(rng.integers(0, 3))):  # things on the table
        prims.append(Prim("box", (x + rng.uniform(-w, w) * 0.7, 2 * h + 1, z + rng.uniform(-d, d) * 0.6), b=(rng.uniform(0.8, 2.5), rng.uniform(0.5, 2), rng.uniform(0.8, 2)), albedo=alb(rng)))
    return prims


def obj_chair(rng, x, z):
    """A stool or chair: a small seat top over a short front, sometimes a back rest behind."""
    w, d, h = rng.uniform(2.5, 6), rng.uniform(2.5, 6), rng.uniform(1.5, 4)
    a = alb(rng, 0.2)
    prims = [Prim("box", (x, h, z), b=(w, h, d), rad=rng.choice([0, 0.4, 1.0]), albedo=a, tex=random_tex(rng) if rng.random() < 0.4 else None)]
    if rng.random() < 0.5:
        bh = rng.uniform(2, 6)
        prims.append(Prim("box", (x, 2 * h + bh, z - d + 0.6), b=(w, bh, 0.6), albedo=a))
    return prims


def obj_counter(rng, x, z):
    """A long counter or desk: narrow top, tall front, often a panel pattern."""
    w, d, h = rng.uniform(8, 24), rng.uniform(2.5, 6), rng.uniform(3, 7)
    prims = [Prim("box", (x, h, z), b=(w, h, d), albedo=alb(rng), tex=random_tex(rng) if rng.random() < 0.7 else tex_panel(rng, rng.uniform(0.4, 0.8)))]
    if rng.random() < 0.5:  # a top board overhanging a little
        prims.append(Prim("box", (x, 2 * h + 0.4, z + 0.3), b=(w + 0.4, 0.4, d + 0.5), albedo=alb(rng, 0.4)))
    return prims


FURNITURE = [obj_table_game, obj_chair, obj_counter, obj_shelf]


OBJECTS = [obj_box, obj_shelf, obj_house, obj_cyl, obj_tree, obj_blob, obj_stairs, obj_slope, obj_table, obj_torus]
WEIGHTS = np.array([2, 1, 2, 1.5, 1.5, 2, 1, 1, 1, 0.5]); WEIGHTS /= WEIGHTS.sum()


def room_scene(rng, W, H):
    """An interior: a back wall across the top of the view, furniture along it and on the floor.
    In the game a room's back wall is a band at the top of the screen that faces you."""
    prims = []
    wall_h = rng.uniform(8, 24); back = -(H - wall_h - rng.uniform(-2, 10))  # wall's top edge near the top of the view
    wall_a = alb(rng, 0.3)
    prims.append(Prim("box", (W / 2, wall_h, back - 4), b=(W, wall_h, 4), albedo=wall_a,
                      tex=random_tex(rng) if rng.random() < 0.7 else tex_stripes(0, rng.uniform(3, 8), rng.uniform(0.6, 1.5), rng.uniform(0.4, 0.8))))
    for _ in range(int(rng.integers(0, 3))):  # pictures, windows, maps hung on the wall
        prims.append(Prim("box", (rng.uniform(4, W - 4), wall_h * rng.uniform(0.6, 1.4), back + 0.2),
                          b=(rng.uniform(2, 6), rng.uniform(1.5, 4), 0.3), albedo=alb(rng), tex=random_tex(rng)))
    if rng.random() < 0.4:  # a side wall
        side = rng.choice([0.0, float(W)])
        prims.append(Prim("box", (side, wall_h, back / 2), b=(rng.uniform(2, 5), wall_h, -back / 2 + 4), albedo=wall_a, tex=random_tex(rng)))
    for _ in range(int(rng.integers(1, 6))):
        against = rng.random() < 0.6
        x = rng.uniform(0, W); z = back + rng.uniform(2, 6) if against else -rng.uniform(0, H)
        if rng.random() < FURNITURE_SHARE:
            f = FURNITURE[rng.choice(4, p=[0.35, 0.3, 0.15, 0.2])]
            prims += f(rng, x, z if against or f is not obj_chair else z)
        else:
            f = [obj_shelf, obj_box, obj_table, obj_cyl, obj_stairs][rng.choice(5, p=[0.35, 0.3, 0.2, 0.1, 0.05])]
            prims += f(rng, x, z)
    floor = rng.choice(4)
    gt = [None, tex_stripes(2, float(rng.choice([2, 3, 4])), 1.0, rng.uniform(0.5, 0.8)), tex_checker(float(rng.choice([2, 4, 8])), rng.uniform(0.6, 0.85)), tex_speckle(rng, 0.1, 0.7)][floor]
    sc = Scene(prims, ground=True, ground_albedo=ALB[rng.choice(3, p=[0.5, 0.4, 0.1])], ground_tex=gt)
    return sc, (0.0, -rng.uniform(0, 4))


def map_scene(rng, W, H):
    if rng.random() < ROOM_SHARE:
        return room_scene(rng, W, H)
    """Objects on a ground plane, laid out to fill a W×H map-view image (u = y - z)."""
    prims = []
    n = int(rng.integers(3, 9))
    for _ in range(n):
        x = rng.uniform(0, W); z = -rng.uniform(0, H)  # u of the base = -z: spread over the image
        new = OBJECTS[rng.choice(len(OBJECTS), p=WEIGHTS)](rng, 0.0, 0.0)
        k = rng.uniform(1.0, 1.8)
        for pr in new:
            pr.pos = pr.pos * k + np.array([x, 0, z]); pr.params = {a: (np.asarray(v) * k if a != 'hip' or v else v) for a, v in pr.params.items()}
        prims += new
    sc = Scene(prims, ground=True, ground_albedo=ALB[rng.choice(3, p=[0.6, 0.3, 0.1])], ground_tex=ground_tex(rng))
    return sc, (0.0, -rng.uniform(0, 4))


FURNITURE_SHARE = float(os.environ.get("FURNITURE_SHARE", "0"))
POSED_SHARE = float(os.environ.get("POSED_SHARE", "0"))


def posed_creature(rng):
    """A creature whose parts sit at clearly different depths: a chain of 2-4 masses (body, head,
    haunch...) stepping towards or away from the viewer, limbs in front of or behind them, and the
    whole figure leaning, turned or lying back. Teaches depth order, e.g. a head behind a belly."""
    parts = []
    r = rng.uniform(7, 13, 3); c = np.zeros(3); masses = [(c, r)]
    parts.append(Prim("ellipsoid", c, rot_z(rng.uniform(0, np.pi)), r=r))
    for _ in range(int(rng.integers(1, 4))):
        pc, pr = masses[int(rng.integers(len(masses)))]
        r = rng.uniform(3.5, 10, 3)
        d = rng.normal(size=3); d[2] = rng.choice([-1, 1]) * rng.uniform(0.7, 1.6); d /= np.linalg.norm(d)
        c = pc + d * (pr.mean() * rng.uniform(0.6, 1.0) + r.mean() * rng.uniform(0.4, 0.9))
        masses.append((c, r))
        parts.append(Prim("ellipsoid", c, rot_z(rng.uniform(0, np.pi)) @ rot_x(rng.uniform(-0.6, 0.6)), r=r))
    for _ in range(int(rng.integers(0, 5))):
        mc, mr = masses[int(rng.integers(len(masses)))]
        d = rng.normal(size=3); d /= np.linalg.norm(d)
        p = mc + d * mr * rng.uniform(0.7, 1.0)
        R = rot_z(rng.uniform(0, np.pi)) @ rot_x(rng.uniform(-1.2, 1.2))
        kind = rng.choice(["capsule", "sphere", "cone", "ellipsoid"])
        if kind == "capsule": parts.append(Prim(kind, p, R, r=rng.uniform(1, 3.5), h=rng.uniform(2, 8)))
        elif kind == "sphere": parts.append(Prim(kind, p, r=rng.uniform(1.5, 5)))
        elif kind == "cone": parts.append(Prim(kind, p, R, r=rng.uniform(1.5, 4), h=rng.uniform(3, 9)))
        else: parts.append(Prim(kind, p, R, r=rng.uniform(1.5, 6, 3)))
    G = rot_x(rng.uniform(-1.2, 1.2)) @ rot_y(rng.uniform(-1.0, 1.0)) @ rot_z(rng.uniform(-0.5, 0.5))
    ext = lambda pr: max(np.max(np.atleast_1d(pr.params.get("r", 1))), pr.params.get("h", 0) / 2 + np.max(np.atleast_1d(pr.params.get("r", 1))))
    P = np.array([G @ pr.pos for pr in parts]); E = np.array([ext(pr) for pr in parts])
    lo, hi = (P - E[:, None]).min(0), (P + E[:, None]).max(0)
    k = min(1.6, 46 / max(hi[0] - lo[0], hi[1] - lo[1]))
    mid = (lo + hi) / 2
    for pr in parts:
        pr.pos = (G @ pr.pos - mid) * k + np.array([28, 28, 0])
        pr.rot = G @ pr.rot
        pr.params = {a: np.asarray(v) * k for a, v in pr.params.items()}
        pr.blend = rng.uniform(0, 2.5) * k; pr.albedo = alb(rng); pr.tex = random_tex(rng)
    return parts


def creature_scene(rng):
    """A front-view picture: a smooth blob creature/person, no ground, white background."""
    if rng.random() < POSED_SHARE:
        prims = posed_creature(rng)
        for pr in prims:
            if rng.random() < WHITE_SHARE:
                pr.flat, pr.tex, pr.albedo = True, None, 1.0
                pr.open = rng.random() < 0.5
        return Scene(prims, ground=False), (0.0, 0.0)
    prims = []
    body = rng.uniform(8, 18, 3)
    prims.append(Prim("ellipsoid", (28, 24, 0), r=body, albedo=alb(rng), tex=random_tex(rng)))
    for _ in range(int(rng.integers(1, 7))):
        kind = rng.choice(["ellipsoid", "capsule", "sphere", "cone"])
        ang = rng.uniform(0, 2 * np.pi)
        p = (28 + np.cos(ang) * body[0] * rng.uniform(0.5, 1.1), 24 + np.sin(ang) * body[1] * rng.uniform(0.5, 1.1), rng.uniform(-3, body[2]))
        R = rot_z(rng.uniform(0, np.pi)) @ rot_x(rng.uniform(-0.5, 0.5))
        if kind == "ellipsoid": pr = Prim(kind, p, R, r=rng.uniform(1.5, 8, 3))
        elif kind == "capsule": pr = Prim(kind, p, R, r=rng.uniform(1, 3.5), h=rng.uniform(1, 7))
        elif kind == "sphere": pr = Prim(kind, p, r=rng.uniform(1.5, 7))
        else: pr = Prim(kind, p, R, r=rng.uniform(1.5, 5), h=rng.uniform(3, 10))
        pr.blend = rng.uniform(0, 3); pr.albedo = alb(rng); pr.tex = random_tex(rng)
        prims.append(pr)
    for pr in prims:
        if rng.random() < WHITE_SHARE:
            pr.flat, pr.tex, pr.albedo = True, None, 1.0
            pr.open = rng.random() < 0.5
    return Scene(prims, ground=False), (0.0, 0.0)


import json, os
_STYLES = None


def calibrated_style(rng):
    """One of the styles fitted to real maps (calibrate.py), jittered."""
    global _STYLES
    if _STYLES is None:
        _STYLES = json.load(open(os.path.join(os.path.dirname(__file__), "styles.json")))[:12]
    s = _STYLES[rng.integers(len(_STYLES))]
    AZ, EL = [-15, 15, 45, 75], [20, 40, 60, 80]
    j = lambda v, a, lo=0.0, hi=1.0: float(np.clip(v + rng.uniform(-a, a), lo, hi))
    th = np.sort(np.clip(np.array(s["th"]) + rng.uniform(-0.05, 0.05, 3), 0.02, 0.98))[::-1]
    return dict(az=AZ[s["li"] // 4] + rng.uniform(-15, 15), el=EL[s["li"] % 4] + rng.uniform(-10, 10),
                ambient=j(s["amb"], 0.08), kd=j(s["kd"], 0.1), wrap=j(s["wrap"], 0.1), shs=j(s["shs"], 0.15),
                aos=j(s["aos"], 0.15), gamma=j(s["gamma"], 0.15, 0.2, 2), thresholds=tuple(th),
                dither=float(rng.choice([0.0, 0.1, 0.15])), outline=True, jump=j(s["jump"], 1, 0.8, 8),
                ground_outline=bool(s["gout"]) if rng.random() < 0.8 else rng.random() < 0.5,
                crease=rng.random() < 0.25, use_shadow=True, use_ao=True, spec=0.0,
                dither_offset=tuple(rng.integers(0, 4, 2)))


STYLE_RAND = float(os.environ.get("STYLE_RAND", "0"))  # share of scenes with randomised outlines and dither


def random_style(rng, view):
    st = _random_style(rng, view)
    if STYLE_RAND > 0 and rng.random() < STYLE_RAND:
        # Randomise what the game doesn't encode consistently: outline on/off, shade, gaps; dither strength.
        st.update(outline=rng.random() < 0.85, outline_shade=int(rng.choice([3, 3, 2])),
                  outline_drop=float(rng.choice([0.0, rng.uniform(0.05, 0.35)])), outline_seed=int(rng.integers(1 << 30)),
                  dither=float(rng.choice([0.0, 0.1, 0.15, 0.25])), crease=rng.random() < 0.4)
    return st


def _random_style(rng, view):
    if view == "map" and rng.random() < 0.85:
        return calibrated_style(rng)
    if view == "map":
        az, el = rng.uniform(-20, 70), rng.uniform(35, 80)
    else:
        az, el = rng.uniform(-10, 60), rng.uniform(20, 65)
    amb = rng.uniform(0.15, 0.5)
    base = np.array([0.8, 0.55, 0.3]) + rng.uniform(-0.1, 0.1, 3)
    return dict(
        az=az, el=el, ambient=amb, kd=rng.uniform(0.6, 1.0) * (1 - amb) / 0.65,
        thresholds=tuple(base), dither=rng.choice([0.0, 0.0, rng.uniform(0.05, 0.25)]),
        outline=rng.random() < 0.9, jump=rng.uniform(0.8, 3.0), ground_outline=rng.random() < 0.75,
        crease=rng.random() < 0.4, use_shadow=rng.random() < 0.85, use_ao=rng.random() < 0.7,
        wrap=rng.uniform(0, 0.5), spec=rng.choice([0.0, 0.0, rng.uniform(0.1, 0.4)]),
        dither_offset=tuple(rng.integers(0, 4, 2)),
    )
