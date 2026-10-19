#!/bin/sh
# Serves Quanta on http://localhost:<port>/ and opens it in a Chromium-based browser (app window)
# or your default browser. The Linux / macOS counterpart of Start-Quanta.cmd + serve.ps1.
# Only dependency: python3 (preinstalled on virtually every Linux distribution and on macOS).
# Only files inside this folder are served, only to this machine (127.0.0.1).
#
# Usage: ./start-quanta.sh [--port N] [--no-browser]
#   --port N       first port to try (default 8477); the next 20 ports are tried if it is busy
#   --no-browser   do not open a browser window; just serve

if ! command -v python3 >/dev/null 2>&1; then
  echo "Quanta needs python3 to run its tiny local web server." >&2
  echo "Install it with your package manager, e.g.  sudo apt install python3" >&2
  exit 1
fi

ROOT=$(cd "$(dirname "$0")" && pwd)
export QUANTA_ROOT="$ROOT"

exec python3 - "$@" <<'PY'
import functools, http.server, os, platform, shutil, subprocess, sys

root = os.environ["QUANTA_ROOT"]
port, open_browser = 8477, True
args = sys.argv[1:]
while args:
    a = args.pop(0)
    if a == "--port" and args:
        port = int(args.pop(0))
    elif a == "--no-browser":
        open_browser = False
    else:
        sys.exit(f"Unknown argument: {a}\nUsage: start-quanta.sh [--port N] [--no-browser]")

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".md": "text/plain; charset=utf-8",
        ".flac": "audio/flac",
    }
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
    def log_message(self, *a):
        pass

# Find a free port, starting at --port.
server = None
for p in range(port, port + 20):
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", p), functools.partial(Handler, directory=root))
        port = p
        break
    except OSError:
        pass
if not server:
    sys.exit(f"Could not open any port between {port} and {port + 19}.")

url = f"http://localhost:{port}/"
print(f"\n  Quanta is running at {url}\n  Press Ctrl+C to stop.\n", flush=True)

def launch(cmd):
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)

if open_browser:
    # Chromium browsers can capture desktop audio and open as a chrome-less app window.
    # On Linux, PulseaudioLoopbackForScreenShare lets "Entire screen" sharing carry system audio
    # through PulseAudio / PipeWire (only honoured if the browser is not already running).
    linux = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
             "microsoft-edge", "microsoft-edge-stable", "brave-browser", "vivaldi"]
    mac = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
           "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
           "/Applications/Chromium.app/Contents/MacOS/Chromium",
           "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]
    candidates = mac if platform.system() == "Darwin" else linux
    browser = next((c for c in (shutil.which(n) or (n if os.path.isfile(n) else None) for n in candidates) if c), None)
    if browser:
        launch([browser, f"--app={url}", "--enable-features=PulseaudioLoopbackForScreenShare"])
    elif shutil.which("xdg-open"):
        launch(["xdg-open", url])
    elif shutil.which("open"):
        launch(["open", url])
    else:
        print("  No browser found; open the address above in Chrome or Edge.", flush=True)

try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY
