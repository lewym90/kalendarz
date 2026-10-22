#!/usr/bin/env python3
"""Rozpoznawanie mowy dla Kalendarza (faster-whisper, CPU). Nasłuchuje tylko na 127.0.0.1.
Model wczytuje się przy pierwszym użyciu i zwalnia pamięć po bezczynności, żeby nie obciążać serwera (Typer itd.).
POST /transcribe?p=<podpowiedź>  — ciało: surowe próbki int16 LE, 16 kHz, mono. Odpowiedź: {"text": "..."}"""
import gc, json, os, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import numpy as np

MODEL_NAME = os.environ.get('STT_MODEL', 'small')
IDLE = int(os.environ.get('STT_IDLE', '1800'))
THREADS = int(os.environ.get('STT_THREADS', '2'))
DIR = os.environ.get('STT_DIR', '/opt/kalendarz/stt/models')
PORT = int(os.environ.get('STT_PORT', '8791'))
MAX_BYTES = 16000 * 2 * 35

lock = threading.Lock()
model = None
last = 0.0


def get_model():
    global model
    if model is None:
        from faster_whisper import WhisperModel
        model = WhisperModel(MODEL_NAME, device='cpu', compute_type='int8', cpu_threads=THREADS, download_root=DIR)
    return model


def janitor():
    global model
    while True:
        time.sleep(30)
        with lock:
            if model is not None and time.time() - last > IDLE:
                model = None
                gc.collect()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        global last
        if urlparse(self.path).path == '/warm':
            def w():
                global last
                with lock:
                    get_model()
                    last = time.time()
            threading.Thread(target=w, daemon=True).start()
            return self.send(200, {'ok': True})
        if urlparse(self.path).path == '/health':
            return self.send(200, {'ok': True, 'model': MODEL_NAME, 'loaded': model is not None})
        self.send(404, {'error': 'nie znaleziono'})

    def do_POST(self):
        global last
        u = urlparse(self.path)
        if u.path != '/transcribe':
            return self.send(404, {'error': 'nie znaleziono'})
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_BYTES:
            return self.send(413, {'error': 'zły rozmiar'})
        raw = self.rfile.read(n)
        audio = np.frombuffer(raw[: n - (n % 2)], dtype='<i2').astype(np.float32) / 32768.0
        prompt = (parse_qs(u.query).get('p') or [''])[0][:400]
        try:
            with lock:
                m = get_model()
                segs, _ = m.transcribe(audio, language='pl', beam_size=1, best_of=1, temperature=0.0, vad_filter=True, without_timestamps=True,
                                       condition_on_previous_text=False, initial_prompt=prompt or None)
                text = ' '.join(s.text.strip() for s in segs).strip()
                last = time.time()
            self.send(200, {'text': text})
        except Exception as e:  # noqa: BLE001
            self.send(500, {'error': str(e)[:200]})


if __name__ == '__main__':
    threading.Thread(target=janitor, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
