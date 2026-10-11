#!/bin/bash
# worker k of 4: map shards then front shards
k=$1
for s in $(seq $k 4 23); do /tmp/claude-0/venv/bin/python gen.py map $((s*250)) 250 ../data/shards/map_$s.npz; done
for s in $(seq $k 4 7); do /tmp/claude-0/venv/bin/python gen.py front $((100000+s*250)) 250 ../data/shards/front_$s.npz; done
