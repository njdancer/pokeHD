"""Mirror RELIEF_HOME/lab to the dashboard's store (PUT /api/admin/lab/<path>), and pull Nick's
flags down. Uploads every file whose mtime/size changed since its last successful upload, so
metrics.jsonl and run.json are re-PUT whole while a run is live (contract: "Live").

Never uploads, overwrites or deletes anything under flags/ except through `reply_flag`.
Base URL: RELIEF_LAB_URL (default https://pokehd.dncr.me). Token: $POKEHD_ADMIN_TOKEN or
~/.config/pokehd/admin-token (never printed).
"""
import json, os, time, urllib.error, urllib.request
from pathlib import Path
from . import lab
from .paths import LAB, LOGS

BASE = os.environ.get("RELIEF_LAB_URL", "https://pokehd.dncr.me").rstrip("/")
STATE = LOGS / "sync-state.json"
EXT = {"json", "jsonl", "png", "webp", "jpg", "f32", "u8", "bin", "txt", "md", "glb"}


def _token():
    t = os.environ.get("POKEHD_ADMIN_TOKEN")
    if t: return t.strip()
    p = Path.home() / ".config/pokehd/admin-token"
    return p.read_text().strip() if p.exists() else None


def _req(method, rel, body=None, headers=None):
    tok = _token()
    if not tok: raise RuntimeError("no admin token (POKEHD_ADMIN_TOKEN or ~/.config/pokehd/admin-token)")
    r = urllib.request.Request(f"{BASE}/api/admin/lab/{rel}", data=body, method=method,
                               headers={"Authorization": f"Bearer {tok}", **(headers or {})})
    with urllib.request.urlopen(r, timeout=60) as resp:
        return resp.status, resp.read()


def _files():
    for p in LAB.rglob("*"):
        if not p.is_file() or p.name.startswith("."): continue
        rel = p.relative_to(LAB).as_posix()
        if rel.startswith("flags/") or p.suffix[1:] not in EXT: continue
        yield rel, p


def once(state):
    sent = 0; errors = 0
    for rel, p in sorted(_files(), key=lambda x: (x[0] != "index.json", x[0])):
        st = p.stat(); sig = [st.st_mtime_ns, st.st_size]
        if state.get(rel) == sig: continue
        try:
            _req("PUT", rel, p.read_bytes()); state[rel] = sig; sent += 1
        except urllib.error.HTTPError as e:
            errors += 1; print(f"sync {rel}: HTTP {e.code}", flush=True)
            if e.code in (401, 403, 404) and rel == "index.json": raise
        except Exception as e:
            errors += 1; print(f"sync {rel}: {e!r}", flush=True)
    return sent, errors


def pull_flags():
    """Copy the dashboard's flags into lab/flags/ locally (read-only for the trainer)."""
    try:
        _, body = _req("GET", "flags/")
    except Exception:
        return 0
    n = 0
    for f in json.loads(body).get("files", []):
        rel = f["path"].removeprefix("lab/")
        if not rel.startswith("flags/"): rel = "flags/" + rel.split("/")[-1]
        _, data = _req("GET", rel)
        (LAB / rel).parent.mkdir(parents=True, exist_ok=True); (LAB / rel).write_bytes(data); n += 1
    return n


def reply_flag(flag_id, status, reply):
    rel = f"flags/{flag_id}.json"
    _, data = _req("GET", rel)
    doc = json.loads(data); doc.update(status=status, reply=reply, updated=lab.now())
    _req("PUT", rel, json.dumps(doc).encode(), {"content-type": "application/json"})
    (LAB / rel).write_text(json.dumps(doc, indent=1))


def loop(every=15):
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    k = 0
    while True:
        try:
            sent, err = once(state)
            if sent: STATE.write_text(json.dumps(state))
            if k % 8 == 0: pull_flags()
            (LOGS / "sync.json").write_text(json.dumps(dict(pid=os.getpid(), ts=lab.now(), sent=sent, errors=err, base=BASE)))
        except Exception as e:
            print(f"sync loop: {e!r}", flush=True)
        k += 1
        time.sleep(every)
