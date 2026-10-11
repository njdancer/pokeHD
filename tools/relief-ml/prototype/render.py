"""SDF scenes rendered as Game Boy pixel art, with exact per-pixel normals.

World: x right, y up, z towards the viewer. Ground plane y = 0.
Views:
  'map'   Game Boy three-quarter view: one pixel up the screen = 1 up or 1 back (u = y - z).
  'front' straight-on (u = y), for battle pictures.
"""
import numpy as np

# ---------- primitives (numpy, p: (..., 3)) ----------

def _len(v):
    return np.sqrt((v * v).sum(-1))


def sd_sphere(p, r):
    return _len(p) - r


def sd_ellipsoid(p, r):
    r = np.asarray(r, float)
    k0 = _len(p / r); k1 = _len(p / (r * r))
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sd_box(p, b, rad=0.0):
    q = np.abs(p) - (np.asarray(b, float) - rad)
    return _len(np.maximum(q, 0)) + np.minimum(q.max(-1), 0) - rad


def sd_cyl(p, r, h, rad=0.0):
    """Vertical capped cylinder, radius r, half-height h."""
    d = np.stack([np.sqrt(p[..., 0] ** 2 + p[..., 2] ** 2) - (r - rad), np.abs(p[..., 1]) - (h - rad)], -1)
    return np.minimum(d.max(-1), 0) + _len(np.maximum(d, 0)) - rad


def sd_cone(p, r, h):
    """Vertical cone, base radius r at y=0, apex at y=h."""
    q = np.sqrt(p[..., 0] ** 2 + p[..., 2] ** 2)
    k = np.array([h, r]) / np.hypot(h, r)
    side = (q - r) * k[0] + p[..., 1] * k[1]
    return np.maximum(side, np.maximum(-p[..., 1], p[..., 1] - h))


def sd_capsule_y(p, r, h):
    q = p.copy(); q[..., 1] = p[..., 1] - np.clip(p[..., 1], -h, h)
    return _len(q) - r


def sd_torus(p, R, r):
    q = np.stack([np.sqrt(p[..., 0] ** 2 + p[..., 2] ** 2) - R, p[..., 1]], -1)
    return _len(q) - r


def sd_roof(p, w, d, h, hip=0.0):
    """Gabled roof: ridge along x, half-width w, half-depth d (z), height h, base at y=0.
    hip > 0 slopes the ends too (hip roof)."""
    s = np.hypot(h, d)
    slope = (np.abs(p[..., 2]) * h + p[..., 1] * d - h * d) / s
    out = np.maximum(slope, np.maximum(-p[..., 1], np.abs(p[..., 0]) - w))
    if hip > 0:
        e = (np.abs(p[..., 0]) - (w - hip)) * h + p[..., 1] * hip - h * hip
        out = np.maximum(out, e / np.hypot(h, hip))
    return out


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    hh = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - hh) + a * hh - k * hh * (1 - hh)


def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


class Prim:
    """A primitive placed in the world: kind, params, position, rotation, material."""

    def __init__(self, kind, pos, rot=None, blend=0.0, albedo=1.0, tex=None, **params):
        self.kind, self.pos = kind, np.asarray(pos, float)
        self.rot = np.eye(3) if rot is None else rot
        self.params, self.blend, self.albedo, self.tex = params, blend, albedo, tex

    def sdf(self, p):
        q = (p - self.pos) @ self.rot  # world -> local (rot is orthonormal; row vectors)
        k, a = self.kind, self.params
        if k == "sphere": return sd_sphere(q, a["r"])
        if k == "ellipsoid": return sd_ellipsoid(q, a["r"])
        if k == "box": return sd_box(q, a["b"], a.get("rad", 0))
        if k == "cyl": return sd_cyl(q, a["r"], a["h"], a.get("rad", 0))
        if k == "cone": return sd_cone(q, a["r"], a["h"])
        if k == "capsule": return sd_capsule_y(q, a["r"], a["h"])
        if k == "torus": return sd_torus(q, a["R"], a["r"])
        if k == "roof": return sd_roof(q, a["w"], a["d"], a["h"], a.get("hip", 0))
        raise ValueError(k)

    def local(self, p):
        return (p - self.pos) @ self.rot


