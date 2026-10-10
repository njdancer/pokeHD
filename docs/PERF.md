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

Not measured on the phone yet; this scales the Mac numbers. The phone drew 780×1688 (its 3×
screen capped at 2×), 36% of 1440p's pixels. It now draws 585×1266 (see "Pixel ratio" below). Its 5-core A15 GPU has roughly an eighth of the M1
Max's compute and a twelfth of its memory bandwidth, so take 8–10× per unit of work.

| | M1 Max at phone size | iPhone 13 Pro estimate |
|---|---|---|
| Post-processing (per-pixel) | 1.2 ms | 9–12 ms |
| Scene + shadows (≈1M triangles, geometry-bound) | 0.9 ms | 7–9 ms |
| **Frame** | **2.1 ms** | **17–21 ms (48–59 fps)** |

That's at full clocks. Phones throttle the GPU within minutes of sustained load, which puts it at
roughly 40–45 fps: under the 16.7 ms a 60 Hz frame allows, which matches what Nick saw.

## Pixel ratio

The render pixel ratio is the largest whole fraction of the screen's own ratio within the cap
(`alignedPixelRatio`, `packages/engine/src/look/quality.ts`). A 3× iPhone used to render at 2×,
so each rendered pixel covered 1.5 screen pixels and the browser had to blur the image to fit.
It now renders at 1.5×: each rendered pixel is exactly 2×2 screen pixels, scaled up with
`image-rendering: pixelated`, and the frame has 44% fewer pixels (585×1266 instead of 780×1688),
which takes roughly that much off the per-pixel post-processing estimate above. 2× and 1× screens
are unchanged. Dynamic resolution's lower rungs (90%, 80%, ...) aren't whole fractions, so they
keep the browser's smooth scaling.

## Main-thread CPU per frame

Measured in `/dev/live` (Pallet Town) on the cloud sandbox's CPU, engine `stats` medians:

| | Before | After |
|---|---|---|
| Colour grade LUT bake (32³ texels) | 8.3 ms, every frame | ≈1 ms, at most 10 times a second |
| Rendering: building and submitting 33 passes, ~120 draws | 5.7 ms | 6.0 ms |
| World update (sprites, chunks) | 0.2 ms | 0.2 ms |
| **Engine total** | **14.2 ms** | **8.0 ms** |

The day cycle blends the grade a little every frame, and the LUT was re-baked whenever any grade
value changed: 32,768 texels through `gradeColor` every frame, then a 128 KB texture upload. On
a phone that alone used half the 16.7 ms budget, before the emulator's messages, HD text and
React got their turn, so the phone was CPU-bound and dynamic resolution couldn't help. The bake
now tabulates the per-channel steps once per axis (same output, texel for texel; 7.5 → 0.9 ms)
and runs at most every 100 ms while the grade drifts.

The rest of the CPU is three.js preparing passes and draws: bloom (12 passes) and depth of
field (10) are about a quarter of it each, shadows half the draw calls. The governor now gets the
engine's CPU time and won't lower resolution for a window whose frames are mostly CPU work.

## Drawing only frames that change

Ambient motion costs no CPU by itself: grass sway and water ripples are a time uniform evaluated
in the shaders. But it made every frame different, so a still view was redrawn 60 times a second.
Now grass, water and the time of day advance in steps, 3 a second by default (about the rate the
original game animates water; `?ambient=60` for smooth), and the engine skips a frame that would
look the same as the last one drawn (D34). A still view (reading a sign, a menu, standing about)
draws about 3 frames a second instead of 60, roughly 95% less 3D work; walking still draws every
frame, since the camera moves.

