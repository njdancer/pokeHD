#!/bin/bash
# White-part creatures + occupancy head for pictures (Nick 2026-10-10: white areas must still get normals)
cd /tmp/claude-0/relief/src
PY=/tmp/claude-0/venv/bin/python
gen() { for s in $(seq $1 2 15); do [ -f ../data/shards/front_w$s.npz ] && continue; WHITE_SHARE=0.35 $PY gen.py front $((500000+s*250)) 250 ../data/shards/front_w$s.npz; done; }
gen 0 & gen 1 & wait
while pgrep -f train_faces.py >/dev/null; do sleep 30; done
$PY train.py front 30 ../models/front_v3.pt --width 40 --occ --name front-v3-unet40 --note "Pictures with flat white parts (fur, bellies) that are white whichever way they face, half of them with no outline against the background, plus a channel that says which pixels belong to the creature. Nick spotted white areas like Eevee's mane dropping out."
RID=$(ls -t /mnt/project-files/relief-synth/runs | grep train-front-v3 | head -1)
$PY eval_pics.py ../models/front_v3.pt $RID
