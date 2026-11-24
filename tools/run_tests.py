"""Serve a folder on a free local port, open one test page in headless Chrome, wait until the page says it has
finished, then print the text of its #out element.

    python3 -I -B run_tests.py <site folder> [page path, default tests/index.html] [seconds to wait, default 120]

A test page says it has finished by setting its title to PASSED, FAILED or NOT RUN. This tool waits for that
mark itself, on the real clock: two minutes at most, or the number of seconds given as the third argument. A
small watcher script is added to the test page as it is served, and it tells this server the moment the title
changes, or the moment the page throws an error that nothing caught (so a broken test page fails at once and is
not waited for). Nothing is read off the page after a guessed amount of time.

About once a second the watcher also sends what the page has written so far. When the time runs out, or Chrome
stops before the page has finished, that is printed first, so the last line shows how far the page had got.

The server also answers __files, at the top of the folder, with the list of every file in it, so a test can
read them all. The watcher is asked for by a relative address, like everything else a page of the site loads.

Exit 0 when the title ends up PASSED, 1 otherwise. Standard library only; Chrome runs headless with a
throwaway profile folder, so the everyday Chrome is not touched.
"""
import http.server
import json
import os
import socketserver
import subprocess
import sys
import tempfile
import threading
import urllib.parse

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DONE_TITLES = ("PASSED", "FAILED", "NOT RUN")
WATCH_PATH = "/__watch.js"
REPORT_PATH = "/__report"
FILES_PATH = "/__files"
DOWNLOADS = "downloads-from-tests"

# Runs in the test page, ahead of the page's own scripts.
WATCH_JS = """(function () {
  var DONE = %s, sent = false, timer = null, last = null, told = 0;
  // reports go to the folder this script came from, so no address here starts at the server's root
  var here = document.currentScript ? document.currentScript.src : "";
  var REPORT = here.slice(0, here.lastIndexOf("/") + 1) + "%s";
  function post(kind, note) {
    var out = document.getElementById("out");
    var x = new XMLHttpRequest();
    x.open("POST", REPORT);
    x.setRequestHeader("Content-Type", "application/json");
    x.send(JSON.stringify({ kind: kind, title: document.title, out: out ? out.textContent : null, note: note || "" }));
  }
  function report(kind, note) {
    if (sent) return;
    sent = true;
    if (timer) clearInterval(timer);
    post(kind, note);
  }
  function look() {
    if (DONE.indexOf(document.title) >= 0) return report("finished");
    // about once a second, what the page has written so far, so a run that never finishes can say where it stopped
    var out = document.getElementById("out"), text = out ? out.textContent : null, now = Date.now();
    if (text && text !== last && now - told >= 1000) { last = text; told = now; post("progress"); }
  }
  window.addEventListener("error", function (e) {
    var from = e.target && e.target !== window ? (e.target.src || e.target.href || e.target.tagName) : "";
    report("threw", e.message ? e.message + " (" + (e.filename || "").split("/").pop() + ":" + e.lineno + ")" : "could not load " + from);
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    report("threw", String(e.reason && e.reason.stack ? e.reason.stack : e.reason));
  });
  timer = setInterval(look, 20);
})();
""" % (json.dumps(list(DONE_TITLES)), REPORT_PATH.lstrip("/"))


def watcher_tag(page_path):
    """The script tag put into the page under test. Its address is relative to the page, so a page two folders
    down asks for ../../__watch.js and nothing in a served page starts at the server's root."""
    return '<script src="%s%s"></script>' % ("../" * page_path.count("/"), WATCH_PATH.lstrip("/"))


def with_watcher(text, page_path):
    """The page's HTML with the watcher put in ahead of the page's own scripts."""
    tag = watcher_tag(page_path)
    at = text.lower().find("<head>")
    return text[:at + 6] + tag + text[at + 6:] if at >= 0 else tag + text


def outcome(report, progress, wait, chrome_said):
    """What to print and the exit code, from what the page reported. report is the page's last word (finished,
    or stopped on an error), None when it never came. progress is the latest of what the page had written while
    it ran, None when there was none."""
    lines = []
    if not report:
        if progress and progress.get("out"):
            lines.append(progress["out"])
            lines.append("That is how far the page had got. The last line above is the last thing it finished.")
        lines.append("The page did not say it had finished within %d seconds (its title never became PASSED, FAILED or NOT RUN). Chrome said: %s"
                     % (wait, chrome_said))
        lines.append("title: None")
        return lines, 1
    lines.append(report.get("out") if report.get("out") is not None else "no #out element in the page")
    if report.get("kind") == "threw":
        lines.append("The page stopped on an error that nothing caught: %s" % report.get("note"))
    title = str(report.get("title", "")).strip()
    lines.append("title: " + title)
    return lines, 0 if report.get("kind") == "finished" and title == "PASSED" else 1


