"""relieflab CLI. Run from tools/relief-ml with the venv's python:

  python -m relieflab submit <config> [--id RUN_ID]   queue a run (configs/<config>.json)
  python -m relieflab worker [--once]                  process the queue (resumes interrupted runs)
  python -m relieflab sync [--once]                    mirror the lab tree to the dashboard
  python -m relieflab status                           queue, runs, worker and sync state
  python -m relieflab stop <run id>                    stop a run after its current epoch
  python -m relieflab ops "<doing>" [--why ..] [--next ..]...   what the ops agent is doing now
  python -m relieflab event <kind> "<title>" [--body ..] [--run ..]   journal entry
  python -m relieflab flags                            list flags pulled from the dashboard
  python -m relieflab flag-reply <id> <seen|fixed|wontfix> "<reply>"
"""
import argparse, json, sys
from . import lab
from .paths import LAB, LOGS, QUEUE


def main(argv=None):
    ap = argparse.ArgumentParser(prog="relieflab")
    sp = ap.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("submit"); s.add_argument("config"); s.add_argument("--id")
    s = sp.add_parser("worker"); s.add_argument("--once", action="store_true")
    s = sp.add_parser("sync"); s.add_argument("--once", action="store_true")
    sp.add_parser("status")
    s = sp.add_parser("stop"); s.add_argument("run")
    s = sp.add_parser("ops"); s.add_argument("doing"); s.add_argument("--why", default=""); s.add_argument("--next", action="append", default=[]); s.add_argument("--run", action="append", default=[])
    s = sp.add_parser("event"); s.add_argument("kind"); s.add_argument("title"); s.add_argument("--body"); s.add_argument("--run", action="append")
    sp.add_parser("flags")
    s = sp.add_parser("flag-reply"); s.add_argument("id"); s.add_argument("status"); s.add_argument("reply")
    a = ap.parse_args(argv)

    if a.cmd == "submit":
        from .runner import submit
        print(submit(a.config, a.id))
    elif a.cmd == "worker":
        from .runner import worker
        worker(a.once)
    elif a.cmd == "sync":
        from . import sync
        if a.once:
            st = json.loads(sync.STATE.read_text()) if sync.STATE.exists() else {}
            print(sync.once(st)); sync.STATE.write_text(json.dumps(st))
        else:
            sync.loop()
    elif a.cmd == "status":
        idx = lab.read_json("index.json", {})
        print("queue:", [p.name for p in sorted(QUEUE.glob("*.json"))])
        for f in ("worker.json", "sync.json"):
            p = LOGS / f
            print(f, p.read_text() if p.exists() else "-")
        for r in idx.get("runs", [])[-12:]:
            s = r.get("summary", {})
            print(f"{r['id']:40s} {r['status']:8s} " + " ".join(f"{k}={v:.4g}" for k, v in s.items() if isinstance(v, (int, float)) and k in
                  ("test_acc", "real_balanced", "val_face_acc", "val_angle", "val_depth_err")))
        print("best:", idx.get("best")); print("ops:", idx.get("ops", {}).get("doing"))
    elif a.cmd == "stop":
        (QUEUE / f"stop-{a.run}").write_text("stop"); print("will stop after the current epoch")
    elif a.cmd == "ops":
        lab.set_ops(a.doing, a.why, a.next, a.run)
    elif a.cmd == "event":
        lab.event(a.kind, a.title, body=a.body, runs=a.run)
    elif a.cmd == "flags":
        for p in sorted((LAB / "flags").glob("*.json")) if (LAB / "flags").exists() else []:
            f = json.loads(p.read_text()); print(f"{f['id']} [{f['status']}] {f['kind']}: {f['note']}")
    elif a.cmd == "flag-reply":
        from . import sync
        sync.reply_flag(a.id, a.status, a.reply)


if __name__ == "__main__":
    sys.exit(main())
