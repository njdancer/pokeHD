# Render performance budget

How much each stage of the look costs, where phones fall short, and what the mobile quality tier
drops. Measured with `/dev/bench`, which stands in Pallet Town at midday with time frozen and
renders the shipped look with one stage switched off at a time. A stage's cost is the shipped
frame time minus the frame time without it. Frames render back to back and are timed until the
GPU finishes, so vsync hides nothing. Open `/dev/bench` on any device (the deployed site works
for Nick's session) to measure that device; `?size=phone` pins an iPhone's drawing buffer.

## What a frame does

33 render passes and about 120 draw calls (Pallet Town, phone framing):

| Stage | Passes | Notes |
|---|---|---|
| Sun shadow map | 1 | 2048², every shadow caster again (≈520k triangles) |
| Scene | 1 | ≈500k triangles; colour + depth |
| Ambient occlusion (GTAO) | 2 | half resolution, 16 samples |
| Depth of field | 10 | CoC at full res, two 64-tap and two 16-tap blurs at half res, composite, input copy |
| Tilt-shift band | 3 | Gaussian blur at half res |
| Bloom | 12 | bright pass, 5-level mip chain (2 blurs each), composite |
| Tone map, LUT grade, vignette, fade | 1 | one full-screen pass |
| SMAA | 4 | edges, weights, blend, plus a copy of the graded image |

## Budget (M1 Max GPU, Chrome WebGPU)

1440p (2560×1440) shows the GPU costs clearly; at phone size the M1 Max is CPU-bound at about
2 ms, so its per-stage deltas there are mostly noise.

| Stage | Cost at 1440p | Share |
|---|---|---|
| **Shipped frame** | **4.20 ms** | 100% |
| Depth of field | 1.49 ms | 35% |
| Ambient occlusion | 0.96 ms (¼ res saves 0.60) | 23% |
| SMAA | 0.37 ms (FXAA instead saves 0.14) | 9% |
| Bloom | 0.30 ms | 7% |
| Tilt-shift band | 0.21 ms | 5% |
| Sun shadows | 0.24 ms GPU, and half the CPU (1.37 → 0.69 ms) | 6% |
| Scene with no shadows or post | 0.70 ms | 17% |
| Fog, vignette, sprite shadows, shadow softness, shadow map 1024 | under the noise (±0.05 ms) | ~0 |

CPU to build and submit a frame: about 1.4 ms, half of it the shadow pass's draw calls.
Post-processing scales with pixels: 75% render size takes the shipped frame from 4.20 to 2.49 ms.

## Why the iPhone 13 Pro struggles (estimate)

Not measured on the phone yet; this scales the Mac numbers. The phone draws 780×1688 (its 3×
screen capped at 2×), 36% of 1440p's pixels. Its 5-core A15 GPU has roughly an eighth of the M1
Max's compute and a twelfth of its memory bandwidth, so take 8–10× per unit of work.

| | M1 Max at phone size | iPhone 13 Pro estimate |
|---|---|---|
| Post-processing (per-pixel) | 1.2 ms | 9–12 ms |
| Scene + shadows (≈1M triangles, geometry-bound) | 0.9 ms | 7–9 ms |
| **Frame** | **2.1 ms** | **17–21 ms (48–59 fps)** |

That's at full clocks. Phones throttle the GPU within minutes of sustained load, which puts it at
roughly 40–45 fps: under the 16.7 ms a 60 Hz frame allows, which matches what Nick saw.

## Dynamic resolution and the mobile tier

Two layers keep a phone near 60 fps without costing a fast machine anything.

**Mobile tier.** `QUALITY_PATCHES.mobile` (`packages/engine/src/look/quality.ts`) lays a patch
over every look on touch-only devices (`?quality=full|mobile` overrides): AO at quarter
resolution and FXAA instead of SMAA. Neither shows on a small, dense screen.

**Dynamic resolution.** A governor (`packages/engine/src/look/governor.ts`) watches the time
between display frames and steps down a ladder when more than a fifth of frames in half a second
miss 60 fps: render scale 100, 90, 80, 70, 60, 50%, then 50% without depth of field. After 3 s
of clean frames it tries a rung up; a rung up that has to come back down within 15 s waits twice
as long next time (up to a minute), so a device on the edge of a rung settles below it. Vsync
hides how close a frame came, so it can't judge a single step; instead, a whole descent that
leaves frames no faster (iOS Low Power Mode's 30 fps cap, or a CPU-bound page) is undone and held
off for 30 s, then 60, 120 and so on. Stalls over 100 ms (map builds, a hidden tab) are ignored,
and a half second with many of them (startup, shader compiles) is thrown away whole.
`?dynres=0` turns it off; `?stats` and `/dev/live` show the current scale.

| Rung (M1 Max, 1440p-class) | Frame | iPhone estimate |
|---|---|---|
| Shipped | 4.20 ms | 17–21 ms |
| Mobile tier at 75% | 2.21 ms (−47%) | 11–14 ms |
| Mobile tier at 75% without depth of field | 1.36 ms (−68%) | 9–11 ms |

On the estimate, an iPhone 13 Pro should settle around 80–90% scale with depth of field on.

## Map changes and the first frame

Two kinds of stall used to land outside the frame budget above.

**Map chunk builds.** Building a map (region, colours, terrain, voxel trees, grass) took 30-50 ms
of JavaScript warm in Node and 50-170 ms in a browser, on the main thread, each time a map came
into range. Chunks now build in a worker (`packages/engine/src/world/chunk-worker.ts`) and come
back as plain arrays; turning them into three.js objects takes 1-10 ms (`live.builds[].ms`;
`totalMs` is the wait for the worker). The worker bundle is about 150 KB gzipped, loaded once.

**Shader compiles.** WebGL2 links each program on the main thread the first time it draws, so the
first frame (scene, shadows and every post pass) froze the page: 1.8-2.0 s in the cloud sandbox's
software WebGL, about 2.6 s on a real device. The engine now asks for pipelines without waiting
(as `compileAsync` does) and skips a draw until its program is ready, keeping the WebGL2 canvas
hidden until every pass has drawn once. With KHR_parallel_shader_compile (Chrome; Safari lists it
but may still block, WebKit bug 251514) the first frame took 0.25-0.37 s of main thread in the
sandbox, with the extension faked since its software WebGL lacks it. Scene objects keep this for good on both backends, so a new chunk's shadow pass
or a new sprite turns up a frame late rather than stalling one.

## What's left

- **Geometry is next.** About a million triangles a frame: the voxel trees are 1,824 triangles
  each and there are about a thousand in Pallet Town's loaded neighbourhood (2.3M triangles
  across the loaded maps, all casting shadows). Tile-based phone GPUs pay for every triangle in
  both the shadow pass and the scene, and resolution doesn't touch that cost. A greedy mesher
  (merging tops in 2D, not just along rows) or a simpler distant-tree shape would cut it without
  changing the close-up look. The back half of each tree can't simply be dropped: its upward
  faces form the top of the crown.
- **Battles and menus** still render the full HD view behind the Game Boy screen.
