"""The trainer's side of the dashboard data contract (docs/relief-ml/LAB-CONTRACT.md).

Everything the pipeline wants the dashboard to show is written as files under RELIEF_HOME/lab, in
the layout the contract defines. `sync.py` mirrors changed files to the private bucket. Writes are
atomic (temp file + rename) so a reader never sees half a file.
"""
import contextlib, datetime as dt, fcntl, io, json, os, threading
from pathlib import Path
import numpy as np
from .paths import LAB

SCHEMA = 1
_tlock = threading.RLock()


@contextlib.contextmanager
def _locked():
    """Serialises index and journal updates across threads and processes (runner, CLI, sync)."""
    with _tlock, open(LAB / ".lock", "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try: yield
        finally: fcntl.flock(f, fcntl.LOCK_UN)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def iso_in(seconds):
    t = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=max(0, seconds))
    return t.isoformat(timespec="seconds").replace("+00:00", "Z")


def clean(v):
    if isinstance(v, dict): return {str(k): clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)): return [clean(x) for x in v]
    if isinstance(v, np.generic): return clean(v.item())
    if isinstance(v, np.ndarray): return clean(v.tolist())
    if isinstance(v, float) and not np.isfinite(v): return None
    if isinstance(v, Path): return str(v)
    return v


def _atomic(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_bytes(data); os.replace(tmp, path)


def write_json(rel, obj):
    _atomic(LAB / rel, json.dumps(clean(obj), indent=1).encode())


def read_json(rel, default=None):
    p = LAB / rel
    return json.loads(p.read_text()) if p.exists() else default


def append_jsonl(rel, obj):
    p = LAB / rel; p.parent.mkdir(parents=True, exist_ok=True)
    with _locked(), open(p, "a") as f: f.write(json.dumps(clean(obj)) + "\n")


def png_bytes(arr, mode=None):
    from PIL import Image
    im = arr if hasattr(arr, "save") else Image.fromarray(np.ascontiguousarray(arr), mode)
    b = io.BytesIO(); im.save(b, "PNG", optimize=False); return b.getvalue()


def write_png(rel, arr, mode=None):
    _atomic(LAB / rel, png_bytes(arr, mode))


def write_f32(rel, arr):
    _atomic(LAB / rel, np.ascontiguousarray(arr, dtype="<f4").tobytes())


EVENT_KINDS = ("finding", "decision", "question", "milestone", "note", "status")


def event(kind, title, body=None, runs=None, **extra):
    """The ops journal (events.jsonl): findings, decisions, questions, milestones."""
    assert kind in EVENT_KINDS, kind
    e = dict(ts=now(), kind=kind, title=title, **({"body": body} if body else {}), **({"runs": runs} if runs else {}), **extra)
    append_jsonl("events.jsonl", e)


def set_ops(doing, why="", next_up=None, runs=None, **extra):
    """'What the ops agent is doing now and why', shown at the top of the dashboard."""
    with _locked():
        idx = read_json("index.json", {})
        ops = idx.get("ops", {})
        ops.update(doing=doing, why=why, next=next_up or [], runs=runs or [], updated=now(), **extra)
        idx["ops"] = ops
        _write_index(idx)


def _write_index(idx):
    idx["schema"] = SCHEMA; idx["updated"] = now()
    idx.setdefault("runs", [])
    write_json("index.json", idx)


def update_index(run_header=None, dataset_header=None, best=None, improved=None):
    """index.json: every run and dataset (summary fields only) plus the best model per task."""
    with _locked():
        idx = read_json("index.json", {})
        if run_header:
            keep = ("id", "name", "task", "title", "status", "parent", "datasets", "created", "started", "updated",
                    "finished", "summary", "archived")
            row = {k: run_header[k] for k in keep if run_header.get(k) is not None}
            runs = [r for r in idx.get("runs", []) if r["id"] != row["id"]] + [row]
            idx["runs"] = sorted(runs, key=lambda r: r.get("created") or "")
        if dataset_header:
            keep = ("id", "title", "kind", "view", "status", "updated", "progress")
            row = {k: dataset_header[k] for k in keep if dataset_header.get(k) is not None}
            idx["datasets"] = [d for d in idx.get("datasets", []) if d["id"] != row["id"]] + [row]
        if best:
            idx.setdefault("best", {}).update(best)
        if improved:
            idx.setdefault("ops", {"doing": ""}).setdefault("lastImproved", {}).update(improved)
        _write_index(idx)
