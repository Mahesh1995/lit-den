#!/usr/bin/env python3
"""
Local dev server for this site that disables caching, so edits to
books-data.js / app.js / styles.css always show up on refresh instead of
serving a stale cached copy from your browser.

Usage:
    python3 serve.py [port]      # defaults to 8080
"""
import sys
import http.server

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("", port), NoCacheHandler) as httpd:
        print(f"Serving (no-cache) at http://localhost:{port}")
        httpd.serve_forever()
