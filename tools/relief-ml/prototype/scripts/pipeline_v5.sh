#!/bin/bash
cd /tmp/claude-0/relief/src
PY=/tmp/claude-0/venv/bin/python
until [ $(ls ../data/shards/map_v4s*.npz 2>/dev/null | wc -l) -ge 40 ] && ! pgrep -f run_gen_v4.sh >/dev/null; do sleep 30; done
$PY -c "
from runlog import Run
import numpy as np, glob
r=Run(None,None,run_id='20261010-164334-generate-map-scenes-v4')
SH=np.array([255,170,85,0],np.uint8); rows=[]
for f in sorted(glob.glob('../data/shards/map_v4s*.npz'))[:2]:
    d=np.load(f); rows.append(np.concatenate([np.concatenate([np.repeat(SH[d['img'][i]][...,None],3,-1),((d['nrm'][i]/127*0.5+0.5)*255).astype(np.uint8),np.full((64,4,3),255,np.uint8)],1) for i in range(3)],1))
r.image('samples.png',np.kron(np.concatenate(rows,0),np.ones((3,3,1),np.uint8)),'Sample scenes, half indoors: sprite and normals')
r.done(scenes=2000)"
true
$PY train.py map 30 ../models/map_v5.pt --name map-v5-unet24 --note "Map view on 12,000 scenes: v2, v3 (game-like ground) and v4 (half indoor rooms)."
$PY train.py map 30 ../models/map_v6w40.pt --width 40 --name map-v6-unet40 --note "Same 12,000 scenes as map-v5, wider network (40 base channels) to see if capacity is the limit."
