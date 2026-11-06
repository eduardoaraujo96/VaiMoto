#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageDraw

GREEN = (23, 107, 77, 255)
LIME = (201, 243, 106, 255)
WHITE = (255, 255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)

ROOT = Path(__file__).resolve().parent
LOGO_PATH = ROOT / "logo.png"

ANDROID_RES = [
    Path("/workspace/android/customer/app/src/main/res"),
    Path("/workspace/android/driver/app/src/main/res"),
    Path("/workspace/driver-app/android/app/src/main/res"),
]

SPLASH_PORT = {
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
}
SPLASH_LAND = {
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
}
LAUNCHER = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
FOREGROUND = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}


def draw_mark(size, padding_ratio=0.0):
    img = Image.new("RGBA", (size, size), TRANSPARENT)
    draw = ImageDraw.Draw(img)
    pad = int(size * padding_ratio)
    inner = max(size - 2 * pad, 1)
    radius = max(int(inner * 0.22), 1)
    box = [pad, pad, size - pad - 1, size - pad - 1]
    draw.rounded_rectangle(box, radius=radius, fill=GREEN)

    l, t, r, b = box
    w = r - l
    h = b - t
    v = [
        (l + w * 0.22, t + h * 0.26),
        (l + w * 0.40, t + h * 0.26),
        (l + w * 0.50, t + h * 0.62),
        (l + w * 0.60, t + h * 0.26),
        (l + w * 0.78, t + h * 0.26),
        (l + w * 0.58, t + h * 0.78),
        (l + w * 0.42, t + h * 0.78),
    ]
    draw.polygon(v, fill=LIME)
    return img


def fit_logo(logo, canvas_size, occupancy):
    canvas = Image.new("RGBA", (canvas_size, canvas_size), TRANSPARENT)
    target = max(int(canvas_size * occupancy), 1)
    scaled = logo.resize((target, target), Image.Resampling.LANCZOS)
    x = (canvas_size - target) // 2
    canvas.paste(scaled, (x, x), scaled)
    return canvas


def circle_mask(size):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    return mask


def make_splash(logo, width, height):
    canvas = Image.new("RGBA", (width, height), WHITE)
    logo_size = max(int(min(width, height) * 0.34), 1)
    scaled = logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    x = (width - logo_size) // 2
    y = (height - logo_size) // 2
    canvas.paste(scaled, (x, y), scaled)
    return canvas.convert("RGB")


def make_legacy_icon(logo, size):
    canvas = Image.new("RGBA", (size, size), WHITE)
    mark = fit_logo(logo, size, 0.84)
    canvas.paste(mark, (0, 0), mark)
    return canvas.convert("RGB")


def make_round_icon(logo, size):
    square = Image.new("RGBA", (size, size), WHITE)
    mark = fit_logo(logo, size, 0.78)
    square.paste(mark, (0, 0), mark)
    out = Image.new("RGBA", (size, size), TRANSPARENT)
    out.paste(square, (0, 0))
    out.putalpha(circle_mask(size))
    return out


def save_png(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)


def main():
    logo = draw_mark(1024)
    save_png(logo, LOGO_PATH)

    splash_icon = fit_logo(logo, 1024, 0.62)

    for res in ANDROID_RES:
        save_png(make_splash(logo, 480, 320), res / "drawable" / "splash.png")
        save_png(splash_icon.convert("RGB"), res / "drawable" / "splash_icon.png")
        for folder, size in SPLASH_PORT.items():
            save_png(make_splash(logo, *size), res / folder / "splash.png")
        for folder, size in SPLASH_LAND.items():
            save_png(make_splash(logo, *size), res / folder / "splash.png")
        for folder, size in LAUNCHER.items():
            save_png(make_legacy_icon(logo, size), res / folder / "ic_launcher.png")
            save_png(make_round_icon(logo, size), res / folder / "ic_launcher_round.png")
        for folder, size in FOREGROUND.items():
            save_png(fit_logo(logo, size, 0.56), res / folder / "ic_launcher_foreground.png")


if __name__ == "__main__":
    main()
