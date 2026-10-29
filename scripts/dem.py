"""Download AWS Terrarium DEM tiles (z13) covering the network bbox and mosaic them.
Output: data/raw/dem_z13.npy (float32 metres) + dem_z13.json (tile origin)."""
import math, os, io, json, concurrent.futures as cf, urllib.request
import numpy as np
from PIL import Image
Z=13; S,W,N,E=-34.24,150.53,-33.48,151.36
def tile(lat,lon):
    n=2**Z; x=(lon+180)/360*n
    y=(1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n
    return x,y
x0,y0=tile(N,W); x1,y1=tile(S,E)
tx0,ty0,tx1,ty1=int(x0),int(y0),int(x1),int(y1)
os.makedirs('data/raw/dem',exist_ok=True)
def get(t):
    tx,ty=t; fn=f'data/raw/dem/{Z}_{tx}_{ty}.png'
    if not os.path.exists(fn):
        urllib.request.urlretrieve(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png',fn)
    return t,fn
jobs=[(tx,ty) for tx in range(tx0,tx1+1) for ty in range(ty0,ty1+1)]
W_=(tx1-tx0+1)*256; H_=(ty1-ty0+1)*256
dem=np.zeros((H_,W_),np.float32)
with cf.ThreadPoolExecutor(16) as ex:
    for (tx,ty),fn in ex.map(get,jobs):
        a=np.asarray(Image.open(fn).convert('RGB')).astype(np.float32)
        h=a[:,:,0]*256+a[:,:,1]+a[:,:,2]/256-32768
        dem[(ty-ty0)*256:(ty-ty0+1)*256,(tx-tx0)*256:(tx-tx0+1)*256]=h
np.save('data/raw/dem_z13.npy',dem)
json.dump({'z':Z,'tx0':tx0,'ty0':ty0,'w':W_,'h':H_},open('data/raw/dem_z13.json','w'))
print(len(jobs),'tiles',dem.shape,dem.min(),dem.max())
