"""Turns render buffers into a 4-shade Game Boy sprite (0 white … 3 black) plus pixel normals."""
import numpy as np
from .render import shadow, ao

BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0 - 0.5 + 1 / 32


def light_dir(az_deg, el_deg):
    """az: 0 = from the viewer's side (+z), positive turns towards the left (-x). el above horizon."""
    a, e = np.radians(az_deg), np.radians(el_deg)
    return np.array([-np.sin(a) * np.cos(e), np.sin(e), np.cos(a) * np.cos(e)])


def pool(a, ss):
    H, W = a.shape[0] // ss, a.shape[1] // ss
    return a.reshape(H, ss, W, ss, *a.shape[2:]).mean((1, 3))


def mode_ids(ids, ss):
    H, W = ids.shape[0] // ss, ids.shape[1] // ss
    blocks = ids.reshape(H, ss, W, ss).transpose(0, 2, 1, 3).reshape(H, W, ss * ss)
    out = np.empty((H, W), ids.dtype)
    for y in range(H):
        for x in range(W):
            v, c = np.unique(blocks[y, x], return_counts=True); out[y, x] = v[c.argmax()]
    return out


def albedo_map(scene, buf):
    """Per-subsample albedo (1 = white … 0 = black), including procedural textures."""
    ids, P = buf["ids"], buf["P"]
    alb = np.ones(ids.shape)
    for i, pr in enumerate(scene.prims):
        m = ids == i
        if not m.any():
            continue
        a = np.full(m.sum(), float(pr.albedo))
        if pr.tex is not None:
            a = pr.tex(pr.local(P[m]), a)
        alb[m] = a
    m = ids == -2
    if m.any():
        a = np.full(m.sum(), float(scene.ground_albedo))
        if scene.ground_tex is not None:
            a = scene.ground_tex(P[m], a)
        alb[m] = a
    return alb


def intensity(scene, buf, L, ambient=0.35, kd=0.75, use_shadow=True, use_ao=True, wrap=0.0, spec=0.0, shs=1.0, aos=1.0, gamma=1.0):
    hit, N, P = buf["hit"], buf["N"], buf["P"]
    I = np.ones(hit.shape)  # background white
    if hit.any():
        n = N[hit]
        lam = np.clip((n @ L + wrap) / (1 + wrap), 0, 1)
        sh = 1 - shs * (1 - shadow(scene, P[hit], L)) if use_shadow else 1.0
        occ = 1 - aos * (1 - ao(scene, P[hit], n)) if use_ao else 1.0
        light = (ambient + kd * lam * sh) * occ
        if spec > 0:
            v = np.array([0, 1, 1]) / np.sqrt(2)
            hvec = (L + v) / np.linalg.norm(L + v)
            light = light + spec * np.clip(n @ hvec, 0, 1) ** 20 * sh
        I[hit] = albedo_map(scene, buf)[hit] ** gamma * light
    return I


def quantise(I, thresholds, dither=0.0, offset=(0, 0)):
    """Brightness → colour number 0 (white) … 3 (black). dither widens each threshold into an
    ordered-dither band."""
    H, W = I.shape
    b = BAYER4[(np.arange(H)[:, None] + offset[0]) % 4, (np.arange(W)[None] + offset[1]) % 4]
    v = I + dither * b
    t1, t2, t3 = thresholds  # descending brightness cut-offs
    return np.where(v > t1, 0, np.where(v > t2, 1, np.where(v > t3, 2, 3))).astype(np.uint8)


def outlines(ids, depth, jump=1.5, ground_outline=True, crease=None, N=None, crease_deg=60):
    """Pixels on an object's edge: next to background/ground, or a depth jump towards something behind."""
    obj = ids >= 0
    out = np.zeros_like(obj)
    H, W = ids.shape
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nb_ids = np.full_like(ids, -1); nb_d = np.full(depth.shape, np.inf)
        ys = slice(max(dy, 0), H + min(dy, 0)); yd = slice(max(-dy, 0), H + min(-dy, 0))
        xs = slice(max(dx, 0), W + min(dx, 0)); xd = slice(max(-dx, 0), W + min(-dx, 0))
        nb_ids[yd, xd] = ids[ys, xs]; nb_d[yd, xd] = depth[ys, xs]
        bg = nb_ids == -1
        gr = nb_ids == -2
        far = nb_d - depth > jump  # neighbour is further from the camera (larger t)
        out |= obj & (bg | (gr & ground_outline) | far)
        if crease is not None and N is not None:
            nb_n = np.zeros_like(N); nb_n[yd, xd] = N[ys, xs]
            cosang = (N * nb_n).sum(-1)
            out |= obj & (nb_ids >= 0) & (cosang < np.cos(np.radians(crease_deg))) & crease
    return out


def stylise(scene, buf, ss, L, thresholds=(0.8, 0.55, 0.3), ambient=0.35, kd=0.75, dither=0.0,
            outline=True, jump=1.5, ground_outline=True, crease=False, use_shadow=True, use_ao=True,
            wrap=0.0, spec=0.0, dither_offset=(0, 0), shs=1.0, aos=1.0, gamma=1.0):
    I = pool(intensity(scene, buf, L, ambient, kd, use_shadow, use_ao, wrap, spec, shs, aos, gamma), ss)
    img = quantise(I, thresholds, dither, dither_offset)
    ids = mode_ids(buf["ids"], ss)
    t = buf["t"].copy(); t[~np.isfinite(t)] = 1e3
    depth = pool(t, ss)
    N = pool(buf["N"], ss); N /= np.maximum(np.linalg.norm(N, axis=-1, keepdims=True), 1e-9)
    # Flat white parts (fur, bellies): white whatever way they face, like the game's white areas.
    flat = [i for i, p in enumerate(scene.prims) if getattr(p, "flat", False)]
    if flat: img[np.isin(ids, flat)] = 0
    if outline:
        o = outlines(ids, depth, jump, ground_outline, crease if crease else None, N)
        # "Open" parts have no outline against the background, so white meets white as in many sprites.
        opn = [i for i, p in enumerate(scene.prims) if getattr(p, "open", False)]
        if opn: o &= ~(np.isin(ids, opn) & next_to_background(ids))
        img[o] = 3
    return img, N, ids, I


def next_to_background(ids):
    bg = ids == -1
    nb = np.zeros_like(bg)
    nb[1:] |= bg[:-1]; nb[:-1] |= bg[1:]; nb[:, 1:] |= bg[:, :-1]; nb[:, :-1] |= bg[:, 1:]
    return nb
