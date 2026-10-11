"""The job runner: a queue of runs executed one at a time, each through its stages, resuming after
any interruption (a killed process, a reboot): finished stages are skipped, training continues from
its last checkpoint.

Queue: RELIEF_HOME/queue/<seq>-<run id>.json  ({"run": id, "config": resolved config}).
Stop a run between epochs: `python -m relieflab stop <run id>` (writes queue/stop-<run id>).
"""
import json, os, signal, sys, time, traceback
import datetime as dt
import torch
from . import config as cfgmod, datasets, evals, lab, render3d, tasks
from .paths import CKPT, LOGS, QUEUE
from .runs import Run
from .train import Trainer

PRIMARY = {"faces": ("test_cat_mean", "higher"), "normals": ("test_cat_mean", "higher"), "picture": ("val_depth_err", "lower")}


class Stopped(Exception):
    pass


def submit(name, run_id=None, **overrides):
    cfg = cfgmod.load(name)
    cfg = cfgmod.merge(cfg, overrides) if overrides else cfg
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M")
    rid = run_id or f"{stamp}-{cfg['name']}"
    Run(rid, cfg)
    (QUEUE / f"{int(time.time()):010d}-{rid}.json").write_text(json.dumps(dict(run=rid, config=cfg), indent=1))
    lab.event("status", f"Queued {rid}", body=cfg.get("why") or cfg.get("note"), runs=[rid])
    return rid


def pending():
    return sorted(QUEUE.glob("*.json"))


def _heartbeat(state, run=None):
    (LOGS / "worker.json").write_text(json.dumps(dict(pid=os.getpid(), state=state, run=run, ts=lab.now())))


def _check_stop(rid):
    if (QUEUE / f"stop-{rid}").exists():
        (QUEUE / f"stop-{rid}").unlink(); raise Stopped(rid)


def _load_model(cfg, rid):
    m = tasks.build(cfg).to(tasks.device())
    m.load_state_dict(torch.load(CKPT / rid / "model.pt", map_location=tasks.device(), weights_only=False)["model"]); m.eval()
    return m


def execute(job):
    rid, cfg = job["run"], job["config"]
    run = Run(rid, cfg)
    run.set(status="running", started=run.h.get("started") or lab.now())
    _heartbeat("running", rid)
    model = None
    if run.stage_status("data") != "done":
        run.stage("data", "running")
        ids = []
        for i, r in enumerate(cfg["datasets"]):
            ids.append(datasets.ensure(r, on_progress=lambda d, done, n, i=i: run.progress("data", i + done / n, len(cfg["datasets"]), "datasets")))
        run.set(datasets=ids); run.stage("data", "done")
    if run.stage_status("train") != "done":
        run.stage("train", "running")
        tr = Trainer(cfg, run)
        def on_epoch(t):
            evals.watch(t.model, cfg, run, t.epoch)
            if "preds/watch.json" not in run.h.get("preds", []): run.set(preds=run.h.get("preds", []) + ["preds/watch.json"])
            _heartbeat("running", rid); _check_stop(rid)
        model = tr.fit(on_epoch)
        run.stage("train", "done")
    if run.stage_status("eval") != "done":
        run.stage("eval", "running")
        model = model or _load_model(cfg, rid)
        res = evals.run_all(model, cfg, run)
        run.summary(**res); run.stage("eval", "done")
        _best(run, cfg)
    if cfg["eval"].get("render3d") and run.stage_status("render3d") != "done":
        run.stage("render3d", "running")
        model = model or _load_model(cfg, rid)
        try:
            render3d.attach(model, cfg, run); run.stage("render3d", "done")
        except Exception as e:
            run.stage("render3d", "failed", note=repr(e)[:300])
    run.set(status="done", finished=lab.now())
    lab.event("milestone", f"{rid} finished", body=_summary_text(run), runs=[rid])


