#!/bin/bash
cd /tmp/claude-0/relief/src
PY=/tmp/claude-0/venv/bin/python
$PY train.py front 22 ../models/front_v5.pt --width 40 --occ --depth --data shards_depth --name front-v5-posed-depth-unet40 --note "Same as front-v4, plus 4,000 made-up creatures posed in depth (lying back, leaning, a head behind the body, limbs in front), so the model can learn which part sits behind which. front-v4 gave every picture a pillow shape: Snorlax's head at the same depth as his belly."
RID=$(ls -t /mnt/project-files/relief-synth/runs | grep front-v5 | head -1)
$PY eval_pics.py ../models/front_v5.pt $RID
