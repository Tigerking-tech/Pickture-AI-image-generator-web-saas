#!/usr/bin/env python3
"""
make-samples.py — 生成 Surepix Demo 样本商品图（PIL 程序化绘制）

输出（public/samples/）：
  serum.png    + serum.json     — 精华液瓶（深绿瓶身 + 品牌 LOGO + 价格标签）
  phones.png   + phones.json    — 头戴耳机（深灰耳罩 + 品牌 LOGO + 价格标签）
  coffee.png   + coffee.json    — 咖啡袋（牛皮纸袋 + 品牌 LOGO + 价格标签）

manifest 元素 bbox 是保真校验的真值（fidelity.ts 按元素逐块校验）。
"""
import json
import hashlib
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1200, 900
OUT = "public/samples"

import os
os.makedirs(OUT, exist_ok=True)


def font(size, bold=False):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def vgrad(draw, box, c1, c2, steps=200):
    """垂直渐变填充矩形"""
    x1, y1, x2, y2 = box
    for i in range(steps):
        t = i / (steps - 1)
        c = tuple(int(c1[k] + (c2[k] - c1[k]) * t) for k in range(3))
        yy1 = y1 + (y2 - y1) * i // steps
        yy2 = y1 + (y2 - y1) * (i + 1) // steps
        draw.rectangle([x1, yy1, x2, max(yy2, yy1 + 1)], fill=c)


def text_block(draw, xy, text, f, fill, anchor="la"):
    draw.text(xy, text, font=f, fill=fill, anchor=anchor)


def sha_region(img, bbox):
    x1, y1, x2, y2 = bbox
    return hashlib.sha256(img.crop((x1, y1, x2, y2)).tobytes()).hexdigest()[:16]


