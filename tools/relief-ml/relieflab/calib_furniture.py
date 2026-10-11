"""Calibration check: P(shade | top or front) on synthetic furniture scenes vs the hand-made test
set's real furniture (13 objects). Usage: python -m relieflab.calib_furniture [n] [topLit]"""
import json, sys
from concurrent.futures import ProcessPoolExecutor
import numpy as np
from . import tasks
from .paths import TESTSET


def real():
    H = {0: np.zeros(4), 1: np.zeros(4)}
    for o in json.loads(TESTSET.read_text())["objects"]:
        img, _ = tasks.map_img(o["map"]); xs = slice(o["x"][0], o["x"][1] + 1)
        H[0] += np.bincount(img[o["top"][0]:o["top"][1] + 1, xs].ravel(), minlength=4)
        H[1] += np.bincount(img[o["front"][0]:o["front"][1] + 1, xs].ravel(), minlength=4)
    return {k: v / v.sum() for k, v in H.items()}


def _one(args):
    seed, top_lit, params = args
    from .synth import scenes
    from .datasets import _sample
    scenes.ROOM_SHARE, scenes.FURNITURE_SHARE, scenes.TOP_LIT = 1.0, 1.0, top_lit
    if params: scenes.TOP_LIT_PARAMS.update(params)
    import os
    scenes.TOP_PLAIN = float(os.environ.get("TOP_PLAIN", 0)); scenes.CHAIR_BACK = float(os.environ.get("CHAIR_BACK", scenes.CHAIR_BACK))
    img, N, ids, _ = _sample(seed, "map")
    f = (N @ tasks.FACES.T).argmax(-1); m = ids >= 0
    return [np.bincount(img[m & (f == k)], minlength=4) for k in (0, 1)]


def synth(n=160, top_lit=1.0, seed=9000000, params=None, ex=None):
    own = ex is None; ex = ex or ProcessPoolExecutor(8)
    res = list(ex.map(_one, [(seed + i, top_lit, params) for i in range(n)]))
    if own: ex.shutdown()
    H = [sum(r[k] for r in res) for k in (0, 1)]
    return {k: H[k] / H[k].sum() for k in (0, 1)}


def distance(a, b):
    """Total variation distance summed over top and front: 0 = identical, 2 = disjoint."""
    return float(sum(np.abs(a[k] - b[k]).sum() / 2 for k in (0, 1)))


def search(k=24, n=64, seed=0):
    """Random search over the top-lit style (centre ± small spread) to match the real shades."""
    R = real(); rng = np.random.default_rng(seed); out = []
    with ProcessPoolExecutor(8) as ex:
        for i in range(k):
            el = rng.uniform(30, 85); amb = rng.uniform(0.05, 0.5); kd = rng.uniform(0.4, 1.0)
            t1 = rng.uniform(0.7, 0.95); t2 = rng.uniform(0.35, t1 - 0.1); t3 = rng.uniform(0.1, t2 - 0.1)
            P = dict(el=(el - 5, el + 5), ambient=(amb - 0.03, amb + 0.03), kd=(kd - 0.05, kd + 0.05),
                     th=((t1 - .03, t1 + .03), (t2 - .03, t2 + .03), (t3 - .03, t3 + .03)))
            d = distance(R, synth(n, 1.0, params=P, ex=ex)); out.append((d, P))
            print(i, round(d, 3), [round(v, 2) for v in (el, amb, kd, t1, t2, t3)], flush=True)
    out.sort(key=lambda x: x[0])
    return out


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "search":
    best = search()
    print("BEST", round(best[0][0], 3), json.dumps(best[0][1]))
elif __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 160; tl = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
    R = real(); S = synth(n, tl)
    for k, nm in ((0, "top"), (1, "front")):
        print(f"{nm:5s} real {R[k].round(2)}  synth {S[k].round(2)}")
    print("distance", round(distance(R, S), 3))
