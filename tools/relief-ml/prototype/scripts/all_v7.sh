#!/bin/bash
cd /tmp/claude-0/relief/src
PY=/tmp/claude-0/venv/bin/python
$PY train.py map 30 ../models/map_v7w64.pt --width 64 --name map-v7-unet64 --note "Same 12,000 scenes, width 64: does more capacity keep helping after v6 (40) beat shade-alone?"
# v7 started before train.py learned to attach 3D renders; add them now
RID=$(ls -t /mnt/project-files/relief-synth/runs | grep train-map-v7 | head -1)
$PY render3d.py ../models/map_v7w64.pt 64 map $RID
$PY train_faces.py 30 ../models/faces_v1w40.pt --width 40 --name faces-v1-unet40 --note "Outputs the relief plan's five faces directly (top, front, slope, hips). Synthetic scenes plus real maps labelled by the plan's rule; the 22 scoring maps are held out, but they share tiles with training maps, so the label score is no longer an independent test for this run."
