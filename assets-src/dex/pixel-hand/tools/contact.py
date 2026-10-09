"""contact.py out.png cand/a cand/b ... : sprites x8 under the dex (red, above its edge band) on a grey backdrop."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

RED, BAND, BACKDROP, S = (0xE8, 0x23, 0x2F), (0xA8, 0x14, 0x1E), (0x7A, 0x82, 0x8C), 8
dirs = [Path(d) for d in sys.argv[2:]]
tiles = []
for d in dirs:
    meta = json.loads((d / "meta.json").read_text())
    if not (d / "back.png").exists():
        sys.path.insert(0, str(Path(__file__).parent))
        from split import split

        split(d)
    back, front = Image.open(d / "back.png"), Image.open(d / "front.png")
    w, h = back.size
    t = Image.new("RGB", ((w + 8) * S, (h + 6) * S), BACKDROP)
    ox, oy = 4 * S, 3 * S
    t.paste(back.resize((w * S, h * S), Image.NEAREST), (ox, oy), back.resize((w * S, h * S), Image.NEAREST))
    e = oy + meta["edge_row"] * S
    ImageDraw.Draw(t).rectangle([0, e - 3 * S, t.width, e], fill=BAND)
    ImageDraw.Draw(t).rectangle([0, 0, t.width, e - 3 * S], fill=RED)
    t.paste(front.resize((w * S, h * S), Image.NEAREST), (ox, oy), front.resize((w * S, h * S), Image.NEAREST))
    ImageDraw.Draw(t).text((6, 6), d.name, fill=(255, 255, 255))
    tiles.append(t)
PER_ROW = 6
rows = [tiles[i: i + PER_ROW] for i in range(0, len(tiles), PER_ROW)]
W = max(sum(t.width for t in r) for r in rows)
hs = [max(t.height for t in r) for r in rows]
sheet = Image.new("RGB", (W, sum(hs)), BACKDROP)
y = 0
for r, h in zip(rows, hs):
    x = 0
    for t in r:
        sheet.paste(t, (x, y + h - t.height))
        x += t.width
    y += h
sheet.save(sys.argv[1])
