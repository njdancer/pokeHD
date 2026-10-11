#!/bin/sh
# Starts the relieflab worker and sync loop fully detached (own session), logging to RELIEF_HOME/logs.
cd "$(dirname "$0")"
H="${RELIEF_HOME:-$HOME/relief-lab}"; mkdir -p "$H/logs"
PY=../../.venv/bin/python
$PY - "$@" <<'PYEOF'
import os, subprocess, sys
H = os.environ.get("RELIEF_HOME", os.path.expanduser("~/relief-lab"))
what = sys.argv[1:] or ["worker"]
for w in what:
    log = open(f"{H}/logs/{w}.log", "a")
    p = subprocess.Popen(["../../.venv/bin/python", "-u", "-m", "relieflab", w], stdout=log, stderr=log,
                         stdin=subprocess.DEVNULL, start_new_session=True)
    print(w, p.pid)
PYEOF
