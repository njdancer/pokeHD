#!/bin/bash
cd /tmp/claude-0/relief/src
while pgrep -f "train.py front" >/dev/null; do sleep 30; done
RID=$(ls /mnt/project-files/relief-synth/runs | grep train-front-v2 | tail -1)
/tmp/claude-0/venv/bin/python eval_pics.py ../models/front_v2.pt $RID
