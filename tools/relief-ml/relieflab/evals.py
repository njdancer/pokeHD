"""Evaluations and prediction sets, written in the contract's eval and sample-set shapes.

- testset:   the hand-made top/front boxes (13 objects), the only independent truth so far.
- real-maps: agreement with the tile-label rule on 22 held-out maps (TOP/FRONT/SLOPE). Circular
             whenever rule labels were in training.
- pics:      every Pokédex picture: normals, depth, silhouette.
- watch:     a few maps and pictures, refreshed after every epoch so learning is visible live.
"""
import json
import numpy as np
from scipy import ndimage
from . import lab, tasks
from .paths import TESTSET
from .train import EVAL_MAPS

FACE_LABELS = ["TOP", "FRONT", "SLOPE", "HIP◀", "HIP▶"]
REAL_CLS = {"TOP": ["ground", "lawn", "floor", "water", "tall-grass"],
            "FRONT": ["wall", "window", "door", "wall-interior", "shelf"],
            "SLOPE": ["roof"]}
LAB2C = {l: i for i, k in enumerate(REAL_CLS) for l in REAL_CLS[k]}
WATCH_MAPS = ["PALLET_TOWN", "OAKS_LAB", "REDS_HOUSE_1F"]
WATCH_PICS = [1, 25, 94, 143]


def bootstrap(scores, n=2000, seed=0):
    """95% interval of the mean by resampling objects (pixels within an object are not independent)."""
    a = np.asarray(scores, float); r = np.random.default_rng(seed)
    m = a[r.integers(0, len(a), (n, len(a)))].mean(1)
    return float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))


def category(title):
    """Test objects by kind, so a model can't win by being good at the most numerous kind only."""
    t = title.lower()
    if "roof" in t or "wall" in t: return "buildings"
    if "chair" in t: return "chairs"
    if "table" in t or "desk" in t: return "tables"
    return "storage"   # shelves, bookshelves, TV, counter


def faces_of(pred):
    return pred["faces"] if "faces" in pred else (pred["normal"] @ tasks.FACES.T).argmax(-1).astype(np.uint8)


def rule_faces(labs):
    f = np.vectorize(lambda l: tasks.rule(l)[0])(labs).astype(np.uint8)
    return np.kron(f, np.ones((8, 8), np.uint8))


def normals_png(N, alpha=None):
    rgb = (N * 127.5 + 127.5).round().clip(0, 255).astype(np.uint8)
    a = np.full(N.shape[:2], 255, np.uint8) if alpha is None else (alpha * 255).astype(np.uint8)
    return np.concatenate([rgb, a[..., None]], -1)


def heat(err):
    """0..1 → black-red-yellow heatmap (brighter is worse)."""
    e = np.clip(err, 0, 1)
    return np.stack([np.clip(e * 2, 0, 1), np.clip(e * 2 - 1, 0, 1), np.zeros_like(e)], -1).__mul__(255).astype(np.uint8)


def outside(img):
    """White pixels connected to the frame edge are background (handoff 4.7)."""
    lab_, _ = ndimage.label(img == 0)
    edge = set(np.unique(np.concatenate([lab_[0], lab_[-1], lab_[:, 0], lab_[:, -1]]))) - {0}
    return np.isin(lab_, list(edge))


class PredSet:
    """Builds preds/<name>.json plus its files under preds/<name>/."""
    def __init__(self, run, name, title, view, layers):
        self.run, self.name = run, name
        self.doc = dict(schema=lab.SCHEMA, title=title, view=view, layers=layers, items=[])

    def item(self, sid, title, w, h, files, scores=None, tags=None):
        out = {}
        for layer, (kind, data) in files.items():
            rel = f"{self.name}/{_slug(sid)}-{layer}.{ 'f32' if kind == 'f32' else 'png'}"
            path = f"{self.run.base}/preds/{rel}"
            lab.write_f32(path, data) if kind == "f32" else lab.write_png(path, data)
            out[layer] = rel
        it = dict(id=sid, title=title, width=int(w), height=int(h), files=out)
        if scores: it["scores"] = {k: (None if v is None else float(v)) for k, v in scores.items()}
        if tags: it["tags"] = tags
        self.doc["items"].append(it)

    def save(self):
        lab.write_json(f"{self.run.base}/preds/{self.name}.json", self.doc)
        rel = f"preds/{self.name}.json"
        if rel not in self.run.h.get("preds", []): self.run.set(preds=self.run.h.get("preds", []) + [rel])
        return rel


