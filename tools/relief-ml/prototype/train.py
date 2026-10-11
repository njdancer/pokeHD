"""Small U-Net: 4-shade sprite → per-pixel normal. Usage: train.py <view> <epochs> <out.pt>"""
import glob, sys, time
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F


def block(i, o):
    return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(inplace=True),
                         nn.Conv2d(o, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class UNet(nn.Module):
    def __init__(self, c=24, occ=False, depth=False):
        super().__init__()
        self.width, self.occ, self.depth, self.last_occ, self.last_z = c, occ, depth, None, None
        self.e1, self.e2, self.e3 = block(4, c), block(c, 2 * c), block(2 * c, 4 * c)
        self.mid = block(4 * c, 4 * c)
        self.d3, self.d2, self.d1 = block(8 * c, 2 * c), block(4 * c, c), block(2 * c, c)
        # Optional extra channels: is this pixel part of the object (occ); how far towards the viewer it is (depth).
        self.out = nn.Conv2d(c, 3 + occ + depth, 1)

    def forward(self, x):
        e1 = self.e1(x); e2 = self.e2(F.max_pool2d(e1, 2)); e3 = self.e3(F.max_pool2d(e2, 2))
        m = self.mid(F.max_pool2d(e3, 2))
        up = lambda t, s: F.interpolate(t, size=s.shape[-2:], mode="nearest")
        d3 = self.d3(torch.cat([up(m, e3), e3], 1))
        d2 = self.d2(torch.cat([up(d3, e2), e2], 1))
        d1 = self.d1(torch.cat([up(d2, e1), e1], 1))
        o = self.out(d1)
        self.last_occ = o[:, 3] if self.occ else None
        self.last_z = o[:, 3 + self.occ] if self.depth else None
        return F.normalize(o[:, :3], dim=1)


def load_model(path):
    """A saved UNet, with its width and occupancy channel read from the weights."""
    sd = torch.load(path); w = sd["out.weight"]
    occ, depth = {3: (False, False), 4: (True, False), 5: (True, True)}[w.shape[0]]
    m = UNet(w.shape[1], occ=occ, depth=depth); m.load_state_dict(sd); m.eval()
    return m


def predict_inside(model, img):
    """Object/background per pixel from the occupancy channel; None for models without one."""
    if not getattr(model, "occ", False): return None
    predict(model, img)
    H, W = img.shape
    return (model.last_occ[0, :H, :W] > 0).numpy()


def predict_depth(model, img):
    """How far towards the viewer each pixel is, in pixels (up to a shift); None without a depth channel."""
    if not getattr(model, "depth", False): return None
    predict(model, img)
    H, W = img.shape
    return model.last_z[0, :H, :W].numpy()


def onehot(img):
    t = torch.as_tensor(img, dtype=torch.long)
    return F.one_hot(t, 4).permute(0, 3, 1, 2).float()


def pad8(x):
    H, W = x.shape[-2:]
    return F.pad(x, (0, (-W) % 8, 0, (-H) % 8), value=0), (H, W)


def predict(model, img):
    """img: (H, W) uint8 0-3 → (H, W, 3) normals."""
    model.eval()
    with torch.no_grad():
        x, (H, W) = pad8(onehot(img[None]))
        if x.shape[-1] > img.shape[1]: x[:, 0, :, img.shape[1]:] = 1  # padding reads as white
        if x.shape[-2] > img.shape[0]: x[:, 0, img.shape[0]:, :] = 1
        return model(x)[0, :, :H, :W].permute(1, 2, 0).numpy()


def load(view, data="shards", with_z=False):
    fs = sorted(glob.glob(f"/tmp/claude-0/relief/data/{data}/{view}_*.npz"))
    d = [np.load(f) for f in fs]
    out = (np.concatenate([x["img"] for x in d]), np.concatenate([x["nrm"] for x in d]).astype(np.float32) / 127,
           np.concatenate([x["mask"] for x in d]))
    return out + (np.concatenate([x["z"] for x in d]).astype(np.float32),) if with_z else out


def depth_loss(pred, true, m):
    """L1 on object pixels after removing each image's mean depth (absolute placement is arbitrary)."""
    n = m.sum((1, 2)).clamp(min=1)
    c = lambda d: d - ((d * m).sum((1, 2)) / n)[:, None, None]
    return ((c(pred) - c(true)).abs() * m).sum() / n.sum()


def synth_panel(model, imgs, nrms, k=6):
    """Validation scenes: sprite | prediction | truth."""
    shade = np.array([255, 170, 85, 0], np.uint8)
    rows = []
    for j in range(k):
        p = predict(model, imgs[j]); rgb = lambda n: ((n * 0.5 + 0.5) * 255).astype(np.uint8)
        rows.append(np.concatenate([np.repeat(shade[imgs[j]][..., None], 3, -1), rgb(p), rgb(nrms[j])], 1))
    return np.kron(np.concatenate(rows, 0), np.ones((3, 3, 1), np.uint8))


if __name__ == "__main__":
    import argparse
    from runlog import Run, describe_model
    ap = argparse.ArgumentParser()
    ap.add_argument("view"); ap.add_argument("epochs", type=int); ap.add_argument("out")
    ap.add_argument("--name", default=""); ap.add_argument("--note", default=""); ap.add_argument("--width", type=int, default=24)
    ap.add_argument("--object-weight", type=float, default=4.0); ap.add_argument("--data", default="shards")
    ap.add_argument("--occ", action="store_true", help="also predict which pixels belong to the object (pictures)")
    ap.add_argument("--depth", action="store_true", help="also predict depth (pictures; needs data with z)")
    a = ap.parse_args()
    torch.manual_seed(0)
    if a.depth: imgs, nrms, masks, zs = load(a.view, a.data, with_z=True); Z = torch.as_tensor(zs)
    else: imgs, nrms, masks = load(a.view, a.data)
    n = len(imgs); nv = max(100, n // 20)
    X = onehot(imgs); Y = F.normalize(torch.as_tensor(nrms).permute(0, 3, 1, 2), dim=1)
    Wt = torch.as_tensor(np.where(masks == 1, a.object_weight, np.where(masks == 2, 1.0, 0.0)), dtype=torch.float32)  # background (pictures) not scored
    model = UNet(a.width, occ=a.occ, depth=a.depth)
    Occ = torch.as_tensor(masks > 0, dtype=torch.float32)
    crop, bs, lr = 48, 32, 2e-3
    run = Run("train", a.name or f"{a.view}-unet{a.width}", note=a.note, config=dict(
        view=a.view, epochs=a.epochs, samples=n, val_samples=nv, data=a.data, width=a.width, crop=crop, batch=bs,
        lr=lr, optimiser="AdamW + one-cycle", loss="1 - cos(angle), object pixels ×%g" % a.object_weight + (" + 0.5 × occupancy BCE" if a.occ else "") + (" + 0.1 × depth L1 (mean removed)" if a.depth else ""), checkpoint=a.out))
    run.set(arch=describe_model(model, (4, crop, crop)))
    opt = torch.optim.AdamW(model.parameters(), lr, weight_decay=1e-4)
    per = (n - nv) // bs
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, lr, total_steps=a.epochs * per)
    step = 0
    try:
        for ep in range(a.epochs):
            model.train(); perm = torch.randperm(n - nv) + nv; t0 = time.time(); tot = 0; win = 0
            for i in range(0, per * bs, bs):
                b = perm[i:i + bs]
                H, W = X.shape[-2:]
                y0, x0 = np.random.randint(0, H - crop + 1), np.random.randint(0, W - crop + 1)
                x = X[b, :, y0:y0 + crop, x0:x0 + crop]; y = Y[b, :, y0:y0 + crop, x0:x0 + crop]; w = Wt[b, y0:y0 + crop, x0:x0 + crop]
                loss = ((1 - (model(x) * y).sum(1)) * w).sum() / w.sum()
                if a.occ: loss = loss + 0.5 * F.binary_cross_entropy_with_logits(model.last_occ, Occ[b, y0:y0 + crop, x0:x0 + crop])
                if a.depth: loss = loss + 0.1 * depth_loss(model.last_z, Z[b, y0:y0 + crop, x0:x0 + crop], Occ[b, y0:y0 + crop, x0:x0 + crop])
                opt.zero_grad(); loss.backward(); opt.step(); sched.step(); tot += loss.item(); win += loss.item(); step += 1
                if step % 25 == 0:
                    run.log(step=step, epoch=ep + i / (per * bs), train_loss=win / 25, lr=sched.get_last_lr()[0]); win = 0
            model.eval()
            with torch.no_grad():
                p = model(pad8(X[:nv])[0])[..., :X.shape[-2], :X.shape[-1]]
                cos = (p * Y[:nv]).sum(1).clamp(-1, 1)
                ang = torch.rad2deg(torch.acos(cos)); om = torch.as_tensor(masks[:nv] == 1)
                val, val_obj = ang[torch.as_tensor(masks[:nv] > 0)].mean().item(), ang[om].mean().item()
                extra = {}
                if a.depth:
                    zm = torch.as_tensor(masks[:nv] > 0, dtype=torch.float32)
                    extra["val_depth_err_px"] = depth_loss(model.last_z[..., :X.shape[-2], :X.shape[-1]], Z[:nv], zm).item()
                if a.occ: extra["val_inside_acc"] = ((model.last_occ[..., :X.shape[-2], :X.shape[-1]] > 0) == torch.as_tensor(masks[:nv] > 0)).float().mean().item()
            run.log(step=step, epoch=ep + 1, epoch_loss=tot / per, val_angle=val, val_angle_objects=val_obj, secs=time.time() - t0, **extra)
            print(f"epoch {ep} loss {tot / per:.4f} val {val:.1f}° objects {val_obj:.1f}° ({time.time() - t0:.0f}s)", flush=True)
            torch.save(model.state_dict(), a.out)
        run.image("val-synthetic.png", synth_panel(model, imgs[:nv], nrms[:nv]), "Held-out synthetic scenes: sprite, prediction, truth")
        try:
            from render3d import attach
            attach(run, model, a.view)
        except Exception as e:
            print("3d renders failed", repr(e), flush=True)
        if a.view == "map":
            from eval_real import evaluate
            from viz import panel
            r = evaluate(model)
            run.result(real_maps=r, val_angle=val, val_angle_objects=val_obj)
            run.image("real-pallet.png", panel(model, "PALLET_TOWN", (32, 160, 32, 288)), "Pallet Town: map, prediction, label-implied normals")
            run.image("real-lab.png", panel(model, "OAKS_LAB"), "Oak's Lab: map, prediction, label-implied normals")
            run.image("real-viridian.png", panel(model, "VIRIDIAN_CITY", (64, 256, 128, 448)), "Viridian City: map, prediction, label-implied normals")
            print("real maps", r["model"], "oracle", r["shade_oracle"])
        run.done(val_angle=val, val_angle_objects=val_obj)
    except BaseException as e:
        run.done("failed", error=repr(e)); raise
