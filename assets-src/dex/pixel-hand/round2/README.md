# Round 2: open, lightly curled fingers

Round 1 read as a thumbs-up with the dex stuck on top. Text prompts alone gave open palms or
thumbs-ups, so this round steers the pose with our own 3D hand.

1. `guides/*_render.png`: the 3D hand rig from `pokedex.blend` in its open-dex hold, with the
   dex as a holdout. Only what you'd really see is kept: the thumb on the front, the fingers
   splayed under the bottom edge, and the tips past the side. It's composited on magenta.
2. `guides/*_pixelated.png`: the same image pre-pixelated to a 56 px grid with a 10-colour
   palette and a dark outline, so the model starts from pixel art.
3. FLUX.2 klein 4B img2img (mflux, 8-bit, 4 steps) with `guides/prompt.txt`. `s04`/`s05` is
   the image strength (how much of the guide is kept). `fpx` is the front guide and `lpx` is
   the low-angle guide. At 0.6 the result was identical to 0.5, so 0.6 is dropped.
4. `tools/pixelize.py`, run with `--pixel 13` for the `s04` set, where the model drew finer
   pixels than the target grid.

Picks, with `front.png` (thumb) and `back.png` layers:
1. fpx_s04_71
2. fpx_s04_72
3. fpx_s05_72

## Layer split (fix for "the hand clips through the dex edge")

The first split cut at the row where the hand widened, which put the device edge across the
palm and drew knuckles in front of the dex. `tools/split.py` now:
- puts the device's bottom edge on top of the knuckles, so the dex rests on the curled
  fingers;
- makes the front layer the thumb alone, traced down from its tip.

The contact sheets now show the dex in red above its edge band, on a grey backdrop, so the
hand no longer looks as if it's drawn on the device. `contact_picks.png` shows the three picks.
`edge_row_manual` in a `meta.json` overrides the trace (set for fpx_s04_72).
