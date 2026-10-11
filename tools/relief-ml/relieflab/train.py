"""The trainer: one loop for every task, on the Apple GPU (MPS) when present.

- faces:   five-face classifier for maps (cross-entropy), optionally mixed with real maps labelled
           by the plan rule (`real.share`), the 22 eval maps held out.
- normals: per-pixel normal for maps (1 - cos).
- picture: normals + optional occupancy and depth for front pictures.

Checkpoints every epoch (model, optimiser, scheduler, RNG) to RELIEF_HOME/ckpt/<run>/last.pt, so a
killed run resumes from its last finished epoch. Publishes curves to metrics.jsonl as it goes and a
"watch" set of real predictions after each epoch, so the dashboard shows learning live.
"""
import math, os, time
import numpy as np, torch, torch.nn.functional as F
from . import datasets, lab, tasks
from .paths import CKPT

EVAL_MAPS = ["PALLET_TOWN", "VIRIDIAN_CITY", "PEWTER_CITY", "CERULEAN_CITY", "VERMILION_CITY", "CELADON_CITY",
             "LAVENDER_TOWN", "FUCHSIA_CITY", "SAFFRON_CITY", "CINNABAR_ISLAND", "ROUTE_1", "ROUTE_2",
             "REDS_HOUSE_1F", "REDS_HOUSE_2F", "OAKS_LAB", "VIRIDIAN_POKECENTER", "VIRIDIAN_MART",
             "BLUES_HOUSE", "MUSEUM_1F", "PEWTER_GYM", "CELADON_MANSION_1F", "VIRIDIAN_SCHOOL_HOUSE"]


def real_crops(object_weight, size=64, stride=32):
    """Real map crops labelled by the plan rule (training maps only; the eval maps are held out)."""
    X, Y, W = [], [], []
    for name in tasks.map_names():
        if name in EVAL_MAPS: continue
        img, labs = tasks.map_img(name)
        f = np.zeros(labs.shape, np.int64); w = np.zeros(labs.shape, np.float32)
        for (i, j), l in np.ndenumerate(labs): f[i, j], w[i, j] = tasks.rule(l, object_weight)
        f = np.kron(f, np.ones((8, 8), np.int64)); w = np.kron(w, np.ones((8, 8), np.float32))
        H, Wd = img.shape
        if H < size or Wd < size: continue
        for y in range(0, H - size + 1, stride):
            for x in range(0, Wd - size + 1, stride):
                if w[y:y + size, x:x + size].mean() < 0.3: continue
                X.append(img[y:y + size, x:x + size]); Y.append(f[y:y + size, x:x + size]); W.append(w[y:y + size, x:x + size])
    return np.stack(X), np.stack(Y), np.stack(W)


def depth_loss(pred, true, m):
    """L1 on object pixels after removing each image's mean depth (absolute placement is arbitrary)."""
    n = m.sum((1, 2)).clamp(min=1)
    c = lambda d: d - ((d * m).sum((1, 2)) / n)[:, None, None]
    return ((c(pred) - c(true)).abs() * m).sum() / n.sum()


METRIC_DEFS = {
    "loss": dict(label="Training loss", better="lower", group="loss", help="How wrong the model is on the batches it learns from. Should fall steadily."),
    "epoch_loss": dict(label="Epoch loss", better="lower", group="loss", help="Training loss averaged over a whole pass through the data."),
    "lr": dict(label="Learning rate", group="schedule", help="How big each learning step is. Warms up, then decays (one-cycle)."),
    "scenes_per_s": dict(label="Throughput", unit="scenes/s", group="speed", help="Training speed on the GPU."),
    "val_angle": dict(label="Synthetic val angle", unit="°", better="lower", group="synthetic", help="Average angle between predicted and true surface direction on held-out made-up scenes."),
    "val_angle_obj": dict(label="Synthetic val angle (objects)", unit="°", better="lower", group="synthetic", help="Same, on object pixels only (not ground or background)."),
    "val_face_acc": dict(unit="%", label="Synthetic face accuracy (objects)", better="higher", group="synthetic", help="Share of object pixels in held-out made-up scenes given the right face."),
    "val_depth_err": dict(label="Synthetic depth error", unit="px", better="lower", group="synthetic", help="Average depth mistake in pixels after lining up each picture's mean depth."),
    "val_inside_acc": dict(unit="%", label="Silhouette accuracy", better="higher", group="synthetic", help="Share of pixels correctly called object or background."),
    "test_acc": dict(unit="%", label="Hand-made test set", better="higher", group="real", primary=True, help="Share of pixels on 13 hand-boxed real objects whose top/front face is right."),
    "test_obj_mean": dict(unit="%", label="Test set, mean per object", better="higher", group="real", help="Average of each object's score, so small objects count as much as big ones."),
    "test_obj_mean_lo": dict(unit="%", label="Test set, low end of 95% range", better="higher", group="real", help="With only 13 objects the score is uncertain; the true value is very likely above this."),
    "test_obj_mean_hi": dict(unit="%", label="Test set, high end of 95% range", better="higher", group="real", help="…and very likely below this."),
    "real_balanced": dict(unit="%", label="Real maps vs labels (balanced)", better="higher", group="real", help="Agreement with the tile-label rule on 22 real maps, averaged over top/front/slope. Circular if rule labels were trained on."),
}


