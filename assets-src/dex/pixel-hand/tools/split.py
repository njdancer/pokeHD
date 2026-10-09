"""Split a hand sprite into front (thumb only) and back layers at the device edge.

usage: split.py cand_dir [cand_dir ...]   (reads sprite.png + meta.json, writes front/back.png)

The device's bottom edge (meta["edge_row"], rewritten here) sits on top of the knuckles, so the
hand supports it from below (set "edge_row_manual" in meta.json where the trace misses). The device covers everything above that row except the thumb, which rests on its face.
The thumb is traced down from its tip: on each row, take the opaque run that overlaps the
previous row's span. Once the run widens past the thumb (it has met a knuckle), clamp it to
the previous span. Everything else above the edge goes in the back layer, hidden behind the
device, so no knuckle is drawn in front of it.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def runs(row):
    out, x, w = [], 0, len(row)
    while x < w:
        if row[x]:
            s = x
            while x < w and row[x]:
                x += 1
            out.append((s, x))
        x += 1
    return out


def thumb_mask(alpha, edge):
    mask = np.zeros_like(alpha)
    top = int(np.argmax(alpha.any(axis=1)))
    span = max(runs(alpha[top]), key=lambda r: r[1] - r[0])
    for y in range(top, edge):
        cand = [r for r in runs(alpha[y]) if r[0] < span[1] and r[1] > span[0]]
        if not cand:
            break
        r = max(cand, key=lambda r: min(r[1], span[1]) - max(r[0], span[0]))
        if (r[1] - r[0]) > (span[1] - span[0]) + 2:  # grew into a knuckle: keep the thumb's width
            r = (max(r[0], span[0] - 1), min(r[1], span[1] + 1))
        mask[y, r[0]: r[1]] = True
        span = r
    return mask


def find_edge(alpha):
    """The device's bottom edge rests on the hand: the first row (below the thumb tip) where any
    pixel lies outside the traced thumb, i.e. the top of the knuckles, plus one row of overlap."""
    full = thumb_mask(alpha, alpha.shape[0])
    top = int(np.argmax(alpha.any(axis=1)))
    for y in range(top + 2, alpha.shape[0]):
        if (alpha[y] & ~full[y]).any():
            return y + 1
    return alpha.shape[0] // 3


def split(d):
    d = Path(d)
    meta = json.loads((d / "meta.json").read_text())
    rgba = np.asarray(Image.open(d / "sprite.png").convert("RGBA")).copy()
    alpha = rgba[..., 3] > 0
    meta["edge_row"] = meta.get("edge_row_manual") or find_edge(alpha)
    (d / "meta.json").write_text(json.dumps(meta, indent=1))
    thumb = thumb_mask(alpha, meta["edge_row"])
    front, back = rgba.copy(), rgba.copy()
    front[~thumb, 3] = 0
    back[thumb, 3] = 0
    Image.fromarray(front).save(d / "front.png")
    Image.fromarray(back).save(d / "back.png")


if __name__ == "__main__":
    for d in sys.argv[1:]:
        split(d)
