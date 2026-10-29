"""Shared helpers for the Sydney rail network pipeline (projection, DEM sampling, geometry)."""
import math, json
import numpy as np

ORIGIN_LAT, ORIGIN_LON = -33.8832, 151.2063
R = 6378137.0
K = math.cos(math.radians(ORIGIN_LAT))


def merc(lat, lon):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


MX0, MY0 = merc(ORIGIN_LAT, ORIGIN_LON)


def project(lat, lon):
    """Same as src/geo.js project(): returns (x east, z south) metres."""
    mx, my = merc(lat, lon)
    return (mx - MX0) * K, -(my - MY0) * K


def project_arr(lat, lon):
    lat = np.asarray(lat, float); lon = np.asarray(lon, float)
    mx = R * np.radians(lon)
    my = R * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
    return (mx - MX0) * K, -(my - MY0) * K


class DEM:
    """Bilinear sampler over the z13 Terrarium mosaic, addressed by world x/z."""

    def __init__(self, root='data/raw'):
        self.a = np.load(f'{root}/dem_z13_f.npy')
        m = json.load(open(f'{root}/dem_z13.json'))
        self.z, self.tx0, self.ty0 = m['z'], m['tx0'], m['ty0']
        self.n = 2 ** self.z

    def sample(self, x, z):
        x = np.asarray(x, float); z = np.asarray(z, float)
        mx = x / K + MX0
        my = -z / K + MY0
        px = ((mx + math.pi * R) / (2 * math.pi * R) * self.n - self.tx0) * 256 - 0.5
        py = ((math.pi * R - my) / (2 * math.pi * R) * self.n - self.ty0) * 256 - 0.5
        h, w = self.a.shape
        px = np.clip(px, 0, w - 1.001); py = np.clip(py, 0, h - 1.001)
        x0 = np.floor(px).astype(int); y0 = np.floor(py).astype(int)
        fx = px - x0; fy = py - y0
        a = self.a
        v = (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy)
             + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy)
        return v


def polyline_len(pts):
    p = np.asarray(pts)
    if len(p) < 2:
        return 0.0
    return float(np.sum(np.hypot(*(p[1:, :2] - p[:-1, :2]).T)))


def cumlen(pts):
    p = np.asarray(pts)[:, :2]
    d = np.hypot(*(p[1:] - p[:-1]).T)
    return np.concatenate([[0], np.cumsum(d)])


def parse_speed(v):
    if not v:
        return None
    v = v.split(';')[0].strip()
    try:
        if v.endswith('mph'):
            return float(v[:-3]) * 1.609
        return float(v.split()[0])
    except ValueError:
        return None
