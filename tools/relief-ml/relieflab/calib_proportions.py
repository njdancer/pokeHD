"""Calibration check: share of TOP among an object's top+front pixels, per furniture type, in
synthetic furniture rooms vs the hand-made test set. Usage: python -m relieflab.calib_proportions [n]"""
import collections, json, sys
from concurrent.futures import ProcessPoolExecutor
import numpy as np
from . import tasks
from .paths import TESTSET

KIND = {"table": "table", "desk": "table", "chair": "chair", "shelves": "shelf", "bookshelves": "shelf", "counter": "counter", "tv": "tv"}


def real():
    out = collections.defaultdict(list)
    for o in json.loads(TESTSET.read_text())["objects"]:
        k = next((v for w, v in KIND.items() if w in o["name"].lower()), "other")
        t = o["top"][1] - o["top"][0] + 1; f = o["front"][1] - o["front"][0] + 1
        out[k].append(t / (t + f))
    return {k: float(np.mean(v)) for k, v in out.items()}


def _one(seed):
    from .synth import scenes
    from .datasets import _sample
    scenes.ROOM_SHARE, scenes.FURNITURE_SHARE = 1.0, 1.0
    import os; scenes.CHAIR_BACK = float(os.environ.get("CHAIR_BACK", scenes.CHAIR_BACK))
    if not getattr(scenes, "_tagged", False):
        def tag(fn, kind):
            def g(*a, **k):
                ps = fn(*a, **k)
                for p in ps: p.furn = kind
                return ps
            return g
        names = {"obj_table_game": "table", "obj_chair": "chair", "obj_counter": "counter", "obj_shelf": "shelf"}
        scenes.FURNITURE[:] = [tag(f, names.get(f.__name__, f.__name__)) for f in scenes.FURNITURE]
        scenes._tagged = True
    captured = {}
    orig = scenes.room_scene
    def rs(rng, W, H):
        sc, org = orig(rng, W, H); captured["sc"] = sc; return sc, org
    scenes.room_scene = rs
    try:
        img, N, ids, _ = _sample(seed, "map")
    finally:
        scenes.room_scene = orig
    sc = captured.get("sc")
    f = (N @ tasks.FACES.T).argmax(-1)
    tally = collections.defaultdict(lambda: np.zeros(2))
    if sc is None: return {}
    for i, p in enumerate(sc.prims):
        k = getattr(p, "furn", None)
        if not k: continue
        m = ids == i
        tally[k] += [(m & (f == 0)).sum(), (m & (f == 1)).sum()]
    return {k: v.tolist() for k, v in tally.items()}


def synth(n=200, seed=9100000):
    tot = collections.defaultdict(lambda: np.zeros(2))
    with ProcessPoolExecutor(8) as ex:
        for d in ex.map(_one, range(seed, seed + n)):
            for k, v in d.items(): tot[k] += v
    return {k: float(v[0] / max(1, v.sum())) for k, v in tot.items()}


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    R, S = real(), synth(n)
    for k in sorted(set(R) | set(S)):
        print(f"{k:8s} real top share {R.get(k, float('nan')):.2f}   synthetic {S.get(k, float('nan')):.2f}")
