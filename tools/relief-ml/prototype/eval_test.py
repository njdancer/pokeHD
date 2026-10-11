"""Score tile-label rule and models on the hand-made top/front test set (testset/objects.json)."""
import json, sys, numpy as np, torch
from romdata import map_img
from train_faces import rule, Faces
from train import load_model, predict
from render3d import FACES

T = json.load(open("/mnt/project-files/relief-synth/testset/objects.json"))["objects"]


def truth(o):
    yield from ((y, x, 0) for y in range(o["top"][0], o["top"][1] + 1) for x in range(o["x"][0], o["x"][1] + 1))
    yield from ((y, x, 1) for y in range(o["front"][0], o["front"][1] + 1) for x in range(o["x"][0], o["x"][1] + 1))


def faces_of(source, name):
    img, labs, _ = map_img(name)
    if source == "rule":
        f = np.vectorize(lambda l: rule(l)[0])(labs)
        return np.kron(f, np.ones((8, 8), int))
    return (predict(source, img) @ FACES.T).argmax(-1)


def score(source):
    per, hits, n = {}, 0, 0
    cache = {}
    for o in T:
        if o["map"] not in cache: cache[o["map"]] = faces_of(source, o["map"])
        f = cache[o["map"]]
        ok = [f[y, x] == c for y, x, c in truth(o)]
        per[o["name"]] = float(np.mean(ok)); hits += sum(ok); n += len(ok)
    return hits / n, per


def load_any(path):
    sd = torch.load(path)
    if any(k.startswith("net.") for k in sd):
        m = Faces(sd["net.out.weight"].shape[1]); m.load_state_dict(sd); m.eval(); return m
    return load_model(path)


if __name__ == "__main__":
    for src in sys.argv[1:]:
        acc, per = score("rule" if src == "rule" else load_any(src))
        print(f"{src}: pixels {acc:.3f} objects {np.mean(list(per.values())):.3f}  " + "  ".join(f"{k.split(',')[0][:18]}={v:.2f}" for k, v in per.items()))
