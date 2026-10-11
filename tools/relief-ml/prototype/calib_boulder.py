from calib_util import *
from render import *; from style import *
import itertools
real = sprite(63).astype(int)
inner = (real==1)|(real==2)
ss=3
def geom(kind):
    if kind=='ellipsoid': pr=Prim('ellipsoid',(8,5.3,0),r=(7.6,5.4,5.4))
    else: pr=Prim('sphere',(8,7.6,0),r=7.6)
    sc=Scene([pr]); view='map' if kind=='ellipsoid' else 'front'
    # map view: u = y - z, image bottom at u=0 -> ellipsoid center u=5.3, extends +-7.6
    org=(0,-2.3) if kind=='ellipsoid' else (0,0)
    return sc, render_buffers(sc, view, 16,16, ss, org), view
best={}
for kind in ['ellipsoid','sphere']:
    sc,buf,view=geom(kind)
    ids=mode_ids(buf['ids'],ss)
    print(kind,'silhouette IoU', ((ids>=0)&(real>0)).sum()/((ids>=0)|(real>0)).sum())
    res=[]
    for az in range(-90,91,15):
        for el in range(10,91,10):
            L=light_dir(az,el)
            for shd in [False,True]:
                I=pool(intensity(sc,buf,L,ambient=0.0,kd=1.0,use_shadow=shd,use_ao=True),ss)
                # for a two-shade sprite (1/2) the only free choice is the cut: pick best cut for this lighting
                vals=I[inner]; tgt=real[inner]
                for cut in np.quantile(vals, np.linspace(0.05,0.95,37)):
                    pred=np.where(vals>cut,1,2)
                    res.append(((pred==tgt).mean(), az, el, shd, cut))
    res.sort(reverse=True); best[kind]=res[0]
    print(kind, 'top fits (acc, az, el, shadow, cut):'); [print('  ',r) for r in res[:6]]
    # baseline: predict by row only (vertical gradient) and constant
    print('  constant-1 acc', (real[inner]==1).mean())
