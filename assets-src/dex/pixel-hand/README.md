# Pixel-art hand candidates (p2-dex)

Our own generated images, made on Nick's Mac with FLUX.2 klein 4B (mflux, 8-bit, 4 steps).
They come from text prompts only (`tools/prompt*.txt`, no reference images), on a magenta
background.

- `<cand>/raw.png` is the model output at 768×768.
- `<cand>/sprite.png` is the real sprite. `tools/pixelize.py` finds the model's pixel size
  (about 9–16 px) from the edge spacing, samples one colour per cell, keys out the magenta,
  keeps the largest island and quantises to 12 colours.
- `meta.json` holds the pixel size, the grid size and `edge_row`, the row where the device's
  bottom edge sits (where the hand widens below the thumb).
- `front.png` is the thumb above `edge_row`, drawn in front of the dex. `back.png` is
  everything else, drawn behind it. These exist for the picks: p2_15, p2_12 and p2_11.
- `contact.png` shows every sprite at ×8 on the dex red, with the device edge as a darker band.

Candidate names are prompt_seed. p2 and p3 have blue cuffs and p4 has a white cuff.
Seeds 13, 14 and 22–26 drew other gestures and were dropped.
