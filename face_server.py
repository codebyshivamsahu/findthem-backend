"""
Find Them India — face similarity service.

WHAT THIS IS: OpenCV Haar cascade face detection plus a HOG-descriptor cosine
similarity between two cropped faces. That is a *similarity score between two
photographs*, not face recognition and not an identification. Two different
people in similar lighting and pose routinely score higher than the same person
photographed years apart.

Because of that, this service is advisory only. The API never stores its score
as "confidence", never auto-verifies a sighting, and never emails a family based
on it — a human reviewer decides.
"""
import base64
import io
import ipaddress
import os
import re
import socket
import traceback
import urllib.parse
import urllib.request

import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image

app = Flask(__name__)

# ── Configuration ────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get('ALLOWED_ORIGINS', 'http://localhost:3000').split(',') if o.strip()
]
MAX_IMAGE_BYTES = int(os.environ.get('MAX_IMAGE_BYTES', 8 * 1024 * 1024))
MAX_CASES_PER_REQUEST = int(os.environ.get('MAX_CASES_PER_REQUEST', 200))
MAX_PHOTOS_PER_CASE = 5
MAX_DIMENSION = 640
FETCH_TIMEOUT = 8

# The previous version allowed every origin. Lock it to the known frontends.
CORS(app, resources={r'/*': {'origins': ALLOWED_ORIGINS}})

app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024


# ── Image loading ────────────────────────────────────────────────────────────
def _decode(data: bytes):
    """Bytes -> RGB numpy array, size-capped."""
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError('image too large')
    Image.open(io.BytesIO(data)).verify()      # reject malformed / bomb images
    img = Image.open(io.BytesIO(data)).convert('RGB')
    if max(img.size) > MAX_DIMENSION:
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)
    return np.array(img)


def b64_to_arr(b64: str):
    if ',' in b64:
        b64 = b64.split(',', 1)[1]
    try:
        return _decode(base64.b64decode(b64, validate=False))
    except Exception:
        return None


def _is_public_host(hostname: str) -> bool:
    """
    Resolve the host and reject anything pointing inside the network.

    Without this, a caller could pass http://169.254.169.254/... or
    http://localhost:5432 as a "case photo" and use this service to reach
    internal addresses it cannot reach itself (SSRF).
    """
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            return False
    return True


def url_to_arr(url: str):
    if 'ui-avatars.com' in url or 'placeholder' in url.lower():
        return None
    if url.startswith('data:image'):
        return b64_to_arr(url)

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https':
        print('  refused: only https URLs are fetched')
        return None
    if not parsed.hostname or not _is_public_host(parsed.hostname):
        print('  refused: host resolves to a non-public address')
        return None

    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'FindThemIndia/1.0'})
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as response:
            if response.status != 200:
                return None
            ctype = (response.headers.get('Content-Type') or '').lower()
            if not ctype.startswith('image/'):
                print(f'  refused: content-type {ctype}')
                return None
            data = response.read(MAX_IMAGE_BYTES + 1)
        return _decode(data)
    except Exception as exc:
        print(f'  fetch failed: {exc}')
        return None


def is_b64(value: str) -> bool:
    return value.startswith('data:image') or (len(value) > 200 and bool(re.match(r'^[A-Za-z0-9+/]', value)))


def get_arr(photo):
    if not isinstance(photo, str) or not photo:
        return None
    return b64_to_arr(photo) if is_b64(photo) else url_to_arr(photo)


# ── Face detection & comparison ──────────────────────────────────────────────
FACE_CASCADE = None


def get_cascade():
    global FACE_CASCADE
    if FACE_CASCADE is None:
        import cv2
        FACE_CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    return FACE_CASCADE


def detect_and_crop_face(img_arr):
    import cv2
    cascade = get_cascade()
    gray = cv2.cvtColor(img_arr, cv2.COLOR_RGB2GRAY)
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    if len(faces) == 0:
        faces = cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=3, minSize=(40, 40))
    if len(faces) == 0:
        return None, None
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    return cv2.resize(gray[y:y + h, x:x + w], (150, 150)), (x, y, w, h)


