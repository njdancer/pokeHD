# Draws the app icon (our own art: a little daylit diorama, no game graphics) as the PNGs the
# web app manifest and iOS home screen use. Usage: python3 tools/gen-icons.py (needs Pillow).
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "apps/web/public"
S = 1024  # drawn large, then scaled down


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def draw() -> Image.Image:
    img = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(img)
    # Morning sky, warm at the horizon.
    for y in range(S):
        d.line([(0, y), (S, y)], fill=lerp((96, 170, 255), (255, 214, 160), y / S))
    d.ellipse([700, 150, 860, 310], fill=(255, 244, 205))
    # An isometric block of grass: top, then the two lit and shaded sides.
    cx, top, w, h, depth = S // 2, 430, 380, 190, 170
    top_face = [(cx, top), (cx + w, top + h), (cx, top + 2 * h), (cx - w, top + h)]
    left = [(cx - w, top + h), (cx, top + 2 * h), (cx, top + 2 * h + depth), (cx - w, top + h + depth)]
    right = [(cx + w, top + h), (cx, top + 2 * h), (cx, top + 2 * h + depth), (cx + w, top + h + depth)]
    d.polygon(left, fill=(150, 96, 60))
    d.polygon(right, fill=(110, 68, 44))
    d.polygon(top_face, fill=(104, 196, 96))
    d.line(top_face + [top_face[0]], fill=(76, 160, 76), width=8)
    # A chunky pixel tree on the block, with its shadow.
    d.ellipse([cx - 40, top + h + 30, cx + 200, top + h + 110], fill=(72, 150, 72))
    px = 40
    canopy = [
        "..XXXX..",
        ".XXXXXX.",
        "XXXXXXXX",
        "XXXXXXXX",
        ".XXXXXX.",
        "...TT...",
        "...TT...",
    ]
    ox, oy = cx - 4 * px, top - 40
    for r, row in enumerate(canopy):
        for c, ch in enumerate(row):
            if ch == ".":
                continue
            colour = (40, 120, 64) if ch == "X" else (120, 72, 40)
            if ch == "X" and (r + c) % 5 == 0:
                colour = (64, 152, 80)
            d.rectangle([ox + c * px, oy + r * px, ox + (c + 1) * px - 1, oy + (r + 1) * px - 1], fill=colour)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img = draw()
    for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")]:
        img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)


if __name__ == "__main__":
    main()
