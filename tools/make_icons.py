"""Draw the Taper app icon (four columns stepping down on a blue ground) and save it at the sizes the site uses.

    python3 -B tools/make_icons.py

Needs Pillow, which lives in the user's site packages, so run it without -I.

Writes docs/icons/icon-512.png, icon-192.png and icon-180.png. The columns sit inside the middle 70 percent so
the same picture works as a maskable icon. Drawn at 2048 px and scaled down, so the edges are smooth.
"""
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs", "icons")
BIG = 2048
GROUND = (28, 92, 171)      # #1c5cab, blue ramp step 550
BAR = (255, 255, 255)
HEIGHTS = [0.62, 0.47, 0.32, 0.17]   # share of the canvas, tallest first


def draw():
    img = Image.new("RGB", (BIG, BIG), GROUND)
    d = ImageDraw.Draw(img)
    left, right = BIG * 0.2, BIG * 0.8
    base = BIG * 0.76
    gap = BIG * 0.045
    w = (right - left - gap * (len(HEIGHTS) - 1)) / len(HEIGHTS)
    r = w * 0.18
    for i, h in enumerate(HEIGHTS):
        x0 = left + i * (w + gap)
        top = base - BIG * h
        d.rounded_rectangle([x0, top, x0 + w, base], radius=r, fill=BAR)
        d.rectangle([x0, base - r, x0 + w, base], fill=BAR)   # square at the baseline
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    img = draw()
    for size in (512, 192, 180):
        path = os.path.join(OUT, "icon-%d.png" % size)
        img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        print(path)


if __name__ == "__main__":
    main()
