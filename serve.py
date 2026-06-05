import http.server
import socketserver
import os

PORT = 5173
DIRECTORY = "/Users/jordynkateerasmus/Downloads/tradee"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()
