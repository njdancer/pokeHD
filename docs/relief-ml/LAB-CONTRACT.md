# Relief lab: data contract, version 1

The trainer on Nick's Mac keeps a local file tree and mirrors it into the private bucket under
`lab/`; the dashboard at `/admin/lab` reads it. The server only stores files. This page says what
the files are; `packages/protocol/src/lab.ts` is the checked schema for each one.

## Transport

- **API:** `https://pokehd.dncr.me/api/admin/lab/<path>` (`http://localhost:5173` under
  `pnpm dev`). `<path>` is the file's path under `lab/`.
  - `PUT` stores the raw body (≤ 32 MB). The type comes from the extension: `.json`, `.jsonl`,
    `.png`, `.webp`, `.jpg`, `.f32`, `.u8`, `.bin`, `.txt`, `.md`, `.glb`. Others get 415.
    JSON files (`.json`) must parse; `.jsonl` isn't checked.
  - `GET` returns it, with an `ETag`; send `If-None-Match` to get a cheap 304 while polling.
  - `DELETE` removes one file. `DELETE <dir>/?recursive=1` removes a folder.
  - `GET <dir>/` (trailing slash) lists a folder: `{ files: [{ path, size, uploaded }], dirs: [] , cursor? }`.
    `GET /api/admin/lab/` lists the top.
- **Auth:** the admin routes (D23): Nick's session cookie in the browser, or
  `Authorization: Bearer <ADMIN_TOKEN>` from scripts. On the Mac the token is
  `$POKEHD_ADMIN_TOKEN` or `~/.config/pokehd/admin-token`. Never print or commit it. A wrong token
  gets a 404, like every admin route.
- **Privacy:** nothing under `lab/` is public. ROM-derived images are allowed here because they
  stay behind Nick's sign-in (CLAUDE.md, D37). They never go in the repo.
- **Live:** the trainer re-PUTs changed files (whole-file, `metrics.jsonl` included) every ~15 s
  while running. The dashboard polls `index.json` and the open run's files every few seconds with
  `If-None-Match`, so it's live to within about 20 s.

## The tree

```
lab/index.json                       front page: runs, datasets, best per task, what ops is doing
lab/events.jsonl                     ops journal: findings, decisions, questions, milestones
lab/runs/<id>/run.json               one experiment: config, parent, changes, stages, summary
lab/runs/<id>/metrics.jsonl          training curves, one row per measurement
lab/runs/<id>/evals/<name>.json      one evaluation: overall, per class, confusion, per object
lab/runs/<id>/preds/<set>.json       sample manifest of predictions (files beside it)
lab/runs/<id>/preds/<set>/…          prediction layers: PNG, .f32
lab/runs/<id>/images/…               any other pictures the run lists in `images`
lab/datasets/<id>/dataset.json       a dataset: generator config, counts, sample manifests
lab/datasets/<id>/samples.json       sample manifest of dataset items (files beside it)
lab/flags/<id>.json                  written by the dashboard; ops answers by re-PUTting it
```

Ids are `[a-z0-9][a-z0-9._-]{0,119}`; a good run id is `20261011-0630-faces-v4`.

## index.json

```jsonc
{
  "schema": 1,
  "updated": "2026-10-11T06:40:00Z",
  "runs": [{ "id": "20261011-0630-faces-v4", "task": "faces", "status": "running",
             "title": "Five faces, furniture rooms", "parent": "20261010-2200-faces-v1b",
             "datasets": ["furn-3k"], "started": "…", "updated": "…", "summary": { "test_acc": 0.81 } }],
  "datasets": [{ "id": "furn-3k", "title": "3,000 furniture rooms", "kind": "synthetic", "status": "done" }],
  "best": { "faces": "20261010-2200-faces-v1b", "depth": "20261011-0400-front-v5" },
  "ops": { "doing": "Training faces-v4 (epoch 7 of 24)",
           "why": "Testing whether furniture rooms can replace furniture labels.",
           "next": ["Score on the hand-made set", "Audit chair labels"],
           "runs": ["20261011-0630-faces-v4"],
           "lastImproved": { "faces": "2026-10-10T22:40:00Z" }, "updated": "…" },
  "metrics": { "test_acc": { "label": "Hand-made test set", "unit": "%", "better": "higher", "primary": true,
                             "help": "Share of pixels whose face matches the hand-made boxes." } }
}
```

`metrics` here defines metric keys once for every run; a run's own `metrics` override them. Any
numeric key still plots without a definition, labelled by its key.

## run.json

```jsonc
{
  "schema": 1, "id": "20261011-0630-faces-v4", "task": "faces", "name": "faces-v4",
  "title": "Five faces, furniture rooms, no furniture labels",
  "status": "running",                       // queued | running | done | failed | stopped
  "created": "…", "started": "…", "updated": "…", "finished": null, "host": "nick-mbp",
  "parent": "20261010-2200-faces-v1b",
  "changes": ["+3,000 game-style furniture rooms", "Furniture rule labels off"],
  "why": "Keep tables high while chairs stay fixed.",
  "datasets": ["furn-3k", "maps-12k"],
  "config": { "width": 40, "lr": 0.002, "epochs": 24, "crop": 48 },
  "arch": { "params": 1300000, "bytes_fp16": 2600000, "input": [4, 48, 48], "nodes": [], "skips": [] },
  "stages": [
    { "name": "train", "stage": "train", "status": "running", "progress": { "done": 7, "total": 24, "unit": "epoch", "eta": "…" } },
    { "name": "eval", "stage": "eval", "status": "queued" },
    { "name": "render3d", "stage": "3d", "status": "queued" }
  ],
  "metrics": { "loss": { "label": "Training loss", "better": "lower", "group": "loss" } },
  "summary": { "val_loss": 0.21, "test_acc": 0.81 },
  "classes": ["TOP", "FRONT", "SLOPE", "HIP◀", "HIP▶"],
  "evals": ["testset", "real-maps"],
  "images": [{ "path": "images/pallet-3d.png", "caption": "Pallet Town from the game camera", "kind": "3d" }],
  "findings": ["Chairs 36% → 55%"]
}
```

