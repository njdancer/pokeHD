#!/bin/bash
# 40 shards of 50 scenes: small enough to finish between container restarts
k=$1
for s in $(seq $k 4 39); do [ -f ../data/shards/map_v4s$s.npz ] && continue; ROOM_SHARE=0.5 /tmp/claude-0/venv/bin/python gen.py map $((300000+s*50)) 50 ../data/shards/map_v4s$s.npz; done
