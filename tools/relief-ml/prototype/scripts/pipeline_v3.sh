#!/bin/bash
cd /tmp/claude-0/relief/src
PY=/tmp/claude-0/venv/bin/python
until [ $(ls ../data/shards/map_v3s*.npz 2>/dev/null | wc -l) -ge 16 ] && ! pgrep -f run_gen_v3.sh >/dev/null; do sleep 30; done
$PY -c "from runlog import Run; Run.attach('20261010-150222-generate-map-scenes-v3').done(scenes=4000)"
until ! pgrep -f "train.py front" >/dev/null; do sleep 30; done
$PY train.py map 30 ../models/map_v3.pt --name map-v3-unet24 --note "Map view on 10,000 scenes (v2 plus v3 with game-like ground textures)."
