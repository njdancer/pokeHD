# Relief ML pipeline (relieflab)

The scripted pipeline that replaced `prototype/`. Configs in `configs/` (with `extends`) fully
describe a run; the runner generates any missing datasets (cached by recipe hash), trains on the
Apple GPU with a checkpoint every epoch, evaluates, renders 3D and publishes everything to the lab
tree that the dashboard at `/admin/lab` reads (`docs/relief-ml/LAB-CONTRACT.md`).

Data, checkpoints and the lab tree live in `RELIEF_HOME` (default `~/relief-lab`), never in the
repo: much of it is derived from the ROM. `RELIEF_HOME/private/rom.json` comes from
`prototype/dump-rom.ts`.

```sh
uv venv .venv && uv pip install --python .venv/bin/python torch numpy scipy pillow   # repo root
cd tools/relief-ml
../../.venv/bin/python -m relieflab submit faces-v3   # queue a run
../../.venv/bin/python -m relieflab worker            # run the queue; resumes after interruptions
../../.venv/bin/python -m relieflab sync              # mirror the lab tree to the dashboard
../../.venv/bin/python -m relieflab status
```
