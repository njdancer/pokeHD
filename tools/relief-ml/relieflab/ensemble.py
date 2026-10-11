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
