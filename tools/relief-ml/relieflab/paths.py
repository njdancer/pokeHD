"""Where everything lives. Code is in the repo; data, checkpoints and the lab tree live in RELIEF_HOME
(default ~/relief-lab), outside the repo, because much of it is derived from the ROM.

  RELIEF_HOME/private/rom.json      ROM dump (dump-rom.ts). Nintendo data: never commit or publish.
  RELIEF_HOME/data/<dataset id>/    synthetic shards, cached by recipe hash
  RELIEF_HOME/ckpt/<run id>/        checkpoints (last.pt for resume, model.pt for the final weights)
  RELIEF_HOME/lab/                  the dashboard's tree (LAB-CONTRACT.md); synced to private R2
  RELIEF_HOME/queue/                job files for the runner
  RELIEF_HOME/logs/                 runner and sync logs
"""
import os
from pathlib import Path

HOME = Path(os.environ.get("RELIEF_HOME", Path.home() / "relief-lab"))
PRIVATE = HOME / "private"
DATA = HOME / "data"
CKPT = HOME / "ckpt"
LAB = HOME / "lab"
QUEUE = HOME / "queue"
LOGS = HOME / "logs"
ROM_JSON = PRIVATE / "rom.json"

PKG = Path(__file__).resolve().parent
TOOL = PKG.parent                      # tools/relief-ml
REPO = TOOL.parent.parent
CONFIGS = TOOL / "configs"
TESTSET = TOOL / "prototype" / "testset" / "objects.json"
SHAPE_TS = REPO / "apps/web/src/client/tools/relief/shape.ts"

for d in (PRIVATE, DATA, CKPT, LAB, QUEUE, LOGS):
    d.mkdir(parents=True, exist_ok=True)
