#!/bin/bash
cd /tmp/claude-0/relief/src
while pgrep -f pipeline_v3.sh >/dev/null; do sleep 30; done
/tmp/claude-0/venv/bin/python train.py map 30 ../models/map_v4w40.pt --width 40 --name map-v4-unet40 --note "Same 10,000 scenes as map-v3, wider network (40 base channels) to see if capacity is the limit."
