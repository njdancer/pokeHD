"""Predict normals for real Pokémon front pictures and attach a gallery to a training run."""
import sys, numpy as np, torch
from romdata import D, SHADE
from train import load_model, predict, predict_inside
from render3d import outside
from runlog import Run
model_path, run_id = sys.argv[1], sys.argv[2]
m = load_model(model_path)
want = [1, 4, 7, 25, 39, 52, 74, 92, 94, 129, 133, 143]
tiles = []
for p in D['pics']:
    if p['dex'] not in want: continue
    img = np.array(p['px'], np.uint8).reshape(p['h'], p['w'])
    img = np.pad(img, ((0, 56 - p['h']), (0, 56 - p['w'])))  # pad to 56 like the game's frame
    N = predict(m, img)
    ins = ~outside(img)  # silhouette: white joined to the frame edge is background
    rgb = ((N * 0.5 + 0.5) * 255).astype(np.uint8); rgb[~ins] = 255  # only true background is blanked
    tiles.append(np.concatenate([np.repeat(SHADE[img][..., None], 3, -1), rgb], 1))
rows = [np.concatenate(tiles[i:i + 3], 1) for i in range(0, len(tiles), 3)]
g = np.kron(np.concatenate(rows, 0), np.ones((3, 3, 1), np.uint8))
Run(None, None, run_id=run_id).image("real-pokemon.png", g, "Real Pokémon pictures: sprite and predicted normals (white = background)")
print("ok", len(tiles))