class Server(socketserver.ThreadingTCPServer):
    # Chrome asks for the twenty or so files of a page at once, each on a connection of its own. The usual
    # queue of 5 waiting connections overflows when the computer is busy, the ones that do not fit are dropped,
    # and the page under test loads without some of its scripts. That was the cause of the test runs that
    # failed now and then.
    request_queue_size = 128
    allow_reuse_address = True
    daemon_threads = True


def make_handler(root, page_path, state):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=root, **kwargs)

        def log_message(self, *args):
            pass

        def send_bytes(self, body, kind, status=200):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
            if path == WATCH_PATH:
                return self.send_bytes(WATCH_JS.encode("utf-8"), "application/javascript; charset=utf-8")
            if path == FILES_PATH:
                names = []
                for folder, _dirs, files in os.walk(root):
                    for name in files:
                        names.append(os.path.relpath(os.path.join(folder, name), root).replace(os.sep, "/"))
                return self.send_bytes(json.dumps(sorted(names)).encode("utf-8"), "application/json; charset=utf-8")
            if path == "/" + page_path:
                # the page under test, with the watcher put in ahead of its own scripts
                with open(os.path.join(root, page_path), "rb") as f:
                    text = f.read().decode("utf-8")
                return self.send_bytes(with_watcher(text, page_path).encode("utf-8"), "text/html; charset=utf-8")
            return super().do_GET()

        def do_POST(self):
            if urllib.parse.urlsplit(self.path).path != REPORT_PATH:
                return self.send_error(404)
            try:
                report = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8"))
            except ValueError:
                return self.send_error(400)
            if isinstance(report, dict) and not state["done"].is_set():
                if report.get("kind") == "progress":
                    state["progress"] = report  # how far the page has got; the wait goes on
                else:
                    state["report"] = report
                    state["done"].set()
            self.send_bytes(b"", "text/plain", 204)

    return Handler


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    root = os.path.abspath(sys.argv[1])
    page = (sys.argv[2] if len(sys.argv) > 2 else "tests/index.html").lstrip("/")
    wait = float(sys.argv[3]) if len(sys.argv) > 3 else 120.0
    page_path = urllib.parse.urlsplit(page).path
    if not os.path.isfile(os.path.join(root, page_path)):
        sys.exit("There is no page %s in %s" % (page_path, root))
    state = {"done": threading.Event(), "report": None, "progress": None}
    with Server(("127.0.0.1", 0), make_handler(root, page_path, state)) as srv:
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        with tempfile.TemporaryDirectory(prefix="taper-tests-chrome-", ignore_cleanup_errors=True) as profile, \
                tempfile.TemporaryFile() as said:
            # A page under test may hand over a file (a backup or a CSV). Headless Chrome saves such
            # a file like any Chrome does, and by default that is this computer's real Downloads folder. The
            # throwaway profile is told to save inside itself instead, so a test run leaves nothing behind.
            os.makedirs(os.path.join(profile, "Default"))
            with open(os.path.join(profile, "Default", "Preferences"), "w", encoding="utf-8") as prefs:
                json.dump({"download": {"default_directory": os.path.join(profile, DOWNLOADS), "prompt_for_download": False}}, prefs)
            cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                   "--user-data-dir=" + profile, "http://127.0.0.1:%d/%s" % (port, page)]
            chrome = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=said)
            try:
                # Chrome stays open until it is told to stop; the wait ends when the page reports, when Chrome
                # stops by itself, or when the time allowed runs out.
                waited = 0.0
                while not state["done"].wait(0.2) and chrome.poll() is None and waited < wait:
                    waited += 0.2
            finally:
                chrome.terminate()
                try:
                    chrome.wait(10)
                except subprocess.TimeoutExpired:
                    chrome.kill()
                    chrome.wait(10)
            said.seek(0)
            # what Chrome wrote, without the line it repeats on every Mac that has no screen attached to it
            chrome_said = "\n".join(line for line in said.read().decode("utf-8", "replace").splitlines()
                                    if line.strip() and "CVDisplayLink" not in line)[-600:]
        srv.shutdown()

    lines, code = outcome(state["report"], state["progress"], wait, chrome_said)
    print("\n".join(lines))
    sys.exit(code)


if __name__ == "__main__":
    main()
