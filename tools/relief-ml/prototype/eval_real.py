"""Score a model on real ROM maps against normals implied by our tile labels (coarse ground truth).

Classes: TOP (ground, lawn, floor, water, tall grass), FRONT (walls, windows, doors, back walls,
shelves), SLOPE (roofs, 45°). Other labels are not scored. Usage: eval_real.py model.pt [maps…]
"""
import sys, numpy as np, torch
from romdata import D, map_img
from train import UNet, predict

CLS = {"TOP": ["ground", "lawn", "floor", "water", "tall-grass"],
       "FRONT": ["wall", "window", "door", "wall-interior", "shelf"],
       "SLOPE": ["roof"]}
NAMES = list(CLS)
REF = np.array([[0, 1, 0], [0, 0, 1], [0, np.sqrt(.5), np.sqrt(.5)]])
LAB2C = {l: i for i, k in enumerate(NAMES) for l in CLS[k]}

DEFAULT_MAPS = ["PALLET_TOWN", "VIRIDIAN_CITY", "PEWTER_CITY", "CERULEAN_CITY", "VERMILION_CITY", "CELADON_CITY",
                "LAVENDER_TOWN", "FUCHSIA_CITY", "SAFFRON_CITY", "CINNABAR_ISLAND", "ROUTE_1", "ROUTE_2",
                "REDS_HOUSE_1F", "REDS_HOUSE_2F", "OAKS_LAB", "VIRIDIAN_POKECENTER", "VIRIDIAN_MART",
                "BLUES_HOUSE", "MUSEUM_1F", "PEWTER_GYM", "CELADON_MANSION_1F", "VIRIDIAN_SCHOOL_HOUSE"]


def gt(labs):
    g = np.full((labs.shape[0] * 8, labs.shape[1] * 8), -1, np.int8)
    for ty in range(labs.shape[0]):
        for tx in range(labs.shape[1]):
            g[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = LAB2C.get(labs[ty, tx], -1)
    return g


def classify(N):
    return (N @ REF.T).argmax(-1)


def score(pred, g):
    m = g >= 0
    acc = [(pred[m & (g == c)] == c).mean() if (m & (g == c)).any() else np.nan for c in range(3)]
    return np.array(acc), np.nanmean(acc)


def load_maps(names):
    out = []
    for n in names:
        try: img, labs, ts = map_img(n)
        except StopIteration: continue
        out.append((n, img, gt(labs)))
    return out


def evaluate(model, names=DEFAULT_MAPS):
    """Per-class accuracy of the model and of the shade-only oracle on real labelled maps."""
    maps = load_maps(names)
    allp, allg, alls, alla = [], [], [], []
    for n, img, g in maps:
        N = predict(model, img); p = classify(N); allp.append(p.ravel()); allg.append(g.ravel()); alls.append(img.ravel())
        ref = REF[np.maximum(g, 0)]
        alla.append(np.degrees(np.arccos(np.clip((N * ref).sum(-1), -1, 1))).ravel())
    P, G, S, A = map(np.concatenate, (allp, allg, alls, alla))
    angle = {k: float(np.median(A[G == i])) for i, k in enumerate(NAMES)}
    acc, bal = score(P, G)
    m = G >= 0
    lut = np.array([np.bincount(G[m & (S == s)], minlength=3) / np.maximum(1, np.bincount(G[m], minlength=3)) for s in range(4)]).argmax(1)
    oacc, obal = score(lut[S], G)
    return dict(model={**dict(zip(NAMES, acc)), "balanced": bal}, median_angle=angle, shade_oracle={**dict(zip(NAMES, oacc)), "balanced": obal},
                chance=1 / 3, pixels={k: int((G == i).sum()) for i, k in enumerate(NAMES)}, maps=[n for n, *_ in maps])


if __name__ == "__main__":
    model = UNet(); model.load_state_dict(torch.load(sys.argv[1])); model.eval()
    maps = load_maps(sys.argv[2:] or DEFAULT_MAPS)
    allp, allg, alls = [], [], []
    for n, img, g in maps:
        N = predict(model, img)
        p = classify(N); allp.append(p.ravel()); allg.append(g.ravel()); alls.append(img.ravel())
    P, G, S = map(np.concatenate, (allp, allg, alls))
    acc, bal = score(P, G)
    print("model         per-class", dict(zip(NAMES, acc.round(3))), "balanced", round(bal, 3))
    # Oracle baseline: best class for each shade, fitted on this very data (what shade alone can say)
    m = G >= 0
    lut = np.array([np.bincount(G[m & (S == s)], minlength=3) / np.maximum(1, np.bincount(G[m], minlength=3)) for s in range(4)]).argmax(1)
    acc, bal = score(lut[S], G)
    print("shade oracle  per-class", dict(zip(NAMES, acc.round(3))), "balanced", round(bal, 3), "lut", lut)
    print("chance        balanced 0.333")
