#!/usr/bin/env python3
"""同步桌布：python3 add_wallpapers.py [圖片資料夾]（預設 ~/Desktop/桌布）
原檔複製到 web/wallpapers/img/，縮圖放 t/，清單寫進 list.json。新增圖片後再跑一次即可。
"""
import json, shutil, sys
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).parent
SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "~/Desktop/桌布").expanduser()
OUT = ROOT / "web" / "wallpapers"
EXT = {".jpg", ".jpeg", ".png", ".webp"}

files = sorted(p for p in SRC.iterdir() if p.suffix.lower() in EXT and not p.name.startswith("."))
if not files:
    sys.exit(f"{SRC} 裡沒有圖片")
for d in ("img", "t"):
    shutil.rmtree(OUT / d, ignore_errors=True)
    (OUT / d).mkdir(parents=True)

items = []
for n, p in enumerate(files, 1):
    name = f"w-{n:02d}"
    ext = p.suffix.lower()
    shutil.copy(p, OUT / "img" / f"{name}{ext}")
    with Image.open(p) as im:
        im = ImageOps.exif_transpose(im)
        w, h = im.size
        th = im.convert("RGB")
        th.thumbnail((720, 720))
        th.save(OUT / "t" / f"{name}.jpg", quality=82)
    items.append({"src": f"img/{name}{ext}", "thumb": f"t/{name}.jpg", "w": w, "h": h, "name": p.stem})

(OUT / "list.json").write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", "utf-8")
print(f"已同步 {len(items)} 張桌布 → {OUT}")