def compute_histogram(face_gray):
    import cv2
    hog = cv2.HOGDescriptor((150, 150), (15, 15), (5, 5), (5, 5), 9)
    return hog.compute(face_gray).flatten()


def cosine_similarity(a, b) -> float:
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    return 0.0 if norm == 0 else float(np.dot(a, b) / norm)


def compare_faces(face1, face2) -> float:
    similarity = cosine_similarity(compute_histogram(face1), compute_histogram(face2))
    score = (similarity - 0.5) / 0.5 * 100
    return round(max(0.0, min(99.9, score)), 1)


# ── Routes ───────────────────────────────────────────────────────────────────
DISCLAIMER = (
    'Photo similarity only. This is not face recognition and not an identification. '
    'Every sighting must be reviewed by a person.'
)


@app.route('/health')
@app.route('/')
def health():
    return jsonify({'status': 'ok', 'service': 'findthem-face-similarity', 'engine': 'OpenCV Haar + HOG'})


@app.route('/match', methods=['POST'])
def match():
    try:
        body = request.get_json(force=True, silent=True) or {}
        sighting_photo = body.get('sighting_photo', '')
        cases = body.get('cases', [])

        if not sighting_photo:
            return jsonify({'error': 'sighting_photo required'}), 400
        if not isinstance(cases, list):
            return jsonify({'error': 'cases must be a list'}), 400
        cases = cases[:MAX_CASES_PER_REQUEST]

        sighting_arr = get_arr(sighting_photo)
        if sighting_arr is None:
            return jsonify({'face_detected': False, 'matches': [], 'disclaimer': DISCLAIMER,
                            'message': 'The photo could not be read.'})

        sighting_face, _ = detect_and_crop_face(sighting_arr)
        if sighting_face is None:
            return jsonify({'face_detected': False, 'matches': [], 'disclaimer': DISCLAIMER,
                            'message': 'No face detected. Upload a clear, front-facing photo.'})

        results = []
        for case in cases:
            if not isinstance(case, dict):
                continue
            case_id = str(case.get('caseId', ''))[:50]
            name = str(case.get('name', ''))[:200]
            photos = case.get('photos') or []
            if not isinstance(photos, list):
                continue

            best = 0.0
            for photo in photos[:MAX_PHOTOS_PER_CASE]:
                case_arr = get_arr(photo)
                if case_arr is None:
                    continue
                case_face, _ = detect_and_crop_face(case_arr)
                if case_face is None:
                    continue
                best = max(best, compare_faces(sighting_face, case_face))

            if best > 0:
                # No "verified" flag — this service does not verify anything.
                results.append({'caseId': case_id, 'name': name, 'similarity': best, 'confidence': best})

        results.sort(key=lambda r: r['similarity'], reverse=True)

        return jsonify({
            'face_detected': True,
            'matches': results,
            'total_checked': len(cases),
            'disclaimer': DISCLAIMER,
        })

    except Exception:
        traceback.print_exc()
        # Don't hand the caller a stack trace or internal path.
        return jsonify({'error': 'Face matching failed'}), 500


@app.route('/detect', methods=['POST'])
def detect():
    try:
        body = request.get_json(force=True, silent=True) or {}
        arr = get_arr(body.get('photo', ''))
        if arr is None:
            return jsonify({'face_detected': False})
        face, _ = detect_and_crop_face(arr)
        return jsonify({'face_detected': face is not None})
    except Exception:
        traceback.print_exc()
        return jsonify({'face_detected': False}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    get_cascade()
    print(f'Face similarity service on port {port}; allowed origins: {ALLOWED_ORIGINS}')
    # Production: gunicorn -w 2 -b 0.0.0.0:$PORT face_server:app
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
