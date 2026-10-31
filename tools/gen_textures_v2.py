#!/usr/bin/env python3
"""Procedural PNG texture generator v2 (higher resolution + extra detail) for the Rocket Workshop simulator.
Every texture is generated individually (no atlas). Cylinder textures are seamless horizontally.
All drawing coordinates are in "design units" (wide textures 1024x512, square ones 512x512) and are rendered at
K x that resolution, with extra micro detail (grain, scratches, grime, wear) layered on top.
Usage: python3 tools/gen_textures_v2.py          (writes assets/rocket parts textures/*.png + a mobile LOD folder)
"""
import os, math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'rocket parts textures')
LOD = os.path.join(ROOT, 'assets', 'rocket parts textures mobile')
os.makedirs(OUT, exist_ok=True); os.makedirs(LOD, exist_ok=True)
FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
CUR = None
HERO = {'rocket_body', 'rocket_body_panels', 'fuel_tank', 'nose_cone', 'control_module', 'liquid_engine', 'solid_rocket_booster', 'stainless_steel', 'interstage', 'capsule', 'fairing'}
def font(sz):
    k = CUR.K if CUR else 1
    try: return ImageFont.truetype(FONT_PATH, max(6, int(round(sz * k))))
    except Exception: return ImageFont.load_default()

def pnoise(w, h, fx, fy, seed, p=2.0):
    """Periodic band-limited noise on the CURRENT texture grid (w,h ignored: kept for call compatibility)."""
    W, H = CUR.W, CUR.H
    rng = np.random.default_rng(seed)
    n = rng.standard_normal((H, W)).astype(np.float32)
    F = np.fft.fft2(n)
    ky = (np.fft.fftfreq(H) * H)[:, None]; kx = (np.fft.fftfreq(W) * W)[None, :]
    k2 = (kx / fx) ** 2 + (ky / fy) ** 2
    F *= (1.0 / (1.0 + k2) ** (p / 2)).astype(np.float32)
    r = np.real(np.fft.ifft2(F)).astype(np.float32)
    r -= r.mean(); r /= (r.std() + 1e-9)
    return r

class SD:
    """ImageDraw proxy taking design-unit coordinates."""
    def __init__(s, d, K): s.d, s.K = d, K
    def _xy(s, xy):
        if isinstance(xy[0], (tuple, list)): return [(p[0] * s.K, p[1] * s.K) for p in xy]
        return [v * s.K for v in xy]
    def _w(s, kw):
        if kw.get('width') is not None: kw['width'] = max(1, int(round(kw['width'] * s.K)))
        return kw
    def line(s, xy, **kw): s.d.line(s._xy(xy), **s._w(kw))
    def polygon(s, xy, **kw): s.d.polygon(s._xy(xy), **s._w(kw))
    def rectangle(s, xy, **kw): s.d.rectangle(s._xy(xy), **s._w(kw))
    def ellipse(s, xy, **kw): s.d.ellipse(s._xy(xy), **s._w(kw))
    def text(s, xy, t, **kw): s.d.text((xy[0] * s.K, xy[1] * s.K), t, **kw)