def _slug(sid):
    return sid.replace(":", "_").replace(",", "-")


MAP_LAYERS = {"input": dict(label="Game art", encoding="shades"),
              "pred": dict(label="Predicted faces", encoding="faces"),
              "normals": dict(label="Predicted normals", encoding="normals"),
              "conf": dict(label="Uncertainty", encoding="error")}


def _map_files(img, p):
    f = {"input": ("png", tasks.SHADE[img]), "pred": ("png", faces_of(p)), "normals": ("png", normals_png(p["normal"]))}
    if "faceProb" in p: f["conf"] = ("png", heat(1 - p["faceProb"].max(0)))
    return f


def testset(model, cfg, run):
    T = json.loads(TESTSET.read_text())["objects"]
    ps = PredSet(run, "testset", "Hand-made test set maps", "map",
                 dict(MAP_LAYERS, truth=dict(label="Hand-made boxes", encoding="faces", truth=True),
                      rule=dict(label="Rule labels", encoding="faces", truth=True),
                      err=dict(label="Wrong vs boxes", encoding="error")))
    per, K, hits, n = [], np.zeros((5, 5), np.int64), 0, 0
    rule_hits = 0
    for name in sorted({o["map"] for o in T}):
        img, labs = tasks.map_img(name)
        p = tasks.predict(model, cfg, img, labs); f = faces_of(p); rf = rule_faces(labs)
        truth = np.full(img.shape, 255, np.uint8)
        for o in [o for o in T if o["map"] == name]:
            xs = slice(o["x"][0], o["x"][1] + 1)
            box = np.zeros(img.shape, bool)
            for key, face in (("top", 0), ("front", 1), ("slope", 2)):
                if key in o:
                    truth[o[key][0]:o[key][1] + 1, xs] = face; box[o[key][0]:o[key][1] + 1, xs] = True
            m = box
            ok = f[m] == truth[m]; rok = rf[m] == truth[m]
            per.append(dict(id=o["name"].lower().replace(" ", "-").replace("'", "").replace(",", "").replace(":", ""), title=o["name"],
                            sample=f"map:{name}", scores=dict(acc=float(ok.mean()), rule=float(rok.mean()))))
            hits += ok.sum(); n += m.sum(); rule_hits += rok.sum()
            np.add.at(K, (truth[m].astype(int), f[m].astype(int)), 1)
        m = truth < 255
        err = np.where(m, (f != truth).astype(float), 0)
        files = _map_files(img, p); files.update(truth=("png", truth), rule=("png", rf), err=("png", heat(err)))
        ps.item(f"map:{name}", name, img.shape[1], img.shape[0], files, scores=dict(acc=float((f[m] == truth[m]).mean())))
    acc = hits / n; om = float(np.mean([o["scores"]["acc"] for o in per]))
    lo, hi = bootstrap([o["scores"]["acc"] for o in per])
    cats = {}
    for o in per: cats.setdefault(category(o["title"]), []).append(o["scores"]["acc"])
    cat_mean = float(np.mean([np.mean(v) for v in cats.values()]))
    run.eval("testset", dict(title=f"Hand-made test set ({len(per)} objects)", split="testset", circular=False,
                             overall=dict(acc=float(acc), obj_mean=om, obj_mean_lo=lo, obj_mean_hi=hi, rule_acc=float(rule_hits / n)),
                             perClass=dict(acc={c: float(K[i, i] / K[i].sum()) for i, c in enumerate(FACE_LABELS[:3]) if K[i].sum()}),
                             confusion=dict(labels=FACE_LABELS, matrix=K.tolist()),
                             perObject=per, preds=[ps.save()]))
    return dict(test_acc=float(acc), test_obj_mean=om, test_obj_mean_lo=lo, test_obj_mean_hi=hi, test_cat_mean=cat_mean,
                **{f"test_{k}": float(np.mean(v)) for k, v in cats.items()})


