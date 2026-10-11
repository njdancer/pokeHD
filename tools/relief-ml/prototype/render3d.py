"""Predicted normals → the relief editor's own 3D mesh (shape.ts via Node) → lit renders, front-on and isometric.

Maps use mapRelief (the game's three-quarter view, columns walked from the bottom); pictures use
pictureRelief (heights solved from the normals). Nothing here invents shape: the mesh is exactly
what the editor would build if the predicted normals had been painted by hand.
"""
import json, subprocess, numpy as np
from scipy import ndimage
from romdata import map_img, SHADE
from train import predict
from eval_real import LAB2C

NODE = "/root/.local/share/mise/installs/node/24.21.0/bin/node"
GROUND = {"ground", "lawn", "tall-grass", "flower", "water", "shore", "bridge", "floor", "void", "unused"}  # normals.ts GROUND_LABELS
_r = np.sqrt(0.5)
# The relief plan's five brushes (normals.ts: TOP, FRONT, slope(45), hip(-1, 45), hip(1, 45)) and their paint colours
FACES = np.array([[0, 1, 0], [0, 0, 1], [0, _r, _r], [-_r, _r, 0], [_r, _r, 0]])
FACE_RGB = np.array([[0x3a, 0x9e, 0xe0], [0xe0, 0x8a, 0x1e], [0x8a, 0x5c, 0xc8], [0x28, 0xbe, 0xa0], [0xdc, 0x50, 0x8c]], np.uint8)


def snap(N):
    """Each pixel to the nearest brush, as if the predicted normals had been painted in the editor."""
    k = (N @ FACES.T).argmax(-1)
    return FACES[k], k


def mesh(kind, N, img, mask, depth=1.0):
    """(T, 3, 9) triangles: position, normal, colour per vertex."""
    rgb = np.repeat(SHADE[img][..., None], 3, -1)
    j = dict(kind=kind, w=int(img.shape[1]), h=int(img.shape[0]), n=np.round(N, 4).ravel().tolist(),
             c=rgb.ravel().tolist(), g=mask.astype(int).ravel().tolist(), depth=depth)
    out = subprocess.run([NODE, "/tmp/claude-0/relief/src/mesh.ts"], input=json.dumps(j).encode(), capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32).reshape(-1, 3, 9)


def rot(yaw, pitch):
    y, p = np.radians(yaw), np.radians(pitch)
    Ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(p), -np.sin(p)], [0, np.sin(p), np.cos(p)]])
    return Rx @ Ry


LIGHT = np.array([-0.45, 0.75, 0.55]); LIGHT /= np.linalg.norm(LIGHT)


def raster(T, R, scale=6, pad=4, bg=(28, 32, 26)):
    """Orthographic z-buffered render. Camera looks down -z after rotating the world by R."""
    P = T[..., :3] @ R.T
    shade = np.clip((T[:, 0, 3:6] @ LIGHT), 0, 1) * 0.7 + 0.35  # flat per face, world-space light
    col = np.clip(T[:, 0, 6:9] * shade[:, None], 0, 1)
    xy = P[..., :2] * scale; xy[..., 1] *= -1
    lo = xy.reshape(-1, 2).min(0) - pad * scale
    xy -= lo
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


def fit(a, h):
    """Pad an image to height h (centred) so panels line up in a row."""
    if a.shape[0] >= h: return a
    t = (h - a.shape[0]) // 2
    return np.pad(a, ((t, h - a.shape[0] - t), (0, 0), (0, 0)), constant_values=28)


def row(parts, gap=12):
    h = max(p.shape[0] for p in parts)
    out = []
    for p in parts: out += [fit(p, h), np.full((h, gap, 3), 255, np.uint8)]
    return np.concatenate(out[:-1], 1)


def sprite_and_normals(img, N, scale, mask=None):
    s = np.repeat(SHADE[img][..., None], 3, -1); n = ((N * 0.5 + 0.5) * 255).astype(np.uint8)
    if mask is not None: n[~mask] = 255
    k = np.ones((scale, scale, 1), np.uint8)
    return np.kron(s, k), np.kron(n, k)


