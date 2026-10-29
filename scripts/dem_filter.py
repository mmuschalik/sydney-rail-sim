"""Remove buildings/trees from the DEM (surface model) with a grey opening, smooth, and
write local Terrarium tiles (z10-13) for the network area: public/data/dem/{z}/{x}/{y}.png"""
import numpy as np, json, os
from scipy import ndimage
from PIL import Image
a = np.load('data/raw/dem_z13.npy')
m = json.load(open('data/raw/dem_z13.json'))
# opening removes features narrower than ~7 px (~110 m): buildings, tree clumps
op = ndimage.grey_opening(a, size=(7, 7))
# keep water/low areas exact, smooth the rest
f = ndimage.gaussian_filter(op, 1.6)
f = np.minimum(f, a + 0.5)  # never raise above original surface
# keep water exactly at/below sea level so shorelines stay crisp
water = ndimage.binary_opening(a <= 0.2, iterations=1)
f = np.where(water, np.minimum(a, 0.0), f)
np.save('data/raw/dem_z13_f.npy', f.astype(np.float32))

def enc(h):
    v = np.clip(h + 32768, 0, 65535.99)
    r = np.floor(v / 256); g = np.floor(v) % 256; b = np.floor((v - np.floor(v)) * 256)
    return np.stack([r, g, b], -1).astype(np.uint8)

cur = f
tx0, ty0 = m['tx0'], m['ty0']
n = 0
for z in range(13, 9, -1):
    H, W = cur.shape
    for j in range(H // 256):
        for i in range(W // 256):
            tile = cur[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256]
            d = f'public/data/dem/{z}/{tx0 + i}'
            os.makedirs(d, exist_ok=True)
            Image.fromarray(enc(tile)).save(f'{d}/{ty0 + j}.png', optimize=True)
            n += 1
    # downsample to next zoom: needs even tile origin
    if tx0 % 2 or ty0 % 2:
        # pad to align
        px = (tx0 % 2) * 256; py = (ty0 % 2) * 256
        cur = np.pad(cur, ((py, 0), (px, 0)), mode='edge')
        tx0 -= tx0 % 2; ty0 -= ty0 % 2
    H, W = cur.shape
    H2, W2 = (H // 512) * 512, (W // 512) * 512
    cur = cur[:H2, :W2].reshape(H2 // 2, 2, W2 // 2, 2).mean((1, 3))
    tx0 //= 2; ty0 //= 2
print('tiles', n)
json.dump({'z13': [m['tx0'], m['ty0'], m['w'] // 256, m['h'] // 256]}, open('public/data/dem/index.json', 'w'))
