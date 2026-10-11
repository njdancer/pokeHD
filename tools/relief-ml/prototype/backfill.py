import json, glob, os, numpy as np, torch
from PIL import Image
from runlog import Run, describe_model
from train import UNet
from calib_util import sprite
SH = np.array([255,170,85,0],np.uint8)

def shard_metrics(r, files, view='map'):
    for f in files:
        d=np.load(f); im=d['img']
        r.log(shard=os.path.basename(f), view=view, samples=len(im), object_fraction=float((d['mask']==1).mean()),
              shade_hist=np.bincount(im.ravel(),minlength=4)/im.size)

# 1. boulder light fit
r=Run("calibrate","boulder-light",run_id="20261010-130900-calibrate-boulder-light",note="First look: fit a light direction to the boulder sprite (a near-sphere) with a sphere and a squashed-sphere proxy.",
      config=dict(object="boulder overworld sprite", proxies=["sphere (front view)","ellipsoid (3/4 map view)"], search="azimuth -90..90 by 15, elevation 10..90 by 10, best shade cut"))
r.result(fits=[dict(proxy="ellipsoid", accuracy=0.903, azimuth=60, elevation=70),dict(proxy="sphere", accuracy=0.903, azimuth=15, elevation=50)],
         constant_baseline=0.729, finding="Light from above and front-left; dither noise caps agreement near 90%.")
b=sprite(63); r.image("boulder.png", np.kron(np.where(b>0,SH[np.minimum(b,3)],255),np.ones((12,12),np.uint8)), "The boulder sprite used for the fit")
r.done()

# 2. generation v1
r=Run("generate","map-scenes-v1",run_id="20261010-131000-generate-map-scenes-v1",note="First synthetic set with hand-picked style ranges. Stopped at 1,000 scenes when the pilot showed the shading stats were off.",
      config=dict(view="map",size="64×64",supersampling=2,planned=6000,style="hand-picked ranges"))
shard_metrics(r, sorted(glob.glob('../data/shards_v1/map_*.npz')))
r.image("samples.png", Image.open('/mnt/project-files/relief-synth/synthetic-map-scenes.png'), "Sprites and their normal maps (green up, blue towards you)")
r.done("stopped", scenes=1000)

# 3. pilot training
m=UNet(); m.load_state_dict(torch.load('../models/pilot.pt'))
r=Run("train","pilot-map-unet24",run_id="20261010-131930-train-pilot-map-unet24",parent="20261010-131000-generate-map-scenes-v1",
      note="Quick pilot on the first 1,000 scenes to test the pipeline and get an early read on transfer.",
      config=dict(view="map",epochs=6,samples=1000,val_samples=100,width=24,crop=48,batch=32,lr=2e-3,optimiser="AdamW + one-cycle",loss="1 - cos(angle), unweighted"))
r.set(arch=describe_model(m,(4,48,48)))
for ep,(l,a) in enumerate([(0.7193,61.5),(0.2125,30.9),(0.1736,27.7),(0.1618,26.4),(0.1547,25.1),(0.1497,25.4)]):
    r.log(epoch=ep+1, epoch_loss=l, val_angle=a)
r.result(real_maps=dict(model=dict(TOP=0.968,FRONT=0.014,SLOPE=0.462,balanced=0.481),shade_oracle=dict(TOP=0.615,FRONT=0.179,SLOPE=0.606,balanced=0.467),chance=1/3),
         finding="Reads almost everything as flat ground; walls nearly never predicted.")
r.image("real-pallet.png", Image.open('../out/pilot_pallet.png'), "Pallet Town: map, prediction, label-implied normals")
r.done(val_angle=25.4)

# 4. style calibration
r=Run("calibrate","style-vs-real-maps",run_id="20261010-133000-calibrate-style-vs-real-maps",note="Fit the renderer's lighting and shading so P(shade | surface orientation) matches 22 real labelled maps.",
      config=dict(real_maps=22, synthetic_scenes=96, search="3,000 random styles on 24 scenes, top 40 refined on all 96",
                  objective="L1 between shade histograms per class (TOP, FRONT, SLOPE)"))
st=json.load(open('../data/styles.json'))
r.result(real_hist=dict(TOP=[0.615,0.286,0.099,0.0],FRONT=[0.309,0.371,0.141,0.179],SLOPE=[0.261,0.418,0.188,0.133]),
         before_hist=dict(TOP_ground=[0.51,0.29,0.14,0.06],TOP_object=[0.21,0.19,0.16,0.45],FRONT=[0.07,0.2,0.34,0.39],SLOPE=[0.32,0.25,0.2,0.23]),
         best_hist=dict(TOP=[0.613,0.265,0.092,0.03],FRONT=[0.302,0.305,0.267,0.126],SLOPE=[0.391,0.328,0.148,0.133]),
         best_distance=st[0]['d'], top_styles=st[:8],
         finding="Best fits use very soft, wrapped light with high ambient: fronts as bright as tops. Light direction is barely constrained, so Nintendo's shading carries little orientation per pixel; outlines and layout carry the shape.")
r.image("preview.png", Image.open('../out/gen_map_v2.png'), "Scenes rendered with the fitted styles")
r.done()

# 5. generation v2 (running)
r=Run("generate","map-scenes-v2",run_id="20261010-134000-generate-map-scenes-v2",parent="20261010-133000-calibrate-style-vs-real-maps",
      note="Synthetic set rendered with the calibrated styles (85% of map scenes), plus front-view creature pictures.",
      config=dict(view="map + front",size="64×64 map, 56×56 front",supersampling=2,planned_map=6000,planned_front=2000,workers=4,style="calibrated (styles.json), jittered"))
shard_metrics(r, sorted(glob.glob('../data/shards/map_*.npz')))
print('ok')