def real_maps(model, cfg, run):
    circular = cfg["task"] == "faces" and cfg["real"]["share"] > 0
    ps = PredSet(run, "real-maps", "22 held-out real maps", "map",
                 dict(MAP_LAYERS, rule=dict(label="Rule labels", encoding="faces", truth=True),
                      err=dict(label="Disagrees with labels", encoding="error")))
    K = np.zeros((3, 5), np.int64); S = np.zeros((4, 3), np.int64)
    for name in EVAL_MAPS:
        img, labs = tasks.map_img(name)
        g = np.kron(np.vectorize(lambda l: LAB2C.get(l, -1))(labs), np.ones((8, 8), int))
        p = tasks.predict(model, cfg, img, labs); f = faces_of(p)
        m = g >= 0
        np.add.at(K, (g[m], f[m].astype(int)), 1); np.add.at(S, (img[m].astype(int), g[m]), 1)
        f3 = np.where(f > 2, 0, f)   # hips count as tops for the 3-class comparison
        err = np.where(m, (f3 != g).astype(float), 0)
        files = _map_files(img, p); files.update(rule=("png", rule_faces(labs)), err=("png", heat(err)))
        ok = (f3[m] == g[m]).mean() if m.any() else None
        ps.item(f"map:{name}", name, img.shape[1], img.shape[0], files, scores=dict(agree=ok))
    acc = {c: float(K[i, i] / max(1, K[i].sum())) for i, c in enumerate(REAL_CLS)}
    bal = float(np.mean(list(acc.values())))
    lut = (S / np.maximum(1, S.sum(0))).argmax(1)   # shade-only oracle: best class per shade
    oracle = float(np.mean([S[lut == i, i].sum() / max(1, S[:, i].sum()) for i in range(3)]))
    run.eval("real-maps", dict(title="Real maps vs tile-label rule", split="real-maps", circular=circular,
                               overall=dict(balanced=bal, shade_oracle=oracle, chance=1 / 3),
                               perClass=dict(acc=acc), confusion=dict(labels=FACE_LABELS, matrix=np.pad(K, ((0, 2), (0, 0))).tolist()),
                               preds=[ps.save()]))
    return dict(real_balanced=bal)


def pictures(model, cfg, run, dexes=None, name="pics", title="Pokédex pictures"):
    layers = {"input": dict(label="Picture", encoding="shades"), "normals": dict(label="Predicted normals", encoding="normals"),
              "mask": dict(label="Silhouette (flood fill)", encoding="mask")}
    if cfg["model"].get("depth"): layers["depth"] = dict(label="Predicted depth", encoding="depth")
    ps = PredSet(run, name, title, "pic", layers)
    for p in tasks.rom()["pics"]:
        if dexes and p["dex"] not in dexes: continue
        img, nm = tasks.picture(p["dex"])
        pr = tasks.predict(model, cfg, img); inside = ~outside(img)
        files = {"input": ("png", tasks.SHADE[img]), "normals": ("png", normals_png(pr["normal"], inside)),
                 "mask": ("png", inside.astype(np.uint8))}
        if "depth" in pr: files["depth"] = ("f32", np.where(inside, pr["depth"] - pr["depth"][inside].mean(), np.nan))
        ps.item(f"pic:{p['dex']}", f"#{p['dex']} {nm}", 56, 56, files)
    return ps.save()


def watch(model, cfg, run, epoch):
    """Small live set after each epoch: real maps for map tasks, a few pictures for picture tasks."""
    if cfg["task"] == "picture":
        pictures(model, cfg, run, WATCH_PICS, "watch", f"Watch set after epoch {epoch}")
        return
    ps = PredSet(run, "watch", f"Watch set after epoch {epoch}", "map", MAP_LAYERS)
    for name in WATCH_MAPS:
        img, labs = tasks.map_img(name)
        ps.item(f"map:{name}", name, img.shape[1], img.shape[0], _map_files(img, tasks.predict(model, cfg, img, labs)))
    ps.save()


def run_all(model, cfg, run):
    out = {}
    ev = cfg["eval"]
    if cfg["task"] in ("faces", "normals"):
        if ev.get("testset"): out.update(testset(model, cfg, run))
        if ev.get("realMaps"): out.update(real_maps(model, cfg, run))
        if ev.get("paintings"):   # only when Nick has said the paintings are real ground truth
            from . import paintings
            out.update(paintings.evaluate(model, cfg, run, EVAL_MAPS))
        if "paint_acc" in out and "test_obj_mean" in out:
            # Headline: furniture-heavy hand-made objects and building-heavy paintings, weighted equally.
            out["score"] = (out["paint_acc"] + out["test_obj_mean"]) / 2
    if cfg["task"] == "picture" and ev.get("pictures"):
        pictures(model, cfg, run)
    return out
