import sys, numpy as np, torch
from PIL import Image
from romdata import map_img, SHADE
from train import UNet, predict
from eval_real import gt, REF
def panel(m, name, crop=None):
    """Real map | predicted normals | normals implied by labels (dark = not scored), ×3."""
    img,labs,ts=map_img(name)
    if crop: img=img[crop[0]:crop[1],crop[2]:crop[3]]; labs=labs[crop[0]//8:crop[1]//8,crop[2]//8:crop[3]//8]
    N=predict(m,img); g=gt(labs)
    gtn=np.where(g[...,None]>=0, REF[np.maximum(g,0)], 0.5*0+np.array([0,0,0]))
    a=np.concatenate([np.repeat(SHADE[img][...,None],3,-1), ((N*0.5+0.5)*255).astype(np.uint8), np.where(g[...,None]>=0,((gtn*0.5+0.5)*255),40).astype(np.uint8)],1)
    return Image.fromarray(a).resize((a.shape[1]*5,a.shape[0]*5),0)
def run(model_path, name, out, crop=None):
    m=UNet(); m.load_state_dict(torch.load(model_path)); m.eval()
    panel(m, name, crop).save(out)
if __name__=='__main__': run(sys.argv[1], sys.argv[2], sys.argv[3], tuple(map(int,sys.argv[4:8])) if len(sys.argv)>4 else None)
