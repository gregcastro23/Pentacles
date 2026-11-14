"""Bake local portrait-derived 3D faces. No uploads, inference or model downloads at runtime.

Requires mediapipe==0.10.21, pillow==11.3.0 in an offline authoring environment.
python bake-portrait-faces.py --model face_landmarker.task --topology canonical_face_model.obj
"""
import argparse
import hashlib
import json
from pathlib import Path

import mediapipe as mp
import numpy as np
from PIL import Image
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

ROOT = Path(__file__).resolve().parents[1]
OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109]


def unit(vector):
    return vector / max(np.linalg.norm(vector), 1e-8)


def sample(image, landmark, radius=3):
    height, width = image.shape[:2]
    x, y = int(landmark.x * width), int(landmark.y * height)
    x, y = max(radius, min(width-radius-1, x)), max(radius, min(height-radius-1, y))
    return np.median(image[y-radius:y+radius+1, x-radius:x+radius+1], axis=(0, 1))


def bake(path, landmarks):
    pixels = np.asarray(Image.open(path).convert('RGB'))
    h, w = pixels.shape[:2]
    points = np.array([[p.x*w, -p.y*h, -p.z*w] for p in landmarks])
    right = unit(points[263] - points[33])
    up = points[10] - points[152]
    up = unit(up - right * np.dot(up, right))
    front = unit(np.cross(right, up))
    center = (points[10] + points[152]) / 2
    local = (points - center) @ np.array([right, up, front]).T
    local *= .60 / (local[10, 1] - local[152, 1])
    # The oval is the join to the skull; the nose retains the model's estimated depth.
    local[:, 2] += .025 - np.mean(local[OVAL, 2])
    skin = np.median([sample(pixels, landmarks[i]) for i in [50,101,205,280,330,425]], axis=0)
    colors = np.array([sample(pixels, p) for p in landmarks[:468]])
    # Retain broad pigment variation without baking all portrait lighting into the skin.
    colors = np.clip(colors * .55 + skin * .45, 0, 255).round().astype(int)
    return dict(version=1, sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                positions=local[:468].round(5).reshape(-1).tolist(),
                colors=colors.reshape(-1).tolist(), skin=skin.round().astype(int).tolist(),
                irises=local[468:478].round(5).reshape(-1).tolist())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True, type=Path)
    parser.add_argument('--topology', required=True, type=Path)
    args = parser.parse_args()
    topology = []
    for line in args.topology.read_text().splitlines():
        if line.startswith('f '):
            topology.extend(int(v.split('/')[0])-1 for v in line.split()[1:])
    assert len(topology) % 3 == 0 and max(topology) == 467
    output = ROOT / 'public/avatars/faces'
    output.mkdir(parents=True, exist_ok=True)
    (ROOT / 'src/lib/agents/portrait-face-topology.ts').write_text(
        '// MediaPipe v0.10.21 canonical face topology (Apache-2.0). See public/licenses/mediapipe.txt.\n'
        + 'export const PORTRAIT_FACE_TRIANGLES = ' + json.dumps(topology, separators=(',', ':')) + ';\n'
        + 'export const PORTRAIT_FACE_OVAL = ' + json.dumps(OVAL) + ';\n')
    options = vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(args.model), delegate=python.BaseOptions.Delegate.CPU),
        running_mode=vision.RunningMode.IMAGE, num_faces=1,
        min_face_detection_confidence=.5, min_face_presence_confidence=.5)
    sources = json.loads((ROOT / 'public/avatars/historical/sources.json').read_text())['portraits']
    results = []
    with vision.FaceLandmarker.create_from_options(options) as detector:
        for entry in sources:
            key = entry['key']
            path = ROOT / f'public/avatars/historical/{key}.webp'
            array = np.asarray(Image.open(path).convert('RGB'))
            detected = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=array))
            if not detected.face_landmarks:
                results.append(dict(key=key, status='undetected'))
                print(f'NO FACE {key}', flush=True)
                continue
            data = bake(path, detected.face_landmarks[0])
            (output / f'{key}.json').write_text(json.dumps(data, separators=(',', ':')) + '\n')
            results.append(dict(key=key, status='estimated', sourceSha256=data['sourceSha256']))
            print(f'BAKED {key}', flush=True)
    manifest = dict(method='MediaPipe Face Landmarker; estimated geometry from a single painted portrait',
                    mediapipeVersion=mp.__version__, modelSha256=hashlib.sha256(args.model.read_bytes()).hexdigest(),
                    topologySha256=hashlib.sha256(args.topology.read_bytes()).hexdigest(), faces=results)
    (output / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'{sum(r["status"] == "estimated" for r in results)}/{len(results)} faces baked', flush=True)


if __name__ == '__main__':
    main()