What counts as a change (`packages/engine/src/change-watch.ts`): every visible object's
transform, each mesh's geometry, material and texture version (sprites change pose by swapping
geometry), the camera, the place tint easing in, the wrap fade, the time of day and the ambient
clock. Battles always draw (they animate through textures the watch doesn't see), as do frames
owed by shaders still compiling and anything after a look, size or content change. `?stats`
shows `drawn N/s`. Dynamic resolution only judges the interval after a drawn frame.

## Cached shadows

The sun's shadow pass draws every shadow caster again (about 520k triangles) and makes half the
frame's draw calls, but the town's shadows only change when the sun steps (3 times a second),
the shadow frustum moves, or the scene changes. So the shadow map comes in two layers (D35,
`packages/engine/src/look/cached-shadow.ts`): the town's casters are drawn into a cached depth
map only then, and each frame one full-screen triangle writes that map's depths into the live
one and just the sprites (marked with `markMovingShadow`) are drawn on top. The frustum follows
the player in jumps of a quarter of its half-width (6 units) instead of every frame. While
walking that's about 4 town redraws a second instead of 60, plus one depth-writing triangle a
frame.

The first version copied the depth texture (`copyTextureToTexture`). On Nick's iPhone
(WebGPU) that left only the sprites drawn, on black, and the cache was turned off on WebGPU
(PR #78). Writing the depths with a draw uses only what every frame already uses, and it runs
on WebGPU in Chromium; it matches drawing every shadow every frame pixel for pixel on both
backends. That draw version still blanked the world on the iPhone, with no fallback (WebGPU reports
errors as events, not throws). Both versions had made the shadow maps 32-bit float depth; with
three.js's own depth format the iPhone draws it correctly (Nick checked, 2026-10-09), so it's on
for every backend. Any uncaught WebGPU error while the cache is on turns it off.
If the cache ever throws, it falls back to three.js's own every-frame shadows, and the game's
HUD says "uncached shadows".

Measured in `/dev/live` on the cloud sandbox (software WebGL, evening, two friends' sprites):
engine CPU 4.6 → 3.0 ms a frame, and the same picture. `?shadowcache=0` turns it off.

## Dynamic resolution and the mobile tier

Two layers keep a phone near 60 fps without costing a fast machine anything.

**Mobile tier.** `QUALITY_PATCHES.mobile` (`packages/engine/src/look/quality.ts`) lays a patch
over every look on touch devices (`?quality=full|mobile` overrides): AO at quarter resolution,
FXAA instead of SMAA, and at most 1.5 rendered pixels per CSS pixel. Neither of the first two
shows on a small, dense screen. The pixel cap leaves a 3× iPhone at 1.5 and renders a 2× iPad at
1× (each pixel 2×2 on screen): a 12.9" iPad at 2× was 2048×2732, four times the iPhone's buffer.
Touch devices are a coarse pointer without hover, or an iPad with a trackpad, which hovers and
reports a Mac user agent (Macs report no touch points). The tier never looks at the user agent
alone, so an iPad's Mac user agent didn't put it on the full tier.

**Dynamic resolution.** A governor (`packages/engine/src/look/governor.ts`) watches the time
between display frames and steps down a ladder when more than a fifth of frames in half a second
miss 60 fps: render scale 100, 90, 80, 70, 60, 50%, then 50% without depth of field. After 3 s
of clean frames it tries a rung up; a rung up that has to come back down within 15 s waits twice
as long next time (up to a minute), so a device on the edge of a rung settles below it. Vsync
hides how close a frame came, so it can't judge a single step; instead, a whole descent that
leaves frames no faster (iOS Low Power Mode's 30 fps cap, or a CPU-bound page) is undone and held
off for 30 s, then 60, 120 and so on. Stalls over 100 ms (map builds, a hidden tab) are ignored,
and a half second with many of them (startup, shader compiles) is thrown away whole. A device
that is slow all the time is not stalling, though: an old iPad at 5-10 fps has every frame over
100 ms, which used to leave the governor with nothing to judge, at full resolution for good. Six
seconds of nothing but such frames now sends it straight to the bottom rung, and the usual rules
take over (step back up, or undo it if it bought nothing). A window only counts as CPU-bound when
the main thread's work, rounded up to whole frames, explains its frame time.
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