class Scene:
    def __init__(self, prims, ground=True, ground_albedo=1.0, ground_tex=None):
        self.prims, self.ground, self.ground_albedo, self.ground_tex = prims, ground, ground_albedo, ground_tex

    def sdf(self, p, with_id=False):
        d = np.full(p.shape[:-1], 1e9); ids = np.full(p.shape[:-1], -1, np.int32)
        for i, pr in enumerate(self.prims):
            di = pr.sdf(p)
            if pr.blend > 0 and i > 0:
                nd = smin(d, di, pr.blend)
            else:
                nd = np.minimum(d, di)
            ids = np.where(di < d, i, ids)
            d = nd
        if self.ground:
            g = p[..., 1]
            ids = np.where(g < d, -2, ids)
            d = np.minimum(d, g)
        return (d, ids) if with_id else d

    def normal(self, p, e=1e-3):
        n = np.stack([
            self.sdf(p + [e, 0, 0]) - self.sdf(p - [e, 0, 0]),
            self.sdf(p + [0, e, 0]) - self.sdf(p - [0, e, 0]),
            self.sdf(p + [0, 0, e]) - self.sdf(p - [0, 0, e]),
        ], -1)
        return n / np.maximum(_len(n)[..., None], 1e-9)


def trace(scene, origins, direction, smax, steps=160, eps=1e-3):
    """Sphere-trace from origins along a unit direction. Returns t (inf where missed)."""
    t = np.zeros(origins.shape[:-1]); alive = np.ones_like(t, bool); hit = np.zeros_like(t, bool)
    for _ in range(steps):
        if not alive.any():
            break
        idx = np.nonzero(alive)
        p = origins[idx] + t[idx][..., None] * direction
        d = scene.sdf(p)
        t[idx] += d * 0.9
        h = d < eps
        hi = tuple(a[h] for a in idx); hit[hi] = True; alive[hi] = False
        far = t[idx] > smax
        fi = tuple(a[far] for a in idx); alive[fi] = False
    t[~hit] = np.inf
    return t


def camera_rays(view, W, H, ss, origin_xy=(0.0, 0.0)):
    """Ray origins/direction for a W×H pixel image, ss×ss samples per pixel, pixel = 1 world unit.
    origin_xy: world (x, u) of the image's bottom-left corner."""
    xs = origin_xy[0] + (np.arange(W * ss) + 0.5) / ss
    us = origin_xy[1] + (H - (np.arange(H * ss) + 0.5) / ss)  # top row has the largest u
    X, U = np.meshgrid(xs, us)
    S = 60.0
    if view == "map":
        o = np.stack([X, U + S, np.full_like(X, S)], -1)
        d = np.array([0, -1, -1]) / np.sqrt(2)
        return o, d, S * np.sqrt(2) * 2
    o = np.stack([X, U, np.full_like(X, S)], -1)
    return o, np.array([0, 0, -1.0]), 2 * S


def render_buffers(scene, view, W, H, ss=3, origin_xy=(0.0, 0.0)):
    """Returns per-subsample position, normal, prim id (-1 background, -2 ground), depth."""
    o, d, smax = camera_rays(view, W, H, ss, origin_xy)
    t = trace(scene, o, d, smax)
    hit = np.isfinite(t)
    P = o + np.where(hit, t, 0)[..., None] * d
    N = np.zeros_like(P); ids = np.full(t.shape, -1, np.int32)
    if hit.any():
        N[hit] = scene.normal(P[hit])
        _, ids_h = scene.sdf(P[hit], with_id=True)
        ids[hit] = ids_h
    return dict(P=P, N=N, ids=ids, hit=hit, t=t)


def shadow(scene, P, L, k=8.0, tmax=40.0):
    """Soft shadow factor (1 lit, 0 shadowed) by marching towards the light."""
    o = P + L * 0.02
    res = np.ones(P.shape[:-1]); t = np.full(P.shape[:-1], 0.02)
    for _ in range(64):
        d = scene.sdf(o + t[..., None] * L)
        res = np.minimum(res, k * d / t)
        t = t + np.clip(d, 0.02, 1.0)
        if (t > tmax).all():
            break
    return np.clip(res, 0, 1)


def ao(scene, P, N, n=5, step=0.6):
    occ = np.zeros(P.shape[:-1]); w = 1.0
    for i in range(1, n + 1):
        h = step * i
        occ += w * (h - scene.sdf(P + N * h)); w *= 0.6
    return np.clip(1 - 0.35 * occ, 0, 1)
