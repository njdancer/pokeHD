"""Five-face model (the relief plan's brushes: top, front, slope, hip ◀, hip ▶) per pixel.

Learns from synthetic scenes (true normal → nearest brush) mixed with real maps labelled by the
plan's rule (labels.ts seedNormal: ground/table/counter top, roof/stairs slope, the rest front).
The 22 scoring maps (eval_real.DEFAULT_MAPS) are held out of the real-map training.
Usage: train_faces.py epochs out.pt [--width 40] [--real-share 0.5] [--name ...] [--note ...]
"""
import argparse, time, numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from train import UNet, onehot, pad8, load, synth_panel
from romdata import D, map_img
from eval_real import DEFAULT_MAPS
from render3d import FACES, GROUND

FT = torch.as_tensor(FACES, dtype=torch.float32)
ORGANIC = {"tree", "rock", "plant", "cliff", "ledge"}
import os as _os
# Objects whose tiles mix top and front inside one tile: the rule can't split them, so let synthetic scenes teach them.
OBJECT_WEIGHT = float(_os.environ.get("OBJECT_RULE_WEIGHT", "1"))
OBJECTS = {"table", "counter", "shelf", "machine", "furniture", "statue", "sign"}
SKIP = {None, "unused", "void", "lettering", "cave"}


def rule(label):
    """(face, weight) for a tile label, as normals.ts seedNormal does."""
    if label in SKIP: return 0, 0.0
    if label in ("table", "counter"): return 0, OBJECT_WEIGHT
    if label in GROUND: return 0, 1.0
    if label in ("roof", "stairs"): return 2, 1.0
    return 1, 0.5 if label in ORGANIC else OBJECT_WEIGHT if label in OBJECTS else 1.0


class Faces(nn.Module):
    """UNet with five logits; forward returns the expected normal so predict/evaluate/render work unchanged."""
    def __init__(self, c=40):
        super().__init__()
        self.net = UNet(c); self.net.out = nn.Conv2d(c, 5, 1); self.width = c

    def logits(self, x):
        n = self.net
        e1 = n.e1(x); e2 = n.e2(F.max_pool2d(e1, 2)); e3 = n.e3(F.max_pool2d(e2, 2))
        m = n.mid(F.max_pool2d(e3, 2))
        up = lambda t, s: F.interpolate(t, size=s.shape[-2:], mode="nearest")
        d3 = n.d3(torch.cat([up(m, e3), e3], 1)); d2 = n.d2(torch.cat([up(d3, e2), e2], 1)); d1 = n.d1(torch.cat([up(d2, e1), e1], 1))
        return n.out(d1)

    def forward(self, x):
        p = self.logits(x).softmax(1)
        return F.normalize(torch.einsum("bkhw,kc->bchw", p, FT), dim=1)


def real_crops(size=64, stride=32):
    names = [m["name"] for m in D["maps"] if m["name"] not in DEFAULT_MAPS]
    X, Y, W = [], [], []
    for n in names:
        try: img, labs, _ = map_img(n)
        except StopIteration: continue
        f = np.zeros(labs.shape, np.int64); w = np.zeros(labs.shape, np.float32)
        for (i, j), l in np.ndenumerate(labs): f[i, j], w[i, j] = rule(l)
        f = np.kron(f, np.ones((8, 8), np.int64)); w = np.kron(w, np.ones((8, 8), np.float32))
        H, Wd = img.shape
        if H < size or Wd < size: continue
        for y in range(0, H - size + 1, stride):
            for x in range(0, Wd - size + 1, stride):
                if w[y:y + size, x:x + size].mean() < 0.3: continue
                X.append(img[y:y + size, x:x + size]); Y.append(f[y:y + size, x:x + size]); W.append(w[y:y + size, x:x + size])
    return np.stack(X), np.stack(Y), np.stack(W), len(names)


