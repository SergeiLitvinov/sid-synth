"""Run browser suites with installed Edge; no npm or Python packages required."""
import argparse
import functools
import http.server
import pathlib
import json
import queue
import subprocess
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = {}


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        name = self.path.removeprefix('/__results/')
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if name in RESULTS:
            RESULTS[name].put(data)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('suites', nargs='*')
    parser.add_argument('--browser', default=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    names = args.suites or [p.stem for p in sorted((ROOT / 'tests').glob('*-test.html'))] + ['smoke']

    def run(name):
        with tempfile.TemporaryDirectory(prefix='sid-browser-') as profile:
            command = [args.browser, '--headless=new', '--disable-gpu', '--no-first-run',
                       '--disable-extensions', '--no-default-browser-check',
                       '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                       '--autoplay-policy=no-user-gesture-required', '--disable-background-networking',
                       '--user-data-dir=' + profile,
                       f'http://127.0.0.1:{server.server_port}/tests/runner.html?suite={name}']
            RESULTS[name] = queue.Queue()
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            try:
                data = RESULTS[name].get(timeout=48)
                summary = data.get('summary') or ''
                failures = data.get('failures') or []
                ok = bool(summary) and not failures
                return name, ok, summary, failures
            except queue.Empty:
                return name, False, 'No completed summary (browser exit: ' + str(process.poll()) + ')', []
            finally:
                process.terminate()
                process.wait(timeout=10)

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            rows = list(pool.map(run, names))
        for name, ok, summary, failures in rows:
            print(('PASS' if ok else 'FAIL') + ' ' + name + ': ' + (summary or 'No completed summary'), flush=True)
            for failure in failures:
                print('  ' + failure, flush=True)
        return 0 if all(row[1] for row in rows) else 1
    finally:
        server.shutdown()


if __name__ == '__main__':
    raise SystemExit(main())
