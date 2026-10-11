"""Synthetic datasets: a recipe (view, first seed, count, scene shares) fully determines the scenes,
so a dataset is cached under the hash of its recipe and regenerated only if missing. Shards are
written atomically by a process pool and skipped when present, so generation resumes after any
interruption. Each dataset publishes dataset.json, progress and sample sheets to the lab tree.

Recipe: {"view": "map"|"front", "seed": 0, "n": 6000, "shares": {"room": 0.5, "furniture": 0,
         "white": 0, "posed": 0}, "shard": 250, "label": "..."}
"""
import json, os, time
from concurrent.futures import ProcessPoolExecutor, as_completed
import numpy as np
from . import lab
from .config import digest
from .paths import DATA

GEN_VERSION = 1   # bump when render/style/scenes change in a way that changes the pixels
SHADE = np.array([255, 170, 85, 0], np.uint8)
SHARE_VARS = {"room": "ROOM_SHARE", "furniture": "FURNITURE_SHARE", "white": "WHITE_SHARE", "posed": "POSED_SHARE",
              "styleRand": "STYLE_RAND", "topLit": "TOP_LIT", "chairBack": "CHAIR_BACK", "topPlain": "TOP_PLAIN"}


def recipe_id(r):
    core = {k: r.get(k) for k in ("view", "seed", "n", "shares", "shard")}
    core["gen"] = GEN_VERSION
    return f"{r['view']}-{digest(core, 8)}"


def _sample(seed, view):
    from .synth.render import render_buffers
    from .synth.style import stylise, light_dir
    from .synth.scenes import map_scene, creature_scene, random_style
    W = H = 64; ss = 2
    rng = np.random.default_rng(seed)
    if view == "map": sc, org = map_scene(rng, W, H)
    else: sc, org = creature_scene(rng); W = H = 56
    st = random_style(rng, view)
    buf = render_buffers(sc, view, W, H, ss, org)
    L = light_dir(st.pop("az"), st.pop("el"))
    img, N, ids, _ = stylise(sc, buf, ss, L, **st)
    z = None
    if view != "map":   # pictures also record how far forward each pixel is (world z, towards the viewer)
        hit = buf["hit"].reshape(H, ss, W, ss); zz = np.where(buf["hit"], buf["P"][..., 2], 0).reshape(H, ss, W, ss)
        z = zz.sum((1, 3)) / np.maximum(hit.sum((1, 3)), 1)
    return img, N, ids, z


def _shard(view, shares, start, n, out):
    from .synth import scenes
    for k, v in shares.items(): setattr(scenes, SHARE_VARS[k], float(v))
    imgs, nrms, masks, zs = [], [], [], []
    t0 = time.time()
    for s in range(start, start + n):
        img, N, ids, z = _sample(s, view)
        imgs.append(img); nrms.append(np.round(N * 127).astype(np.int8))
        masks.append((ids >= 0).astype(np.uint8) + (ids == -2) * 2)
        if z is not None: zs.append(z.astype(np.float16))
    tmp = out + ".part.npz"
    np.savez_compressed(tmp, img=np.stack(imgs), nrm=np.stack(nrms), mask=np.stack(masks).astype(np.uint8),
                        **({"z": np.stack(zs)} if zs else {}))
    os.replace(tmp, out)
    return out, (time.time() - t0) / n


def shard_paths(r):
    d = DATA / recipe_id(r); size = r.get("shard", 250)
    return [(r["seed"] + i, min(size, r["n"] - i), str(d / f"shard_{i // size:04d}.npz")) for i in range(0, r["n"], size)]


def view_name(view):
    return "map" if view == "map" else "pic"


def ensure(r, workers=8, on_progress=None):
    """Generate any missing shards of a recipe; returns the dataset id."""
    did = recipe_id(r); d = DATA / did; d.mkdir(parents=True, exist_ok=True)
    jobs = shard_paths(r)
    todo = [j for j in jobs if not os.path.exists(j[2])]
    header = lab.read_json(f"datasets/{did}/dataset.json") or dict(
        schema=lab.SCHEMA, id=did, title=r.get("label") or did, kind="synthetic", view=view_name(r["view"]),
        created=lab.now(), config=dict(recipe=r, genVersion=GEN_VERSION), counts=counts(r), changes=r.get("changes", []))
    def publish(status, done):
        header.update(status=status, updated=lab.now(), progress=dict(done=done, total=r["n"], unit="scenes"))
        lab.write_json(f"datasets/{did}/dataset.json", header)
        lab.update_index(dataset_header=header)
        if on_progress: on_progress(did, done, r["n"])
    done = sum(n for _, n, p in jobs if os.path.exists(p))
    if todo:
        publish("running", done)
        lab.event("status", f"Generating {r['n'] - done:,} {r['view']} scenes: {header['title']}")
        shares = r.get("shares", {})
        t0 = time.time()
        with ProcessPoolExecutor(workers) as ex:
            futs = {ex.submit(_shard, r["view"], shares, s, n, p): n for s, n, p in todo}
            for f in as_completed(futs):
                f.result(); done += futs[f]
                header["config"]["secsPerScenePerCore"] = round((time.time() - t0) * workers / max(1, done - (r["n"] - sum(futs.values()))), 3)
                publish("running", done)
    if header.get("status") != "done" or "stats" not in header:
        header["stats"] = stats(did, r)
        samples(did, r)
        header["samples"] = ["samples.json"]
        publish("done", r["n"])
    return did


