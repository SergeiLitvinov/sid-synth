"""Dev static server with no-cache headers.

Python's http.server sends no Cache-Control, so browsers apply heuristic
caching based on file mtime (which equals the git-checkout date). After
editing ES modules the browser can serve stale code forever. This server
forces `Cache-Control: no-store` on every response.
"""
import argparse
import functools
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] %s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description="no-cache static dev server")
    parser.add_argument("directory", nargs="?", default=".", help="directory to serve")
    parser.add_argument("port", nargs="?", type=int, default=3000, help="port")
    args = parser.parse_args()

    handler = functools.partial(NoCacheHandler, directory=args.directory)
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as httpd:
        print(f"no-cache server at http://127.0.0.1:{args.port} (dir: {args.directory})")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
