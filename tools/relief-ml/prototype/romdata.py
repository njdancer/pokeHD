import json, numpy as np
D = json.load(open('/tmp/claude-0/relief/data/rom.json'))
TS = {t['name']: t for t in D['tilesets']}
SHADE = np.array([255, 170, 85, 0], np.uint8)  # colour number -> grey (0 = white)

def tiles(ts):
    return np.array(ts['tiles'], np.uint8).reshape(-1, 8, 8)

def block_img(ts, b):
    t = tiles(ts); ids = ts['blocks'][b*16:(b+1)*16]
    return np.block([[t[ids[r*4+c]] for c in range(4)] for r in range(4)])

def block_labels(ts, b):
    return ts['blockLabels'][b]

def map_img(name):
    m = next(m for m in D['maps'] if m['name'] == name)
    ts = D['tilesets'][m['tileset']]
    rows = []
    for by in range(m['h']):
        rows.append(np.concatenate([block_img(ts, m['blocks'][by*m['w']+bx]) for bx in range(m['w'])], 1))
    labs = np.empty((m['h']*4, m['w']*4), object)
    for by in range(m['h']):
        for bx in range(m['w']):
            L = block_labels(ts, m['blocks'][by*m['w']+bx])
            for i in range(16): labs[by*4+i//4, bx*4+i%4] = L[i]
    return np.concatenate(rows, 0), labs, ts
