"""產生 PWA 圖示（PNG）。設計和 public/icon.svg 相同，只是改用 Pillow 畫，不必另外裝 SVG 轉檔工具。

為什麼需要 PNG：
- Android Chrome 判斷「可安裝」要 192 與 512 的 PNG 圖示；只有 SVG 不算。
- iPhone 的「加入主畫面」不吃 SVG，要 180×180 的 apple-touch-icon。
- maskable 版：Android 會把圖示裁成圓形／圓角方形，重要內容必須落在中央 80% 的安全區，
  而且底色要鋪滿（不能有透明角）。

用法（需要 Pillow）：
    python scripts/make_icons.py
輸出到 public/icons/。圖示已經放進 git，平常不必重跑；改了設計才需要。
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
SS = 4  # 超取樣倍率：先畫 4 倍大再縮小，邊緣才平滑

BG = (0x0F, 0x17, 0x20)
RING_OUTER = (0x3B, 0x82, 0xC4, round(255 * 0.45))
RING_INNER = (0xE8, 0xA3, 0x3D, round(255 * 0.80))
TRACE = (0xF4, 0xF6, 0xF8, 255)
# 以 512 為基準的座標（同 icon.svg）
TRACE_POINTS = [(70, 270), (170, 270), (205, 190), (245, 340), (285, 215), (315, 290), (340, 270), (442, 270)]


def render(size, content_scale=1.0, rounded=True):
    """size：輸出邊長；content_scale：內容以中心縮放（maskable 要縮小）；rounded：底色是否為圓角（透明角）。"""
    n = size * SS
    k = n / 512.0

    def pt(x, y):
        return ((x - 256) * content_scale + 256) * k, ((y - 256) * content_scale + 256) * k

    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    bg = ImageDraw.Draw(img)
    if rounded:
        bg.rounded_rectangle([0, 0, n - 1, n - 1], radius=112 * k, fill=BG + (255,))
    else:
        bg.rectangle([0, 0, n, n], fill=BG + (255,))

    def ring(radius, width, color):
        layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        r_out = (radius + width / 2) * content_scale * k  # SVG 的線寬以半徑為中心，Pillow 往內畫
        cx = cy = 256 * k
        ImageDraw.Draw(layer).ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out],
                                      outline=color, width=max(1, round(width * content_scale * k)))
        return layer

    img = Image.alpha_composite(img, ring(150, 22, RING_OUTER))
    img = Image.alpha_composite(img, ring(92, 22, RING_INNER))

    d = ImageDraw.Draw(img)
    w = 26 * content_scale * k
    pts = [pt(x, y) for x, y in TRACE_POINTS]
    d.line(pts, fill=TRACE, width=round(w), joint="curve")
    for x, y in pts:  # 圓頭與圓角接點
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=TRACE)

    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [
        ("icon-32.png", 32, 1.0, True),
        ("icon-192.png", 192, 1.0, True),
        ("icon-512.png", 512, 1.0, True),
        ("maskable-192.png", 192, 0.82, False),
        ("maskable-512.png", 512, 0.82, False),
        ("apple-touch-icon.png", 180, 0.94, False),
    ]
    for name, size, scale, rounded in jobs:
        img = render(size, scale, rounded)
        if not rounded:
            img = img.convert("RGB")  # 鋪滿底色的版本不需要透明度；iOS 遇到透明會補黑
        img.save(OUT / name, optimize=True)
        print(f"{name}: {size}x{size}, {(OUT / name).stat().st_size} bytes")


if __name__ == "__main__":
    main()