class Tex:
    def __init__(s, w, h, base, seed=1):
        global CUR
        K = CURK; s.K = K; s.w, s.h, s.seed = w, h, seed
        s.W, s.H = int(round(w * K)), int(round(h * K)); CUR = s
        s.rgb = (np.zeros((s.H, s.W, 3), np.float32) + np.array(base, np.float32))
        s.hm = np.zeros((s.H, s.W), np.float32); s.ao = np.ones((s.H, s.W), np.float32)
        yy, xx = np.mgrid[0:s.H, 0:s.W]
        s.yy = ((yy + 0.5) / K).astype(np.float32); s.xx = ((xx + 0.5) / K).astype(np.float32); del yy, xx
        s.layer = Image.new('RGBA', (s.W, s.H), (0, 0, 0, 0)); s.d = SD(ImageDraw.Draw(s.layer), K)
        s.metal = 0.0; s.wear = 0.5
    def S(s, v): return int(round(v * s.K))
    # ---- height field features (design units)
    def dx(s, cx): return (s.xx - cx + s.w / 2) % s.w - s.w / 2
    def dy(s, cy): return (s.yy - cy + s.h / 2) % s.h - s.h / 2
    def groove_h(s, y, wid=2.0, depth=1.0, ao=0.25):
        g = np.exp(-(s.dy(y) / wid) ** 2)
        s.hm -= depth * g; s.ao *= 1 - ao * np.exp(-(s.dy(y) / (wid * 2.2)) ** 2)
    def groove_v(s, x, wid=2.0, depth=1.0, ao=0.25):
        g = np.exp(-(s.dx(x) / wid) ** 2)
        s.hm -= depth * g; s.ao *= 1 - ao * np.exp(-(s.dx(x) / (wid * 2.2)) ** 2)
    def bead_h(s, y, wid=3.0, h=1.0):
        s.hm += h * np.exp(-(s.dy(y) / wid) ** 2)
    def rivet(s, cx, cy, r=5, h=2.0):
        K = s.K; rp = r * K; cxp = cx * K; cyp = cy * K
        x0, x1 = int(cxp - rp * 2 - 2), int(cxp + rp * 2 + 3); y0, y1 = int(max(0, cyp - rp * 2 - 2)), int(min(s.H, cyp + rp * 2 + 3))
        if y1 <= y0: return
        xs = np.arange(x0, x1) % s.W; ys = np.arange(y0, y1)
        X, Y = np.meshgrid(np.arange(x0, x1), ys); d = np.hypot(X - cxp, Y - cyp)
        dome = np.where(d < rp, np.sqrt(np.clip(1 - (d / rp) ** 2, 0, 1)), 0)
        ring = 1 - 0.6 * np.exp(-((d - rp * 1.35) / (rp * 0.5)) ** 2)
        s.hm[np.ix_(ys, xs)] += h * dome; s.ao[np.ix_(ys, xs)] *= ring
    def rivet_row_h(s, y, step=32, off=16, r=4, h=2.0):
        for x in range(off, s.w, step): s.rivet(x, y, r, h)
    def rivet_row_v(s, x, step=32, off=16, r=4, h=2.0):
        for y in range(off, s.h, step): s.rivet(x, y, r, h)
    def screw(s, cx, cy, r=6):
        s.rivet(cx, cy, r, 1.2)
        s.dr(lambda d, o: (d.line([(cx + o - r * .6, cy), (cx + o + r * .6, cy)], fill=(20, 20, 22, 230), width=2),
                           d.line([(cx + o, cy - r * .6), (cx + o, cy + r * .6)], fill=(20, 20, 22, 230), width=2)))
    def hexbolt(s, cx, cy, r=7):
        s.rivet(cx, cy, r, 2.0)
        def f(d, o):
            pts = [(cx + o + r * .75 * math.cos(math.pi / 3 * i), cy + r * .75 * math.sin(math.pi / 3 * i)) for i in range(6)]
            d.polygon(pts, outline=(15, 15, 18, 220))
        s.dr(f)
    # ---- colour features
    def dr(s, fn):
        for o in (-s.w, 0, s.w): fn(s.d, o)
    def rect(s, x0, y0, x1, y1, col, a=255):
        s.dr(lambda d, o: d.rectangle([x0 + o, y0, x1 + o, y1], fill=col + (a,)))
    def text(s, x, y, t, sz, col, a=235, anchor='la'):
        f = font(sz)
        s.dr(lambda d, o: d.text((x + o, y), t, font=f, fill=col + (a,), anchor=anchor))
    def hazard(s, x0, y0, x1, y1, pitch=36, c1=(235, 190, 20), c2=(25, 25, 25)):
        K = s.K; w = int(round((x1 - x0) * K)); h = int(round((y1 - y0) * K)); pit = pitch * K
        sub = Image.new('RGBA', (w, h), c1 + (255,)); d = ImageDraw.Draw(sub); k = -h
        while k < w + h:
            d.polygon([(k, h), (k + pit, h), (k + pit + h, 0), (k + h, 0)], fill=c2 + (255,)); k += pit * 2
        for o in (-s.W, 0, s.W): s.layer.paste(sub, (int(round(x0 * K)) + o, int(round(y0 * K))))
    def tint_noise(s, amp, fx, fy, seed, col=(1, 1, 1)):
        n = pnoise(0, 0, fx, fy, s.seed * 100 + seed); s.rgb *= (1 + amp * n)[:, :, None]
    def streaks(s, amp=0.06, seed=7):
        n = pnoise(0, 0, 90, 3, s.seed * 100 + seed); n = np.clip(n - 0.3, 0, 3)
        s.rgb *= (1 - amp * n)[:, :, None]
    def peel(s, amp=0.012):
        s.rgb *= (1 + amp * pnoise(0, 0, s.w / 3, s.h / 3, s.seed * 100 + 3, 0.5))[:, :, None]
    def blot(s, amp=0.05):
        s.rgb *= (1 + amp * pnoise(0, 0, 6, 4, s.seed * 100 + 5))[:, :, None]
    def scratches(s, n, alen=(40, 260), alpha=(18, 55), horiz=0.8, dark=False):
        rng = np.random.default_rng(s.seed * 7 + 1); lay = Image.new('RGBA', (s.W, s.H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
        for i in range(n):
            x = rng.uniform(0, s.W); y = rng.uniform(0, s.H); L = rng.uniform(*alen) * s.K
            a = rng.normal(0, 0.06) if rng.random() < horiz else rng.uniform(0, math.pi)
            x2, y2 = x + L * math.cos(a), y + L * math.sin(a)
            c = (10, 10, 12) if dark else (235, 238, 245)
            d.line([(x, y), (x2, y2)], fill=c + (int(rng.uniform(*alpha)),), width=1)
        a = np.array(lay).astype(np.float32) / 255.0
        s.rgb = s.rgb * (1 - a[:, :, 3:4]) + a[:, :, :3] * a[:, :, 3:4]
    def grime(s, amp=0.10, seed=77):
        n = np.clip(pnoise(0, 0, 10, 6, s.seed * 100 + seed) * 0.5 + 0.1, 0, 2); s.rgb *= (1 - amp * n)[:, :, None] * np.array([1, 0.98, 0.94], np.float32)
        s.rgb *= (1 - amp * 0.8 * np.clip((1 - s.ao) * 2.2, 0, 1))[:, :, None]
    def finish(s, path, strength=0.35, light=(0.7, 0.7), micro=True):
        img = np.array(s.layer).astype(np.float32) / 255.0
        a = img[:, :, 3:4]; rgb = s.rgb * (1 - a) + (img[:, :, :3]) * a
        s.rgb = rgb
        if micro:
            n_sc = int((50 + 180 * s.metal) * (s.w * s.h) / (1024 * 512)); s.scratches(n_sc); s.grime(0.035 + 0.03 * s.wear)
        rgb = s.rgb
        hm = s.hm
        gx = np.roll(hm, -1, 1) - np.roll(hm, 1, 1); gy = np.roll(hm, -1, 0) - np.roll(hm, 1, 0)
        lit = -(gx * light[0] + gy * light[1]) * s.K
        rgb = rgb * (1 + strength * lit)[:, :, None] * (s.ao ** 1.2)[:, :, None]
        if micro:
            rng = np.random.default_rng(s.seed + 999)
            rgb *= (1 + 0.016 * rng.standard_normal((s.H, s.W)).astype(np.float32))[:, :, None]
            rgb *= (1 + 0.03 * pnoise(0, 0, s.w / 2.5, s.h / 2.5, s.seed * 100 + 41, 1.2))[:, :, None]
        rgb = np.clip(rgb, 0, 1)
        im = Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), 'RGB')
        im.save(path, optimize=True); print('wrote', os.path.relpath(path, ROOT), im.size, os.path.getsize(path) // 1024, 'KB', flush=True)
        return im

CURK = 1.5
def P(name): return os.path.join(OUT, name)

def white_paint(w, h, seed, base=(0.93, 0.94, 0.95)):
    t = Tex(w, h, base, seed); t.peel(); t.blot(0.04); return t

def seams(t, cols, rows, depth=1.2, rivets=True, step=32):
    for i in range(cols):
        x = i * t.w // cols; t.groove_v(x, 1.6, depth)
        if rivets: t.rivet_row_v(x + 12, step, step // 2, 3, 1.5); t.rivet_row_v(x - 12, step, step // 2, 3, 1.5)
    for j in range(rows):
        y = j * t.h // rows; t.groove_h(y, 1.6, depth)
        if rivets: t.rivet_row_h(y + 12, step, step // 2, 3, 1.5); t.rivet_row_h(y - 12, step, step // 2, 3, 1.5)

# ------------------------------------------------------------------ parts
def rocket_body():
    t = white_paint(1024, 512, 11)
    t.streaks(0.07)
    seams(t, 4, 2)
    t.text(60, 110, 'ACCESS PANEL 4B', 15, (20, 20, 25)); t.rect(56, 108, 250, 112, (20, 20, 25), 0)
    t.rect(300, 90, 410, 150, (20, 20, 25), 0)
    t.text(320, 100, 'NO', 22, (200, 30, 30)); t.text(320, 124, 'STEP', 22, (200, 30, 30))
    t.hazard(560, 60, 720, 96, 14)
    t.text(576, 120, 'REMOVE BEFORE', 14, (190, 25, 25)); t.text(576, 138, 'FLIGHT', 14, (190, 25, 25))
    t.rect(800, 330, 980, 345, (30, 30, 34), 200); t.text(808, 328, 'SERIAL  RB-0412-X', 14, (235, 235, 235))
    t.rect(40, 380, 220, 384, (190, 40, 40)); t.rect(40, 392, 220, 394, (30, 30, 34))
    t.text(300, 340, 'VENT', 18, (30, 30, 34)); t.d.ellipse([360, 345, 380, 365], outline=(30, 30, 34, 220), width=2)
    for x in (140, 400, 650, 900): t.hexbolt(x, 300, 6)
    return t.finish(P('rocket_body.png'))

def rocket_body_panels():
    t = Tex(1024, 512, (0.80, 0.81, 0.83), 12)
    n = pnoise(1024, 512, 4, 300, 12); t.rgb *= (1 + 0.03 * n)[:, :, None]   # brushed
    rng = np.random.default_rng(12)
    cols, rows = 8, 4; pw, ph = 1024 // cols, 512 // rows
    for r in range(rows):
        for c in range(cols):
            sh = 1 + rng.uniform(-0.05, 0.05); tone = np.array([1, 1.0, 1.02]) * sh
            t.rgb[t.S(r * ph):t.S((r + 1) * ph), t.S(c * pw):t.S((c + 1) * pw)] *= tone
            for (dx, dy) in ((10, 10), (pw - 10, 10), (10, ph - 10), (pw - 10, ph - 10)):
                t.screw(c * pw + dx, r * ph + dy, 4)
    for c in range(cols): t.groove_v(c * pw, 1.8, 1.4)
    for r in range(rows): t.groove_h(r * ph, 1.8, 1.4)
    # hatches
    for (c, r) in ((1, 1), (5, 2)):
        x0, y0 = c * pw + 16, r * ph + 16
        t.rect(x0, y0, x0 + pw - 32, y0 + ph - 32, (45, 48, 55), 255)
        t.groove_h(y0, 1.5, 1); t.groove_h(y0 + ph - 32, 1.5, 1); t.groove_v(x0, 1.5, 1); t.groove_v(x0 + pw - 32, 1.5, 1)
        t.rect(x0 + pw // 2 - 24, y0 + ph // 2 - 5, x0 + pw // 2 + 24, y0 + ph // 2 + 5, (200, 200, 205))
        t.text(x0 + 6, y0 + 4, 'ACCESS', 11, (230, 200, 40))
    t.hazard(3 * pw + 12, 2 * ph + 20, 4 * pw - 12, 2 * ph + 40, 12)
    t.text(6 * pw + 14, 3 * ph + 40, 'PWR', 20, (200, 40, 40)); t.text(0 * pw + 14, 2 * ph + 50, 'DATA', 20, (40, 90, 200))
    t.streaks(0.04, 9)
    return t.finish(P('rocket_body_panels.png'))

def nose_cone():
    t = white_paint(1024, 512, 13, (0.94, 0.94, 0.95))
    t.streaks(0.05)
    # dark tip (top rows) and red band
    t.rect(0, 0, 1023, 90, (40, 40, 44)); t.rect(0, 90, 1023, 96, (190, 35, 35))
    t.rect(0, 330, 1023, 372, (200, 40, 38)); t.rect(0, 380, 1023, 388, (30, 30, 34))
    for i in range(8): t.groove_v(i * 128, 1.5, 1.0)
    t.groove_h(96, 1.5, 1.2); t.groove_h(256, 1.8, 1.2); t.groove_h(440, 2, 1.5)
    t.rivet_row_h(456, 32, 16, 4, 2); t.rivet_row_h(424, 32, 16, 4, 2)
    t.text(40, 280, 'PAYLOAD FAIRING', 20, (30, 30, 34)); t.text(530, 282, 'FAIRING SEP LINE', 16, (190, 30, 30))
    t.hazard(700, 150, 860, 180, 12)
    n90 = t.S(90); t.rgb[:n90] *= 1 + 0.05 * pnoise(1024, 512, 120, 120, 5)[:n90, :, None]
    return t.finish(P('nose_cone.png'))

def fuel_tank():
    t = Tex(1024, 512, (0.74, 0.76, 0.79), 14)
    t.rgb *= (1 + 0.045 * pnoise(1024, 512, 3, 400, 14))[:, :, None]       # brushed aluminium
    t.rgb *= (1 + 0.02 * pnoise(1024, 512, 200, 200, 15))[:, :, None]
    t.rect(0, 0, 1023, 14, (235, 190, 20)); t.rect(0, 498, 1023, 511, (235, 190, 20))
    t.rect(0, 60, 1023, 200, (240, 240, 238), 235)       # painted band
    t.text(60, 82, 'FUEL', 78, (30, 30, 34)); t.text(330, 98, 'LH2 / LOX', 40, (30, 30, 34))
    t.text(60, 380, 'OXIDISER', 34, (170, 35, 35)); t.text(330, 388, 'MAX 2.0 BAR', 22, (30, 30, 34))
    # gauge
    t.rect(640, 230, 660, 440, (25, 25, 28), 220)
    for i in range(0, 21):
        y = 230 + i * 10; L = 36 if i % 5 == 0 else 22
        t.d.line([(662, y), (662 + L, y)], fill=(25, 25, 28, 230), width=2)
        if i % 5 == 0: t.text(704, y - 8, str(100 - i * 5), 14, (25, 25, 28))
    # diamond hazard sign
    for o in (0,):
        cx, cy = 880, 330
        t.d.polygon([(cx, cy - 55), (cx + 55, cy), (cx, cy + 55), (cx - 55, cy)], fill=(235, 235, 235, 255), outline=(190, 30, 30, 255))
        t.d.polygon([(cx, cy - 45), (cx + 45, cy), (cx, cy + 45), (cx - 45, cy)], outline=(190, 30, 30, 255), width=4)
        t.text(cx, cy, '!', 54, (190, 30, 30), 255, 'mm')
    for y in (0, 256): t.groove_h(y, 2.2, 1.6); t.bead_h(y + 7, 2.5, 0.5); t.bead_h(y - 7, 2.5, 0.5)
    for x in (0, 512): t.groove_v(x, 1.4, 0.8)
    t.rivet_row_h(26, 32, 16, 4, 2); t.rivet_row_h(486, 32, 16, 4, 2)
    t.streaks(0.05)
    return t.finish(P('fuel_tank.png'))

def liquid_engine():
    t = Tex(1024, 512, (0.30, 0.31, 0.33), 15)
    t.rgb *= (1 + 0.08 * pnoise(1024, 512, 60, 40, 15))[:, :, None]
    # plumbing rows: cylindrical pipe shading
    for y, wd in ((60, 22), (120, 14), (390, 20)):
        prof = np.clip(1 - (t.dy(y) / wd) ** 2, 0, 1) ** 0.5
        t.hm += 2.2 * prof; t.rgb *= (1 + 0.25 * prof)[:, :, None] * np.array([1.05, 0.9, 0.75])[None, None, :] ** (prof[:, :, None] > 0)
    for x in range(64, 1024, 128):   # vertical feed lines
        prof = np.clip(1 - (t.dx(x) / 8) ** 2, 0, 1) ** 0.5
        m = ((t.yy > 150) & (t.yy < 370)).astype(float)
        t.hm += 1.5 * prof * m; t.rgb *= (1 + 0.28 * prof * m)[:, :, None]
    # heat stains near bottom
    st = np.clip(pnoise(1024, 512, 30, 4, 16) * 0.5 + (t.yy - 380) / 120, 0, 1)
    t.rgb[:, :, 0] += 0.20 * st * (t.yy > 380); t.rgb[:, :, 2] += 0.12 * st * (t.yy > 430)
    t.groove_h(0, 2, 1.4); t.groove_h(256, 2, 1.0); t.groove_h(450, 2, 1.0)
    t.rivet_row_h(18, 32, 16, 5, 2.5); t.rivet_row_h(480, 32, 16, 5, 2.5)
    for x in range(0, 1024, 256): t.hexbolt(x + 128, 300, 9)
    t.rect(380, 205, 640, 250, (190, 192, 196), 255); t.text(390, 210, 'LV-T45  SN 00218', 22, (20, 20, 24)); t.text(390, 232, '200 kN  ISP 280', 14, (20, 20, 24))
    t.hazard(80, 440, 300, 462, 12)
    t.text(660, 270, 'HOT', 42, (235, 120, 20), 220)
    return t.finish(P('liquid_engine.png'))

def engine_nozzle():
    t = Tex(512, 512, (0.55, 0.38, 0.26), 16)
    # cooling channel ribs (64 around, periodic)
    for k in range(64):
        x = k * 8; t.groove_v(x, 1.3, 0.9, 0.18)
    ribs = 0.5 + 0.5 * np.cos(2 * math.pi * t.xx * 64 / 512)
    t.rgb *= (0.88 + 0.22 * ribs)[:, :, None]
    # throat (top) polished -> exit (bottom) heat tinted
    g = np.clip(t.yy / 512, 0, 1)
    t.rgb *= np.stack([1 - 0.25 * g, 1 - 0.15 * g, 1 - 0.1 * g], axis=2)
    tint = np.clip((t.yy - 300) / 212, 0, 1) * (0.5 + 0.5 * pnoise(512, 512, 6, 14, 17))
    t.rgb[:, :, 2] += 0.22 * tint * np.sin(tint * 3.14); t.rgb[:, :, 0] += 0.1 * tint
    for y in (60, 190, 330): t.groove_h(y, 2, 1.2); t.bead_h(y + 6, 3, 0.6)
    t.rect(0, 486, 511, 511, (60, 60, 64)); t.rivet_row_h(498, 32, 16, 5, 2.2); t.groove_h(486, 1.6, 1.2)
    t.rgb *= (1 + 0.06 * pnoise(512, 512, 90, 8, 18))[:, :, None]
    return t.finish(P('engine_nozzle.png'))

def solid_rocket_booster():
    t = Tex(1024, 512, (0.86, 0.86, 0.85), 17); t.peel(); t.blot(0.05); t.streaks(0.08)
    t.rect(0, 0, 1023, 22, (30, 30, 33)); t.rect(0, 490, 1023, 511, (30, 30, 33))
    t.rect(0, 200, 1023, 232, (195, 40, 36))
    t.text(70, 250, 'SOLID', 64, (35, 35, 38)); t.text(70, 330, 'ROCKET BOOSTER', 30, (35, 35, 38))
    t.text(600, 270, 'SRB-K2', 56, (195, 40, 36)); t.hazard(600, 360, 900, 392, 14)
    for y in (0, 256):
        for dy in (-14, 0, 14): t.groove_h(y + dy, 1.4, 1.1)
        for dy in (-24, 24): t.rivet_row_h(y + dy, 24, 12, 3, 1.8)
    for x in (0, 512): t.groove_v(x, 1.4, 0.8)
    t.hexbolt(940, 130, 7); t.hexbolt(220, 440, 7)
    return t.finish(P('solid_rocket_booster.png'))

def carbon_weave(w, h, seed, pitch=8):
    xs, ys = CUR.xx, CUR.yy
    fib_x = 0.5 + 0.5 * np.sin((xs % pitch) / pitch * math.pi)
    fib_y = 0.5 + 0.5 * np.sin((ys % pitch) / pitch * math.pi)
    tw = (((xs + ys) // (pitch / 2)) % 4 < 2)
    return np.where(tw, 0.10 + 0.14 * fib_x, 0.06 + 0.14 * fib_y).astype(np.float32)

def rocket_fins():
    w = h = 512
    t = Tex(w, h, (0.1, 0.1, 0.11), 18)
    val = carbon_weave(w, h, 18); t.rgb = np.stack([val * 1.0, val * 1.02, val * 1.1], axis=2)
    t.rgb *= (1 + 0.15 * pnoise(w, h, 4, 4, 18))[:, :, None]
    t.rect(0, 0, 28, 511, (180, 182, 188)); t.groove_v(28, 1.5, 1.2)    # metal leading-edge/root strip
    t.rect(0, 0, 511, 20, (190, 40, 36))
    t.rect(484, 0, 511, 511, (120, 122, 128)); t.groove_v(484, 1.5, 1.2)
    t.rivet_row_v(14, 32, 16, 4, 2); t.rivet_row_v(498, 32, 16, 4, 2)
    t.text(120, 230, 'FIN', 60, (225, 225, 230), 120); t.hazard(120, 440, 400, 462, 12)
    return t.finish(P('rocket_fins.png'), 0.25)

def structural_connector():
    t = Tex(1024, 512, (0.34, 0.35, 0.38), 19)
    t.rgb *= (1 + 0.06 * pnoise(1024, 512, 80, 60, 19))[:, :, None]
    # flanges
    t.rect(0, 0, 1023, 60, (0.62 * 255,) * 3 if False else (150, 152, 158)); t.rect(0, 452, 1023, 511, (150, 152, 158))
    t.groove_h(60, 2, 1.6); t.groove_h(452, 2, 1.6); t.bead_h(66, 3, 0.8); t.bead_h(446, 3, 0.8)
    # lattice X braces between flanges: 8 bays
    bw = 128
    for i in range(8):
        x0, x1 = i * bw, (i + 1) * bw
        for (xa, ya, xb, yb) in ((x0 + 6, 70, x1 - 6, 442), (x1 - 6, 70, x0 + 6, 442)):
            t.dr(lambda d, o: d.line([(xa + o, ya), (xb + o, yb)], fill=(176, 178, 184, 255), width=14))
        t.groove_v(x0, 3, 1.6)
        t.rect(x0 + 4, 70, x0 + 8, 442, (60, 60, 64), 180)
    for x in range(16, 1024, 32): t.hexbolt(x, 30, 8); t.hexbolt(x, 482, 8)
    t.text(40, 8, 'STRUCTURAL  TRUSS  ADAPTER  SC-1', 20, (25, 25, 28))
    return t.finish(P('structural_connector.png'), 0.3)

def decoupler():
    t = Tex(1024, 512, (0.55, 0.56, 0.58), 20); t.blot(0.06); t.peel(0.02)
    t.hazard(0, 170, 1023, 340, 30)
    t.groove_h(256, 2.5, 1.6); t.groove_h(170, 2, 1.2); t.groove_h(340, 2, 1.2)
    t.rivet_row_h(110, 32, 16, 7, 3); t.rivet_row_h(400, 32, 16, 7, 3)
    t.rect(0, 0, 1023, 50, (60, 62, 66)); t.rect(0, 462, 1023, 511, (60, 62, 66))
    t.text(40, 60, 'EXPLOSIVE BOLTS', 26, (230, 190, 30)); t.text(500, 420, 'SEPARATION PLANE', 26, (230, 190, 30))
    t.d.rectangle([800, 20, 970, 44], fill=(190, 35, 35, 255)); t.text(812, 20, 'ARMED', 22, (255, 255, 255))
    t.streaks(0.05)
    return t.finish(P('decoupler.png'))

def landing_legs():
    t = Tex(512, 512, (0.72, 0.73, 0.76), 21)
    t.rgb *= (1 + 0.05 * pnoise(512, 512, 3, 200, 21))[:, :, None]   # brushed
    t.hazard(0, 380, 511, 440, 20)
    t.rect(0, 440, 511, 511, (28, 28, 30))    # rubber footpad zone
    n440 = t.S(440); t.rgb[n440:] *= 1 + 0.15 * pnoise(512, 512, 120, 120, 22)[n440:, :, None]
    t.rect(0, 0, 511, 40, (50, 52, 58)); t.groove_h(40, 1.8, 1.2)
    for y in (0, 130, 260): t.groove_h(y, 1.6, 1.0)
    t.rivet_row_h(25, 32, 16, 5, 2.2); t.rivet_row_h(465, 32, 16, 5, 1.0)
    t.text(30, 160, 'LEG  LT-2', 34, (30, 30, 34)); t.text(30, 210, 'MAX 3.5 t', 22, (180, 35, 35))
    return t.finish(P('landing_legs.png'))

def heat_shield():
    w = h = 512
    t = Tex(w, h, (0.13, 0.12, 0.12), 23)
    tile = 32; rng = np.random.default_rng(23)
    for r in range(h // tile):
        off = (tile // 2) * (r % 2)
        for c in range(w // tile):
            x0 = c * tile + off; y0 = r * tile
            b = rng.uniform(0.7, 1.35)
            for o in (-w, 0):
                xs, xe = x0 + o + 2, x0 + o + tile - 2
                if xe < 0 or xs >= w: continue
                xs2, xe2 = max(xs, 0), min(xe, w)
                t.rgb[t.S(y0 + 2):t.S(y0 + tile - 2), t.S(xs2):t.S(xe2)] *= b
    for r in range(h // tile + 1): t.groove_h(r * tile, 1.3, 1.2, 0.5)
    for r in range(h // tile):
        off = (tile // 2) * (r % 2)
        for c in range(w // tile + 1): 
            x = c * tile + off
            m = (t.yy >= r * tile) & (t.yy < (r + 1) * tile)
            g = np.exp(-(t.dx(x) / 1.3) ** 2) * m
            t.hm -= 1.2 * g; t.ao *= 1 - 0.5 * g
    char = np.clip(pnoise(w, h, 10, 10, 24) * 0.5 + 0.2, 0, 1)
    t.rgb *= (1 - 0.35 * char)[:, :, None]; t.rgb += (0.06 * np.clip(pnoise(w, h, 40, 40, 25), 0, 3))[:, :, None] * np.array([1.0, 0.7, 0.4])
    t.rect(0, 0, 511, 12, (200, 200, 205)); t.text(200, 14, 'ABLATIVE SHIELD', 12, (210, 210, 215), 200)
    return t.finish(P('heat_shield.png'), 0.4)

def parachute():
    w = h = 512
    t = Tex(w, h, (0.95, 0.5, 0.1), 26)
    gore = w // 16
    gi = (t.xx // gore).astype(int) % 2
    t.rgb = np.where(gi[:, :, None] == 0, np.array([0.96, 0.46, 0.08]), np.array([0.96, 0.95, 0.92]))
    # fabric weave
    wv = 0.5 + 0.5 * np.sin(t.xx * 2 * math.pi / 3) * np.sin(t.yy * 2 * math.pi / 3)
    t.rgb *= (0.9 + 0.12 * wv)[:, :, None]
    t.rgb *= (1 + 0.05 * pnoise(w, h, 20, 20, 26))[:, :, None]
    for k in range(16):
        x = k * gore; t.groove_v(x, 1.2, 0.8, 0.2)
        t.rect(x - 1, 0, x + 1, 511, (45, 40, 36), 255)
    for y in (40, 256, 470):
        t.rect(0, y - 6, 511, y + 6, (230, 230, 225)); t.groove_h(y - 6, 1, 0.8); t.groove_h(y + 6, 1, 0.8)
        t.dr(lambda d, o: [d.line([(x + o, y - 5), (x + o + 6, y + 5)], fill=(40, 40, 40, 200), width=1) for x in range(0, 512, 6)])
    t.rect(0, 490, 511, 511, (190, 35, 35))
    t.text(gore * 2 + 3, 130, 'CHUTE', 22, (60, 40, 20), 150); t.text(gore * 6 + 3, 330, 'CH-5', 22, (60, 40, 20), 150)
    return t.finish(P('parachute.png'), 0.25)

def battery():
    w = h = 512
    t = Tex(w, h, (0.85, 0.62, 0.22), 27)
    # crinkled Kapton foil: ridged noise
    n1 = pnoise(w, h, 18, 18, 27, 1.2); n2 = pnoise(w, h, 40, 40, 28, 1.0)
    r = 1 - np.abs(n1 * 0.8 + n2 * 0.4) 
    t.hm += 2.2 * r + 1.0 * pnoise(w, h, 80, 80, 29, 0.8)
    t.rgb *= (0.8 + 0.35 * r)[:, :, None] * np.array([1.0, 0.95, 0.85])[None, None, :]
    t.rect(0, 0, 511, 44, (40, 42, 48)); t.rect(0, 468, 511, 511, (40, 42, 48))
    t.rivet_row_h(22, 32, 16, 6, 2.5); t.rivet_row_h(490, 32, 16, 6, 2.5)
    t.rect(130, 150, 382, 300, (30, 30, 34), 235)
    t.d.polygon([(256, 160), (226, 230), (252, 230), (240, 290), (290, 215), (262, 215), (278, 160)], fill=(250, 210, 40, 255))
    t.text(256, 322, 'BATT-100EC', 40, (30, 30, 34), 255, 'ma'); t.text(300, 120, '+', 40, (190, 35, 35)); t.text(60, 120, '-', 40, (30, 30, 34))
    return t.finish(P('battery.png'), 0.35)

def control_module():
    t = Tex(1024, 512, (0.88, 0.89, 0.9), 30); t.peel(); t.blot(0.04); t.streaks(0.05)
    seams(t, 4, 1, 1.1, True, 40)
    for (x0, x1) in ((90, 250), (600, 760)):     # windows
        yy = np.clip((t.yy - 150) / 120, 0, 1)
        sel = (t.xx >= x0) & (t.xx < x1) & (t.yy >= 150) & (t.yy < 270)
        glass = np.stack([0.05 + 0.1 * yy, 0.09 + 0.18 * yy, 0.16 + 0.3 * yy], axis=2)
        t.rgb = np.where(sel[:, :, None], glass, t.rgb)
        t.d.rectangle([x0 - 6, 144, x1 + 5, 276], outline=(40, 42, 48, 255), width=6)
        t.d.line([(x0 + 10, 160), (x0 + 60, 160)], fill=(150, 190, 235, 200), width=3)
    t.rect(300, 150, 520, 270, (14, 20, 18), 255); 
    for i, line in enumerate(('FLT CTRL  OK', 'ATT  HOLD', 'PWR  98%', 'LINK  NOMINAL', 'SAS  READY')):
        t.text(312, 156 + i * 22, line, 15, (80, 255, 120))
    for i in range(10):
        c = [(70, 220, 90), (240, 190, 40), (220, 60, 50)][i % 3]
        t.d.ellipse([320 + i * 20, 296, 332 + i * 20, 308], fill=c + (255,))
    t.text(60, 330, 'CTRL-1  AVIONICS', 30, (30, 30, 34)); t.hazard(540, 330, 720, 358, 12)
    t.rect(780, 330, 980, 356, (25, 25, 28)); t.text(790, 333, 'REACTION WHEELS', 15, (230, 230, 230))
    for x in (60, 330, 575, 850): t.hexbolt(x, 440, 7)
    t.groove_h(60, 1.5, 1.2); t.groove_h(450, 1.5, 1.2)
    return t.finish(P('control_module.png'))

def rcs_thruster():
    w = h = 512
    t = Tex(w, h, (0.22, 0.23, 0.25), 31)
    t.rgb *= (1 + 0.08 * pnoise(w, h, 50, 50, 31))[:, :, None]
    t.rect(0, 0, 511, 511, (58, 60, 66), 0)
    t.groove_h(0, 2, 1.2); t.groove_h(256, 2, 1.0); t.groove_v(0, 2, 1.2); t.groove_v(256, 2, 1)
    for (cx, cy) in ((128, 128), (384, 128), (128, 384), (384, 384)):
        t.d.ellipse([cx - 44, cy - 44, cx + 44, cy + 44], fill=(20, 20, 22, 255), outline=(176, 108, 62, 255), width=8)
        t.d.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=(6, 6, 7, 255))
        t.hm[(t.yy - cy) ** 2 + (t.xx - cx) ** 2 < 52 ** 2] += 0.4
        for a in range(8):
            t.screw(int(cx + 62 * math.cos(a * math.pi / 4)), int(cy + 62 * math.sin(a * math.pi / 4)), 4)
    t.rect(0, 244, 511, 268, (200, 40, 34), 255); t.text(256, 256, 'RCS  MONOPROP  N2H4', 20, (250, 250, 250), 255, 'mm')
    return t.finish(P('rcs_thruster.png'), 0.35)

def solar_panels():
    w = h = 512
    t = Tex(w, h, (0.75, 0.77, 0.80), 32)
    cw, ch = 64, 85
    for r in range(6):
        for c in range(8):
            x0, y0 = c * cw + 4, r * ch + 4
            for yy_ in range(y0, y0 + ch - 8):
                pass
            sel = (t.xx >= x0) & (t.xx < x0 + cw - 8) & (t.yy >= y0) & (t.yy < y0 + ch - 8)
            grad = 0.5 + 0.5 * (t.yy - y0) / ch
            cell = np.stack([0.04 + 0.03 * grad, 0.09 + 0.08 * grad, 0.30 + 0.20 * grad], axis=2)
            t.rgb = np.where(sel[:, :, None], cell, t.rgb)
            for k in range(1, 4):
                t.rect(x0 + k * (cw - 8) // 4, y0, x0 + k * (cw - 8) // 4, y0 + ch - 9, (190, 195, 205), 255)
            t.rect(x0, y0 + (ch - 8) // 2 - 1, x0 + cw - 9, y0 + (ch - 8) // 2, (170, 175, 185), 220)
    for c in range(9): t.groove_v(c * cw, 1.4, 1.0)
    for r in range(7): t.groove_h(min(r * ch, 511), 1.4, 1.0)
    t.rect(0, 0, 511, 3, (60, 62, 68)); t.rect(0, 508, 511, 511, (60, 62, 68))
    t.rgb *= (1 + 0.04 * pnoise(w, h, 40, 40, 33))[:, :, None]
    return t.finish(P('solar_panels.png'), 0.3)

def docking_port():
    t = Tex(1024, 512, (0.62, 0.64, 0.67), 34)
    t.rgb *= (1 + 0.05 * pnoise(1024, 512, 5, 220, 34))[:, :, None]
    t.rect(0, 0, 1023, 90, (40, 42, 48)); t.rect(0, 420, 1023, 511, (40, 42, 48))
    # latches
    for i in range(8):
        x = i * 128 + 24
        t.rect(x, 130, x + 80, 250, (210, 175, 60), 255)
        t.d.rectangle([x, 130, x + 80, 250], outline=(30, 30, 34, 255), width=4); t.hexbolt(x + 40, 190, 10)
    for y in (90, 420): t.groove_h(y, 2, 1.6)
    t.groove_h(0, 2, 1.2); t.rivet_row_h(45, 32, 16, 6, 2.4); t.rivet_row_h(465, 32, 16, 6, 2.4)
    for i in range(16):
        x = i * 64 + 32; t.d.ellipse([x - 7, 290, x + 7, 304], fill=(240, 200, 60, 255), outline=(20, 20, 22, 255))
    t.hazard(0, 340, 1023, 380, 16, (200, 40, 36), (240, 240, 240))
    t.text(30, 395, 'DOCKING  PORT  IDSS', 20, (240, 240, 240))
    return t.finish(P('docking_port.png'))

def adapter():
    t = white_paint(1024, 512, 35, (0.78, 0.80, 0.84)); t.streaks(0.05)
    seams(t, 8, 1, 1.3, True, 32)
    t.groove_h(256, 2, 1.4); t.rivet_row_h(244, 24, 12, 3, 1.6); t.rivet_row_h(268, 24, 12, 3, 1.6)
    t.text(60, 90, 'TAPERED ADAPTER', 28, (30, 30, 34)); t.hazard(500, 380, 760, 404, 12)
    t.text(60, 400, 'AD-125/250', 22, (190, 40, 36))
    return t.finish(P('adapter.png'))

def carbon_fibre():
    w = h = 512; t = Tex(w, h, (0.1, 0.1, 0.1), 40)
    v = carbon_weave(w, h, 40, 16); t.rgb = np.stack([v, v, v * 1.08], axis=2) * 1.1
    t.rgb *= (1 + 0.1 * pnoise(w, h, 5, 5, 40))[:, :, None]
    return t.finish(P('carbon_fibre.png'), 0.2)

def insulation_foil():
    w = h = 512; t = Tex(w, h, (0.82, 0.8, 0.74), 41)
    n1 = pnoise(w, h, 14, 14, 41, 1.2); n2 = pnoise(w, h, 36, 36, 42, 1.0); r = 1 - np.abs(n1 * 0.8 + n2 * 0.5)
    t.hm += 2.4 * r; t.rgb *= (0.75 + 0.42 * r)[:, :, None] * np.array([1.0, 0.98, 0.94])[None, None, :]
    for k in range(0, 512, 128): t.groove_v(k, 2, 0.5)
    for k in range(0, 512, 128): t.groove_h(k, 2, 0.5)
    return t.finish(P('insulation_foil.png'), 0.4)

def hazard_stripes():
    t = Tex(512, 512, (0.5, 0.5, 0.5), 43); t.hazard(0, 0, 512, 512, 32); t.peel(0.02); t.blot(0.06)
    t.groove_h(0, 2, 1); t.rivet_row_h(20, 40, 20, 4, 1.5)
    return t.finish(P('hazard_stripes.png'), 0.25)


# ------------------------------------------------------------------ NEW parts (v2): Starship / Falcon style hardware
def stainless_steel():
    t = Tex(1024, 512, (0.70, 0.72, 0.75), 61)
    t.rgb *= (1 + 0.05 * pnoise(0, 0, 3, 420, 61))[:, :, None]             # brushed grain
    t.rgb *= (1 + 0.03 * pnoise(0, 0, 220, 220, 62))[:, :, None]
    rng = np.random.default_rng(61); rows = 4
    for r in range(rows):                                                  # ring panels of slightly different tone
        y0, y1 = r * 128, (r + 1) * 128; tone = 1 + rng.uniform(-0.06, 0.05)
        m = ((t.yy >= y0) & (t.yy < y1))[:, :, None]; t.rgb = np.where(m, t.rgb * tone, t.rgb)
    for y in range(0, 512, 128):                                           # circumferential welds with heat tint
        t.groove_h(y, 1.1, 0.8, 0.35); t.bead_h(y + 5, 2.2, 0.7); t.bead_h(y - 5, 2.2, 0.7)
        band = np.exp(-(t.dy(y) / 9.0) ** 2)[:, :, None]
        t.rgb = t.rgb * (1 - 0.30 * band) + band * 0.30 * np.array([0.52, 0.56, 0.66], np.float32)
        ripple = 0.5 + 0.5 * np.sin(t.xx * 2 * math.pi / 3.2 + 3 * pnoise(0, 0, 40, 40, 63 + y // 128))
        t.hm += 0.35 * ripple * np.exp(-(t.dy(y) / 4.0) ** 2)
    for x in (0, 512): t.groove_v(x, 1.1, 0.7, 0.3); t.bead_h(0, 0.1, 0)     # longitudinal weld lines
    t.hm += 0.9 * pnoise(0, 0, 5, 3, 64, 1.5)                               # gentle oil-canning dents
    for y in range(0, 512, 128):
        for x in range(16, 1024, 64): t.rivet(x, y + 18, 2.0, 0.8)           # tack-weld dots
    st = np.clip(pnoise(0, 0, 70, 3, 65) * 0.6 + (t.yy - 330) / 190, 0, 1) * (t.yy > 330)
    t.rgb *= (1 - 0.22 * st)[:, :, None]   # soot / heat staining toward the bottom
    t.text(110, 70, 'SN 20', 26, (60, 62, 66), 160); t.text(110, 100, 'STAINLESS 304L', 12, (60, 62, 66), 140)
    t.rect(640, 330, 760, 336, (30, 30, 34), 190); t.text(640, 340, 'TANK  VENT', 11, (40, 40, 44), 170)
    t.metal = 1; t.grime(0.05)
    return t.finish(P('stainless_steel.png'), 0.32)

def raptor_cluster():
    t = Tex(1024, 512, (0.20, 0.21, 0.23), 66)
    t.rgb *= (1 + 0.1 * pnoise(0, 0, 50, 30, 66))[:, :, None]
    # quilted insulation skirt
    q = 0.5 + 0.5 * np.sin(t.xx * 2 * math.pi / 32) * np.sin(t.yy * 2 * math.pi / 32)
    t.hm += 1.6 * q * (t.yy > 120); t.rgb *= (0.85 + 0.25 * q)[:, :, None] * (t.yy > 120)[:, :, None] + (t.yy <= 120)[:, :, None]
    t.rect(0, 0, 1023, 110, (130, 132, 138)); t.groove_h(110, 2, 1.6); t.bead_h(118, 3, 0.8)
    t.rivet_row_h(40, 24, 12, 5, 2.4); t.rivet_row_h(80, 24, 0, 5, 2.4)
    for y, wd in ((140, 10), (410, 12)):
        prof = np.clip(1 - (t.dy(y) / wd) ** 2, 0, 1) ** 0.5; t.hm += 2.4 * prof
        t.rgb *= (1 + 0.3 * prof)[:, :, None] * np.array([1.05, 0.9, 0.75], np.float32)
    t.hazard(60, 440, 300, 462, 12); t.text(420, 150, 'RAPTOR  CLUSTER', 30, (235, 235, 235), 220); t.text(420, 190, 'FULL-FLOW STAGED COMBUSTION', 13, (235, 190, 40), 200)
    st = np.clip(pnoise(0, 0, 30, 4, 67) * 0.5 + (t.yy - 330) / 150, 0, 1)
    t.rgb[:, :, 0] += 0.04 * st * (t.yy > 330)
    for x in range(48, 1024, 128): t.hexbolt(x, 285, 9)
    t.metal = 1
    return t.finish(P('raptor_cluster.png'), 0.4)

def grid_fin():
    t = Tex(512, 512, (0.30, 0.31, 0.33), 68)
    t.rgb *= (1 + 0.07 * pnoise(0, 0, 4, 160, 68))[:, :, None]; t.rgb *= (1 + 0.04 * pnoise(0, 0, 90, 90, 69))[:, :, None]
    t.rect(0, 0, 511, 30, (175, 178, 184)); t.groove_h(30, 1.6, 1.2); t.rect(0, 481, 511, 511, (175, 178, 184)); t.groove_h(481, 1.6, 1.2)
    t.rivet_row_h(15, 24, 12, 4, 2); t.rivet_row_h(496, 24, 12, 4, 2)
    g = np.clip((t.xx - 280) / 232, 0, 1) * (0.5 + 0.5 * pnoise(0, 0, 5, 12, 70))        # titanium heat tint toward the tip
    t.rgb[:, :, 0] += 0.05 * g; t.rgb[:, :, 2] += 0.07 * g * np.sin(g * 3.14)
    for x in (0, 128, 256, 384): t.groove_v(x, 1.4, 1.0)
    t.text(150, 220, 'GRID FIN', 42, (225, 225, 230), 150); t.hazard(60, 410, 330, 436, 12)
    t.text(40, 90, 'TI-6AL-4V', 20, (235, 235, 235), 170)
    t.metal = 1; t.grime(0.05)
    return t.finish(P('grid_fin.png'), 0.3)

def flap_tiles():
    t = Tex(512, 512, (0.10, 0.10, 0.11), 71)
    rng = np.random.default_rng(71); tile = 32
    for r in range(16):
        off = (tile // 2) * (r % 2)
        for c in range(17):
            x0 = c * tile + off - (tile // 2 if r % 2 else 0); y0 = r * tile + 40 if False else r * tile
            b = rng.uniform(0.7, 1.5)
            xs, xe = max(0, x0 + 2), min(512, x0 + tile - 2)
            if xe > xs: t.rgb[t.S(y0 + 2):t.S(y0 + tile - 2), t.S(xs):t.S(xe)] *= b
            # chipped corner
            if rng.random() < 0.06: t.rect(x0 + 2, y0 + 2, x0 + 2 + rng.integers(4, 12), y0 + 2 + rng.integers(3, 9), (210, 205, 195), 230)
    for r in range(17): t.groove_h(r * tile, 1.2, 1.1, 0.55)
    for r in range(16):
        off = (tile // 2) * (r % 2)
        for c in range(17):
            x = c * tile + off; m = ((t.yy >= r * tile) & (t.yy < (r + 1) * tile)); g = np.exp(-(t.dx(x) / 1.2) ** 2) * m; t.hm -= 1.1 * g; t.ao *= 1 - 0.5 * g
    t.rgb *= (1 + 0.15 * np.clip(pnoise(0, 0, 30, 30, 72), -1, 3))[:, :, None]
    burn = np.clip(pnoise(0, 0, 8, 8, 73) * 0.5 + 0.3, 0, 1)[:, :, None]; t.rgb += 0.05 * burn * np.array([1.0, 0.7, 0.45], np.float32)
    t.rect(0, 0, 511, 56, (150, 152, 158)); t.groove_h(56, 2, 1.6); t.bead_h(62, 3, 0.8); t.rivet_row_h(20, 24, 12, 5, 2.4); t.rivet_row_h(40, 24, 0, 4, 2)
    t.text(40, 70, 'FLAP  A-L', 14, (200, 200, 205), 170)
    return t.finish(P('flap_tiles.png'), 0.4)

def interstage():
    t = Tex(1024, 512, (0.07, 0.07, 0.08), 74)
    v = carbon_weave(0, 0, 74, 6); t.rgb = np.stack([v * 0.55, v * 0.55, v * 0.6], axis=2).astype(np.float32)
    t.rgb *= (1 + 0.1 * pnoise(0, 0, 12, 8, 74))[:, :, None]; t.rgb += 0.015
    for x in range(0, 1024, 64): t.groove_v(x, 1.2, 0.8, 0.3)
    for y in (0, 100, 412): t.groove_h(y, 1.6, 1.2); t.rivet_row_h(y + 12, 24, 12, 3, 1.6); t.rivet_row_h(y - 12, 24, 0, 3, 1.6)
    t.rect(0, 440, 1023, 470, (200, 200, 205)); t.text(40, 150, 'INTERSTAGE', 70, (225, 225, 230), 215); t.text(46, 235, 'F9-S1/S2  COMPOSITE', 22, (225, 225, 230), 190)
    t.hazard(560, 330, 760, 360, 14); t.rect(820, 130, 980, 200, (225, 225, 230), 220); t.text(830, 140, 'DO NOT', 22, (190, 30, 30)); t.text(830, 166, 'PUSH HERE', 18, (190, 30, 30))
    for i in range(12): t.d.ellipse([60 + i * 18, 300, 70 + i * 18, 310], fill=(5, 5, 6, 255), outline=(90, 92, 98, 255), width=1)   # vent holes
    t.streaks(0.06); t.metal = 0.3
    return t.finish(P('interstage.png'), 0.3)

def capsule():
    t = white_paint(1024, 512, 75, (0.94, 0.94, 0.95)); t.streaks(0.05)
    for i in range(8): t.groove_v(i * 128, 1.1, 0.8, 0.3)
    for y in (96, 200, 330): t.groove_h(y, 1.3, 1.0)
    # four windows
    for x in (64, 320, 576, 832):
        t.rect(x + 14, 224, x + 98, 290, (10, 14, 20), 255); t.d.rectangle([x + 10, 220, x + 102, 294], outline=(60, 62, 68, 255), width=5)
        t.d.line([(x + 24, 232), (x + 60, 232)], fill=(150, 190, 235, 200), width=3)
    # dark thermal protection band + tiles at the bottom
    yb = 380; tile = 24
    t.rect(0, yb, 1023, 511, (28, 24, 24))
    rng = np.random.default_rng(75)
    for r in range((512 - yb) // tile + 1):
        for c in range(1024 // tile + 1):
            b = rng.uniform(0.7, 1.3); y0 = yb + r * tile; x0 = c * tile + (tile // 2) * (r % 2)
            if y0 + tile < 512 and x0 + tile < 1024: t.rgb[t.S(y0 + 2):t.S(y0 + tile - 2), t.S(x0 + 2):t.S(x0 + tile - 2)] *= 1.0 if False else 1.0
    for r in range(8): t.groove_h(yb + r * tile, 1, 0.9, 0.4)
    t.groove_h(yb, 2, 1.6)
    t.text(80, 100, 'CREW  CAPSULE', 40, (30, 30, 34)); t.text(80, 150, 'ISS-RATED', 16, (190, 40, 36))
    t.rect(700, 100, 940, 124, (25, 25, 28)); t.text(710, 102, 'SPLASHDOWN READY', 16, (235, 235, 235)); t.hazard(540, 100, 660, 126, 10)
    for x in (30, 300, 560, 820): t.hexbolt(x, 330, 7)
    t.rect(0, 0, 1023, 40, (60, 60, 66)); t.groove_h(40, 1.6, 1.2)
    return t.finish(P('capsule.png'))

def fairing():
    t = white_paint(1024, 512, 76, (0.95, 0.95, 0.95)); t.streaks(0.05)
    t.groove_v(0, 1.6, 1.4, 0.4); t.groove_v(512, 1.6, 1.4, 0.4)          # two halves
    for x in (0, 512): t.rivet_row_v(x + 10, 20, 10, 3, 1.4); t.rivet_row_v(x - 10, 20, 0, 3, 1.4)
    for y in (140, 330, 470): t.groove_h(y, 1.2, 0.9)
    t.rect(0, 0, 1023, 70, (30, 30, 34)); t.groove_h(70, 1.8, 1.4)
    t.text(100, 180, 'PAYLOAD', 56, (30, 30, 34)); t.text(100, 250, 'FAIRING', 56, (30, 30, 34)); t.text(620, 190, 'FAIRING SEP', 18, (190, 35, 35)); t.hazard(620, 220, 820, 246, 12)
    for i in range(10): t.d.ellipse([650 + i * 14, 400, 658 + i * 14, 408], fill=(200, 200, 205, 255), outline=(60, 62, 68, 255), width=1)
    t.rect(220, 400, 420, 412, (30, 30, 34)); t.text(220, 416, 'ACOUSTIC BLANKET', 11, (60, 62, 68))
    return t.finish(P('fairing.png'))

def avionics_ring():
    t = Tex(1024, 512, (0.20, 0.21, 0.24), 77)
    t.rgb *= (1 + 0.06 * pnoise(0, 0, 6, 200, 77))[:, :, None]
    for x in range(0, 1024, 128): t.groove_v(x, 1.4, 1.0)
    for y in (0, 60, 452): t.groove_h(y, 1.6, 1.2)
    t.rect(0, 0, 1023, 52, (150, 152, 158)); t.rect(0, 460, 1023, 511, (150, 152, 158)); t.rivet_row_h(26, 24, 12, 4, 2); t.rivet_row_h(486, 24, 12, 4, 2)
    t.text(60, 130, 'AVIONICS  RING', 44, (235, 235, 235), 230); t.text(60, 200, 'GNC  /  FLIGHT COMPUTER  x3', 20, (235, 190, 40), 220)
    for i, c in enumerate([(70, 220, 90), (240, 190, 40), (70, 220, 90), (70, 220, 90), (220, 60, 50)]):
        t.d.ellipse([60 + i * 30, 270, 78 + i * 30, 288], fill=c + (255,), outline=(10, 10, 12, 255), width=1)
    for x in (480, 640, 800):
        t.rect(x, 250, x + 90, 320, (30, 30, 34)); t.d.rectangle([x, 250, x + 90, 320], outline=(190, 192, 198, 255), width=3)
        for k in range(8): t.rect(x + 10 + k * 9, 262, x + 14 + k * 9, 308, (200, 170, 60))
    t.hazard(60, 360, 300, 386, 12); t.metal = 1
    return t.finish(P('avionics_ring.png'), 0.35)

def insignia(name, fn):
    global CUR
    class _K: K = 2.0
    CUR = _K; S = 256; im = Image.new('RGBA', (S * 2, S * 2), (0, 0, 0, 0)); d = SD(ImageDraw.Draw(im), 2.0); fn(d, S)
    im.save(P(name), optimize=True); print('wrote', name, flush=True)

def ins_star(d, S):
    d.ellipse([8, 8, S - 8, S - 8], fill=(20, 40, 110, 255), outline=(240, 240, 240, 255), width=8)
    pts = []
    for i in range(10):
        r = 100 if i % 2 == 0 else 40; a = -math.pi / 2 + i * math.pi / 5
        pts.append((S / 2 + r * math.cos(a), S / 2 + r * math.sin(a)))
    d.polygon(pts, fill=(245, 245, 245, 255))
def ins_chevron(d, S):
    d.rectangle([8, 8, S - 8, S - 8], fill=(190, 35, 40, 255), outline=(250, 250, 250, 255), width=8)
    for k in range(3):
        y = 60 + k * 50; d.line([(40, y + 40), (S / 2, y - 10), (S - 40, y + 40)], fill=(250, 250, 250, 255), width=18, joint='curve')
def ins_patch(d, S):
    d.ellipse([6, 6, S - 6, S - 6], fill=(15, 20, 40, 255), outline=(235, 190, 40, 255), width=10)
    d.ellipse([70, 70, S - 70, S - 70], fill=(40, 120, 200, 255)); d.ellipse([100, 70, S - 40, S - 100], fill=(15, 20, 40, 255))
    d.text((S / 2, S - 36), 'ROCKET WORKSHOP', font=font(16), fill=(235, 190, 40, 255), anchor='mm')
    for (x, y) in ((50, 60), (200, 80), (180, 190), (60, 170)): d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 255, 255, 255))
def ins_checker(d, S):
    n = 8; c = S // n
    for i in range(n):
        for j in range(n): d.rectangle([i * c, j * c, (i + 1) * c, (j + 1) * c], fill=(240, 240, 240, 255) if (i + j) % 2 == 0 else (20, 20, 22, 255))
    d.rectangle([0, 0, S - 1, S - 1], outline=(200, 200, 200, 255), width=3)


def make_lod():
    for f in sorted(os.listdir(OUT)):
        if not f.endswith('.png'): continue
        im = Image.open(os.path.join(OUT, f)); w, h = im.size
        if f.startswith('insignia'): im.save(os.path.join(LOD, f), optimize=True); continue
        tw = 1024 if w > h else 512; sc = tw / w
        if sc < 1: im = im.resize((tw, int(round(h * sc))), Image.LANCZOS)
        im.save(os.path.join(LOD, f), optimize=True)
    print('LOD done')

ALL = [nose_cone, rocket_body, rocket_body_panels, fuel_tank, liquid_engine, engine_nozzle, solid_rocket_booster, rocket_fins,
       structural_connector, decoupler, landing_legs, heat_shield, parachute, battery, control_module, rcs_thruster,
       solar_panels, docking_port, adapter, carbon_fibre, insulation_foil, hazard_stripes,
       stainless_steel, raptor_cluster, grid_fin, flap_tiles, interstage, capsule, fairing, avionics_ring]

if __name__ == '__main__':
    only = set(sys.argv[1:])
    for f in ALL:
        if only and f.__name__ not in only: continue
        CURK = 2.0 if f.__name__ in HERO else 1.5
        f()
    if not only or 'insignia' in only:
        insignia('insignia_star.png', ins_star); insignia('insignia_chevron.png', ins_chevron)
        insignia('insignia_patch.png', ins_patch); insignia('insignia_checker.png', ins_checker)
    make_lod()