def counts(r):
    """Expected scene mix from the recipe's shares (the generator draws each scene's type at random)."""
    s = r.get("shares", {}); n = r["n"]
    if r["view"] == "map":
        room = s.get("room", 0)
        return {"outdoor scenes": round(n * (1 - room)), "rooms": round(n * room * (1 - s.get("furniture", 0))),
                "furniture rooms": round(n * room * s.get("furniture", 0))}
    posed = s.get("posed", 0)
    return {"creatures": round(n * (1 - posed)), "posed creatures": round(n * posed)}


def stats(did, r):
    """Shade histogram and pixel shares (object/ground/background, and faces for maps)."""
    x = np.load(shard_paths(r)[0][2])
    img, mask = x["img"], x["mask"]
    out = dict(shadeHist=(np.bincount(img.ravel(), minlength=4) / img.size).round(4).tolist(),
               maskShare={"background": float((mask == 0).mean()), "object": float((mask == 1).mean()), "ground": float((mask == 2).mean())})
    if r["view"] == "map":
        from .tasks import FACES
        n = x["nrm"].astype(np.float32).reshape(-1, 3) / 127
        k = (n @ FACES.T).argmax(-1)[(mask.ravel() == 1)]
        out["objectFaceShare"] = (np.bincount(k, minlength=5) / max(1, len(k))).round(4).tolist()
    return out


def samples(did, r, k=24):
    """Sample browser: input, true normals, true faces (maps), mask and depth (pictures) for the
    first k scenes, with a manifest in the contract's sample-set shape."""
    from .tasks import FACES
    x = np.load(shard_paths(r)[0][2])
    H, W = x["img"].shape[1:]
    layers = {"input": dict(label="Scene", encoding="shades"),
              "normals": dict(label="True normals", encoding="normals", truth=True),
              "mask": dict(label="Object / ground / background", encoding="mask", truth=True)}
    if r["view"] == "map": layers["faces"] = dict(label="True faces (nearest brush)", encoding="faces", truth=True)
    if "z" in x.files: layers["depth"] = dict(label="True depth", encoding="depth", truth=True)
    items = []
    for i in range(min(k, len(x["img"]))):
        f = {}; base = f"samples/{i:03d}"
        def put(name, ext, fn):
            f[name] = f"{base}-{name}.{ext}"; fn(f"datasets/{did}/{f[name]}")
        n = x["nrm"][i].astype(np.float32) / 127; m = x["mask"][i]
        put("input", "png", lambda p: lab.write_png(p, SHADE[x["img"][i]]))
        put("normals", "png", lambda p: lab.write_png(p, np.concatenate([((n * 0.5 + 0.5) * 255).round().astype(np.uint8), ((m > 0) * 255).astype(np.uint8)[..., None]], -1)))
        put("mask", "png", lambda p: lab.write_png(p, m.astype(np.uint8)))
        if "faces" in layers:
            fc = np.where(m == 1, (n @ FACES.T).argmax(-1), np.where(m == 2, 0, 255)).astype(np.uint8)
            put("faces", "png", lambda p: lab.write_png(p, fc))
        if "depth" in layers:
            put("depth", "f32", lambda p: lab.write_f32(p, np.where(m > 0, x["z"][i].astype(np.float32), np.nan)))
        items.append(dict(id=f"synth:{did}:{i}", title=f"seed {r['seed'] + i}", width=int(W), height=int(H), files=f))
    lab.write_json(f"datasets/{did}/samples.json", dict(schema=lab.SCHEMA, title=f"{r.get('label') or did}: first {len(items)} scenes",
                                                         view=view_name(r["view"]), layers=layers, items=items))


def load(recipes):
    """Concatenate the shards of several recipes: img (N,H,W) uint8, nrm (N,H,W,3) float32, mask, z|None."""
    imgs, nrms, masks, zs = [], [], [], []
    for r in recipes:
        for _, _, p in shard_paths(r):
            x = np.load(p)
            imgs.append(x["img"]); nrms.append(x["nrm"]); masks.append(x["mask"])
            if "z" in x.files: zs.append(x["z"])
    z = np.concatenate(zs).astype(np.float32) if zs and len(zs) == len(imgs) else None
    return np.concatenate(imgs), np.concatenate(nrms).astype(np.float32) / 127, np.concatenate(masks), z
