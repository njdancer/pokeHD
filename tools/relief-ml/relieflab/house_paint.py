"""Hand painting of Red's house in Pallet Town (Nick, 2026-10-12): front pitch = slope, roof ends = hips
(sloping from the outside inward), eave band and upstairs wall = front, cut-off corners = ground
(background showing through). Used to check the editor's mesh before painting training tiles."""
import numpy as np
from . import tasks

Y0, Y1, X0, X1 = 44, 98, 56, 136   # crop around the house (map pixels)


def paint():
    img, labs = tasks.map_img("PALLET_TOWN")
    im = img[Y0:Y1, X0:X1]; H, W = im.shape
    faces = np.zeros((H, W), np.uint8); ground = np.ones((H, W), bool)
    for y in range(48, 95):
        row = img[y]
        lo = 64 if y >= 80 else 60
        xs = [x for x in range(lo, 132) if row[x] == 3]
        if not xs: continue
        a, b = xs[0], xs[-1]
        if y >= 80: a, b = 69, 122                            # lower floor walls
        for x in range(a, b + 1):
            yy, xx = y - Y0, x - X0
            ground[yy, xx] = False
            if y <= 60:
                faces[yy, xx] = 2 if 78 <= x <= 113 else (3 if x < 78 else 4)
            elif y <= 70:
                dl, dr = 78 - (y - 61) * 1.45, 113 + (y - 61) * 1.45
                faces[yy, xx] = 3 if x < dl else 4 if x > dr else 1
            else:
                faces[yy, xx] = 1
    faces[ground] = 0
    return im, faces, ground, labs[Y0 // 8:(Y1 + 7) // 8, X0 // 8:X1 // 8]
