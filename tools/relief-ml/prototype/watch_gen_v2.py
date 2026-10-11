import glob, os, time, numpy as np
from runlog import Run
RID = "20261010-134000-generate-map-scenes-v2"
r = Run.attach(RID)
seen = set(l.split('"shard": "')[1].split('"')[0] for l in open(os.path.join(r.dir, "metrics.jsonl")) if '"shard"' in l)
while True:
    fs = sorted(glob.glob("../data/shards/*.npz"))
    for f in fs:
        b = os.path.basename(f)
        if b in seen or time.time() - os.path.getmtime(f) < 5: continue
        d = np.load(f); im = d["img"]
        r.log(shard=b, view=b.split("_")[0], samples=len(im), object_fraction=float((d["mask"] == 1).mean()),
              shade_hist=np.bincount(im.ravel(), minlength=4) / im.size)
        seen.add(b)
    if len(seen) >= 32:
        r = Run(None, None, run_id=RID); r.done(map_scenes=6000, front_pictures=2000); break
    time.sleep(20)
