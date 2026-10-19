#!/usr/bin/env python3
"""Static dev server for public/ with the cross-origin isolation headers
Play! needs (SharedArrayBuffer for pthreads), plus the user's own game dumps
from ./games streamed at /games/<name> with HTTP Range support and listed at
/games/index.json.

Usage: python3 serve.py [port] [--host HOST]"""
import argparse
import http.server
import ipaddress
import json
import os
import re
from functools import partial
from pathlib import Path
from urllib.parse import unquote, urlsplit

BASE = Path(__file__).resolve().parent
GAMES_DIR = BASE / "games"
GAME_EXTENSIONS = {".iso", ".cso", ".chd", ".isz", ".bin", ".elf"}
BIOS_DIR = BASE / "bios"  # the developer's own console BIOS dump (gitignored), for the boot intro


def parse_range(header, size):
    """'bytes=a-b' | 'bytes=a-' | 'bytes=-n' -> (start, end) inclusive, or None
    when malformed/unsatisfiable. Multiple ranges are not supported (None)."""
    m = re.fullmatch(r"\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*", header)
    if not m or (m[1] == "" and m[2] == "") or size == 0:
        return None
    if m[1] == "":  # suffix range: last n bytes
        n = int(m[2])
        return (max(0, size - n), size - 1) if n > 0 else None
    start = int(m[1])
    end = min(int(m[2]), size - 1) if m[2] else size - 1
    return (start, end) if start <= end and start < size else None


def game_path(name):
    """Plain file name inside GAMES_DIR, or None (blocks traversal, dotfiles, subdirs)."""
    if not name or "/" in name or "\\" in name or "\0" in name or name.startswith("."):
        return None
    p = (GAMES_DIR / name).resolve()
    if p.parent != GAMES_DIR.resolve() or not p.is_file():
        return None
    return p


def host_allowed(host, bind_host):
    """DNS rebinding guard: the Host header must be localhost, an IP literal or the --host name
    (a rebinding page always sends its own domain name)."""
    m = re.fullmatch(r"\[([0-9a-fA-F:.]+)\](?::\d+)?|([^:\[\]]+)(?::\d+)?", (host or "").strip())
    if not m:
        return False
    name = (m[1] or m[2]).lower().rstrip(".")
    if name in ("localhost", bind_host.lower().strip("[]")):
        return True
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        return False


class Handler(http.server.SimpleHTTPRequestHandler):
    bind_host = "127.0.0.1"

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".wasm": "application/wasm", ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.host_check() and self.bios_route(head=False) is None and self.games_route(head=False) is None:
            super().do_GET()

    def do_HEAD(self):
        if self.host_check() and self.bios_route(head=True) is None and self.games_route(head=True) is None:
            super().do_HEAD()

    # /bios/dev.bin: the first bios/*.bin, only to this machine (a BIOS is never served to others).
    def bios_route(self, head):
        if urlsplit(self.path).path != "/bios/dev.bin":
            return None
        bins = sorted(BIOS_DIR.glob("*.bin")) if BIOS_DIR.is_dir() else []
        if not bins or not ipaddress.ip_address(self.client_address[0]).is_loopback:
            self.send_error(404, "Not found")
            return True
        return self.send_game(bins[0], head)

    def host_check(self):
        if host_allowed(self.headers.get("Host"), self.bind_host):
            return True
        self.send_error(403, "Host not allowed")
        return False

    # Returns None when the request is not under /games/ (static files handle it).
    def games_route(self, head):
        path = urlsplit(self.path).path
        if path != "/games" and not path.startswith("/games/"):
            return None
        name = unquote(path[len("/games/"):])
        if name == "index.json":
            return self.send_index(head)
        p = game_path(name)
        if p is None or p.suffix.lower() not in GAME_EXTENSIONS:
            self.send_error(404, "Not found")
            return True
        return self.send_game(p, head)

    def send_index(self, head):
        items = []
        if GAMES_DIR.is_dir():
            for e in sorted(os.scandir(GAMES_DIR), key=lambda e: e.name.lower()):
                if e.is_file() and not e.name.startswith(".") and Path(e.name).suffix.lower() in GAME_EXTENSIONS:
                    st = e.stat()
                    items.append({"name": e.name, "size": st.st_size, "mtime": int(st.st_mtime)})
        body = json.dumps(items).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)
        return True

    def send_game(self, p, head):
        size = p.stat().st_size
        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng is not None:
            r = parse_range(rng, size)
            if r is None:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return True
            (start, end), status = r, 206
        length = max(0, end - start + 1)
        self.send_response(status)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if head:
            return True
        try:
            with open(p, "rb") as f:  # kernel sendfile: streams without loading the file
                self.wfile.flush()
                self.connection.sendfile(f, offset=start, count=length)
        except (BrokenPipeError, ConnectionResetError):
            pass  # client aborted (e.g. tab closed mid-read)
        return True


def selftest():
    assert parse_range("bytes=0-99", 1000) == (0, 99)
    assert parse_range("bytes=990-", 1000) == (990, 999)
    assert parse_range("bytes=-10", 1000) == (990, 999)
    assert parse_range("bytes=-5000", 1000) == (0, 999)
    assert parse_range("bytes=500-5000", 1000) == (500, 999)
    assert parse_range("bytes=1000-", 1000) is None
    assert parse_range("bytes=5-1", 1000) is None
    assert parse_range("bytes=-0", 1000) is None
    assert parse_range("bytes=0-1,5-6", 1000) is None
    assert parse_range("items=0-1", 1000) is None
    for h in ("localhost:8080", "127.0.0.1:8080", "[::1]:8080", "localhost", "192.168.0.5:8080", "pc.lan:80"):
        assert host_allowed(h, "pc.lan"), h
    for h in ("evil.example:8080", "evil.example", "", None, "localhost.evil.example", "[::1"):
        assert not host_allowed(h, "127.0.0.1"), h
    assert game_path("../serve.py") is None and game_path(".hidden") is None and game_path("a/b") is None


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("port", nargs="?", type=int, default=8080)
    ap.add_argument("--host", default="127.0.0.1", help="interface to bind (default 127.0.0.1, this machine only)")
    ap.add_argument("--selftest", action="store_true", help="run the range/path checks and exit")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        print("selftest OK")
        raise SystemExit
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"AVISO: servindo em {args.host} — qualquer aparelho dessa rede pode acessar o site e os jogos em games/. "
              "Use só na sua rede doméstica, nunca em rede pública. "
              "(SharedArrayBuffer exige contexto seguro: em outro aparelho, só funciona via HTTPS ou localhost.)")
    Handler.bind_host = args.host
    GAMES_DIR.mkdir(exist_ok=True)
    print(f"http://localhost:{args.port}/  (jogos em {GAMES_DIR})")
    http.server.ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=BASE / "public")).serve_forever()
