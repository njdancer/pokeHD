"""A run's record in the lab tree: runs/<id>/run.json (header), metrics.jsonl, evals/, preds/, images/.

The header is rewritten atomically by the runner that owns the run. Stages track the pipeline
(data → train → eval → 3d) so the dashboard can draw where a run is and the runner can resume it.
"""
import os, platform, subprocess
from . import lab
from .paths import REPO

# (name, contract stage): the run's own steps, left to right on the dashboard's pipeline map
STAGES = [("data", "dataset"), ("train", "train"), ("eval", "eval"), ("render3d", "3d")]


def git_state():
    try:
        sha = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        dirty = bool(subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "tools/relief-ml"], capture_output=True, text=True).stdout.strip())
        return dict(sha=sha, dirty=dirty)
    except Exception:
        return None


class Run:
    def __init__(self, run_id, cfg=None):
        self.id = run_id
        self.base = f"runs/{run_id}"
        h = lab.read_json(self.base + "/run.json")
        if h is None:
            h = dict(schema=lab.SCHEMA, id=run_id, name=cfg["name"], task=cfg["task"], title=cfg.get("title") or cfg["name"],
                     why=cfg.get("why", ""), note=cfg.get("note", ""), parent=cfg.get("parent"), changes=cfg.get("changes", []),
                     tags=cfg.get("tags", []), status="queued", created=lab.now(), host=platform.node(), git=git_state(),
                     config=cfg, stages=[dict(name=n, stage=st, status="queued") for n, st in STAGES],
                     arch=None, datasets=[], summary={}, metrics={}, classes=None, findings=[], images=[], evals=[])
        self.h = h
        self.save()

    def save(self):
        self.h["updated"] = lab.now()
        self.h = {k: v for k, v in self.h.items() if v is not None or k in ("parent", "arch")}
        lab.write_json(self.base + "/run.json", self.h)
        lab.update_index(run_header=self.h)

    def set(self, **kw):
        self.h.update(lab.clean(kw)); self.save()

    def stage(self, name, status, **kw):
        for s in self.h["stages"]:
            if s["name"] == name:
                s["status"] = status
                if status == "running": s.setdefault("started", lab.now())
                if status in ("done", "failed", "stopped"): s["finished"] = lab.now()
                s.update(lab.clean(kw))
        self.save()

    def stage_status(self, name):
        return next(s["status"] for s in self.h["stages"] if s["name"] == name)

    def progress(self, name, done, total, unit, eta=None):
        for s in self.h["stages"]:
            if s["name"] == name: s["progress"] = lab.clean(dict(done=done, total=total, unit=unit, **({"eta": eta} if eta else {})))
        self.save()

    def metric(self, step, split, metrics, epoch=None):
        """One metrics.jsonl row: {ts, step, epoch, split, metrics{}}; per-class keys as 'acc/TOP'."""
        lab.append_jsonl(self.base + "/metrics.jsonl", dict(ts=lab.now(), step=step, epoch=epoch, split=split, metrics=metrics))

    def image(self, name, arr, caption="", kind="other"):
        rel = f"images/{name}"
        lab.write_png(f"{self.base}/{rel}", arr)
        self.h["images"] = [i for i in self.h["images"] if i["path"] != rel] + [dict(path=rel, caption=caption, kind=kind)]
        self.save()

    def eval(self, name, doc):
        lab.write_json(f"{self.base}/evals/{name}.json", dict(schema=lab.SCHEMA, name=name, **doc))
        if name not in self.h["evals"]: self.h["evals"].append(name)
        self.save()

    def finding(self, text, body=None):
        self.h["findings"].append(text); self.save()
        lab.event("finding", text, body=body, runs=[self.id])

    def summary(self, **kw):
        self.h["summary"].update(lab.clean(kw)); self.save()