def map_views(model, name, crop, scale=6):
    """Sprite | predicted normals (full pixel resolution) | 3D front-on | 3D isometric."""
    img, labs, _ = map_img(name)
    img = img[crop[0]:crop[1], crop[2]:crop[3]]; labs = labs[crop[0] // 8:crop[1] // 8, crop[2] // 8:crop[3] // 8]
    N = predict(model, img)
    lab = np.kron(np.array([[l in GROUND for l in r] for r in labs]), np.ones((8, 8), bool))
    ground = lab & (N[..., 1] > 0.9)  # same rule as the editor: ground label and a sky-facing normal
    S, k = snap(N)
    T = mesh("map", S, img, ground)
    s, n = sprite_and_normals(img, N, scale)
    f = np.kron((np.repeat(SHADE[img][..., None], 3, -1) * 0.35 + FACE_RGB[k] * 0.65).astype(np.uint8), np.ones((scale, scale, 1), np.uint8))
    return row([s, n, f, raster(T, rot(0, 45), scale), raster(T, rot(-35, 30), scale)])  # game camera (front-on as played), then isometric


def outside(img):
    """White pixels connected to the frame edge are background."""
    lab, _ = ndimage.label(img == 0)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return np.isin(lab, list(edge))


def depth_mesh(img, N, z, inside, thr=2.5):
    """Triangles for a picture built from predicted depth: one quad per pixel, corners shared with
    neighbours at a similar depth and torn apart where depth jumps (an arm in front of a body)."""
    H, W = img.shape
    rgb = SHADE[img] / 255.0
    z = np.where(inside, z - z[inside].mean(), 0)
    tris = []
    for y in range(H):
        for x in range(W):
            if not inside[y, x]: continue
            zc = []
            for cy, cx in ((y, x), (y, x + 1), (y + 1, x + 1), (y + 1, x)):  # corners: TL, TR, BR, BL
                vals = [z[j, i] for j in (cy - 1, cy) for i in (cx - 1, cx)
                        if 0 <= j < H and 0 <= i < W and inside[j, i] and abs(z[j, i] - z[y, x]) < thr]
                zc.append(np.mean(vals))
            X, Y = x - W / 2, H / 2 - y
            P = [(X, Y, zc[0]), (X + 1, Y, zc[1]), (X + 1, Y - 1, zc[2]), (X, Y - 1, zc[3])]
            v = lambda p: [*p, *N[y, x], rgb[y, x], rgb[y, x], rgb[y, x]]
            tris += [[v(P[0]), v(P[1]), v(P[2])], [v(P[0]), v(P[2]), v(P[3])]]
    return np.array(tris, np.float32)


def picture_views(model, img, scale=6, depth=1.0):
    """Picture, normals, front-on, angled. Outside the silhouette (white joined to the frame edge) is
    background; everything inside gets a surface, white or not."""
    from train import predict_depth
    N = predict(model, img); inside = ~outside(img)
    z = predict_depth(model, img)
    T = depth_mesh(img, N, z, inside) if z is not None else mesh("pic", N, img, inside, depth)
    s, n = sprite_and_normals(img, N, scale, inside)
    return row([s, n, raster(T, rot(0, 0), scale), raster(T, rot(-50, 20), scale)])


def stack(rows, gap=16):
    w = max(r.shape[1] for r in rows)
    return np.concatenate([np.pad(r, ((0, gap), (0, w - r.shape[1]), (0, 0)), constant_values=255) for r in rows], 0)


MAP_SCENES = [("PALLET_TOWN", (40, 104, 56, 136)), ("PALLET_TOWN", (24, 104, 152, 280)), ("OAKS_LAB", (0, 96, 0, 160))]
PICS = [1, 25, 94, 143]


def attach(run, model, view):
    """3D renders of the model's relief on real sprites, added to a run's gallery."""
    if view == "map":
        run.image("3d-maps.png", stack([map_views(model, n, c) for n, c in MAP_SCENES]),
                  "Predicted normals snapped to the relief plan's five brushes (top blue, front orange, slope purple, hips teal/pink), built in 3D by the relief editor's mesh code. Each row: sprite, raw normals, faces, game camera, isometric")
    else:
        from romdata import D
        rows = []
        for p in D["pics"]:
            if p["dex"] not in PICS: continue
            img = np.pad(np.array(p["px"], np.uint8).reshape(p["h"], p["w"]), ((0, 56 - p["h"]), (0, 56 - p["w"])))
            rows.append(picture_views(model, img))
        run.image("3d-pictures.png", stack(rows), "3D relief from predicted normals (relief editor mesh). Each row: picture, normals, front-on, angled")


if __name__ == "__main__":
    import sys, torch
    from train import UNet
    from runlog import Run
    path, width, view, run_id = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
    m = UNet(width); m.load_state_dict(torch.load(path)); m.eval()
    attach(Run(None, None, run_id=run_id), m, view); print("ok")
