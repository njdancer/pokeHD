# Relief ML: handoff notes (2026-10-10 to 2026-10-11)

These notes come from the thread "synthetic relief training", where Claude worked with Nick in the
cloud for about 17 hours. They are for the agents taking the work over on Nick's Mac: a dashboard
builder and an ML operations agent. Read them all before changing anything. The prototype code is in
`tools/relief-ml/prototype/`, and its README says how to run it.

## 1. The goal

Every pixel of the game's art should get a 3D shape so the HD-2D renderer can light it, worked out
on the player's own ROM at runtime.

- **Maps (overworld and interior tiles):** each pixel is one of five *faces*, the relief plan's
  brushes: TOP (0,1,0), FRONT (0,0,1), SLOPE (0,√½,√½), HIP◀ (−√½,√½,0) and HIP▶ (√½,√½,0). The
  repo's relief editor (`apps/web/src/client/tools/relief`, `/tools/relief`) turns faces into a mesh
  with `shape.ts` `mapRelief`. The plan artifact is "Top or Front?"
  (https://claude.ai/artifact/A1eP7KKwtoKcLH8pxJdDfU).
- **Pictures (battle and Pokédex sprites, 56×56 front views):** a surface normal per pixel, *plus
  depth*. Nick, 2026-10-11: "we're building the wrong map". Snorlax's head should sit further back
  than his belly. A height field pinned to the outline can't do that, so a displacement or depth
  map is needed.
- **Runtime constraint:** a small model that runs in the browser on phones (WebGPU; Nick's son plays
  on an iPhone 13 Pro). Today's best models are about 1.3M parameters (U-Net, width 40).

### Rules that bind this work

- **D37:** nothing baked ships, our own model outputs included. Teachers run offline; a small
  student runs at runtime on the player's ROM. Weights trained on the game's art are fine
  (personal use).
- **D38:** relief-editor edits are training data only. The game never reads them.
- **No Nintendo data in the repo.** That means no ROM, no ROM-derived images and no dumps such as
  `rom.json`. Derived images may be shown to Nick privately, never publicly. Synthetic renders and
  trained weights are fine.
- **Prototypes stay standalone** (memory `prototypes-stay-standalone`). Don't wire the model into
  the game until Nick has picked it.
- **No band-aids** (Nick): find root causes, and measure assumptions before relying on them.

## 2. The approach so far

Nick's idea (2026-10-10): procedurally generate 3D objects, render them exactly the way the Game
Boy art looks (4 shades, outlines, dither), and keep the true normals and depth as labels. Train a
small network from sprite to relief on that synthetic data, then test it on the real game's art.

His explicit asks:

- Calibrate the renderer against real data first.
- Report honestly if the game's shading doesn't carry enough shape to transfer.
- Every round should show full-resolution comparisons, plus the prediction turned into 3D (the
  game camera and an isometric view for maps; front-on and angled views for pictures).

### Pipeline

1. **SDF renderer** (`render.py`): primitives such as sphere, ellipsoid, box, cylinder, cone,
   capsule, torus and roof, with smooth blending.
   - Map view is the game's fake 3/4 view: rays along (0,−1,−1)/√2, so a surface's on-screen
     height is its height plus its depth.
   - Front view is orthographic along −z.
   - Supersampled 2×.
2. **Stylise** (`style.py`): wrapped Lambert with ambient, soft shadow and AO, then 3 thresholds
   down to 4 shades. Adds optional dither, outlines at depth jumps and creases.
   - Flat-white parts (`pr.flat`) stay white whichever way they face, and "open" ones have no
     outline against the background.
3. **Scenes** (`scenes.py`):
   - Map scenes: objects on textured ground.
   - Rooms (`ROOM_SHARE`): a back wall, wall hangings and furniture.
   - Game-style furniture (`FURNITURE_SHARE`): tables with a big top and a short front, chairs,
     counters.
   - Creatures (front view), with flat-white parts (`WHITE_SHARE`).
   - Posed creatures (`POSED_SHARE`): parts at clearly different depths, lying back or leaning.
4. **Generate** (`gen.py`): writes `.npz` shards with `img` (4-shade indices), `nrm` (int8
   normals), `mask` (1 object, 2 ground, 0 background) and, for front view, `z` (depth).
5. **Train** (`train.py` for normals, pictures and depth; `train_faces.py` for the five-face
   classifier):
   - U-Net with 3 levels, widths c/c·5/3/c·8/3 (24/40/64 for c=24; c=40 is the default).
   - Input is the 4 shades one-hot. Trained on 48px crops.
   - AdamW with one-cycle, lr 2e-3, batch 32.
   - Losses:
     - Normals: 1−cos, with object pixels weighted ×4.
     - Faces: cross-entropy.
     - Occupancy: BCE ×0.5.
     - Depth: mean-removed L1 ×0.1.
6. **Evaluate:**
   - `eval_real.py`: 22 real maps, tile labels mapped to TOP/FRONT/SLOPE, balanced accuracy.
     Baselines are chance (0.33) and a *shade-only oracle* (0.47), which predicts the best class
     from the pixel's shade alone.
   - `eval_test.py`: the hand-made test set (section 5).
   - `eval_pics.py`: a gallery of real pictures.
7. **3D** (`render3d.py` with `mesh.ts`):
   - Runs the repo's own `shape.ts` (`mapRelief`/`pictureRelief`) through Node 24 type-stripping,
     so the 3D is exactly what the editor would build.
   - Pictures with depth use `depth_mesh`: one quad per pixel, corners shared with neighbours at a
     similar depth, and torn where depth jumps more than 2.5px.
   - A numpy z-buffer rasteriser renders the views.
8. **Run log** (`runlog.py`): each run writes `run.json` (config, architecture, results, findings,
   images) plus `metrics.jsonl` to `/mnt/project-files/relief-synth/runs/<id>/`. The Relief Lab
   artifact (https://claude.ai/artifact/GZ1X8WyhKQXLBLbxhSzyma) reads them live through the
   artifact `files` capability.

## 3. Results, in order

| Run | What changed | Synthetic val | Real maps (balanced) | Lesson |
|---|---|---|---|---|
| pilot (w24) | hand-picked styles, 1k scenes | 25° | 0.48 | reads everything as flat ground |
| calibration | fit shading to 22 real maps | | | game shading: soft wrapped light, high ambient, fronts as bright as tops; light direction barely constrained. **Outlines and layout carry the shape, not shading.** |
| map-v2 (w24) | calibrated styles, 6k | 9.7° | 0.48 | walls 1% → 40%; trees become domes, fences become posts; dithered grass reads as bumps |
| map-v3 (w24) | + game-like ground textures | 8.8° | 0.46 | ground fixed (77%); room back walls now read as floor |
| map-v5 (w24) | + indoor rooms, 12k | 7.3° | 0.49 | each data fix trades one class for another |
| **map-v6 (w40)** | same data, wider | 6.6° | **0.57** | first clear win over shade alone; capacity was the limit |
| map-v7 (w64) | wider again | 6.3° | 0.50 | overfits the synthetic style; w40 is the sweet spot |
| faces-v1b | 5-face classifier + real maps labelled by the plan rule | 7.6° | 0.98 (circular) | clean 3D (houses become boxes with roofs). Score is circular because it is graded by the same rule |
| faces-v2b | furniture rule labels down-weighted to 15% | 7.5° | 0.98 (circular) | test set 68%: worse |
| faces-v0 | no tile labels at all | 7.6° | 0.50 (honest) | test set 65%, but chairs 36% → 55% |
| faces-v3 | + 3,000 game-style furniture rooms, furniture labels off | (running at handoff) | | |
| front-v2 (w24) | creatures, normals only | | | puffy, plausible reliefs; white parts drop out |
| front-v3 (w40) | + flat-white parts, occupancy channel | 8.7° | | white bellies get normals; occupancy leaves holes, so it was replaced by a flood-fill silhouette |
| front-v4 | + depth output | 9.1°, depth err 0.85px | | silhouette clean, but depth is a **pillow**: no part layering |
| **front-v5** | + 4,000 posed creatures | 9.6° | | **layering works**: Snorlax's head 2–11px behind, belly and feet 4–7px in front |

Hand-made test set, pixel accuracy (object mean in brackets):

| Model | Score |
|---|---|
| Rule | 73.2% (0.62) |
| map-v6 | 72.5% (0.65) |
| faces-v1b | **82.5%** (0.65) |
| faces-v2b | 68.0% (0.57) |
| faces-v0 | 65.0% (0.60) |

## 4. What we learned, and still believe

1. **Calibrate first.** The calibration run changed everything for walls. Measuring P(shade |
   orientation) on labelled real maps and fitting the renderer to match is the single most useful
   step. Repeat it whenever the renderer changes.
2. **The shading alone carries little shape.** The game's light is soft and nearly ambient, so
   per-pixel shade is a weak cue. Shape comes from outlines, layout, context and recognising the
   object. That argues for more receptive field and context, and later conditioning on tile labels
   and tileset (section 7).
3. **Data fixes trade classes.** Each new scene type fixed one class and hurt another (ground vs
   walls vs roofs). Watch per-class metrics, not just the average.
4. **Width 40 is the sweet spot on this data.** 64 overfits the synthetic style. Bigger models
   need more diverse data, not just more of the same.
5. **The tile labels (`packages/rom/src/labels`, plan rule `normals.ts seedNormal`) are
   unvalidated and partly wrong.** Nick's warning (2026-10-11 01:22Z): "Many of those tiles are
   objectively wrong. We've never validated them… make sure we measure and validate our assumptions
   here so we don't end up on the wrong path." Measured so far:
   - The rule itself scores 73% on the hand-made set. Chairs are 36%, because they are labelled
     FRONT but are mostly seat tops.
   - Training on rule labels gives 83%, but copies the rule's errors (chairs stay 36%).
   - Without labels it scores 65%, with chairs fixed but tables and shelves worse, because the
     synthetic scenes didn't teach furniture.
   - Real-map scores graded by the same rule are **circular** when rule labels are in training.
     Never report them as quality.
6. **Pictures need depth, not just normals.** A height field from normals is pinned to the
   outline and can't put a head behind a body. A depth channel plus torn meshes works, *if* the
   synthetic creatures include parts at very different depths (front-v4 vs front-v5 proves it).
7. **Silhouette by flood fill.** White pixels connected to the frame edge are background; everything
   else, white or not, gets a surface. Nick asked for this explicitly. The learned occupancy channel
   made holes.
8. **White areas need surfaces.** The training data must include flat-white parts with and without
   outlines, or the model leaves white bellies and manes flat.
9. **Ground keeps its natural place** (Nick's catch, fixed in PR 110). In the map 3D, the ground
   behind a tall object stays at its own depth and leaves a gap. Normals must not move pixels away
   from their natural position.
10. **Resolution:** predictions and renders must be at full pixel resolution, never one normal per
    block.

## 5. Evaluation assets

- **Hand-made test set:** `/mnt/project-files/relief-synth/testset/objects.json` (copied into
  `tools/relief-ml/prototype/testset/objects.json`). It is 13 objects from REDS_HOUSE_1F, OAKS_LAB
  and VIRIDIAN_POKECENTER, each a box with pixel ranges for its top rows and front rows. Claude drew
  it by eye from the map images, so it is small and has its own biases. **Extend it with Nick's own
  relief-editor paintings** (`/api/admin/relief`, D38). Those are the best ground truth we have.
- **Real-map label eval:** 22 maps (`eval_real.DEFAULT_MAPS`). Use it only for models trained
  without rule labels.
- **Pictures to watch:** Bulbasaur (1), Pikachu (25), Gengar (94), Snorlax (143), plus Eevee,
  Jigglypuff and Charmander for white areas and enclosed background.
- **Map scenes to watch:** Pallet Town (houses, roof hips, fences, trees) and Oak's Lab (back
  wall, shelves, tables, the computer). Red's house 1F has the bookshelf, TV, table and chairs.

## 6. Infrastructure lessons (cloud)

- The cloud container had 4 CPU cores and no GPU:
  - five-face epochs took about 220s; depth epochs about 95s;
  - generation was 0.2–0.3s a scene per core;
  - two jobs at once slowed each other.
- Background jobs were killed after 2h, and the container was reclaimed when the session went idle.
  Make every job resumable and checkpoint each epoch. On the Mac, use a proper job runner.
- The artifact `files` capability rate-limits parallel reads, so read sequentially with retry.
  Folder listings on the FUSE mount could miss new runs, so an index file was needed.
- `pkill -f`/`pgrep -f` matched the agent's own shell; kill by PID.

## 7. Where Claude was heading next

1. **faces-v3:** game-style furniture rooms with furniture rule labels off. Hope: tables and
   shelves stay high while chairs stay fixed. If it works, drop rule labels for furniture
   altogether.
2. **Validate the labels properly:**
   - Sample tiles per label.
   - Have Nick (or a vision model) confirm or correct them in the relief editor.
   - Measure the rule's accuracy per label, then decide per label whether to keep, fix or drop it.
3. **Extend the test set** with Nick's paintings. It is the only independent truth.
4. **Port picture depth into the repo's `pictureRelief`** (depth plus tears) if Nick likes the
   front-v5 3D.
5. **Merge the map models:** five faces plus a height where needed, for example stacked objects.
6. **Conditioning** (from `plan/vision-model.md`): feed tile label id, tileset and neighbours to
   the student. They are available at runtime from the ROM plus our committed tables.
7. **Teacher models on the Mac** (the p4-vlm-colour brief): big depth and normal models (Depth
   Anything, Marigold or similar, on upscaled sprites) as extra teachers alongside the synthetic
   data; pick the best, distil to the small model.
8. **Export** the student to ONNX or TSL for WebGPU, and measure its phone cost.

## 8. Nick's preferences for this work

- He is an experienced TS/3D developer. Explain trade-offs, push back, and show options side by
  side.
- He wants to *see* everything: full-resolution comparisons, 3D renders every round, graphs, and
  the architecture.
- He wants explanations he can follow with limited maths, ideally interactive.
- Updates at least every 55 minutes while he's away, short, leading with what's needed from him.
- He catches real bugs by eye (the bookshelf gap, white patches, wrong map type). Make it easy for
  him to look closely and to hand a precise correction back.
