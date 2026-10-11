#!/bin/bash
cd /tmp/claude-0/relief/src
g() { for s in $(seq $1 4 29); do f=../data/shards/map_f$s.npz; [ -f $f ] && continue; ROOM_SHARE=1 FURNITURE_SHARE=0.8 /tmp/claude-0/venv/bin/python gen.py map $((1000000+s*100)) 100 $f; done; }
g 0 & g 1 & g 2 & g 3 & wait
