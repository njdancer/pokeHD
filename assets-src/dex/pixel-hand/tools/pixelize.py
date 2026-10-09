"""Turn a generated 'pixel art' image into a real sprite.

usage: pixelize.py raw.png outdir [--colors N] [--pixel P]
Writes outdir/sprite.png (true pixel grid, small palette, transparent bg),
outdir/front.png + back.png (the thumb, drawn in front of the device / the rest, via split.py)
and outdir/meta.json (pixel size, grid, edge row).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def period(img):
    """Model-drawn pixel size, from the spacing of colour edges."""
    a = np.asarray(img.convert("L"), dtype=np.float32)
    best = []
    for axis in (0, 1):
        d = np.abs(np.diff(a, axis=axis)).sum(axis=1 - axis)
        d = d - d.mean()
        ac = np.correlate(d, d, mode="full")[len(d) - 1:]
        lo = 6
        p = lo + int(np.argmax(ac[lo:40]))
        best.append(p)
    return float(np.mean(best))


def phase(img, p):
    """Offset of the grid on each axis: where the edge energy lines up best."""
    a = np.asarray(img.convert("L"), dtype=np.float32)
    out = []
    for axis in (0, 1):
        d = np.abs(np.diff(a, axis=axis)).sum(axis=1 - axis)
        offs = np.arange(0, p, 0.5)
        scores = []
        for o in offs:
            k = np.round(np.arange(o, len(d), p)).astype(int)
            scores.append(d[k[k < len(d)]].sum())
        out.append(float(offs[int(np.argmax(scores))]) + 1)
    return out  # (y0, x0): first cell starts here


def magenta(rgb):
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    return (r - g > 60) & (b - g > 40) & (r > 120)


def largest_component(mask):
    h, w = mask.shape
    seen = np.zeros_like(mask, bool)
    best = []
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not seen[y, x]:
                stack, comp = [(y, x)], []
                seen[y, x] = True
                while stack:
                    cy, cx = stack.pop()
                    comp.append((cy, cx))
                    for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
                if len(comp) > len(best):
                    best = comp
    out = np.zeros_like(mask)
    for y, x in best:
        out[y, x] = True
    return out


def main():
    src, outdir = Path(sys.argv[1]), Path(sys.argv[2])
    colors = int(sys.argv[sys.argv.index("--colors") + 1]) if "--colors" in sys.argv else 12
    outdir.mkdir(parents=True, exist_ok=True)
    img = Image.open(src).convert("RGB")
    if "--pixel" in sys.argv:  # model drew finer pixels than we want: force the grid
        p = float(sys.argv[sys.argv.index("--pixel") + 1])
        y0 = x0 = 0.0
    else:
        p = period(img)
        y0, x0 = phase(img, p)
    a = np.asarray(img)
    H, W = a.shape[:2]
    ny, nx = int((H - y0) // p), int((W - x0) // p)
    # sample each cell at its centre (median of the inner half avoids seams)
    cells = np.zeros((ny, nx, 3), np.uint8)
    for j in range(ny):
        for i in range(nx):
            cy0, cx0 = y0 + j * p, x0 + i * p
            blk = a[int(cy0 + p * 0.25): int(cy0 + p * 0.75) + 1, int(cx0 + p * 0.25): int(cx0 + p * 0.75) + 1]
            cells[j, i] = np.median(blk.reshape(-1, 3), axis=0)
    fg = largest_component(~magenta(cells))
    # crop to the hand, keep the bottom edge (the cuff is cut by the frame)
    ys, xs = np.where(fg)
    cells, fg = cells[ys.min():, xs.min(): xs.max() + 1], fg[ys.min():, xs.min(): xs.max() + 1]
    # palette from the hand only
    pal_img = Image.fromarray(cells[fg].reshape(-1, 1, 3))
    q = pal_img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    pal = np.array(q.getpalette()[: colors * 3]).reshape(-1, 3)
    flat = cells.reshape(-1, 3).astype(int)
    nearest = pal[np.argmin(((flat[:, None, :] - pal[None]) ** 2).sum(-1), axis=1)]
    rgba = np.zeros((*cells.shape[:2], 4), np.uint8)
    rgba[..., :3] = nearest.reshape(cells.shape).astype(np.uint8)
    rgba[..., 3] = fg * 255
    Image.fromarray(rgba).save(outdir / "sprite.png")
    # device edge: first row where the hand gets much wider than the thumb
    widths = fg.sum(axis=1)
    top = int(np.argmax(widths > 0))
    thumb_w = np.median(widths[top: top + max(3, len(widths) // 6)])
    edge = top + int(np.argmax(widths[top:] > thumb_w * 1.8))
    meta = dict(source=src.name, model_pixel=round(p, 2), grid=[int(cells.shape[1]), int(cells.shape[0])], edge_row=edge, colors=colors)
    (outdir / "meta.json").write_text(json.dumps(meta, indent=1))
    from split import split  # front = the thumb only, so no knuckle sits in front of the dex

    split(outdir)
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
