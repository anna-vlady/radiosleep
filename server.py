# RADIOSLEEP -- Local HTTP Server with Automatic File Saving Endpoint

import os
import http.server
import socketserver

PORT = 8080
DREAMS_DIR = os.path.join(os.path.dirname(__file__), 'dreams')

if not os.path.exists(DREAMS_DIR):
    os.makedirs(DREAMS_DIR)

class RadiosleepHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/save-dream':
            content_length = int(self.headers.get('Content-Length', 0))
            filename = self.headers.get('X-Filename', 'dream.wav')
            
            # Sanitize filename
            filename = os.path.basename(filename)
            file_path = os.path.join(DREAMS_DIR, filename)

            audio_data = self.rfile.read(content_length)

            with open(file_path, 'wb') as f:
                f.write(audio_data)

            print(f"[SERVER] Saved audio recording directly to: {file_path}")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'{"status":"success"}')
            return
        
        super().do_POST()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Filename')
        self.end_headers()

if __name__ == '__main__':
    with socketserver.TCPServer(("", PORT), RadiosleepHTTPRequestHandler) as httpd:
        print(f"RADIOSLEEP Local Server running at http://localhost:{PORT}")
        print(f"Local Dreams Directory: {DREAMS_DIR}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
