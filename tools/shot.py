"""Serve a folder on a free local port and take a screenshot of one page with headless Chrome.

    python3 -I -B tools/shot.py <site folder> <path and hash, e.g. "docs/index.html"> <out.png> [width] [height] [dark]

Used to look at the site at a phone size (390 x 844 by default) or a Mac window size without opening a browser
window. Add the word dark as the last argument to render with the dark colour scheme.

Headless Chrome on a Mac will not make a window narrower than 500 px, so a narrower width is shown inside a
frame of exactly that width (the page's own media queries then see the phone width) and the picture is cropped
to the frame. Standard library only; Chrome runs headless with a throwaway profile folder, so the everyday
Chrome is not touched.
"""
import functools
import html
import http.server
import os
import socketserver
import subprocess
import sys
import tempfile
import threading
import urllib.parse

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
MIN_WINDOW = 500
FRAME_PATH = "/__frame"


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path != FRAME_PATH:
            return super().do_GET()
        q = urllib.parse.parse_qs(parsed.query)
        src, w, h = q["src"][0], int(q["w"][0]), int(q["h"][0])
        body = ('<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">'
                '<style>html,body{margin:0;padding:0;background:#fff}iframe{display:block;border:0;margin:0 auto;width:%dpx;height:%dpx}</style>'
                '</head><body><iframe src="%s"></iframe></body></html>' % (w, h, html.escape(src, quote=True))).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    root, page, out = sys.argv[1], sys.argv[2], os.path.abspath(sys.argv[3])
    rest = sys.argv[4:]
    dark = "dark" in rest
    nums = [a for a in rest if a.isdigit()]
    width = int(nums[0]) if len(nums) > 0 else 390
    height = int(nums[1]) if len(nums) > 1 else 844
    framed = width < MIN_WINDOW
    handler = functools.partial(Handler, directory=root)
    socketserver.TCPServer.allow_reuse_address = True
    # Chrome asks for a page's twenty or so files at once. The usual queue of 5 waiting connections overflows on
    # a busy computer and the page is pictured without some of its scripts (the same fault tools/run_tests.py had).
    socketserver.TCPServer.request_queue_size = 128
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler) as srv:
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = "http://127.0.0.1:%d/" % port
        if framed:
            url = base + FRAME_PATH.lstrip("/") + "?" + urllib.parse.urlencode({"src": "/" + page.lstrip("/"), "w": width, "h": height})
        else:
            url = base + page.lstrip("/")
        with tempfile.TemporaryDirectory(prefix="taper-shot-chrome-") as profile:
            cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                   "--hide-scrollbars", "--user-data-dir=" + profile, "--virtual-time-budget=8000",
                   "--window-size=%d,%d" % (max(width, MIN_WINDOW), height), "--screenshot=" + out]
            if dark:
                cmd.append("--force-dark-mode")
            cmd.append(url)
            p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        srv.shutdown()
    if not os.path.exists(out):
        sys.exit("Chrome did not write the screenshot (exit %s): %s" % (p.returncode, p.stderr.decode("utf-8", "replace")[-500:]))
    if framed:
        # the frame sits in the middle of the window and sips crops around the middle, so this keeps just the frame
        c = subprocess.run(["/usr/bin/sips", "--cropToHeightWidth", str(height), str(width), out],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        if c.returncode != 0:
            print("crop failed, the picture is %d px wide with the page in its left %d px: %s"
                  % (MIN_WINDOW, width, c.stderr.decode("utf-8", "replace")[-200:]))
    print("%s  (%d x %d%s%s)" % (out, width, height, ", dark" if dark else "", ", framed" if framed else ""))


if __name__ == "__main__":
    main()
