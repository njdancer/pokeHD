from romdata import *
from PIL import Image
def sprite(id_):
    s=next(s for s in D['sprites'] if s and s['id']==id_)
    t=np.array(s['tiles'],np.uint8).reshape(-1,8,8)
    return np.block([[t[0],t[1]],[t[2],t[3]]])
def save(imgs, path, scale=8):
    imgs=[np.pad(i,1,constant_values=0) for i in imgs]
    h=max(i.shape[0] for i in imgs)
    imgs=[np.pad(i,((0,h-i.shape[0]),(0,0))) for i in imgs]
    a=np.concatenate(imgs,1)
    Image.fromarray(a.astype(np.uint8)).resize((a.shape[1]*scale,a.shape[0]*scale),0).save(path)
def nrm_rgb(N):
    return ((N*0.5+0.5)*255).astype(np.uint8)
