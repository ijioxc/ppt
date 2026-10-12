#!/usr/bin/env python3
"""本機管理伺服器：python3 admin.py
開 http://localhost:8765 ，頂列會多一個「編輯」，可以上傳簡報、改標題與群組、刪除、發佈。
只聽 127.0.0.1；GitHub Pages 上的線上版沒有這支程式，所以是唯讀的。
刪除的檔案會移到 .trash/，不會真的刪掉。
"""
import json, os, re, shutil, subprocess, sys, tempfile, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

import add_deck

ROOT = Path(__file__).parent
TRASH = ROOT / ".trash"
FILES = {"deck": ROOT / "decks.json", "site": ROOT / "sites.json"}
GROUPS = ROOT / "groups.json"  # 群組名單與順序；空的群組也記在這裡
MAX_UPLOAD = 500 * 1024 * 1024
ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")

def load(kind): return json.loads(FILES[kind].read_text("utf-8")) if FILES[kind].exists() else []
def save(kind, d): FILES[kind].write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", "utf-8")
def text(v): return str(v or "").strip()[:120]
def groups(): return json.loads(GROUPS.read_text("utf-8")) if GROUPS.exists() else []
def save_groups(g): GROUPS.write_text(json.dumps(list(dict.fromkeys(g)), ensure_ascii=False, indent=2) + "\n", "utf-8")
def remember(name):
    if name and name not in groups(): save_groups(groups() + [name])

def find(kind, item_id):
    if kind not in FILES or not ID.match(item_id or ""):
        raise ValueError("參數不對")
    items = load(kind)
    for it in items:
        if it["id"] == item_id:
            return items, it
    raise ValueError("找不到這一筆")

def trash(path):
    if path.exists():
        TRASH.mkdir(exist_ok=True)
        shutil.move(str(path), str(TRASH / f"{time.strftime('%Y%m%d-%H%M%S')}-{path.name}"))

def update(b):
    items, it = find(b.get("kind"), b.get("id"))
    if "title" in b:
        if not text(b["title"]): raise ValueError("標題不能留空")
        it["title"] = text(b["title"])
    if "group" in b:  # 空字串＝放回未分類
        if text(b["group"]): it["group"] = text(b["group"]); remember(it["group"])
        else: it.pop("group", None)
    if "cover" in b and b["kind"] == "deck":  # 封面頁（從 0 起算），null＝自動
        c = b["cover"]
        if c is None: it.pop("cover", None)
        elif isinstance(c, int) and 0 <= c < len(it["slides"]): it["cover"] = c
        else: raise ValueError("沒有這一頁")
    save(b["kind"], items)

def delete(b):
    items, it = find(b.get("kind"), b.get("id"))
    trash(ROOT / "decks" / it["id"] if b["kind"] == "deck" else ROOT / "sites" / Path(it.get("shot", "-")).name)
    save(b["kind"], [x for x in items if x is not it])

def regroup(old, new):
    for kind in FILES:
        items = load(kind)
        for it in items:
            if it.get("group") == old:
                if new: it["group"] = new
                else: it.pop("group", None)
        save(kind, items)

def group_add(b):
    name = text(b.get("name"))
    if not name or name == "未分類": raise ValueError("請換一個名稱")
    remember(name)

def group_rename(b):
    old, new = text(b.get("from")), text(b.get("to"))
    if not old or not new or new == "未分類": raise ValueError("請換一個名稱")
    regroup(old, new)
    save_groups([new if g == old else g for g in groups()] + [new])

def group_order(b):
    names = [text(n) for n in b.get("names", []) if text(n)]
    save_groups(names + [g for g in groups() if g not in names])  # 沒列到的排在後面，不會弄丟

def group_delete(b):
    name = text(b.get("name"))
    regroup(name, None)  # 裡面的作品回到未分類，不刪檔
    save_groups([g for g in groups() if g != name])

def publish(_):
    def git(*a): return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True)
    git("add", "-A")
    out = [git("commit", "-m", "更新簡報庫")]
    out.append(git("push"))
    log = "\n".join((r.stdout + r.stderr).strip() for r in out)
    if out[-1].returncode: raise ValueError("推送失敗：\n" + log)
    return {"log": log}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
    def end_headers(self):
        # 本機編輯時一律重新驗證，改了檔案馬上看得到
        if "Cache-Control" not in self._headers_buffer_text(): self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def _headers_buffer_text(self): return b"".join(getattr(self, "_headers_buffer", [])).decode("latin-1")

    def reply(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/ping": return self.reply({"ok": True})
        if "/." in path: return self.send_error(404)
        super().do_GET()

    def do_POST(self):
        # 自訂標頭＋本機 Host：別的網站沒辦法替你送出這些請求
        host = (self.headers.get("Host") or "").split(":")[0]
        if self.headers.get("X-Admin") != "1" or host not in ("localhost", "127.0.0.1"):
            return self.reply({"error": "拒絕"}, 403)
        url = urlsplit(self.path)
        qs = {k: v[0] for k, v in parse_qs(url.query).items()}
        size = int(self.headers.get("Content-Length") or 0)
        if size > MAX_UPLOAD: return self.reply({"error": "檔案太大"}, 413)
        try:
            if url.path == "/api/upload": return self.reply(self.upload(qs, size))
            if url.path == "/api/pptx": return self.reply(self.pptx(qs, size))
            actions = {"/api/update": update, "/api/delete": delete, "/api/group-add": group_add, "/api/group-rename": group_rename, "/api/group-delete": group_delete, "/api/group-order": group_order, "/api/publish": publish}
            if url.path not in actions: return self.reply({"error": "沒有這個功能"}, 404)
            body = json.loads(self.rfile.read(size) or b"{}")
            self.reply(actions[url.path](body) or {"ok": True})
        except (ValueError, KeyError, SystemExit, subprocess.CalledProcessError) as e:
            self.reply({"error": str(e) or "失敗"}, 400)

    def receive(self, size, dest):
        with open(dest, "wb") as f:
            while size > 0:
                chunk = self.rfile.read(min(size, 1 << 20))
                if not chunk: break
                f.write(chunk); size -= len(chunk)

    def upload(self, qs, size):
        title, group = text(qs.get("title")), text(qs.get("group")) or None
        if not title or not size: raise ValueError("缺少標題或檔案")
        stem = re.sub(r"[^a-z0-9]+", "-", Path(qs.get("name", "")).stem.lower()).strip("-") or "deck"
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / f"{stem}.pdf"
            self.receive(size, pdf)
            deck_id = add_deck.add(pdf, title, group=group, unique=True)
        remember(group)
        return {"id": deck_id}

    def pptx(self, qs, size):
        items, it = find("deck", qs.get("id"))
        ext = Path(qs.get("name", "")).suffix.lower()
        if ext not in (".pptx", ".ppt") or not size: raise ValueError("只收 .pptx 或 .ppt")
        self.receive(size, ROOT / "decks" / it["id"] / f"original{ext}")
        it["pptx"] = f"original{ext}"
        save("deck", items)
        return {"ok": True}

if __name__ == "__main__":
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8765))
    print(f"簡報庫管理：http://localhost:{port}  （Ctrl+C 結束）")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
