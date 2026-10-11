#!/bin/bash
# after generation v2: train the map model, then the picture model
cd /tmp/claude-0/relief/src
PY=/tmp/claude-0/venv/bin/python
$PY watch_gen_v2.py
$PY train.py map 30 ../models/map_v2.pt --name map-v2-unet24 --note "Map view, trained on 6,000 calibrated scenes. Object pixels weighted ×4." 
$PY train.py front 30 ../models/front_v2.pt --name front-v2-unet24 --note "Front view (battle pictures), 2,000 synthetic creatures."
