#!/usr/bin/env python3
"""Local static server with COOP/COEP + /sf → unpkg proxy (multi-thread Stockfish)."""
from __future__ import annotations

import argparse
import hashlib
import http.server
import os
import socketserver
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
SF_UPSTREAM = "https://unpkg.com/stockfish@18.0.0/src"
SF_CACHE = os.path.join(ROOT, ".sf-cache")
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp3": "audio/mpeg",
    ".woff2": "font/woff2",
}


def _sf_cache_path(rel: str) -> str:
    # Flat cache keyed by path hash — avoids nested dirs / path tricks
    h = hashlib.sha256(rel.encode()).hexdigest()[:40]
    ext = os.path.splitext(rel)[1].lower() or ".bin"
    return os.path.join(SF_CACHE, h + ext)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        if self.path.startswith("/sf/"):
            self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/sf/"):
            return self._proxy_sf()
        return super().do_GET()

    def do_HEAD(self):
        if self.path.startswith("/sf/"):
            return self._proxy_sf(head=True)
        return super().do_HEAD()

    def _proxy_sf(self, head=False):
        rel = self.path[len("/sf/") :].split("?", 1)[0].split("#", 1)[0]
        if not rel or ".." in rel or rel.startswith("/"):
            self.send_error(400, "bad path")
            return
        ctype = MIME.get(os.path.splitext(rel)[1].lower(), "application/octet-stream")
        cache_path = _sf_cache_path(rel)

        if os.path.isfile(cache_path):
            size = os.path.getsize(cache_path)
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(size))
            self.end_headers()
            if not head:
                with open(cache_path, "rb") as f:
                    self.wfile.write(f.read())
            return

        url = f"{SF_UPSTREAM}/{rel}"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=120) as res:
                data = res.read()
                ctype = res.headers.get("Content-Type") or ctype
            try:
                os.makedirs(SF_CACHE, exist_ok=True)
                tmp = cache_path + ".tmp"
                with open(tmp, "wb") as f:
                    f.write(data)
                os.replace(tmp, cache_path)
            except OSError:
                pass
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if not head:
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_error(e.code, e.reason)
        except Exception as e:
            self.send_error(502, str(e))

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("-p", "--port", type=int, default=8000)
    args = p.parse_args()
    socketserver.TCPServer.allow_reuse_address = True
    os.makedirs(SF_CACHE, exist_ok=True)
    with socketserver.TCPServer(("", args.port), Handler) as httpd:
        print(f"Serving {ROOT} on http://localhost:{args.port}")
        print("COOP/COEP on → SharedArrayBuffer / multi-thread Stockfish OK")
        print(f"Stockfish proxy cache → {SF_CACHE}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
