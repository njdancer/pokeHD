"""Nick's relief-editor paintings (D38: training and evaluation material only) as ground truth.

The editor stores 64 normals per painted tile (tileset name + tile id), so one painting covers every
place that tile appears. `fetch()` downloads the document through the admin API (the token stays
inside the script) to RELIEF_HOME/private/relief.json. `evaluate()` scores a model on every
occurrence of a painted tile in the held-out eval maps, with normals snapped to the five faces.
"""
import base64, json
import numpy as np
from . import lab, tasks
from .paths import PRIVATE

DOC = PRIVATE / "relief.json"


def fetch():
    from . import sync
    import urllib.request
    tok = sync._token()
    r = urllib.request.Request(f"{sync.BASE}/api/admin/relief", headers={"Authorization": f"Bearer {tok}", "User-Agent": "relieflab/1"})
    with urllib.request.urlopen(r, timeout=60) as resp:
        data = resp.read()
    DOC.write_bytes(data)
    d = json.loads(data)
    return sum(len(v) for v in d.get("tiles", {}).values()), len(d.get("pics", {}))


def decode(text):
    b = np.frombuffer(base64.b64decode(text), np.int8).astype(np.float32) / 127
    n = b.reshape(-1, 3)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-6)


def painted_tiles():
    """{(tileset index, tile id): (8, 8) face indices} for every painted map tile."""
    if not DOC.exists(): return {}
    d = json.loads(DOC.read_text()); D = tasks.rom()
    by_name = {t["name"]: i for i, t in enumerate(D["tilesets"])}
    out = {}
    for ts, tiles in d.get("tiles", {}).items():
        if ts not in by_name: continue
        for tid, enc in tiles.items():
            n = decode(enc)
            if len(n) != 64: continue
            out[(by_name[ts], int(tid))] = (n @ tasks.FACES.T).argmax(-1).reshape(8, 8).astype(np.uint8)
    return out


def half(key):
    """Painted tiles are split in two by a fixed hash: 'train' tiles may teach, 'eval' tiles only score."""
    import zlib
    return "train" if zlib.crc32(f"{key[0]}:{key[1]}".encode()) % 2 == 0 else "eval"


def truth_map(name, painted):
    """Face truth for a map from paintings (255 where nothing is painted), plus the painted labels."""
    D = tasks.rom(); m = next(m for m in D["maps"] if m["name"] == name)
    ts = D["tilesets"][m["tileset"]]
    _, labs = tasks.map_img(name)
    T = np.full((m["h"] * 32, m["w"] * 32), 255, np.uint8); L = {}
    for by in range(m["h"]):
        for bx in range(m["w"]):
            b = m["blocks"][by * m["w"] + bx]
            for i in range(16):
                tid = ts["blocks"][b * 16 + i]
                f = painted.get((m["tileset"], tid))
                if f is None: continue
                y, x = by * 32 + (i // 4) * 8, bx * 32 + (i % 4) * 8
                T[y:y + 8, x:x + 8] = f; L[(y, x)] = labs[y // 8, x // 8]
    return T, L


def evaluate(model, cfg, run, maps):
    painted = painted_tiles()
    # Always the 'eval' half, so models trained on the other half compare fairly with the rest.
    painted = {k: v for k, v in painted.items() if half(k) == "eval"}
    trained = True
    if not painted: return {}
    K = np.zeros((5, 5), np.int64); per_label = {}
    for name in maps:
        T, L = truth_map(name, painted)
        if not L: continue
        img, _ = tasks.map_img(name)
        p = tasks.predict(model, cfg, img)
        f = p["faces"] if "faces" in p else (p["normal"] @ tasks.FACES.T).argmax(-1)
        m = T < 255
        np.add.at(K, (T[m].astype(int), f[m].astype(int)), 1)
        for (y, x), l in L.items():
            t = T[y:y + 8, x:x + 8]; pf = f[y:y + 8, x:x + 8]
            a = per_label.setdefault(str(l), [0, 0]); a[0] += int((t == pf).sum()); a[1] += 64
    if K.sum() == 0: return {}
    acc = float(np.trace(K) / K.sum())
    labels = ["TOP", "FRONT", "SLOPE", "HIP◀", "HIP▶"]
    run.eval("paintings", dict(title="Nick's relief-editor paintings (held-out maps, held-out half of the painted tiles)",
                               split="paintings", circular=False,
                               overall=dict(acc=acc, tiles=len(painted), pixels=int(K.sum())),
                               perClass=dict(acc={labels[i]: float(K[i, i] / K[i].sum()) for i in range(5) if K[i].sum()}),
                               perLabel={k: v[0] / v[1] for k, v in per_label.items()},
                               confusion=dict(labels=labels, matrix=K.tolist())))
    return dict(paint_acc=acc)
