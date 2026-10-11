# Relief ML prototype (cloud, 2026-10-10/11)

The first synthetic-data relief pipeline, kept as written so the next version can build on it.
Read `docs/relief-ml/HANDOFF.md` first: it explains what each part does, every result, and what we
learned.

This is a prototype, not the pipeline to keep. Paths are hard-coded to the cloud sandbox
(`/tmp/claude-0/relief/{src,data,models}`, `/mnt/project-files/relief-synth/runs`), runs are
launched by hand with the shell scripts in `scripts/`, and it trains on CPU.

## Files

| File | Role |
|---|---|
| `render.py` | SDF primitives, ray marching, map (3/4) and front cameras |
| `style.py` | Game Boy look: wrapped light, thresholds to 4 shades, outlines, dither, flat-white parts |
| `scenes.py` | Scene generators: map objects, rooms, game furniture, creatures, posed creatures (env: `ROOM_SHARE`, `FURNITURE_SHARE`, `WHITE_SHARE`, `POSED_SHARE`) |
| `styles.json` | Rendering styles fitted to real maps by `calibrate.py` |
| `calibrate.py`, `calib_*.py` | Fit the renderer's shading to labelled real maps |
| `gen.py` | Writes `.npz` shards (`img`, `nrm`, `mask`, `z`) |
| `train.py` | U-Net for normals (+ occupancy, + depth) |
| `train_faces.py` | Five-face classifier (synthetic + real maps labelled by the plan rule; env `OBJECT_RULE_WEIGHT`) |
| `eval_real.py`, `eval_test.py`, `eval_pics.py` | Real-map label score, hand-made test set, picture gallery |
| `render3d.py`, `mesh.ts` | Predicted relief to 3D via the repo's `shape.ts`, plus depth meshes for pictures |
| `runlog.py` | Run records (`run.json`, `metrics.jsonl`, images) read by the Relief Lab dashboard |
| `relief-lab.html` | The Relief Lab artifact's source (reads runs through the artifact `files` capability) |
| `romdata.py`, `dump-rom.ts` | ROM data access. `dump-rom.ts` writes `rom.json`, which is Nintendo data: keep it outside the repo |
| `testset/objects.json` | Hand-made top/front boxes for 13 objects (coordinates only) |

## Running (as it was)

```sh
python3 -m venv venv && venv/bin/pip install -r requirements.txt
node dump-rom.ts ../../../rom/pokeblue.gb /private/path/rom.json   # from this folder, Node 24
WHITE_SHARE=0.35 POSED_SHARE=1 venv/bin/python gen.py front 800000 250 data/shards_depth/front_p0.npz
venv/bin/python train.py front 22 models/front_v5.pt --width 40 --occ --depth --data shards_depth
OBJECT_RULE_WEIGHT=0 venv/bin/python train_faces.py 20 models/faces_v3w40.pt --width 40
venv/bin/python eval_test.py rule models/faces_v1w40.pt models/faces_v3w40.pt
```
