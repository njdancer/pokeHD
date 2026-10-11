"""Ensembles: several trained runs averaged (mean of their per-pixel face probabilities). Scored
and published like a run, so the dashboard compares it with its members.
Usage: python -m relieflab ensemble <name> <run id> <run id> ..."""
import torch, torch.nn as nn
from . import evals, lab, render3d, tasks
from .runner import _load_model
from .runs import Run


class Ensemble(nn.Module):
    def __init__(self, models):
        super().__init__(); self.models = nn.ModuleList(models)

    def forward(self, x):
        p = torch.stack([m(x).softmax(1) for m in self.models]).mean(0)
        return p.clamp_min(1e-8).log()   # logits whose softmax is the mean probability


def build(name, run_ids):
    cfgs = [lab.read_json(f"runs/{r}/run.json")["config"] for r in run_ids]
    cfg = dict(cfgs[0]); cfg["name"] = name
    assert cfg["task"] == "faces", "ensembles are for the faces task"
    model = Ensemble([_load_model(c, r) for c, r in zip(cfgs, run_ids)]).eval()
    rid = f"{lab.now()[:16].replace('-', '').replace(':', '').replace('T', '-')}-{name}"
    run = Run(rid, dict(cfg, title=f"Ensemble of {len(run_ids)} runs", why="Average several training runs to cancel run-to-run luck.",
                        changes=[f"Mean of: {', '.join(run_ids)}"], parent=run_ids[0]))
    run.set(status="running", started=lab.now(), members=run_ids, datasets=[])
    for s in ("data", "train"): run.stage(s, "done", note="members")
    run.stage("eval", "running"); res = evals.run_all(model, cfg, run); run.summary(**res); run.stage("eval", "done")
    run.stage("render3d", "running"); render3d.attach(model, cfg, run); run.stage("render3d", "done")
    run.set(status="done", finished=lab.now())
    from .runner import _best
    _best(run, cfg)
    return rid, res


TRUSTED = {"ground", "lawn", "tall-grass", "flower", "water", "shore", "bridge", "floor", "roof", "wall", "wall-interior", "window", "door", "picture"}


class Router(nn.Module):
    """Two models, chosen per tile by its label: tiles whose rule label is clear-cut (buildings, ground,
    floors, walls) go to the label-trained model; everything else (furniture, plants, ledges...) to the
    label-free one. Tile labels come from our own committed tables, so this works at runtime too.
    Needs the label grid, set with .labels before predicting a map."""
    def __init__(self, labelled, free):
        super().__init__(); self.labelled, self.free = labelled, free; self.mask = None

    def forward(self, x):
        a, b = self.labelled(x).softmax(1), self.free(x).softmax(1)
        if self.mask is None: return ((a + b) / 2).clamp_min(1e-8).log()
        m = self.mask[..., :x.shape[-2], :x.shape[-1]].to(x.device)
        m = torch.nn.functional.pad(m, (0, x.shape[-1] - m.shape[-1], 0, x.shape[-2] - m.shape[-2]), value=1.0)
        return (a * m + b * (1 - m)).clamp_min(1e-8).log()


def build_router(name, labelled_run, free_run):
    import numpy as np
    cfgs = [lab.read_json(f"runs/{r}/run.json")["config"] for r in (labelled_run, free_run)]
    cfg = dict(cfgs[0]); cfg["name"] = name
    router = Router(_load_model(cfgs[0], labelled_run), _load_model(cfgs[1], free_run)).eval()
    orig = tasks.map_img
    def predict_with_labels(model, cfg_, img, _p=tasks.predict):
        return _p(model, cfg_, img)
    # Patch map_img so every evaluated map sets the router's tile mask from its labels.
    def map_img(n):
        img, labs = orig(n)
        t = np.vectorize(lambda l: 1.0 if l in TRUSTED else 0.0)(labs).astype(np.float32)
        router.mask = torch.as_tensor(np.kron(t, np.ones((8, 8), np.float32)))[None]
        return img, labs
    tasks.map_img = map_img
    try:
        rid = f"{lab.now()[:16].replace('-', '').replace(':', '').replace('T', '-')}-{name}"
        run = Run(rid, dict(cfg, title="Router: labelled model for clear-cut tiles, label-free model for the rest",
                            why="Label-trained models get buildings right and chairs wrong; label-free models the opposite, on every seed. Let the tile label pick which model answers.",
                            changes=[f"Clear-cut tiles: {labelled_run}", f"Everything else: {free_run}"], parent=labelled_run))
        run.set(status="running", started=lab.now(), members=[labelled_run, free_run], datasets=[])
        for s in ("data", "train"): run.stage(s, "done", note="members")
        run.stage("eval", "running"); res = evals.run_all(router, cfg, run); run.summary(**res); run.stage("eval", "done")
        run.stage("render3d", "running"); render3d.attach(router, cfg, run); run.stage("render3d", "done")
        run.set(status="done", finished=lab.now())
        from .runner import _best
        _best(run, cfg)
    finally:
        tasks.map_img = orig
    return rid, res
