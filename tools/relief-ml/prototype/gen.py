import os, numpy as np, sys, time
from render import render_buffers
from style import stylise, light_dir
from scenes import map_scene, creature_scene, random_style

def sample(seed, view, W=64, H=64, ss=2):
    rng = np.random.default_rng(seed)
    if view == "map": sc, org = map_scene(rng, W, H)
    else: sc, org = creature_scene(rng); W = H = 56
    st = random_style(rng, view)
    buf = render_buffers(sc, view, W, H, ss, org)
    L = light_dir(st.pop("az"), st.pop("el"))
    img, N, ids, I = stylise(sc, buf, ss, L, **st)
    if view != "map":  # pictures also record how far forward each pixel is (world z, towards the viewer)
        hit = buf["hit"].reshape(H, ss, W, ss); z = np.where(buf["hit"], buf["P"][..., 2], 0).reshape(H, ss, W, ss)
        sample.z = z.sum((1, 3)) / np.maximum(hit.sum((1, 3)), 1)
    return img, N, ids

if __name__ == "__main__":
    view, start, n, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    imgs, nrms, masks, zs = [], [], [], []
    t0 = time.time()
    for i in range(start, start + n):
        img, N, ids = sample(i, view)
        if view != "map": zs.append(sample.z.astype(np.float16))
        imgs.append(img); nrms.append(np.round(N * 127).astype(np.int8)); masks.append((ids >= 0).astype(np.uint8) + (ids == -2) * 2)
    tmp = out + ".part.npz"; np.savez_compressed(tmp, img=np.stack(imgs), nrm=np.stack(nrms), mask=np.stack(masks), **({"z": np.stack(zs)} if zs else {})); os.replace(tmp, out)
    print(out, n, f"{(time.time()-t0)/n:.2f}s each")
    import os
    if os.environ.get("RELIEF_RUN"):
        from runlog import Run
        objs = np.stack(masks) == 1
        Run.attach(os.environ["RELIEF_RUN"]).log(shard=os.path.basename(out), view=view, samples=n, secs_each=(time.time() - t0) / n,
                                                 object_fraction=float(objs.mean()),
                                                 shade_hist=np.bincount(np.stack(imgs).ravel(), minlength=4) / np.stack(imgs).size)
