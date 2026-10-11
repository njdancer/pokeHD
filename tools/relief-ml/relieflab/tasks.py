"""Models, the five faces, ROM data access and prediction helpers (ported from the prototype)."""
import json
from functools import lru_cache
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from .paths import ROM_JSON

_r = np.sqrt(0.5)
# The relief plan's five brushes (normals.ts: TOP, FRONT, slope(45), hip(-1, 45), hip(1, 45)) and their paint colours
FACES = np.array([[0, 1, 0], [0, 0, 1], [0, _r, _r], [-_r, _r, 0], [_r, _r, 0]])
FACE_NAMES = ["top", "front", "slope", "hipL", "hipR"]
FACE_RGB = np.array([[0x3a, 0x9e, 0xe0], [0xe0, 0x8a, 0x1e], [0x8a, 0x5c, 0xc8], [0x28, 0xbe, 0xa0], [0xdc, 0x50, 0x8c]], np.uint8)
FT = torch.as_tensor(FACES, dtype=torch.float32)
SHADE = np.array([255, 170, 85, 0], np.uint8)   # colour number -> grey (0 = white)
GROUND = {"ground", "lawn", "tall-grass", "flower", "water", "shore", "bridge", "floor", "void", "unused"}  # normals.ts GROUND_LABELS


def device():
    return torch.device("mps" if torch.backends.mps.is_available() else "cpu")


# ---------- models ----------

