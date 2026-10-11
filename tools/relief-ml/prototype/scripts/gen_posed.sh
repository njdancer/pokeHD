#!/bin/bash
cd /tmp/claude-0/relief/src
g() { for s in $(seq $1 2 15); do f=../data/shards_depth/front_p$s.npz; [ -f $f ] && continue; POSED_SHARE=1 WHITE_SHARE=0.35 nice /tmp/claude-0/venv/bin/python gen.py front $((800000+s*250)) 250 $f; done; }
g 0 & g 1 & wait
