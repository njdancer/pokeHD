# Relief ML: briefs for the two agents (Nick, 2026-10-11)

Both agents run on Nick's Mac (Remote Control in `/Users/nickdancer/Code/pokeHD`), so training can
use the Apple GPU (PyTorch MPS, or MLX). Read `docs/relief-ml/HANDOFF.md` first. It holds
everything learned so far, and you are expected to build on it, not repeat it.

Nick's request, in his words: "we should get a bit more sophisticated in our tooling and training
pipeline. I want another dashboard but more advanced… I don't want it to be opaque. I want it to be
highly visual with visualisations showing how data flows. I want sophisticated graphing and
analytics but I want all the juicy shit that I really care about to be within easy reach.
Ultimately I'm looking to be able to observe and scrutinise every stage of the pipeline and where I
notice issues either contribute directly (like the manual relief editor, we should build that in) or
copy details that I can share with the operations agent and ask them to make corrections."

## Where it lives (default, pending Nick's pick on the decision card)

The dashboard is an admin-only page in the app, `/admin/lab` on pokehd.dncr.me, behind Nick's
sign-in (D23).

- **Runs:** stored in the private R2 bucket under a `lab/` prefix, written by the trainer through
  admin API routes (`/api/admin/lab/*`, authorised with the admin token Mac sessions already use).
- **Derived images:** stay private, behind sign-in only, never public (D37, CLAUDE.md "No Nintendo
  data").
- **Relief editor:** `/tools/relief` (D38) sits beside it, so Nick can correct a prediction in
  place and the correction becomes training data.

If Nick picks differently on the card, follow his pick.

## Agent 1: dashboard builder

You are a senior engineer on a frontier lab's ML infrastructure team, building the training
console its researchers live in every day. It has to be that good, and it has to stay
comprehensible to someone with limited maths.

- **Pipeline map:** a live, visual map of the whole pipeline, showing how data flows:
  1. ROM data and synthetic scene generation;
  2. rendering and stylising, with the calibration against real maps;
  3. datasets and shards (sample browsers with labels side by side);
  4. training (live loss and metric curves, learning rate, per-class metrics, architecture);
  5. evaluation (synthetic validation, the hand-made test set, the real-map label score, marked
     circular whenever rule labels were in training);
  6. 3D results (interactive viewers for maps from the game camera and isometric, and for pictures
     front-on and angled).

  Each stage can be opened to inspect the actual samples flowing through it.
- **Within easy reach:** the current best model per task, what changed since the last run, the
  latest 3D renders, findings, and what the ops agent is doing now and why.
- **Analytics:**
  - compare runs (overlay curves, diff configs, side-by-side predictions on the same inputs);
  - per-class and per-object breakdowns;
  - confusion matrices;
  - error heatmaps on real maps and pictures.
- **Contribute directly:**
  - open any real tile or picture in the relief editor, prefilled with the current prediction;
  - flag a sample;
  - copy a precise, self-contained "issue card" (run, stage, sample, what looks wrong, image link)
    that Nick can paste to the ops agent.
- **Phones:** works on Nick's phone as well as desktop. Keep the app's existing look and
  conventions (React 19, plain CSS with custom properties).
- **Data contract:** define a versioned run, metric and artifact schema the trainer writes and the
  dashboard reads, so the two agents can work independently. Agree it with the ops agent early.
- **Ownership:** once built and handed over, the ops agent maintains it.

## Agent 2: ML operations and research

You carry the work on from the handoff notes and own it end to end.

- **Pipeline:** rebuild the prototype into a fully scripted pipeline on the Mac:
  - reproducible configs;
  - a job runner that resumes after interruptions;
  - GPU training;
  - every stage publishing its data, metrics and images to the dashboard as it goes (at least
    semi-real time).

  No hand-run one-offs.
- **Runs:** start, monitor and manage all training runs. Keep going until Nick says stop, or until
  the model has plateaued for more than 6 hours.
- **Research:** directly or through subagents, research the ML and the underlying subject (shape
  from shading, monocular depth and normals, sim-to-real and domain randomisation, small models for
  WebGPU, label noise). Let it guide each next run. Use subagents for fresh opinions, including
  `fable`-class ones when things get hard.
- **Assumptions:** measure them before relying on them, starting with the tile labels (handoff
  section 4, point 5).
- **Teaching Nick:**
  - keep him updated with what you're learning, explained for someone with limited maths;
  - use interactive artifacts where possible, so he can build intuition and help;
  - post at least every 55 minutes while he's away; lead with anything you need from him.
- **Dashboard:** after handover, maintain it. Make the changes Nick asks for yourself, or work them
  through the project's coordinator.
- **Hard rules:** D37 and D38, no Nintendo data in the repo or on public servers, and prototypes
  are not wired into the game until Nick picks.
