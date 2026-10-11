"""Experiment configs: JSON files in tools/relief-ml/configs. `extends` names a parent config whose
fields are deep-merged underneath, so a new run states only what changed. The resolved config is
stored with the run, so every run can be reproduced from its run.json alone."""
import hashlib, json
from .paths import CONFIGS

DEFAULTS = {
    "task": "faces",                     # faces | normals | picture
    "title": "", "note": "", "parent": None, "tags": [],
    "datasets": [],                      # recipes, see datasets.py
    "real": {"share": 0.0, "objectRuleWeight": 1.0},   # faces: real maps labelled by the plan rule
    "model": {"arch": "unet3", "width": 40, "occ": False, "depth": False},
    "train": {"epochs": 20, "batch": 32, "crop": 48, "lr": 2e-3, "weightDecay": 1e-4, "objectWeight": 4.0,
              "valFraction": 0.05, "seed": 0, "logEvery": 25},
    "eval": {"testset": True, "realMaps": True, "pictures": True, "render3d": True},
}


def merge(a, b):
    out = dict(a)
    for k, v in b.items():
        out[k] = merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load(name_or_path):
    p = CONFIGS / (name_or_path if name_or_path.endswith(".json") else name_or_path + ".json")
    raw = json.loads(p.read_text())
    base = load(raw.pop("extends")) if "extends" in raw else DEFAULTS
    cfg = merge(base, raw)
    cfg["name"] = p.stem
    return cfg


def digest(obj, n=10):
    return hashlib.sha1(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:n]