class Trainer:
    def __init__(self, cfg, run):
        self.cfg, self.run = cfg, run
        self.dev = tasks.device()
        self.dir = CKPT / run.id; self.dir.mkdir(parents=True, exist_ok=True)
        t = cfg["train"]
        torch.manual_seed(t["seed"]); np.random.seed(t["seed"])
        img, nrm, mask, z = datasets.load(cfg["datasets"])
        n = len(img); nv = max(100, int(n * t["valFraction"]))
        # Fixed split: the first nv scenes of a seeded permutation are validation.
        perm = np.random.default_rng(1234).permutation(n)
        vi, ti = perm[:nv], perm[nv:]
        d = self.dev
        self.X = torch.as_tensor(img, device=d)                    # uint8 shades
        self.N = torch.as_tensor(nrm, device=d).permute(0, 3, 1, 2)  # float normals
        self.N = F.normalize(self.N, dim=1)
        self.M = torch.as_tensor(mask, device=d)
        self.Z = torch.as_tensor(z, device=d) if z is not None else None
        self.vi, self.ti = torch.as_tensor(vi, device=d), torch.as_tensor(ti, device=d)
        ow = t["objectWeight"]
        self.Wt = torch.where(self.M == 1, ow, torch.where(self.M == 2, 1.0, 0.0)).float()
        if cfg["task"] == "faces":
            FT = tasks.FT.to(d)
            self.Y = torch.einsum("bchw,kc->bkhw", self.N, FT).argmax(1)
            share = cfg["real"]["share"]
            if share > 0:
                rx, ry, rw = real_crops(cfg["real"]["objectRuleWeight"])
                self.RX, self.RY, self.RW = (torch.as_tensor(a, device=d) for a in (rx, ry, rw))
            self.nreal = int(t["batch"] * share) if share > 0 else 0
        else:
            self.nreal = 0
        self.model = tasks.build(cfg).to(d)
        self.opt = torch.optim.AdamW(self.model.parameters(), t["lr"], weight_decay=t["weightDecay"])
        self.per = len(ti) // (t["batch"] - self.nreal)
        self.sched = torch.optim.lr_scheduler.OneCycleLR(self.opt, t["lr"], total_steps=t["epochs"] * self.per)
        self.epoch = 0; self.step = 0; self.best = None
        info = dict(samples=n, valSamples=nv, realCrops=int(len(self.RX)) if self.nreal else 0, device=str(d))
        run.set(arch=tasks.describe(self.model, (4, t["crop"], t["crop"])), metrics=METRIC_DEFS,
                classes=["TOP", "FRONT", "SLOPE", "HIP◀", "HIP▶"] if cfg["task"] == "faces" else None, data=info)
        self._resume()

    # ---------- checkpoints ----------
    def _resume(self):
        p = self.dir / "last.pt"
        if not p.exists(): return
        s = torch.load(p, map_location=self.dev, weights_only=False)
        self.model.load_state_dict(s["model"]); self.opt.load_state_dict(s["opt"]); self.sched.load_state_dict(s["sched"])
        self.epoch, self.step = s["epoch"], s["step"]
        torch.set_rng_state(s["rng"]); np.random.set_state(s["nprng"])
        lab.event("status", f"Resumed {self.run.id} at epoch {self.epoch}", runs=[self.run.id])

    def _save(self):
        s = dict(model=self.model.state_dict(), opt=self.opt.state_dict(), sched=self.sched.state_dict(),
                 epoch=self.epoch, step=self.step, rng=torch.get_rng_state(), nprng=np.random.get_state(), cfg=self.cfg)
        tmp = self.dir / "last.pt.tmp"; torch.save(s, tmp); os.replace(tmp, self.dir / "last.pt")
        torch.save(dict(model=self.model.state_dict(), cfg=self.cfg), self.dir / "model.pt")

    # ---------- loss ----------
    def _batch(self, idx, y0, x0, c):
        sl = (slice(None), slice(y0, y0 + c), slice(x0, x0 + c))
        x = tasks.onehot(self.X[idx][sl])
        return x, sl

    def _loss(self, idx):
        t, cfg = self.cfg["train"], self.cfg
        c = t["crop"]; H, W = self.X.shape[-2:]
        y0, x0 = np.random.randint(0, H - c + 1), np.random.randint(0, W - c + 1)
        x, sl = self._batch(idx, y0, x0, c)
        w = self.Wt[idx][sl]
        if cfg["task"] == "faces":
            y = self.Y[idx][sl]
            if self.nreal:
                br = torch.randint(0, len(self.RX), (self.nreal,), device=self.dev)
                x = torch.cat([x, tasks.onehot(self.RX[br][sl])]); y = torch.cat([y, self.RY[br][sl]]); w = torch.cat([w, self.RW[br][sl]])
            o = self.model(x)
            return (F.cross_entropy(o, y, reduction="none") * w).sum() / w.sum().clamp(min=1)
        h = tasks.split(cfg, self.model(x))
        y = self.N[idx][(slice(None), slice(None)) + sl[1:]]
        loss = ((1 - (h["normal"] * y).sum(1)) * w).sum() / w.sum().clamp(min=1)
        occ = (self.M[idx][sl] > 0).float()
        if "occ" in h: loss = loss + 0.5 * F.binary_cross_entropy_with_logits(h["occ"], occ)
        if "depth" in h: loss = loss + 0.1 * depth_loss(h["depth"], self.Z[idx][sl], occ)
        return loss

    # ---------- validation ----------
    @torch.no_grad()
    def validate(self):
        self.model.eval(); cfg = self.cfg
        out, conf = {}, None
        angs, angs_o, facc, dz, ins = [], [], [], [], []
        K = np.zeros((5, 5), np.int64)
        for i in range(0, len(self.vi), 128):
            idx = self.vi[i:i + 128]
            x = tasks.onehot(self.X[idx]); h = tasks.split(cfg, self.model(x))
            y = self.N[idx]; m = self.M[idx]
            ang = torch.rad2deg(torch.acos((h["normal"] * y).sum(1).clamp(-1, 1)))
            angs.append(ang[m > 0]); angs_o.append(ang[m == 1])
            if cfg["task"] == "faces":
                k = h["logits"].argmax(1); yt = self.Y[idx]
                kk = (yt[m == 1] * 5 + k[m == 1]).cpu().numpy()
                K += np.bincount(kk, minlength=25).reshape(5, 5)
            if "depth" in h: dz.append(depth_loss(h["depth"], self.Z[idx], (m > 0).float()).item())
            if "occ" in h: ins.append(((h["occ"] > 0) == (m > 0)).float().mean().item())
        out["val_angle"] = torch.cat(angs).mean().item(); out["val_angle_obj"] = torch.cat(angs_o).mean().item()
        if cfg["task"] == "faces":
            out["val_face_acc"] = float(np.trace(K) / max(1, K.sum()))
            for j, nm in enumerate(tasks.FACE_NAMES):
                if K[j].sum(): out[f"acc/{['TOP', 'FRONT', 'SLOPE', 'HIP◀', 'HIP▶'][j]}"] = float(K[j, j] / K[j].sum())
            conf = K
        if dz: out["val_depth_err"] = float(np.mean(dz))
        if ins: out["val_inside_acc"] = float(np.mean(ins))
        self.model.train()
        return out, conf

    # ---------- loop ----------
    def fit(self, on_epoch=None):
        t = self.cfg["train"]; run = self.run
        bs = t["batch"] - self.nreal
        while self.epoch < t["epochs"]:
            self.model.train(); t0 = time.time(); tot = 0.0; win = 0.0; wn = 0
            perm = self.ti[torch.randperm(len(self.ti), device=self.dev)]
            for i in range(self.per):
                loss = self._loss(perm[i * bs:(i + 1) * bs])
                self.opt.zero_grad(set_to_none=True); loss.backward(); self.opt.step(); self.sched.step()
                self.step += 1; li = loss.item(); tot += li; win += li; wn += 1
                if self.step % t["logEvery"] == 0:
                    el = time.time() - t0
                    run.metric(self.step, "train", dict(loss=win / wn, lr=self.sched.get_last_lr()[0],
                                                        scenes_per_s=(i + 1) * t["batch"] / el), epoch=self.epoch + (i + 1) / self.per)
                    win = 0.0; wn = 0
                    left = (t["epochs"] - self.epoch - (i + 1) / self.per) * el / ((i + 1) / self.per)
                    run.progress("train", round(self.epoch + (i + 1) / self.per, 2), t["epochs"], "epoch",
                                 eta=lab.iso_in(left))
            self.epoch += 1
            v, conf = self.validate()
            v["epoch_loss"] = tot / self.per; v["epoch_secs"] = time.time() - t0
            run.metric(self.step, "val", v, epoch=self.epoch)
            run.summary(**{k: round(x, 4) for k, x in v.items() if "/" not in k})
            if conf is not None:
                run.eval("synthetic-val", dict(title="Held-out synthetic scenes", split="synthetic-val", circular=False,
                                               overall={"acc": v["val_face_acc"], "angle": v["val_angle"]},
                                               perClass={"acc": {k.split("/")[1]: x for k, x in v.items() if k.startswith("acc/")}},
                                               confusion=dict(labels=["TOP", "FRONT", "SLOPE", "HIP◀", "HIP▶"], matrix=conf.tolist()),
                                               epoch=self.epoch))
            self._save()
            print(f"epoch {self.epoch}/{t['epochs']} " + " ".join(f"{k}={x:.4g}" for k, x in v.items() if "/" not in k), flush=True)
            if on_epoch: on_epoch(self)
        return self.model