def block(i, o):
    return nn.Sequential(nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(inplace=True),
                         nn.Conv2d(o, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class Dilated(nn.Module):
    """Bottleneck with parallel dilated 3x3 convs (rates 1, 2, 4, 8), each c/4 wide, concatenated:
    more context for the same weights as the plain bottleneck (ASPP-style)."""
    def __init__(self, c):
        super().__init__()
        self.inp = nn.Sequential(nn.Conv2d(c, c, 3, padding=1), nn.BatchNorm2d(c), nn.ReLU(inplace=True))
        self.branches = nn.ModuleList(nn.Conv2d(c, c // 4, 3, padding=r, dilation=r) for r in (1, 2, 4, 8))
        self.post = nn.Sequential(nn.BatchNorm2d(c // 4 * 4), nn.ReLU(inplace=True))

    def forward(self, x):
        x = self.inp(x)
        return self.post(torch.cat([b(x) for b in self.branches], 1))


class UNet(nn.Module):
    """3-level U-Net, widths c, 2c, 4c (the prototype's). `out` channels depend on the task.
    dilate=True swaps the bottleneck for dilated convs (research memo 1, section 3).
    extra: additional input channels (e.g. the clear-cut tile flag)."""
    def __init__(self, c=40, out=3, dilate=False, extra=0):
        super().__init__()
        self.e1, self.e2, self.e3 = block(4 + extra, c), block(c, 2 * c), block(2 * c, 4 * c)
        self.mid = Dilated(4 * c) if dilate else block(4 * c, 4 * c)
        self.d3, self.d2, self.d1 = block(8 * c, 2 * c), block(4 * c, c), block(2 * c, c)
        self.out = nn.Conv2d(c, out, 1)

    def forward(self, x):
        e1 = self.e1(x); e2 = self.e2(F.max_pool2d(e1, 2)); e3 = self.e3(F.max_pool2d(e2, 2))
        m = self.mid(F.max_pool2d(e3, 2))
        up = lambda t, s: F.interpolate(t, size=s.shape[-2:], mode="nearest")
        d3 = self.d3(torch.cat([up(m, e3), e3], 1))
        d2 = self.d2(torch.cat([up(d3, e2), e2], 1))
        d1 = self.d1(torch.cat([up(d2, e1), e1], 1))
        return self.out(d1)


def out_channels(cfg):
    m = cfg["model"]
    if cfg["task"] == "faces": return 5
    return 3 + bool(m.get("occ")) + bool(m.get("depth"))


def build(cfg):
    return UNet(cfg["model"]["width"], out_channels(cfg), dilate=cfg["model"].get("dilate", False),
                extra=1 if cfg["model"].get("tileFlag") else 0)


TRUSTED = {"ground", "lawn", "tall-grass", "flower", "water", "shore", "bridge", "floor", "roof", "wall", "wall-interior",
           "window", "door", "picture"}


def tile_flag(labs, trusted=TRUSTED):
    """Per-pixel 1 where the tile's label is clear-cut (the rule is right whole-tile), else 0."""
    t = np.vectorize(lambda l: 1.0 if l in trusted else 0.0)(labs).astype(np.float32)
    return np.kron(t, np.ones((8, 8), np.float32))


def split(cfg, o):
    """Raw output -> dict of named heads."""
    if cfg["task"] == "faces":
        return {"logits": o, "normal": F.normalize(torch.einsum("bkhw,kc->bchw", o.softmax(1), FT.to(o.device)), dim=1)}
    h = {"normal": F.normalize(o[:, :3], dim=1)}
    i = 3
    if cfg["model"].get("occ"): h["occ"] = o[:, i]; i += 1
    if cfg["model"].get("depth"): h["depth"] = o[:, i]
    return h


def onehot(img_u8):
    """(B,H,W) uint8 tensor -> (B,4,H,W) float."""
    return F.one_hot(img_u8.long(), 4).permute(0, 3, 1, 2).float()


@torch.no_grad()
def predict(model, cfg, img, labs=None):
    """img: (H,W) uint8 0-3 numpy -> dict of numpy heads at full resolution (padding reads as white).
    labs: the tile labels, for models that take the clear-cut tile flag as input."""
    model.eval(); dev = next(model.parameters()).device
    H, W = img.shape
    pad = np.zeros(((H + 7) // 8 * 8, (W + 7) // 8 * 8), np.uint8); pad[:H, :W] = img
    x = onehot(torch.as_tensor(pad[None], device=dev))
    if cfg["model"].get("tileFlag"):
        fl = np.zeros(pad.shape, np.float32)
        if labs is not None: f = tile_flag(labs); fl[:f.shape[0], :f.shape[1]] = f[:pad.shape[0], :pad.shape[1]]
        x = torch.cat([x, torch.as_tensor(fl, device=dev)[None, None]], 1)
    o = model(x)
    h = split(cfg, o)
    out = {"normal": h["normal"][0, :, :H, :W].permute(1, 2, 0).cpu().numpy()}
    if "logits" in h:
        p = h["logits"][0, :, :H, :W].softmax(0).cpu().numpy()
        out["faces"] = p.argmax(0).astype(np.uint8); out["faceProb"] = p
    if "occ" in h: out["occ"] = (h["occ"][0, :H, :W] > 0).cpu().numpy()
    if "depth" in h: out["depth"] = h["depth"][0, :H, :W].cpu().numpy()
    return out


def describe(model, input_shape=(4, 48, 48)):
    """Architecture summary for the dashboard: blocks with output shape and parameter counts, plus skips."""
    nodes, hooks = [], []
    for name, mod in model.named_children():
        def hook(m, i, o, name=name):
            nodes.append(dict(id=name, type=type(m).__name__, out=list(o.shape[1:]),
                              params=sum(p.numel() for p in m.parameters()),
                              layers=[type(l).__name__ for l in m.modules() if not list(l.children())]))
        hooks.append(mod.register_forward_hook(hook))
    was = model.training; model.eval(); dev = next(model.parameters()).device
    c_in = model.e1[0].in_channels if hasattr(model, "e1") else input_shape[0]
    with torch.no_grad(): model(torch.zeros(1, c_in, *input_shape[1:], device=dev))
    model.train(was)
    for h in hooks: h.remove()
    params = sum(p.numel() for p in model.parameters())
    return dict(input=list(input_shape), nodes=nodes, skips=[["e1", "d1"], ["e2", "d2"], ["e3", "d3"]],
                params=params, bytesFp16=2 * params)


# ---------- ROM data (private dump, see dump-rom.ts) ----------

@lru_cache(1)
def rom():
    return json.loads(ROM_JSON.read_text())


def _tiles(ts):
    return np.array(ts["tiles"], np.uint8).reshape(-1, 8, 8)


def map_img(name):
    """Real map: (img (H,W) 0-3, tile labels (H/8, W/8) object array)."""
    D = rom()
    m = next(m for m in D["maps"] if m["name"] == name)
    ts = D["tilesets"][m["tileset"]]; t = _tiles(ts)
    blk = lambda b: np.block([[t[ts["blocks"][b * 16 + r * 4 + c]] for c in range(4)] for r in range(4)])
    img = np.concatenate([np.concatenate([blk(m["blocks"][by * m["w"] + bx]) for bx in range(m["w"])], 1) for by in range(m["h"])], 0)
    labs = np.empty((m["h"] * 4, m["w"] * 4), object)
    for by in range(m["h"]):
        for bx in range(m["w"]):
            L = ts["blockLabels"][m["blocks"][by * m["w"] + bx]]
            for i in range(16): labs[by * 4 + i // 4, bx * 4 + i % 4] = L[i]
    return img, labs


def map_names():
    return [m["name"] for m in rom()["maps"]]


def picture(dex):
    p = next(p for p in rom()["pics"] if p["dex"] == dex)
    img = np.array(p["px"], np.uint8).reshape(p["h"], p["w"])
    return np.pad(img, ((0, 56 - p["h"]), (0, 56 - p["w"]))), p["name"]   # pad to 56 like the game's frame


# ---------- the plan's tile-label rule (labels.ts / normals.ts seedNormal) ----------

ORGANIC = {"tree", "rock", "plant", "cliff", "ledge"}
OBJECTS = {"table", "counter", "shelf", "machine", "furniture", "statue", "sign"}
SKIP = {None, "unused", "void", "lettering", "cave"}


def rule(label, object_weight=1.0):
    """(face, weight) for a tile label, as normals.ts seedNormal does."""
    if label in SKIP: return 0, 0.0
    if label in ("table", "counter"): return 0, object_weight
    if label in GROUND: return 0, 1.0
    if label in ("roof", "stairs"): return 2, 1.0
    return 1, 0.5 if label in ORGANIC else object_weight if label in OBJECTS else 1.0
