"""Run records for the training dashboard.

Every script that does a unit of work (generate data, calibrate, train, evaluate) opens a Run.
A run is a folder in the project's shared files, which the dashboard artifact reads live:

  relief-synth/runs/<id>/run.json       header: kind, name, status, config, architecture, results
  relief-synth/runs/<id>/metrics.jsonl  one JSON object per line, appended as work progresses
  relief-synth/runs/<id>/*.png          pictures, listed in run.json "images"

run.json is rewritten atomically by the process that owns the run; metrics.jsonl is append-only,
so parallel workers can share one run. Set RELIEF_RUNS to write somewhere else (e.g. on the Mac).
"""
import json, os, time, datetime as dt
import numpy as np

ROOT = os.environ.get("RELIEF_RUNS", "/mnt/project-files/relief-synth/runs")


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _clean(v):
    if isinstance(v, dict): return {str(k): _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)): return [_clean(x) for x in v]
    if isinstance(v, np.generic): return v.item()
    if isinstance(v, np.ndarray): return v.tolist()
    if isinstance(v, float) and not np.isfinite(v): return None
    return v


class Run:
    def __init__(self, kind, name, config=None, note="", run_id=None, parent=None):
        self.id = run_id or f"{dt.datetime.now(dt.timezone.utc):%Y%m%d-%H%M%S}-{kind}-{name}"
        self.dir = os.path.join(ROOT, self.id)
        os.makedirs(self.dir, exist_ok=True)
        path = os.path.join(self.dir, "run.json")
        if os.path.exists(path):
            self.h = json.load(open(path))
        else:
            self.h = dict(id=self.id, kind=kind, name=name, status="running", started=_now(), updated=_now(),
                          note=note, config=_clean(config or {}), parent=parent, results={}, images=[], arch=None)
            self._write()

    @classmethod
    def attach(cls, run_id):
        """Join an existing run (e.g. a parallel worker), to append metrics only."""
        r = cls.__new__(cls); r.id = run_id; r.dir = os.path.join(ROOT, run_id)
        r.h = json.load(open(os.path.join(r.dir, "run.json"))); return r

    def _write(self):
        self.h["updated"] = _now()
        # Written in place: the project-files mount (rclone) loses files renamed over an existing one.
        with open(os.path.join(self.dir, "run.json"), "w") as f: json.dump(_clean(self.h), f, indent=1)
        write_index()

    def log(self, **m):
        m.setdefault("t", _now())
        with open(os.path.join(self.dir, "metrics.jsonl"), "a") as f:
            f.write(json.dumps(_clean(m)) + "\n")

    def set(self, **fields):
        self.h.update(_clean(fields)); self._write()

    def result(self, **r):
        self.h["results"].update(_clean(r)); self._write()

    def image(self, filename, array_or_pil, caption=""):
        from PIL import Image
        im = array_or_pil if hasattr(array_or_pil, "save") else Image.fromarray(np.asarray(array_or_pil).astype(np.uint8))
        im.save(os.path.join(self.dir, filename))
        self.h["images"] = [i for i in self.h["images"] if i["file"] != filename] + [dict(file=filename, caption=caption)]
        self._write()

    def done(self, status="done", **results):
        self.h["results"].update(_clean(results)); self.h["status"] = status; self.h["finished"] = _now(); self._write()


def write_index():
    """runs/index.json: every run folder, so the dashboard needn't rely on folder listings."""
    ids = sorted(d for d in os.listdir(ROOT) if os.path.isfile(os.path.join(ROOT, d, "run.json")))
    with open(os.path.join(ROOT, "index.json"), "w") as f: json.dump({"runs": ids, "updated": _now()}, f)


def describe_model(model, input_shape):
    """Architecture summary for the dashboard: each top-level block with output shape and parameters,
    plus U-Net skip connections (from module names e1..e3 → d1..d3)."""
    import torch
    nodes, hooks = [], []
    for name, mod in model.named_children():
        def hook(m, i, o, name=name):
            nodes.append(dict(id=name, type=type(m).__name__, out=list(o.shape[1:]),
                              params=sum(p.numel() for p in m.parameters()),
                              layers=[type(l).__name__ for l in m.modules() if not list(l.children())]))
        hooks.append(mod.register_forward_hook(hook))
    was = model.training; model.eval()
    with torch.no_grad(): model(torch.zeros(1, *input_shape))
    model.train(was)
    for h in hooks: h.remove()
    names = {n["id"] for n in nodes}
    skips = [[f"e{k}", f"d{k}"] for k in range(1, 6) if f"e{k}" in names and f"d{k}" in names]
    return dict(input=list(input_shape), nodes=nodes, skips=skips, params=sum(p.numel() for p in model.parameters()),
                bytes_fp16=2 * sum(p.numel() for p in model.parameters()))
