#!/bin/bash
cd /tmp/claude-0/relief/src
g() { for s in $(seq $1 2 23); do f=../data/shards_depth/front_$s.npz; [ -f $f ] && continue; WHITE_SHARE=0.35 /tmp/claude-0/venv/bin/python gen.py front $((700000+s*250)) 250 $f; done; }
g 0 & g 1 & wait
