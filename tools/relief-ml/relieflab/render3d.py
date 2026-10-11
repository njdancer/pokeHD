"""Pre-rendered 3D views (the dashboard's fallback; it also builds 3D itself from the pred layers).

Maps: predicted faces → the relief editor's own mesh (shape.ts mapRelief via Node), rendered from
the game camera and isometric. Pictures: predicted depth → a torn per-pixel mesh, front-on and
angled. A numpy z-buffer rasteriser, ported from the prototype.
"""
import json, shutil, subprocess
from functools import lru_cache
import numpy as np
from . import tasks
from .evals import outside
from .paths import PKG, REPO

LIGHT = np.array([-0.45, 0.75, 0.55]); LIGHT /= np.linalg.norm(LIGHT)
MAP_SCENES = [("PALLET_TOWN", (40, 104, 56, 136)), ("PALLET_TOWN", (24, 104, 152, 280)), ("OAKS_LAB", (0, 96, 0, 160)),
              ("REDS_HOUSE_1F", (0, 96, 0, 128))]
PICS = [1, 25, 94, 143]


@lru_cache(1)
def node():
    p = subprocess.run(["mise", "which", "node"], cwd=REPO, capture_output=True, text=True).stdout.strip()
    return p or shutil.which("node")


def mesh(kind, N, img, mask, depth=1.0):
    rgb = np.repeat(tasks.SHADE[img][..., None], 3, -1)
    j = dict(kind=kind, w=int(img.shape[1]), h=int(img.shape[0]), n=np.round(N, 4).ravel().tolist(),
             c=rgb.ravel().tolist(), g=mask.astype(int).ravel().tolist(), depth=depth)
    out = subprocess.run([node(), str(PKG / "mesh.ts")], input=json.dumps(j).encode(), capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32).reshape(-1, 3, 9)


def rot(yaw, pitch):
    y, p = np.radians(yaw), np.radians(pitch)
    Ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(p), -np.sin(p)], [0, np.sin(p), np.cos(p)]])
    return Rx @ Ry


def raster(T, R, scale=6, pad=4, bg=(28, 32, 26)):
    """Orthographic z-buffered render. Camera looks down -z after rotating the world by R."""
    P = T[..., :3] @ R.T
    shade = np.clip((T[:, 0, 3:6] @ LIGHT), 0, 1) * 0.7 + 0.35
    col = np.clip(T[:, 0, 6:9] * shade[:, None], 0, 1)
    xy = P[..., :2] * scale; xy[..., 1] *= -1
    xy -= xy.reshape(-1, 2).min(0) - pad * scale
    W, H = (xy.reshape(-1, 2).max(0) + pad * scale).astype(int) + 1
    zb = np.full((H, W), -np.inf); im = np.zeros((H, W, 3)); im[:] = np.array(bg) / 255
    z = P[..., 2]
    for t in range(len(T)):
        a, b, c = xy[t]
        x0, y0 = np.floor(np.minimum(np.minimum(a, b), c)).astype(int); x1, y1 = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
        if x1 <= x0 or y1 <= y0: continue
        gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
        d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(d) < 1e-9: continue
        w1 = ((gx - a[0]) * (c[1] - a[1]) - (gy - a[1]) * (c[0] - a[0])) / d
        w2 = ((b[0] - a[0]) * (gy - a[1]) - (b[1] - a[1]) * (gx - a[0])) / d
        w0 = 1 - w1 - w2
        ins = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not ins.any(): continue
        zz = w0 * z[t, 0] + w1 * z[t, 1] + w2 * z[t, 2] + 1e-4
        sub = zb[y0:y1, x0:x1]; win = ins & (zz > sub)
        sub[win] = zz[win]; im[y0:y1, x0:x1][win] = col[t]
    return (im * 255).astype(np.uint8)


def _fit(a, h):
    if a.shape[0] >= h: return a
    t = (h - a.shape[0]) // 2
    return np.pad(a, ((t, h - a.shape[0] - t), (0, 0), (0, 0)), constant_values=28)


