"""Draw the Taper app icon (four white columns stepping down on a blue gradient, with a soft shadow, so it sits
among App Store icons) and save it at the sizes the site uses.

    python3 -B tools/make_icons.py

Needs Pillow, which lives in the user's site packages, so run it without -I.

Writes docs/icons/icon-512.png, icon-192.png, icon-180.png and icon-maskable-512.png. The columns sit inside the
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
BAR = (255, 255, 255, 255)
HEIGHTS = [0.50, 0.38, 0.26, 0.14]   # share of the canvas, tallest first


def ground():
    img = Image.new("RGB", (BIG, BIG))
    d = ImageDraw.Draw(img)
    for y in range(BIG):
        t = y / (BIG - 1)
        d.line([(0, y), (BIG, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    return img.convert("RGBA")


def columns(fill):
    layer = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    left, right = BIG * 0.22, BIG * 0.78
    base = BIG * 0.74
    gap = BIG * 0.04
    w = (right - left - gap * (len(HEIGHTS) - 1)) / len(HEIGHTS)
    r = w * 0.28
    for i, h in enumerate(HEIGHTS):
        x0 = left + i * (w + gap)
        top = base - BIG * h
        # each step down a little fainter, as it tapers off
        alpha = round(fill[3] * (1 - 0.1 * i))
        d.rounded_rectangle([x0, top, x0 + w, base], radius=r, fill=fill[:3] + (alpha,))
    return layer


def draw():
    img = ground()
    shadow = columns((0, 30, 90, 110)).filter(ImageFilter.GaussianBlur(BIG * 0.02))
    img.alpha_composite(shadow, (0, round(BIG * 0.018)))
    img.alpha_composite(columns(BAR))
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
