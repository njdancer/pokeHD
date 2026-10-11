import sys, numpy as np
from romdata import map_img, SHADE
from PIL import Image, ImageDraw
def crop(name, y0, y1, x0, x1, out, k=12):
    img, l, _ = map_img(name); a = SHADE[img[y0:y1, x0:x1]]
    H, W = a.shape
    g = Image.fromarray(np.kron(a, np.ones((k, k), np.uint8))).convert("RGB")
    d = ImageDraw.Draw(g)
    for i in range(H + 1): d.line([(0, i * k), (W * k, i * k)], fill=(255, 0, 0) if i % 4 == 0 else (200, 200, 255), width=1)
    for i in range(W + 1): d.line([(i * k, 0), (i * k, H * k)], fill=(255, 0, 0) if i % 4 == 0 else (200, 200, 255), width=1)
    pad = Image.new("RGB", (W * k + 30, H * k), "white"); pad.paste(g, (30, 0)); d = ImageDraw.Draw(pad)
    for i in range(H): d.text((2, i * k), str(i), fill=(0, 0, 0))
    pad.save(out)
if __name__ == "__main__":
    a = sys.argv; crop(a[1], *map(int, a[2:6]), a[6])
