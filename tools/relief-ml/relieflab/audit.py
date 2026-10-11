"""Tile-label audit (handoff 4.5: the labels are unvalidated). A model that never saw the rule
predicts faces on every real map; per label we measure how often it disagrees with the rule, and
list the blocks where it disagrees most, so Nick checks (or paints in the relief editor) the most
suspicious labels first. Disagreement is a pointer, not proof: the model has its own errors.

Publishes lab/datasets/label-audit/{dataset.json, labels.json, samples.json, files}.
"""
import collections
import numpy as np
from . import lab, tasks
from .evals import FACE_LABELS, normals_png, heat

DID = "label-audit"


def run(model_run, per_label=12):
    from .runner import _load_model
    h = lab.read_json(f"runs/{model_run}/run.json"); cfg = h["config"]
    if cfg["task"] == "faces" and cfg["real"]["share"] > 0:
        raise SystemExit("audit needs a model trained without rule labels (real.share = 0)")
    model = _load_model(cfg, model_run)
    stats = collections.defaultdict(lambda: dict(pixels=0, agree=0, pred=np.zeros(5, np.int64), maps=set(), tiles=set()))
    blocks = collections.defaultdict(list)   # label -> [(disagree, map, bx, by)]
    D = tasks.rom(); cache = {}
    for m in D["maps"]:
        name = m["name"]
        try: img, labs = tasks.map_img(name)
        except Exception: continue
        if img.shape[0] < 16 or img.shape[1] < 16: continue
        p = tasks.predict(model, cfg, img, labs)
        f = (p["faces"] if "faces" in p else (p["normal"] @ tasks.FACES.T).argmax(-1)).astype(np.uint8)
        cache[name] = (img, labs, f)
        ts = D["tilesets"][m["tileset"]]
        for (ty, tx), l in np.ndenumerate(labs):
            if l in tasks.SKIP: continue
            rf = tasks.rule(l)[0]
            t = f[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8]
            s = stats[l]; s["pixels"] += 64; s["agree"] += int((t == rf).sum())
            s["pred"] += np.bincount(t.ravel(), minlength=5); s["maps"].add(name)
            bi = m["blocks"][(ty // 4) * m["w"] + tx // 4]
            s["tiles"].add((m["tileset"], ts["blocks"][bi * 16 + (ty % 4) * 4 + tx % 4]))
        for by in range(m["h"]):
            for bx in range(m["w"]):
                L = labs[by * 4:by * 4 + 4, bx * 4:bx * 4 + 4]
                c = collections.Counter(l for l in L.ravel() if l not in tasks.SKIP)
                if not c: continue
                l, n = c.most_common(1)[0]
                mask = np.kron(L == l, np.ones((8, 8), bool))
                fb = f[by * 32:by * 32 + 32, bx * 32:bx * 32 + 32]
                dis = float((fb[mask] != tasks.rule(l)[0]).mean())
                blocks[l].append((dis, name, bx, by, m["tileset"], m["blocks"][by * m["w"] + bx]))
    rows = {}
    for l, s in stats.items():
        rows[l] = dict(ruleFace=FACE_LABELS[tasks.rule(l)[0]], pixels=s["pixels"], maps=len(s["maps"]), distinctTiles=len(s["tiles"]),
                       agreement=s["agree"] / s["pixels"], modelShare={FACE_LABELS[i]: float(v / s["pixels"]) for i, v in enumerate(s["pred"])})
    lab.write_json(f"datasets/{DID}/labels.json", dict(schema=lab.SCHEMA, model=model_run, labels=dict(sorted(rows.items(), key=lambda kv: kv[1]["agreement"]))))
    # Samples: per label, the most-disagreeing distinct blocks (one per tileset block), worst labels first.
    items, layers = [], {"input": dict(label="Game art", encoding="shades"), "rule": dict(label="Rule labels", encoding="faces", truth=True),
                         "pred": dict(label="Label-free model", encoding="faces"), "err": dict(label="Disagreement", encoding="error")}
    for l in sorted(rows, key=lambda k: rows[k]["agreement"]):
        seen = set(); k = 0
        for dis, name, bx, by, tsid, blk in sorted(blocks[l], key=lambda x: -x[0]):
            if (tsid, blk) in seen: continue
            seen.add((tsid, blk))
            img, labs, fm = cache[name]
            sl = (slice(by * 32, by * 32 + 32), slice(bx * 32, bx * 32 + 32))
            f = fm[sl]
            rf = np.kron(np.vectorize(lambda x: tasks.rule(x)[0])(labs[by * 4:by * 4 + 4, bx * 4:bx * 4 + 4]), np.ones((8, 8), np.uint8)).astype(np.uint8)
            base = f"samples/{l}-{k:02d}"
            files = {"input": f"{base}-input.png", "rule": f"{base}-rule.png", "pred": f"{base}-pred.png", "err": f"{base}-err.png"}
            lab.write_png(f"datasets/{DID}/{files['input']}", tasks.SHADE[img[sl]])
            lab.write_png(f"datasets/{DID}/{files['rule']}", rf)
            lab.write_png(f"datasets/{DID}/{files['pred']}", f)
            lab.write_png(f"datasets/{DID}/{files['err']}", heat((f != rf).astype(float)))
            items.append(dict(id=f"map:{name}:{bx},{by},1,1", title=f"{l}: {name} block {bx},{by}", width=32, height=32,
                              files=files, scores=dict(disagree=dis, labelAgreement=rows[l]["agreement"]), tags=[l]))
            k += 1
            if k >= per_label: break
    lab.write_json(f"datasets/{DID}/samples.json", dict(schema=lab.SCHEMA, title="Tile labels, most suspicious first", view="map", layers=layers, items=items))
    header = dict(schema=lab.SCHEMA, id=DID, title="Tile-label audit", kind="rom", view="map", status="done", created=lab.now(), updated=lab.now(),
                  config=dict(model=model_run, perLabel=per_label), samples=["samples.json"],
                  findings=[f"{l}: rule says {r['ruleFace']}, label-free model agrees on {r['agreement']:.0%} of pixels"
                            for l, r in sorted(rows.items(), key=lambda kv: kv[1]["agreement"])[:8]])
    lab.write_json(f"datasets/{DID}/dataset.json", header); lab.update_index(dataset_header=header)
    return rows