def build(name, brand, bg1, bg2, body_color, body_hi, accent, price, draw_product):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    vgrad(d, (0, 0, W, H), bg1, bg2)

    # 柔光
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W // 2 - 320, 180, W // 2 + 320, 820], fill=(60, 60, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    img = Image.blend(img, Image.composite(glow, img, glow.convert("L").point(lambda v: 40)), 0.35)
    d = ImageDraw.Draw(img)

    elements = {}

    # 左上品牌 LOGO（红底白字）
    logo_bbox = (60, 55, 420, 125)
    d.rounded_rectangle(logo_bbox, radius=14, fill=(196, 45, 48))
    text_block(d, (78, 90), brand, font(46, bold=True), (255, 255, 255), anchor="lm")
    elements["brand_logo"] = {"bbox": list(logo_bbox)}

    # 商品主体
    body_bbox = draw_product(d, elements)

    # 瓶身/袋身小字
    if body_bbox:
        x1, y1, x2, y2 = body_bbox
        small_y = y2 - 60
        d.text(((x1 + x2) // 2, small_y), "NET 30ml / 1.0 fl oz", font=font(22), fill=(235, 235, 235), anchor="mm")
        elements["text_small"] = {"bbox": [x1, small_y - 18, x2, small_y + 18]}

    # 右下价格标签
    tag_bbox = (W - 300, H - 150, W - 60, H - 60)
    d.rounded_rectangle(tag_bbox, radius=12, fill=(24, 24, 28), outline=accent, width=3)
    text_block(d, ((tag_bbox[0] + tag_bbox[2]) // 2, (tag_bbox[1] + tag_bbox[3]) // 2 - 14), price, font(40, bold=True), accent, anchor="mm")
    text_block(d, ((tag_bbox[0] + tag_bbox[2]) // 2, tag_bbox[3] - 30), "FREE EU SHIPPING", font(16), (200, 200, 200), anchor="mm")
    elements["price_tag"] = {"bbox": list(tag_bbox)}

    # hash 真值
    for k, v in elements.items():
        v["hash"] = sha_region(img, tuple(v["bbox"]))

    png_path = f"{OUT}/{name}.png"
    json_path = f"{OUT}/{name}.json"
    img.save(png_path)
    with open(json_path, "w") as f:
        json.dump({"width": W, "height": H, "elements": elements}, f, indent=2)
    print(f"saved {png_path} + {json_path} ({len(elements)} elements)")


def draw_serum(d, elements):
    x1, y1, x2, y2 = 480, 260, 720, 760
    # 瓶身
    d.rounded_rectangle([x1, y1, x2, y2], radius=28, fill=(28, 52, 44))
    d.rounded_rectangle([x1 + 10, y1 + 10, x1 + 60, y2 - 10], radius=20, fill=(46, 82, 68))  # 高光
    # 瓶颈与泵头
    d.rectangle([x1 + 70, y1 - 40, x2 - 70, y1 + 6], fill=(20, 38, 32))
    d.rounded_rectangle([x1 + 95, y1 - 110, x2 - 95, y1 - 40], radius=10, fill=(158, 138, 96))
    d.rectangle([x1 + 40, y1 - 128, x2 - 40, y1 - 108], fill=(158, 138, 96))
    elements["product_body"] = {"bbox": [x1, y1, x2, y2]}
    # 瓶身标签
    lx1, ly1, lx2, ly2 = x1 + 40, y1 + 190, x2 - 40, y1 + 380
    d.rounded_rectangle([lx1, ly1, lx2, ly2], radius=10, fill=(240, 238, 230))
    text_block(d, ((lx1 + lx2) // 2, ly1 + 46), "LUMINA", font(38, bold=True), (28, 52, 44), anchor="mm")
    text_block(d, ((lx1 + lx2) // 2, ly1 + 92), "VITAMIN C SERUM", font(20), (90, 100, 95), anchor="mm")
    elements["product_label"] = {"bbox": [lx1, ly1, lx2, ly2]}
    # 瓶身圆形 LOGO
    cx, cy, r = (x1 + x2) // 2, y1 + 130, 34
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(196, 45, 48), width=5)
    text_block(d, (cx, cy), "L", font(30, bold=True), (196, 45, 48), anchor="mm")
    elements["product_logo"] = {"bbox": [cx - r, cy - r, cx + r, cy + r]}
    return (x1, y1, x2, y2)


def draw_headphones(d, elements):
    # 头梁
    d.arc([400, 200, 800, 560], start=180, end=360, fill=(40, 42, 48), width=44)
    # 耳罩
    for cx in (430, 770):
        d.rounded_rectangle([cx - 85, 420, cx + 85, 700], radius=42, fill=(34, 36, 42))
        d.rounded_rectangle([cx - 85, 420, cx + 85, 700], radius=42, outline=(90, 94, 104), width=3)
        d.ellipse([cx - 52, 480, cx + 52, 584], fill=(22, 24, 28))
        d.ellipse([cx - 52, 480, cx + 52, 584], outline=(120, 124, 134), width=3)
        d.ellipse([cx - 20, 510, cx + 20, 550], fill=(196, 45, 48))
    elements["product_body"] = {"bbox": [345, 200, 855, 700]}
    # 品牌字（左耳罩）
    text_block(d, (430, 640), "AURASOUND", font(24, bold=True), (220, 222, 228), anchor="mm")
    elements["product_label"] = {"bbox": [355, 618, 505, 662]}
    # 右耳罩圆形 LOGO
    cx, cy, r = 770, 640, 30
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(196, 45, 48), width=5)
    text_block(d, (cx, cy), "A", font(26, bold=True), (196, 45, 48), anchor="mm")
    elements["product_logo"] = {"bbox": [cx - r, cy - r, cx + r, cy + r]}
    return (345, 200, 855, 700)


def draw_coffee(d, elements):
    x1, y1, x2, y2 = 470, 240, 730, 780
    # 袋身（牛皮纸）
    d.rounded_rectangle([x1, y1, x2, y2], radius=18, fill=(150, 112, 74))
    d.polygon([(x1, y1 + 30), (x1 + 40, y1), (x2 - 40, y1), (x2, y1 + 30)], fill=(168, 128, 88))  # 顶褶
    d.rectangle([x1 + 20, y1 + 14, x2 - 20, y1 + 26], fill=(120, 88, 58))
    elements["product_body"] = {"bbox": [x1, y1, x2, y2]}
    # 标签
    lx1, ly1, lx2, ly2 = x1 + 45, y1 + 170, x2 - 45, y1 + 400
    d.rounded_rectangle([lx1, ly1, lx2, ly2], radius=10, fill=(246, 242, 234))
    text_block(d, ((lx1 + lx2) // 2, ly1 + 50), "NORDIC", font(36, bold=True), (94, 66, 44), anchor="mm")
    text_block(d, ((lx1 + lx2) // 2, ly1 + 96), "DARK ROAST", font(20), (120, 96, 70), anchor="mm")
    d.line([lx1 + 30, ly1 + 128, lx2 - 30, ly1 + 128], fill=(180, 150, 120), width=3)
    elements["product_label"] = {"bbox": [lx1, ly1, lx2, ly2]}
    # 袋身圆形 LOGO
    cx, cy, r = (x1 + x2) // 2, y1 + 90, 32
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(94, 66, 44), width=5)
    text_block(d, (cx, cy), "N", font(28, bold=True), (94, 66, 44), anchor="mm")
    elements["product_logo"] = {"bbox": [cx - r, cy - r, cx + r, cy + r]}
    return (x1, y1, x2, y2)


build("serum", "SUREPIX", (238, 240, 242), (206, 210, 216), (28, 52, 44), (46, 82, 68), (196, 45, 48), "$34.90", draw_serum)
build("phones", "SUREPIX", (232, 234, 238), (198, 202, 210), (34, 36, 42), (60, 63, 72), (196, 45, 48), "$129.00", draw_headphones)
build("coffee", "SUREPIX", (240, 236, 230), (210, 200, 188), (150, 112, 74), (170, 132, 92), (94, 66, 44), "$12.50", draw_coffee)
