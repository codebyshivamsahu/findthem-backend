"""
Find Them India - Face Recognition Server
OpenCV LBPH - No TensorFlow, No DeepFace - Fast & Lightweight
Port: 5001
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import base64, os, io, re, traceback, tempfile, urllib.request
import numpy as np
from PIL import Image

app = Flask(__name__)
CORS(app)

# ── Image helpers ────────────────────────────────────────────────────────────

def b64_to_arr(b64: str):
    """Base64 → numpy RGB array"""
    if ',' in b64:
        b64 = b64.split(',')[1]
    img = Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGB')
    if max(img.size) > 640:
        img.thumbnail((640, 640), Image.LANCZOS)
    return np.array(img)

def url_to_arr(url: str):
    if 'ui-avatars.com' in url or 'placeholder' in url.lower():
        return None
    if url.startswith('data:image'):
        return b64_to_arr(url)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = r.read()
        img = Image.open(io.BytesIO(data)).convert('RGB')
        if max(img.size) > 640:
            img.thumbnail((640, 640), Image.LANCZOS)
        return np.array(img)
    except Exception as e:
        print(f"  URL fail: {e}")
        return None

def is_b64(s: str) -> bool:
    return s.startswith('data:image') or (len(s) > 200 and bool(re.match(r'^[A-Za-z0-9+/]', s)))

def get_arr(photo: str):
    return b64_to_arr(photo) if is_b64(photo) else url_to_arr(photo)

# ── Face detection & feature extraction ─────────────────────────────────────

def load_face_cascade():
    import cv2
    cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    return cv2.CascadeClassifier(cascade_path)

FACE_CASCADE = None

def get_cascade():
    global FACE_CASCADE
    if FACE_CASCADE is None:
        FACE_CASCADE = load_face_cascade()
    return FACE_CASCADE

def detect_and_crop_face(img_arr):
    """Detect face in image, return cropped grayscale face or None"""
    import cv2
    cascade = get_cascade()
    gray    = cv2.cvtColor(img_arr, cv2.COLOR_RGB2GRAY)
    faces   = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    if len(faces) == 0:
        # Try with relaxed params
        faces = cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=3, minSize=(40, 40))
    if len(faces) == 0:
        return None, None
    # Take largest face
    x, y, w, h = max(faces, key=lambda f: f[2]*f[3])
    face_gray   = gray[y:y+h, x:x+w]
    face_resized = cv2.resize(face_gray, (150, 150))
    return face_resized, (x, y, w, h)

def compute_histogram(face_gray):
    """LBPH-style histogram for face comparison"""
    import cv2
    # Use HOG features for better accuracy
    hog = cv2.HOGDescriptor((150,150),(15,15),(5,5),(5,5),9)
    hist = hog.compute(face_gray)
    return hist.flatten()

def cosine_similarity(a, b):
    """Cosine similarity between two vectors → 0 to 1"""
    dot   = np.dot(a, b)
    norm  = np.linalg.norm(a) * np.linalg.norm(b)
    if norm == 0:
        return 0.0
    return float(dot / norm)

def compare_faces(face1, face2) -> float:
    """Compare two face arrays → confidence 0-100"""
    import cv2
    h1 = compute_histogram(face1)
    h2 = compute_histogram(face2)
    sim = cosine_similarity(h1, h2)
    # sim range: ~0.7-1.0 for same person, ~0.3-0.7 for different
    # Map to 0-100%
    conf = (sim - 0.5) / 0.5 * 100
    return round(max(0, min(99.9, conf)), 1)

# ── Routes ───────────────────────────────────────────────────────────────────

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'engine': 'OpenCV-HOG (Fast)'})

@app.route('/match', methods=['POST'])
def match():
    try:
        import cv2
        body  = request.get_json(force=True)
        sight = body.get('sighting_photo', '')
        cases = body.get('cases', [])

        if not sight:
            return jsonify({'error': 'sighting_photo required'}), 400

        print(f"\n{'='*50}")
        print(f"🔍 Match request: {len(cases)} cases")

        # Load & detect face in sighting photo
        sight_arr = get_arr(sight)
        if sight_arr is None:
            return jsonify({'face_detected': False, 'matches': [],
                            'best_match': None, 'message': 'Photo load nahi hua'})

        sight_face, sight_box = detect_and_crop_face(sight_arr)
        if sight_face is None:
            print("❌ Sighting photo mein face nahi mila")
            return jsonify({
                'face_detected': False,
                'matches':       [],
                'best_match':    None,
                'message':       'Sighting photo mein face detect nahi hua. Clear saamne wali photo upload karein.'
            })

        print(f"✅ Sighting face detected")
        results = []

        for case in cases:
            cid    = case.get('caseId', '')
            cname  = case.get('name', '')
            photos = case.get('photos', [])

            if not photos:
                continue

            print(f"\n--- {cid} ({cname}) ---")
            best_conf = 0.0

            for photo in photos:
                if 'ui-avatars.com' in str(photo):
                    print(f"  ⚠️  Avatar skip")
                    continue

                case_arr = get_arr(photo)
                if case_arr is None:
                    continue

                case_face, _ = detect_and_crop_face(case_arr)
                if case_face is None:
                    print(f"  ⚠️  Case photo mein face nahi mila")
                    continue

                conf = compare_faces(sight_face, case_face)
                print(f"  Confidence: {conf}%")

                if conf > best_conf:
                    best_conf = conf

            if best_conf > 0:
                results.append({
                    'caseId':     cid,
                    'name':       cname,
                    'confidence': best_conf,
                    'verified':   best_conf >= 60,
                })

        results.sort(key=lambda x: x['confidence'], reverse=True)
        best = results[0] if results and results[0]['confidence'] >= 35 else None

        print(f"\n🎯 Best: {best['name'] if best else 'None'} @ {best['confidence'] if best else 0}%")

        return jsonify({
            'face_detected': True,
            'matches':       results,
            'best_match':    best,
            'total_checked': len(cases),
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/detect', methods=['POST'])
def detect():
    try:
        body  = request.get_json(force=True)
        photo = body.get('photo', '')
        arr   = get_arr(photo)
        if arr is None:
            return jsonify({'face_detected': False})
        face, _ = detect_and_crop_face(arr)
        return jsonify({'face_detected': face is not None})
    except Exception as e:
        return jsonify({'face_detected': False, 'error': str(e)})

if __name__ == '__main__':
    import cv2
    print("=" * 50)
    print("🔍  Find Them India — Face Recognition")
    print("🤖  Engine : OpenCV HOG (No TensorFlow!)")
    print("⚡  Speed  : Fast — no model loading")
    print("📡  URL    : http://localhost:5001")
    print("=" * 50)
    # Pre-load cascade
    get_cascade()
    print("✅  Ready!")
    app.run(host='0.0.0.0', port=5001, debug=False, threaded=True)
