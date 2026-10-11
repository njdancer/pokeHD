#!/bin/bash
cd /tmp/claude-0/relief/src
PY=/tmp/claude-0/venv/bin/python
while pgrep -f gen_depth.sh >/dev/null || pgrep -f train_faces.py >/dev/null; do sleep 30; done
$PY train.py front 30 ../models/front_v4.pt --width 40 --occ --depth --data shards_depth --name front-v4-depth-unet40 --note "Pictures predict depth as well as surface direction, so the 3D can have parts in front of others (Snorlax's head further back than his belly) instead of a height field pinned to zero at the outline. 6,000 new creatures with white parts. 3D is built from the depth, torn where it jumps, lit by the directions; outside the silhouette is background."
RID=$(ls -t /mnt/project-files/relief-synth/runs | grep front-v4 | head -1)
$PY eval_pics.py ../models/front_v4.pt $RID
