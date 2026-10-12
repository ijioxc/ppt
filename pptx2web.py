#!/usr/bin/env python3
"""把有動畫的 PPTX 轉成網頁簡報：python3 pptx2web.py 簡報.pptx 資料夾名稱 "標題"
輸出到 web/<資料夾名稱>/（deck.json、media/、index.html），由 web/player.js 播放。
支援：轉化（Morph）、淡出、擦去轉場；路徑與旋轉動畫；圖片、文字、線條、群組、3D 模型。
"""
import colorsys, json, re, shutil, subprocess, sys, tempfile, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).parent
NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "am3d": "http://schemas.microsoft.com/office/drawing/2017/model3d",
    "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main",
    "p159": "http://schemas.microsoft.com/office/powerpoint/2015/09/main",
}
REMBED = "{%s}embed" % NS["r"]
EMU = 914400 / 96  # 1 px = 9525 EMU
M3D = 36000000     # 3D 模型的長度單位：36,000,000 = 1 公尺

def px(v): return round(int(v) / EMU, 2)
def tag(el): return el.tag.split("}")[1]
def find(el, path): return el.find(path, NS) if el is not None else None


class Deck:
    def __init__(self, pptx, out):
        self.z = zipfile.ZipFile(pptx)
        self.out = out
        self.media = {}
        theme = ET.fromstring(self.z.read("ppt/theme/theme1.xml"))
        self.scheme = {}
        for c in find(theme, ".//a:clrScheme"):
            v = c[0]
            self.scheme[tag(c)] = v.get("lastClr") or v.get("val")
        master = ET.fromstring(self.z.read("ppt/slideMasters/slideMaster1.xml"))
        cmap = find(master, "p:clrMap").attrib
        for k in ("bg1", "tx1", "bg2", "tx2"):
            self.scheme[k] = self.scheme[cmap[k]]
        self.lnw = [int(l.get("w", 9525)) / 12700 for l in theme.findall(".//a:lnStyleLst/a:ln", NS)] or [0.5, 1, 1.5]
        self.fonts = {k: (find(theme, f".//a:{k}Font/a:latin").get("typeface")) for k in ("major", "minor")}
        self.bg = self.color(find(master, "p:cSld/p:bg/p:bgPr/a:solidFill")) or "rgb(255,255,255)"
        pres = ET.fromstring(self.z.read("ppt/presentation.xml"))
        rel = {r.get("Id"): r.get("Target") for r in ET.fromstring(self.z.read("ppt/_rels/presentation.xml.rels"))}
        self.slides = [rel[s.get("{%s}id" % NS["r"])] for s in pres.findall(".//p:sldId", NS)]
        sz = find(pres, "p:sldSz")
        self.size = [px(sz.get("cx")), px(sz.get("cy"))]

    # ---- 顏色
    def color(self, el):
        """solidFill / lnRef / fontRef 之類含顏色子節點的元素 → css rgba()"""
        if el is None: return None
        c = find(el, "a:srgbClr")
        if c is not None: hexv = c.get("val")
        else:
            c = find(el, "a:schemeClr")
            if c is None: c = find(el, "a:sysClr")
            if c is None: return None
            hexv = self.scheme.get(c.get("val"), c.get("lastClr") or "000000")
        r, g, b = (int(hexv[i:i + 2], 16) / 255 for i in (0, 2, 4))
        alpha = 1
        for m in c:
            v = int(m.get("val", 100000)) / 100000
            t = tag(m)
            if t in ("lumMod", "lumOff"):
                h, l, s = colorsys.rgb_to_hls(r, g, b)
                l = min(1, l * v) if t == "lumMod" else min(1, l + v)
                r, g, b = colorsys.hls_to_rgb(h, l, s)
            elif t == "shade": r, g, b = r * v, g * v, b * v
            elif t == "tint": r, g, b = (x + (1 - x) * (1 - v) for x in (r, g, b))
            elif t == "alpha": alpha = v
        return "rgba(%d,%d,%d,%s)" % (round(r * 255), round(g * 255), round(b * 255), round(alpha, 3))

    # ---- 媒體
    def asset(self, target):
        name = Path(target).name
        if name in self.media: return self.media[name]
        data = self.z.read("ppt/media/" + name)
        dest = name
        (self.out / "media").mkdir(parents=True, exist_ok=True)
        if name.lower().endswith(".emf"):
            # Mac 版 PowerPoint 貼上的圖是包著 PDF 的 EMF：把 PDF 拿出來轉成 PNG
            i = data.find(b"%PDF")
            if i < 0:
                print("  略過無法轉換的 EMF：", name); self.media[name] = None; return None
            dest = Path(name).stem + ".png"
            with tempfile.TemporaryDirectory() as tmp:
                pdf = Path(tmp) / "x.pdf"; pdf.write_bytes(data[i:])
                subprocess.run(["pdftoppm", "-png", "-singlefile", "-scale-to", "2400", str(pdf), str(self.out / "media" / Path(dest).stem)], check=True)
        else:
            (self.out / "media" / dest).write_bytes(data)
        self.media[name] = "media/" + dest
        return self.media[name]

    # ---- 幾何
    def xfrm(self, x):
        d = {}
        if x is None: return d
        o, e = find(x, "a:off"), find(x, "a:ext")
        if o is not None: d.update(x=px(o.get("x")), y=px(o.get("y")))
        if e is not None: d.update(w=px(e.get("cx")), h=px(e.get("cy")))
        d["rot"] = round(int(x.get("rot", 0)) / 60000, 2)
        d["fh"], d["fv"] = x.get("flipH") == "1", x.get("flipV") == "1"
        co, ce = find(x, "a:chOff"), find(x, "a:chExt")
        if co is not None: d["ch"] = [px(co.get("x")), px(co.get("y")), px(ce.get("cx")), px(ce.get("cy"))]
        return d

    def line_style(self, sp, style):
        ln = find(sp, "a:ln")
        if ln is not None and find(ln, "a:noFill") is not None: return None
        ref = find(style, "a:lnRef")
        col = self.color(find(ln, "a:solidFill")) if ln is not None else None
        if col is None and ref is not None and ref.get("idx") != "0": col = self.color(ref)
        if col is None: return None
        w = int(ln.get("w")) / 12700 if ln is not None and ln.get("w") else self.lnw[min(int(ref.get("idx", 1)), len(self.lnw)) - 1] if ref is not None else 0.75
        ends = [(find(ln, "a:" + k).get("type") if ln is not None and find(ln, "a:" + k) is not None else "none") for k in ("headEnd", "tailEnd")]
        return {"w": round(w * 96 / 72, 2), "c": col, "head": ends[0] != "none", "tail": ends[1] != "none"}

    def fill(self, sp, style):
        if sp is None: return None
        if find(sp, "a:noFill") is not None: return None
        s = find(sp, "a:solidFill")
        if s is not None: return self.color(s)
        g = find(sp, "a:gradFill")
        if g is not None:
            stops = sorted(((int(gs.get("pos")) / 1000, self.color(gs)) for gs in g.findall("a:gsLst/a:gs", NS)), key=lambda t: t[0])
            lin = find(g, "a:lin")
            ang = int(lin.get("ang", 0)) / 60000 if lin is not None else 90
            return "linear-gradient(%sdeg,%s)" % (round(ang + 90, 1), ",".join("%s %s%%" % (c, p) for p, c in stops))
        ref = find(style, "a:fillRef")
        if ref is not None and ref.get("idx") != "0": return self.color(ref)
        return None

    # ---- 文字
    def text(self, el, style):
        tx = find(el, "p:txBody")
        if tx is None: return None
        base = self.color(find(style, "a:fontRef")) or self.scheme_css("tx1")
        paras, has = [], False
        for p in tx.findall("a:p", NS):
            ppr = find(p, "a:pPr")
            lh = find(ppr, "a:lnSpc/a:spcPct")
            end = find(p, "a:endParaRPr")
            runs = []
            for r in p:
                if tag(r) == "br": runs.append({"br": 1}); continue
                if tag(r) != "r": continue
                rp, d = find(r, "a:rPr"), {"t": find(r, "a:t").text or ""}
                if rp is not None:
                    if rp.get("sz"): d["sz"] = int(rp.get("sz")) / 100
                    if rp.get("b") == "1": d["b"] = 1
                    if rp.get("i") == "1": d["i"] = 1
                    c = self.color(find(rp, "a:solidFill"))
                    if c: d["c"] = c
                    fam = [find(rp, "a:" + f).get("typeface") for f in ("latin", "ea") if find(rp, "a:" + f) is not None]
                    if fam: d["f"] = [self.fonts["minor"] if f.startswith("+mn") else self.fonts["major"] if f.startswith("+mj") else f for f in fam]
                    if rp.get("spc"): d["spc"] = int(rp.get("spc")) / 100
                has = has or bool(d["t"].strip())
                runs.append(d)
            paras.append({
                "algn": ppr.get("algn") if ppr is not None else None,
                "lh": int(lh.get("val")) / 100000 if lh is not None else None,
                "sz": int(end.get("sz")) / 100 if end is not None and end.get("sz") else None,
                "runs": runs,
            })
        if not has: return None
        bp = find(tx, "a:bodyPr")
        fit = find(bp, "a:normAutofit")
        ins = [px(bp.get(k, d)) for k, d in (("lIns", 91440), ("tIns", 45720), ("rIns", 91440), ("bIns", 45720))]
        return {"p": paras, "c": base, "wrap": bp.get("wrap", "square") != "none", "anchor": bp.get("anchor", "t"), "ins": ins,
                "scale": int(fit.get("fontScale", 100000)) / 100000 if fit is not None else 1, "font": self.fonts["minor"]}

    def scheme_css(self, k):
        h = self.scheme[k]
        return "rgba(%d,%d,%d,1)" % tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

    # ---- 形狀
    def shape(self, el, R):
        t = tag(el)
        if t == "AlternateContent":
            ch = find(el, "mc:Choice")
            inner = ch[0] if ch is not None and len(ch) else None
            return self.shape(inner, R) if inner is not None else None
        nv = find(el, ".//p:cNvPr")
        if nv is None: return None
        d = {"id": nv.get("id"), "name": nv.get("name")}
        if t == "grpSp":
            d.update(kind="group", **self.xfrm(find(el, "p:grpSpPr/a:xfrm")))
            d["children"] = [c for c in (self.shape(c, R) for c in el if tag(c) in ("sp", "pic", "grpSp", "cxnSp", "AlternateContent", "graphicFrame")) if c]
            return d
        if t == "graphicFrame":
            m = find(el, ".//am3d:model3d")
            if m is None: return None
            d.update(kind="model", **self.xfrm(find(el, "p:xfrm")))
            tr, cam = find(m, "am3d:trans"), find(m, "am3d:camera")
            v3 = lambda e, keys: [int(e.get(k, 0)) for k in keys] if e is not None else [0, 0, 0]
            rot = find(tr, "am3d:rot")
            ras = find(m, "am3d:raster/am3d:blip")
            mpu = find(tr, "am3d:meterPerModelUnit")
            if mpu is None: return None  # 空的 3D 物件（無縮放資訊）
            d.update(
                glb=self.asset(R[m.get(REMBED)]),
                raster=self.asset(R[ras.get(REMBED)]) if ras is not None and ras.get(REMBED) in R else None,
                unit=int(mpu.get("n")) / int(mpu.get("d")),
                pre=[v / M3D for v in v3(find(tr, "am3d:preTrans"), ("dx", "dy", "dz"))],
                post=[v / M3D for v in v3(find(tr, "am3d:postTrans"), ("dx", "dy", "dz"))],
                euler=[v / 60000 for v in v3(rot, ("ax", "ay", "az"))],
                cam=[v / M3D for v in v3(find(cam, "am3d:pos"), ("x", "y", "z"))],
                fov=int(find(cam, "am3d:perspective").get("fov")) / 60000 if find(cam, "am3d:perspective") is not None else 45,
                view=px(find(m, "am3d:objViewport").get("viewportSz")),
            )
            return d
        sp, style = find(el, "p:spPr"), find(el, "p:style")
        d.update(self.xfrm(find(sp, "a:xfrm")))
        geom = find(sp, "a:prstGeom")
        prst = geom.get("prst") if geom is not None else None
        ln = self.line_style(sp, style)
        if t == "cxnSp" or prst in ("line", "straightConnector1"):
            if ln is None: return None
            x1, y1, x2, y2 = d["x"], d["y"], d["x"] + d["w"], d["y"] + d["h"]
            if d["fh"]: x1, x2 = x2, x1
            if d["fv"]: y1, y2 = y2, y1
            d.update(kind="line", p=[x1, y1, x2, y2], ln=ln)
            return d
        if t == "pic":
            blip = find(el, ".//a:blip")
            src = self.asset(R[blip.get(REMBED)])
            if not src: return None
            sr = find(el, ".//a:srcRect")
            d.update(kind="pic", img=src)
            if sr is not None: d["crop"] = [int(sr.get(k, 0)) / 100000 for k in "ltrb"]
            return d
        d.update(kind="shape", fill=self.fill(sp, style), ln=ln, text=self.text(el, style))
        cg = find(sp, "a:custGeom/a:pathLst/a:path")
        if cg is not None:
            cmds = []
            for c in cg:
                pts = " ".join("%s %s" % (p.get("x"), p.get("y")) for p in c.findall("a:pt", NS))
                cmds.append({"moveTo": "M", "lnTo": "L", "cubicBezTo": "C", "quadBezTo": "Q", "close": "Z"}.get(tag(c), "") + pts)
            d["path"] = {"d": " ".join(cmds), "w": int(cg.get("w")), "h": int(cg.get("h")), "fill": cg.get("fill") != "none"}
        elif prst == "roundRect": d["radius"] = 0.1667
        elif prst == "ellipse": d["radius"] = 0.5
        if not d["fill"] and not d["ln"] and not d["text"] and "path" not in d: return None
        return d

    # ---- 動畫
    def timing(self, root):
        seq = find(root, "p:timing//p:cTn[@nodeType='mainSeq']/p:childTnLst")
        steps = []
        if seq is None: return steps
        for par in seq:
            ctn = find(par, "p:cTn")
            auto = any(c.get("evt") == "onBegin" for c in ctn.findall("p:stCondLst/p:cond", NS))
            anims = []
            def walk(node, t0, ease):
                c = find(node, "p:cTn")
                if c is None: c = find(node, "p:cBhvr/p:cTn")
                delay = 0
                if c is not None:
                    for cond in c.findall("p:stCondLst/p:cond", NS):
                        if (cond.get("delay") or "").isdigit() and cond.get("evt") is None: delay = int(cond.get("delay"))
                    if c.get("presetClass"): ease = bool(c.get("accel") or c.get("decel"))
                t = t0 + delay
                k = tag(node)
                if k in ("animMotion", "animRot"):
                    a = {"id": find(node, "p:cBhvr/p:tgtEl/p:spTgt").get("spid"), "t": t, "dur": int(c.get("dur", 1000)), "ease": ease}
                    if k == "animMotion":
                        n = [float(v) for v in re.findall(r"-?\d+\.?\d*(?:[eE]-?\d+)?", node.get("path"))]
                        a.update(type="move", frm=[n[0] * self.size[0], n[1] * self.size[1]], to=[n[-2] * self.size[0], n[-1] * self.size[1]])
                    else:
                        a.update(type="rot", by=int(node.get("by", 0)) / 60000)
                    anims.append(a)
                    return
                for sub in (find(c, "p:childTnLst") if c is not None and find(c, "p:childTnLst") is not None else []):
                    walk(sub, t, ease)
            walk(par, 0, False)
            if anims: steps.append({"auto": auto, "anims": anims})
        return steps

    def transition(self, raw):
        m = re.search(r"<p:transition[^>]*>", raw)
        if not m: return {"type": "none", "dur": 0}
        dur = re.search(r'p14:dur="(\d+)"', m[0])
        spd = {"slow": 1000, "med": 750, "fast": 500}.get((re.search(r'spd="(\w+)"', m[0]) or [0, "fast"])[1], 500)
        kind = "morph" if "<p159:morph" in raw else "wipe" if "<p:wipe" in raw else "fade" if "<p:fade" in raw else "none"
        d = {"type": kind, "dur": int(dur[1]) if dur else spd}
        if kind == "wipe": d["dir"] = (re.search(r'<p:wipe[^>]*dir="(\w)"', raw) or [0, "l"])[1]
        return d

    def build(self, title):
        slides = []
        for target in self.slides:
            raw = self.z.read("ppt/" + target).decode("utf8")
            root = ET.fromstring(raw)
            try: R = {r.get("Id"): r.get("Target") for r in ET.fromstring(self.z.read("ppt/slides/_rels/%s.rels" % Path(target).name))}
            except KeyError: R = {}
            bg = self.color(find(root, "p:cSld/p:bg/p:bgPr/a:solidFill"))
            tree = find(root, "p:cSld/p:spTree")
            shapes = [s for s in (self.shape(c, R) for c in tree if tag(c) in ("sp", "pic", "grpSp", "cxnSp", "AlternateContent", "graphicFrame")) if s]
            slides.append({"bg": bg or self.bg, "trans": self.transition(raw), "steps": self.timing(root), "shapes": shapes})
            print("  第 %d 頁：%d 個物件，轉場 %s" % (len(slides), len(shapes), slides[-1]["trans"]["type"]))
        return {"title": title, "size": self.size, "slides": slides}


INDEX = """<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Carlito:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../player.css?v=%s">
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
</head>
<body>
<script type="module" src="../player.js?v=%s"></script>
</body>
</html>
"""

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(__doc__)
    out = ROOT / "web" / sys.argv[2]
    if (out / "media").exists(): shutil.rmtree(out / "media")
    out.mkdir(parents=True, exist_ok=True)
    title = sys.argv[3] if len(sys.argv) > 3 else Path(sys.argv[1]).stem
    deck = Deck(sys.argv[1], out).build(title)
    (out / "deck.json").write_text(json.dumps(deck, ensure_ascii=False), "utf-8")
    v = int(max((ROOT / "web" / f).stat().st_mtime for f in ("player.js", "player.css")))  # 播放器改版時避開瀏覽器快取
    (out / "index.html").write_text(INDEX % (title, v, v), "utf-8")
    print("完成：web/%s/（%d 頁）" % (sys.argv[2], len(deck["slides"])))
