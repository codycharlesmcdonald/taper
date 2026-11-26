"""Draw the Taper app icon (four cigarettes, each shorter than the last, burning down on a blue gradient, with a
soft shadow, so it sits among App Store icons) and save it at the sizes the site uses.

    python3 -B tools/make_icons.py

Needs Pillow, which lives in the user's site packages, so run it without -I.

Writes docs/icons/icon-512.png, icon-192.png, icon-180.png and icon-maskable-512.png. The cigarettes sit inside the
middle 60 percent, so the same picture survives any mask (iOS rounds the corners itself; Android may cut a
circle). Drawn at 2048 px and scaled down, so the edges are smooth.
"""
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs", "icons")
BIG = 2048
TOP = (64, 150, 245)        # lighter blue at the top
BOTTOM = (20, 80, 170)      # the app's blue, deeper, at the bottom
PAPER = (255, 255, 255, 255)
FILTER = (220, 154, 82, 255)
BAND = (184, 115, 50, 255)
EMBER = (242, 85, 31, 255)
GLOW = (255, 170, 60, 255)
ASH = (170, 170, 178, 255)
HEIGHTS = [0.54, 0.43, 0.32, 0.21]   # share of the canvas, tallest first
FILTER_H = 0.12


def ground():
    img = Image.new("RGB", (BIG, BIG))
    d = ImageDraw.Draw(img)
    for y in range(BIG):
        t = y / (BIG - 1)
        d.line([(0, y), (BIG, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    return img.convert("RGBA")


def slots():
    left, right = BIG * 0.21, BIG * 0.79
    base = BIG * 0.77
    gap = BIG * 0.055
    w = (right - left - gap * (len(HEIGHTS) - 1)) / len(HEIGHTS)
    for i, h in enumerate(HEIGHTS):
        x0 = left + i * (w + gap)
        yield x0, base - BIG * h, x0 + w, base, w


def shadow():
    layer = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x0, top, x1, base, w in slots():
        d.rounded_rectangle([x0, top, x1, base], radius=w * 0.16, fill=(0, 30, 90, 120))
    return layer.filter(ImageFilter.GaussianBlur(BIG * 0.02))


def cigarettes():
    layer = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x0, top, x1, base, w in slots():
        r = w * 0.16
        ash = BIG * 0.03
        ember = BIG * 0.045
        fh = BIG * FILTER_H
        d.rounded_rectangle([x0, top, x1, base], radius=r, fill=PAPER)                      # paper
        d.rounded_rectangle([x0, base - fh, x1, base], radius=r, fill=FILTER)               # filter
        d.rectangle([x0, base - fh, x1, base - fh + r], fill=FILTER)
        d.rectangle([x0, base - fh, x1, base - fh + BIG * 0.008], fill=BAND)                # tipping edge
        for k in range(3):                                                                  # cork speckle
            sx = x0 + w * (0.25 + 0.25 * k)
            sy = base - fh * (0.35 + 0.2 * (k % 2))
            d.ellipse([sx - w * 0.05, sy - w * 0.05, sx + w * 0.05, sy + w * 0.05], fill=BAND)
        d.rectangle([x0, top + ash, x1, top + ash + ember], fill=EMBER)                     # lit tip
        d.rectangle([x0, top + ash + ember * 0.55, x1, top + ash + ember], fill=GLOW)
        d.rounded_rectangle([x0, top, x1, top + ash + r], radius=r, fill=ASH)               # ash
        d.rectangle([x0, top + ash, x1, top + ash + r * 0.01], fill=EMBER)
    return layer


def draw():
    img = ground()
    img.alpha_composite(shadow(), (0, round(BIG * 0.018)))
    img.alpha_composite(cigarettes())
    return img.convert("RGB")


def main():
    os.makedirs(OUT, exist_ok=True)
    img = draw()
    for name, size in (("icon-512", 512), ("icon-192", 192), ("icon-180", 180), ("icon-maskable-512", 512)):
        path = os.path.join(OUT, name + ".png")
        img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        print(path)


if __name__ == "__main__":
    main()
