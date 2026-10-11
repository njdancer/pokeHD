#!/bin/bash
k=$1
for s in $(seq $k 4 15); do /tmp/claude-0/venv/bin/python gen.py map $((200000+s*250)) 250 ../data/shards/map_v3s$s.npz; done