if __name__ == "__main__":
    from runlog import Run, describe_model
    ap = argparse.ArgumentParser()
    ap.add_argument("epochs", type=int); ap.add_argument("out")
    ap.add_argument("--width", type=int, default=40); ap.add_argument("--real-share", type=float, default=0.5)
    ap.add_argument("--name", default=""); ap.add_argument("--note", default="")
    a = ap.parse_args()
    torch.manual_seed(0); np.random.seed(0)
    imgs, nrms, masks = load("map")
    n = len(imgs); nv = max(100, n // 20)
    Xs = onehot(imgs)
    Ys = torch.as_tensor((nrms.reshape(-1, 3) @ FACES.T).argmax(-1).reshape(nrms.shape[:3]))
    Ws = torch.as_tensor(np.where(masks == 1, 4.0, np.where(masks == 2, 1.0, 0.0)), dtype=torch.float32)
    ri, rf, rw, nmaps = real_crops()
    Xr, Yr, Wr = onehot(ri), torch.as_tensor(rf), torch.as_tensor(rw)
    model = Faces(a.width)
    crop, bs, lr = 48, 32, 2e-3
    nr = int(bs * a.real_share)
    run = Run("train", a.name or f"faces-unet{a.width}", note=a.note, config=dict(
        view="map", output="five faces (top, front, slope, hip L, hip R)", epochs=a.epochs, samples=n, val_samples=nv,
        real_crops=len(ri), real_maps=nmaps, real_share=a.real_share, width=a.width, crop=crop, batch=bs, lr=lr,
        optimiser="AdamW + one-cycle", loss="cross-entropy; synthetic objects ×4, real tiles by label rule (organic ×0.5)", checkpoint=a.out))
    run.set(arch=describe_model(model.net, (4, crop, crop)))
    opt = torch.optim.AdamW(model.parameters(), lr, weight_decay=1e-4)
    per = (n - nv) // (bs - nr)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, lr, total_steps=a.epochs * per)
    step = 0
    try:
        for ep in range(a.epochs):
            model.train(); perm = torch.randperm(n - nv) + nv; t0 = time.time(); tot = 0; win = 0
            for i in range(per):
                b = perm[i * (bs - nr):(i + 1) * (bs - nr)]; br = torch.randint(0, len(ri), (nr,))
                y0, x0 = np.random.randint(0, 64 - crop + 1, 2)
                x = torch.cat([Xs[b], Xr[br]])[:, :, y0:y0 + crop, x0:x0 + crop]
                y = torch.cat([Ys[b], Yr[br]])[:, y0:y0 + crop, x0:x0 + crop]
                w = torch.cat([Ws[b], Wr[br]])[:, y0:y0 + crop, x0:x0 + crop]
                loss = (F.cross_entropy(model.logits(x), y, reduction="none") * w).sum() / w.sum()
                opt.zero_grad(); loss.backward(); opt.step(); sched.step(); tot += loss.item(); win += loss.item(); step += 1
                if step % 25 == 0:
                    run.log(step=step, epoch=ep + i / per, train_loss=win / 25, lr=sched.get_last_lr()[0]); win = 0
            model.eval()
            with torch.no_grad():
                k = model.logits(pad8(Xs[:nv])[0])[..., :64, :64].argmax(1)
                om = torch.as_tensor(masks[:nv] == 1)
                acc_obj = (k == Ys[:nv])[om].float().mean().item()
                p = FT[k].permute(0, 3, 1, 2); Yn = F.normalize(torch.as_tensor(nrms[:nv]).permute(0, 3, 1, 2), dim=1)
                ang = torch.rad2deg(torch.acos((p * Yn).sum(1).clamp(-1, 1)))
                val, val_obj = ang[torch.as_tensor(masks[:nv] > 0)].mean().item(), ang[om].mean().item()
            run.log(step=step, epoch=ep + 1, epoch_loss=tot / per, val_angle=val, val_angle_objects=val_obj, val_face_acc_objects=acc_obj, secs=time.time() - t0)
            print(f"epoch {ep} loss {tot / per:.4f} val {val:.1f}° objects {val_obj:.1f}° faces {acc_obj:.2f} ({time.time() - t0:.0f}s)", flush=True)
            torch.save(model.state_dict(), a.out)
        run.image("val-synthetic.png", synth_panel(model, imgs[:nv], nrms[:nv]), "Held-out synthetic scenes: sprite, prediction, truth")
        from render3d import attach
        attach(run, model, "map")
        from eval_real import evaluate
        from viz import panel
        r = evaluate(model)
        run.result(real_maps=r, val_angle=val, val_angle_objects=val_obj)
        run.image("real-pallet.png", panel(model, "PALLET_TOWN", (32, 160, 32, 288)), "Pallet Town: map, prediction, label-implied normals")
        run.image("real-lab.png", panel(model, "OAKS_LAB"), "Oak's Lab: map, prediction, label-implied normals")
        print("real maps", r["model"], "oracle", r["shade_oracle"], flush=True)
        run.done(val_angle=val, val_angle_objects=val_obj)
    except BaseException as e:
        run.done("failed", error=repr(e)); raise