def row(parts, gap=12):
    h = max(p.shape[0] for p in parts); out = []
    for p in parts: out += [_fit(p, h), np.full((h, gap, 3), 255, np.uint8)]
    return np.concatenate(out[:-1], 1)


def stack(rows, gap=16):
    w = max(r.shape[1] for r in rows)
    return np.concatenate([np.pad(r, ((0, gap), (0, w - r.shape[1]), (0, 0)), constant_values=255) for r in rows], 0)


def _big(a, s):
    return np.kron(a, np.ones((s, s, 1), np.uint8))


def map_views(model, cfg, name, crop, scale=6):
    img, labs = tasks.map_img(name)
    img = img[crop[0]:crop[1], crop[2]:crop[3]]; labs = labs[crop[0] // 8:crop[1] // 8, crop[2] // 8:crop[3] // 8]
    if getattr(model, "mask", None) is not None: model.mask = model.mask[..., crop[0]:crop[1], crop[2]:crop[3]]
    p = tasks.predict(model, cfg, img)
    k = p["faces"] if "faces" in p else (p["normal"] @ tasks.FACES.T).argmax(-1)
    S = tasks.FACES[k]
    lab_ = np.kron(np.array([[l in tasks.GROUND for l in r] for r in labs]), np.ones((8, 8), bool))
    ground = lab_ & (k == 0)   # same rule as the editor: ground label and a sky-facing face
    T = mesh("map", S, img, ground)
    sh = np.repeat(tasks.SHADE[img][..., None], 3, -1)
    f = (sh * 0.35 + tasks.FACE_RGB[k] * 0.65).astype(np.uint8)
    return row([_big(sh, scale), _big(f, scale), raster(T, rot(0, 45), scale), raster(T, rot(-35, 30), scale)])


def depth_mesh(img, N, z, inside, thr=2.5):
    H, W = img.shape
    rgb = tasks.SHADE[img] / 255.0
    z = np.where(inside, z - z[inside].mean(), 0)
    tris = []
    for y in range(H):
        for x in range(W):
            if not inside[y, x]: continue
            zc = []
            for cy, cx in ((y, x), (y, x + 1), (y + 1, x + 1), (y + 1, x)):
                vals = [z[j, i] for j in (cy - 1, cy) for i in (cx - 1, cx)
                        if 0 <= j < H and 0 <= i < W and inside[j, i] and abs(z[j, i] - z[y, x]) < thr]
                zc.append(np.mean(vals))
            X, Y = x - W / 2, H / 2 - y
            P = [(X, Y, zc[0]), (X + 1, Y, zc[1]), (X + 1, Y - 1, zc[2]), (X, Y - 1, zc[3])]
            v = lambda q: [*q, *N[y, x], rgb[y, x], rgb[y, x], rgb[y, x]]
            tris += [[v(P[0]), v(P[1]), v(P[2])], [v(P[0]), v(P[2]), v(P[3])]]
    return np.array(tris, np.float32)


def picture_views(model, cfg, dex, scale=6):
    img, _ = tasks.picture(dex)
    p = tasks.predict(model, cfg, img); inside = ~outside(img)
    T = depth_mesh(img, p["normal"], p["depth"], inside) if "depth" in p else mesh("pic", p["normal"], img, inside)
    sh = np.repeat(tasks.SHADE[img][..., None], 3, -1)
    n = ((p["normal"] * 0.5 + 0.5) * 255).astype(np.uint8); n[~inside] = 255
    return row([_big(sh, scale), _big(n, scale), raster(T, rot(0, 0), scale), raster(T, rot(-50, 20), scale), raster(T, rot(-90, 0), scale)])


def attach(model, cfg, run):
    if cfg["task"] == "picture":
        run.image("3d-pictures.png", stack([picture_views(model, cfg, d) for d in PICS]),
                  "Each row: picture, predicted normals, 3D front-on, angled, from the side (depth layering)", kind="3d")
    else:
        run.image("3d-maps.png", stack([map_views(model, cfg, n, c) for n, c in MAP_SCENES]),
                  "Each row: map, predicted faces (top blue, front orange, slope purple, hips teal/pink), the editor's 3D from the game camera, isometric", kind="3d")
