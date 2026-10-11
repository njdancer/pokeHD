"""Fit the renderer's style to real ROM art: match P(shade | surface orientation) on labelled maps.

Real side: every pixel of the eval maps whose tile label implies TOP / FRONT / SLOPE.
Synthetic side: cached geometry for a batch of random scenes; style parameters are searched so the
same class-conditional shade histograms match. Prints the best styles and saves them to styles.json.
"""
import json, sys, numpy as np
from multiprocessing import Pool
from render import render_buffers, shadow, ao
from style import pool, mode_ids, albedo_map, quantise, outlines, light_dir
from scenes import map_scene
from eval_real import load_maps, DEFAULT_MAPS, REF

AZ, EL = [-15, 15, 45, 75], [20, 40, 60, 80]
SS, W = 2, 48


def real_hist():
    ms = load_maps(DEFAULT_MAPS)
    S = np.concatenate([i.ravel() for _, i, _ in ms]); G = np.concatenate([g.ravel() for *_, g in ms])
    return np.stack([np.bincount(S[G == c], minlength=4) / (G == c).sum() for c in range(3)])


def cache_one(seed):
    rng = np.random.default_rng(10_000_000 + seed)
    sc, org = map_scene(rng, W, W)
    buf = render_buffers(sc, "map", W, W, SS, org)
    hit = buf["hit"]; P, N = buf["P"][hit], buf["N"][hit]
    sh = np.ones((len(AZ) * len(EL), *hit.shape))
    k = 0
    for az in AZ:
        for el in EL:
            s = np.ones(hit.shape); s[hit] = shadow(sc, P, light_dir(az, el)); sh[k] = s; k += 1
    occ = np.ones(hit.shape); occ[hit] = ao(sc, P, N)
    t = buf["t"].copy(); t[~np.isfinite(t)] = 1e3
    return dict(N=buf["N"], hit=hit, alb=albedo_map(sc, buf), sh=sh.astype(np.float32), ao=occ, ids=mode_ids(buf["ids"], SS), depth=pool(t, SS))


def render_style(c, st):
    li = st["li"]; L = light_dir(AZ[li // len(EL)], EL[li % len(EL)])
    lam = np.clip((c["N"] @ L + st["wrap"]) / (1 + st["wrap"]), 0, 1)
    sh = 1 - st["shs"] * (1 - c["sh"][li]); occ = 1 - st["aos"] * (1 - c["ao"])
    I = np.where(c["hit"], c["alb"] ** st["gamma"] * (st["amb"] + st["kd"] * lam * sh) * occ, 1.0)
    img = quantise(pool(I, SS), st["th"], st["dither"])
    if st["outline"]:
        img[outlines(c["ids"], c["depth"], st["jump"], st["gout"])] = 3
    return img


def synth_hist(cache, st):
    h = np.zeros((3, 4))
    for c in cache:
        img = render_style(c, st)
        N = pool(c["N"], SS); N /= np.maximum(np.linalg.norm(N, axis=-1, keepdims=True), 1e-9)
        dots = N @ REF.T; cls = dots.argmax(-1); ok = dots.max(-1) > 0.95
        obj = c["ids"] >= 0
        for k in range(3):
            m = ok & (cls == k) & (obj if k else np.ones_like(obj))
            h[k] += np.bincount(img[m], minlength=4)
    return h / np.maximum(h.sum(1, keepdims=True), 1)


def random_st(rng):
    th = np.sort(rng.uniform(0.1, 0.95, 3))[::-1]
    return dict(li=int(rng.integers(len(AZ) * len(EL))), wrap=rng.uniform(0, 1), shs=rng.uniform(0, 1), aos=rng.uniform(0, 1),
                gamma=rng.uniform(0.3, 1.5), amb=rng.uniform(0.1, 0.7), kd=rng.uniform(0.2, 1.0), th=tuple(th),
                dither=rng.choice([0.0, 0.1]), outline=True, jump=rng.uniform(0.8, 6), gout=bool(rng.random() < 0.5))


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 96
    R = real_hist(); print("real\n", R.round(3))
    with Pool(4) as p: cache = p.map(cache_one, range(n))
    rng = np.random.default_rng(1)
    res = []
    for i in range(3000):
        st = random_st(rng)
        d = np.abs(synth_hist(cache[:24], st) - R).sum()
        res.append((d, st))
    res.sort(key=lambda r: r[0])
    # refine the top 40 on the full cache
    top = [(np.abs(synth_hist(cache, st) - R).sum(), st) for _, st in res[:40]]
    top.sort(key=lambda r: r[0])
    for d, st in top[:8]:
        print(round(d, 3), {k: (round(v, 2) if isinstance(v, float) else v) for k, v in st.items() if k != "th"}, np.round(st["th"], 2))
    print("best synthetic hist\n", synth_hist(cache, top[0][1]).round(3))
    json.dump([dict(d=float(d), **{k: (list(v) if isinstance(v, tuple) else v) for k, v in st.items()}) for d, st in top[:20]],
              open("/tmp/claude-0/relief/data/styles.json", "w"), default=float, indent=1)