`stage` on each step is one of `source`, `render`, `dataset`, `train`, `eval`, `3d`; the pipeline
map lays runs and datasets out by these.

## metrics.jsonl

One JSON object per line: `{ "ts": "…", "step": 1200, "epoch": 7, "split": "train", "metrics": {
"loss": 0.31, "lr": 0.0018, "acc/TOP": 0.91 } }`. `step` increases; per-class values use
`metric/class` keys.

## evals/<name>.json

```jsonc
{
  "schema": 1, "name": "testset", "title": "Hand-made test set", "split": "testset",
  "circular": false,                     // true when graded by rule labels the model trained on
  "overall": { "acc": 0.81, "obj_mean": 0.65 },
  "perClass": { "acc": { "TOP": 0.9, "FRONT": 0.78, "SLOPE": 0.6 } },
  "confusion": { "labels": ["TOP", "FRONT", "SLOPE"], "matrix": [[900, 80, 20], [120, 800, 80], [50, 50, 900]] },
  "perObject": [{ "id": "reds-chair-1", "title": "Red's house, chair", "sample": "map:REDS_HOUSE_1F:2,4,2,2", "scores": { "acc": 0.55 } }],
  "preds": ["preds/testset.json"]
}
```

`confusion.matrix[truth][predicted]`.

## Sample manifests

`preds/<set>.json` in a run and `samples.json` in a dataset. File paths are relative to the
manifest's folder.

```jsonc
{
  "schema": 1, "title": "Real maps", "view": "map",       // map: three-quarter view; pic: front view
  "layers": {
    "input": { "label": "Game art", "encoding": "rgb" },
    "rule":  { "label": "Rule labels", "encoding": "faces", "truth": true },
    "pred":  { "label": "Prediction", "encoding": "faces" },
    "err":   { "label": "Disagreement", "encoding": "error" }
  },
  "items": [{ "id": "map:PALLET_TOWN:2,3,4,3", "title": "Red's house", "width": 128, "height": 96,
              "files": { "input": "real-maps/pallet-0/input.png", "pred": "real-maps/pallet-0/pred.png" },
              "scores": { "acc": 0.81 } }]
}
```

**Sample ids** say where a sample comes from, so the dashboard can open it in the relief editor:
`map:<MAP_NAME>[:bx,by,bw,bh]` (area in 32-pixel blocks, map names as in `MAP_NAMES`),
`pic:<dex number>`, `synth:<dataset id>:<index>`.

**Layer encodings**, all at full pixel resolution, never one value per block:

| Encoding | File | Meaning |
|---|---|---|
| `rgb` | PNG | shown as is |
| `shades` | PNG | the 4 Game Boy shades as grey 255, 170, 85, 0 |
| `faces` | 8-bit PNG | 0 TOP, 1 FRONT, 2 SLOPE, 3 HIP◀, 4 HIP▶; 255 none |
| `normals` | RGBA PNG | RGB = n × 127.5 + 127.5 (x right, y up, z to the viewer); alpha 0 = no surface |
| `depth` | `.f32` | little-endian float32, width × height, pixels towards the viewer; NaN = none |
| `mask` | 8-bit PNG | 0 background, 1 object, 2 ground |
| `error` | PNG | heatmap, brighter is worse |

Pre-rendered 3D PNGs can go in `images` as a fallback; the dashboard also builds 3D itself from
`faces`, `normals` and `depth` layers.

## events.jsonl

One entry per line, newest last: `{ "ts", "kind": "finding" | "decision" | "question" |
"milestone" | "note" | "status", "title", "body"?, "runs"?, "images"?: [{ "path", "caption" }],
"links"?: [{ "url", "title" }], "tags"? }`. `path` is under `lab/`. Write bodies for someone with
limited maths; link explainer artifacts.

## Flags (Nick → ops agent)

The dashboard writes `lab/flags/<id>.json`:

```json
{ "schema": 1, "id": "20261011-071502-chair", "created": "…", "kind": "wrong-label", "status": "open",
  "note": "Chair seat reads as FRONT, it's a top.", "run": "20261011-0630-faces-v4",
  "sample": { "manifest": "runs/20261011-0630-faces-v4/preds/testset.json", "id": "map:REDS_HOUSE_1F:2,4,2,2", "layer": "pred" },
  "box": [12, 30, 8, 4] }
```

Kinds: `wrong-label`, `bad-prediction`, `bad-data`, `bug`, `idea`, `question`. The ops agent lists
`lab/flags/`, works the open ones, and re-PUTs each with `status` (`seen`, `fixed`, `wontfix`),
`reply` and `updated`. The trainer's sync must never delete flags. Nick can also copy any flag as
a self-contained issue card to paste in a thread.

## Versioning

`schema: 1` in every JSON document. A breaking change bumps it and the dashboard keeps reading
version 1; additive fields don't need a bump.
