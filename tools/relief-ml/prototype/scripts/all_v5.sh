#!/bin/bash
# Foreground orchestration: the container is reclaimed when the session goes idle, so this runs as a tracked task
cd /tmp/claude-0/relief/src
for k in 0 1 2 3; do RELIEF_RUN=20261010-164334-generate-map-scenes-v4 bash run_gen_v4.sh $k > ../data/gen4_$k.log 2>&1 & done
wait
bash pipeline_v5.sh
