#!/bin/bash
cd /tmp/claude-0/relief/src
OBJECT_RULE_WEIGHT=0 /tmp/claude-0/venv/bin/python train_faces.py 20 ../models/faces_v3w40.pt --width 40 --name faces-v3-furniture-unet40 --note "Adds 3,000 made-up rooms with game-style tables, chairs and counters; real-map rule labels on furniture tiles switched off entirely, so chairs can't copy the rule's error while tables are taught by the new scenes. Scored on the hand-made test set." && /tmp/claude-0/venv/bin/python eval_test.py rule ../models/faces_v1w40.pt ../models/faces_v0w40.pt ../models/faces_v3w40.pt