def _summary_text(run):
    s = run.h.get("summary", {})
    keys = ["test_acc", "test_obj_mean", "real_balanced", "val_face_acc", "val_angle", "val_depth_err"]
    return "\n".join(f"- {k}: {s[k]:.4g}" for k in keys if isinstance(s.get(k), (int, float)))


def _best(run, cfg):
    """Best run per task by its primary metric; records when the best last improved (plateau watch)."""
    if "smoke" in cfg.get("tags", []): return
    key, better = PRIMARY.get(cfg["task"], ("val_angle", "lower"))
    val = run.h["summary"].get(key)
    if val is None: return
    idx = lab.read_json("index.json", {})
    cur = idx.get("best", {}).get(cfg["task"])
    cur_val = None
    if cur:
        h = lab.read_json(f"runs/{cur}/run.json") or {}
        cur_val = h.get("summary", {}).get(key)
    if cur_val is None or (val > cur_val if better == "higher" else val < cur_val):
        lab.update_index(best={cfg["task"]: run.id}, improved={cfg["task"]: lab.now()})
        lab.event("milestone", f"New best {cfg['task']} model: {run.id} ({key} {val:.4g}, was {cur_val if cur_val is None else round(cur_val, 4)})", runs=[run.id])


def _single_instance():
    """Exactly one worker per RELIEF_HOME: two would train the same run twice."""
    import fcntl
    f = open(LOGS / "worker.lock", "a+")
    try: fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: raise SystemExit("another worker is already running")
    f.truncate(0); f.write(str(os.getpid())); f.flush()
    return f


def _code_mtime():
    from .paths import PKG
    return max(p.stat().st_mtime for p in PKG.rglob("*.py"))


def worker(once=False):
    """Process the queue forever (or until empty with once=True). Between jobs, re-executes itself
    if the pipeline code changed, so new runs always use the latest code."""
    _lock = _single_instance()
    born = _code_mtime()
    stop = {"flag": False}
    def term(*_): stop["flag"] = True; raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, term)
    (QUEUE / "done").mkdir(exist_ok=True); (QUEUE / "failed").mkdir(exist_ok=True)
    while not stop["flag"]:
        jobs = pending()
        if not jobs:
            if once: _heartbeat("idle"); return
            _heartbeat("idle"); time.sleep(10); continue
        if not once and _code_mtime() > born:
            print("code changed: restarting worker", flush=True)
            _lock.close()
            os.execv(sys.executable, [sys.executable, "-u", "-m", "relieflab", "worker"])
        f = jobs[0]; job = json.loads(f.read_text())
        try:
            execute(job)
            os.replace(f, QUEUE / "done" / f.name)
        except Stopped:
            Run(job["run"], job["config"]).set(status="stopped", finished=lab.now())
            lab.event("status", f"Stopped {job['run']}", runs=[job["run"]])
            os.replace(f, QUEUE / "failed" / f.name)
        except KeyboardInterrupt:
            # Interrupted: leave the job queued; the next worker resumes it from its checkpoint.
            Run(job["run"], job["config"]).set(status="queued")
            _heartbeat("stopped"); return
        except Exception as e:
            tb = traceback.format_exc()
            print(tb, file=sys.stderr, flush=True)
            r = Run(job["run"], job["config"])
            for s in r.h["stages"]:
                if s["status"] == "running": s["status"] = "failed"; s["note"] = repr(e)[:300]
            r.set(status="failed", finished=lab.now(), error=tb[-2000:])
            lab.event("status", f"{job['run']} failed: {e!r}"[:200], body=f"```\n{tb[-1500:]}\n```", runs=[job["run"]])
            os.replace(f, QUEUE / "failed" / f.name)


def prep(every=60):
    """Generates the datasets of queued runs on the CPU while the worker trains on the GPU."""
    while True:
        for f in pending():
            try:
                job = json.loads(f.read_text())
                for r in job["config"]["datasets"]:
                    datasets.ensure(r, workers=6)
            except Exception as e:
                print(f"prep {f.name}: {e!r}", flush=True)
        time.sleep(every)
