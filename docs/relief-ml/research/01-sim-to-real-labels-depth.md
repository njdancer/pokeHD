# Research memo 1: closing the synthetic-to-real gap for the relief student

Context: a 1.3M-parameter U-Net (3 levels, width 40, 48px crops). It predicts five map faces and,
for 56x56 pictures, normals plus depth. It is trained on SDF renders styled like Game Boy art. Real
data is small: 22 maps whose labels come from an unreliable tile rule, a 13-object hand-made test
set, and Nick's relief-editor paintings, which are still to come. Each section ranks its
recommendations by expected payoff for this setup.

## 1. Sim-to-real for stylised low-res art

What the literature says: domain randomisation works when the real domain is "just one more
variation" of the randomised one (Tobin et al., https://arxiv.org/abs/1703.06907). Randomising
style or texture pushes a network towards shape cues (Jackson et al., style augmentation,
https://arxiv.org/abs/1809.05375; Geirhos et al., texture bias, https://arxiv.org/abs/1811.12231).
That is exactly the cue we want, because shading carries little here. Self-training on unlabelled
target data is the most reliable way to add real data cheaply: Noisy Student
(https://arxiv.org/abs/1911.04252), FixMatch (https://arxiv.org/abs/2001.07685), and Mean Teacher
for dense prediction (https://arxiv.org/abs/1703.01780). Domain-adversarial training (DANN,
https://arxiv.org/abs/1505.07818) is fragile with a tiny model and a small target set. It also
aligns features, not labels, so it cannot fix a renderer that is systematically wrong.

Ranked for us:
1. **Randomise what the game does not encode; calibrate what it does.** Keep the calibrated shade
   statistics. Then randomise outline rules per scene: on or off at depth jumps and at creases,
   1px or broken, and outline shade (index 3 or 2). Also randomise the dither pattern (Bayer,
   checker, none), the tile-grid alignment of objects, and the palette index permutation for
   texture-only regions. Payoff: high. It attacks the "dithered grass reads as bumps" and "each data
   fix trades classes" failures directly.
2. **Mean-teacher consistency on real unlabelled tiles.** The whole ROM gives thousands of real map
   crops for free. Add a loss so the student under augmentation (flip only where faces allow it;
   HIP◀/▶ swap under a horizontal flip, crop shifts in 8px steps, outline dropout) matches an
   exponential moving average (EMA) of itself on the clean crop. Payoff: high and cheap. It
   regularises on the real style without using any rule labels.
3. **Pseudo-labels from a confident teacher, filtered per class.** Use faces-v3 or a teacher
   ensemble, keep pixels above a per-class confidence threshold, and retrain (Noisy Student). Watch
   for confirmation bias: check per-class rates on the test set every round. Payoff: medium.
4. **DANN or feature alignment.** Payoff: low. Skip it unless 1–3 plateau.

## 2. Learning from the rule-labelled set (class-dependent noise)

Methods: estimate a noise transition matrix T (P(rule label | true face)) and correct the loss
(forward correction, Patrini et al., https://arxiv.org/abs/1609.03683). Gold Loss Correction
estimates T from a small trusted set (Hendrycks et al., https://arxiv.org/abs/1802.05300). This
fits us exactly: Nick's paintings are the trusted set. Confident learning
(https://arxiv.org/abs/1911.00068, the `cleanlab` package) finds likely-wrong labels from model
probabilities. Small-loss selection and co-teaching (https://arxiv.org/abs/1804.06872) train only on
the pixels with the lowest loss. Meta-reweighting with a clean set (Ren et al.,
https://arxiv.org/abs/1803.09050) learns per-example weights. DivideMix
(https://arxiv.org/abs/2002.07394) is state of the art but heavy.

Caveat: co-teaching and small-loss methods assume noise is random-ish. Our noise is *systematic per
tile label* (every chair tile is FRONT). The network learns a systematic error early, so its loss on
those pixels stays small and the selection keeps them. The fix has to work at the level of the
label, not the pixel.

Ranked for us:
1. **Measure rule accuracy per tile label, then decide per label.** Our labels are tile-level and
   each tile id repeats across maps, so the unit of verification is the *tile label*, not the pixel.
   Sample about 5 tiles per label (stratified, weighted by on-screen frequency). Have Nick confirm or
   correct each in the relief editor. That is roughly 30–60 seconds per tile, under an hour for the
   common labels. Then compute per-label accuracy with a Wilson interval. With 5 samples, 5/5
   correct still has a lower bound of about 57%, so collect more for the frequent labels. Keep
   labels above about 90%, drop labels below about 60%, and correct the middle ones in the table.
   Payoff: highest. It turns a noisy source into a clean one.
2. **Gold Loss Correction with a per-label T.** Where a label can't be fixed outright, estimate
   T(label) from the verified tiles and train through it. Payoff: medium-high.
3. **Disagreement mining.** Flag tile labels where an unlabelled-trained model (faces-v0 or v3)
   and the rule disagree on more than X% of pixels. These are the best candidates to send to Nick
   first. It is cleanlab's idea applied at label level. Payoff: high as a triage tool.
4. **Co-teaching or small-loss selection.** Low for the reason above.

## 3. Context and receptive field in a tiny model

A 3-level U-Net with 3x3 convs has a theoretical receptive field of about 40–70px, but the
*effective* field is much smaller and roughly Gaussian (Luo et al.,
https://arxiv.org/abs/1701.04128). A 16x16 object such as a table, plus its surroundings, sits
at the edge of what the net actually uses.

Ranked for us:
1. **Tile-id conditioning.** Feed a learned embedding (8–16 dimensions) of the tileset and the tile
   or block id, broadcast over the tile's 8x8 pixels and concatenated at the input or bottleneck.
   It is free at runtime because the ROM gives it. It is also the strongest cue we have: the same
   tile is the same shape everywhere. The risk is that the model memorises the tile id, which brings
   back the rule's errors through the back door. Train with id dropout (about 30–50%) and with
   synthetic scenes carrying random ids, so the image path stays good. Payoff: very high once the
   labels are cleaned (section 2). Before that it simply copies the rule.
2. **Dilated or atrous convs at the bottleneck** (Yu and Koltun,
   https://arxiv.org/abs/1511.07122; ASPP, https://arxiv.org/abs/1706.05587). Rates 1/2/4/8 at the
   lowest level add receptive field for almost no parameters. Payoff: high, cheap, and WebGPU
   friendly.
3. **A 4th U-Net level** (12px or 6px bottleneck at 48px crops). Train on larger crops (96px) so the
   extra context exists. Crop size probably matters as much as depth here. Payoff: medium-high. The
   cost is mostly training time.
4. **One self-attention or axial-attention block at the bottleneck** (MobileViT-style,
   https://arxiv.org/abs/2110.02178). It gives global context, for example "this is a room, the back
   wall is at the top". At 6x6 or 12x12 tokens it costs little. Payoff: medium. It is the riskiest
   to port to WebGPU, so try 2 and 3 first.

## 4. Depth from single stylised images, and big teachers

Losses: the scale- and shift-invariant loss plus multi-scale gradient matching from MiDaS (Ranftl et
al., https://arxiv.org/abs/1907.01341) is the standard. Gradient matching is what keeps
discontinuities sharp. Our "mean-removed L1" is shift-invariant only, so add a scale fit
(least-squares s, t per image) once teachers enter, because their depth scale is arbitrary. For
layering, add an occlusion or edge term: supervise a "depth-jump" mask (the same >2.5px tear rule)
as an auxiliary BCE head. This trains the tears directly instead of hoping they emerge. A
normal–depth consistency loss (normals from depth gradients matching the normal head) ties the two
heads together.

Teachers: Depth Anything V2 (https://arxiv.org/abs/2406.09414; trained on synthetic labels plus
pseudo-labelled real images, which is the same recipe we want to copy), Marigold
(https://arxiv.org/abs/2312.02145), StableNormal (https://arxiv.org/abs/2406.16864), DSINE for
normals (https://arxiv.org/abs/2403.12013), and Depth Pro for sharp boundaries
(https://arxiv.org/abs/2410.02073).

Expected pitfalls with pixel art:
- **Upscaling:** nearest-neighbour 8–16x gives the teacher hard staircase edges, which it reads as
  real geometry such as steps and ridges. Try a smooth upscale too, and blur at about half a source
  pixel before inference, then downsample predictions by area-average to 56x56.
- **Dither and 4-shade banding** read as texture or relief bumps. Expect noisy normals in shaded
  regions.
- **No ground plane or context:** a sprite on white looks like a cut-out, so the teacher may return
  a near-flat card. Compositing onto a neutral grey or a simple floor sometimes helps. Test it.
- **Diffusion teachers are stochastic:** average several seeds and use the variance as a
  per-pixel distillation weight.
- **Teachers agree with each other but not with "game truth":** they inherit photographic priors,
  for example the 3/4 map view reads as a real perspective. They are worth much more for pictures
  (front view, creature-like) than for maps. For maps, prefer the synthetic labels and Nick's
  paintings.

Ranked: (1) gradient-matching plus tear-mask head on the synthetic data; (2) a teacher bake-off on
the 7 watch-list pictures, scored by eye with Nick and against front-v5; (3) distil only where
teachers agree (low cross-teacher variance), mixed about 30% with synthetic; (4) teachers for maps,
low payoff.

## 5. Evaluation hygiene with tiny test sets

- **Report intervals, not points.** Pixels within an object are highly correlated, so the effective
  sample size is the number of objects (13), not the pixel count. Use a *cluster bootstrap*: resample
  objects with replacement, 2,000 times, and report the 2.5–97.5 percentiles. With 13 objects,
  82.5% vs 73.2% may well overlap. For per-label rule accuracy use Wilson intervals
  (https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval).
- **Compare models paired.** Bootstrap the *difference* between two models on the same resampled
  objects. That is far tighter than comparing two separate intervals.
- **Freeze a lockbox.** Split Nick's paintings into a dev set (iterate freely) and a sealed test set
  touched once per milestone. Repeated reuse of one test set overfits it (Recht et al.,
  https://arxiv.org/abs/1902.10811; reusable holdout, Dwork et al.,
  https://arxiv.org/abs/1506.02629). The current 13 objects have been used for model selection
  already, so treat them as dev from now on.
- **Never grade with a source used in training.** That is the circular rule-label lesson.
  Generalise it: if teacher X distils into the student, don't score against teacher X.
- **Per-class and per-object breakdowns always**, with the class-trade effect called out: a model
  is "better" only if no class drops outside its interval.
- **Seeds:** run 2–3 seeds per configuration. Seed variance on small models is often as large as the
  effects being measured.

## Top 5 overall (this setup)

1. Verify tile labels per label with Nick and Wilson intervals; keep, fix or drop each label.
2. Cluster-bootstrap evaluation with paired differences, and a sealed lockbox from Nick's paintings.
3. Outline and dither randomisation plus mean-teacher consistency on unlabelled real ROM crops.
4. Dilated bottleneck plus a 4th level and 96px crops; then tile-id conditioning with dropout once
   labels are clean.
5. Pictures: MiDaS gradient loss plus an explicit tear-mask head; teacher bake-off before any
   distillation.
