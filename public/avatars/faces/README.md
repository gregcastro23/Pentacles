# Portrait-derived faces

These 71 meshes are estimated from the matching 512×512 painted profile portraits
in `../historical/`. `sources.json` records each source WebP's SHA-256, the model
and topology hashes, the authoring version and detection outcome. All 71 detected
successfully. The face JSON files plus manifest total 1,206,731 bytes.

Each asset holds 468 front-surface positions, estimated iris landmarks and sampled
vertex pigmentation. The renderer adds a closed skull, ears and geometric eyes
and mouth, then attaches the head to the existing animated rig. Facial hair and
accessories retain their character-specific geometry and fit to estimated landmarks.
Random face accents from the procedural trait mixer are hidden after the face
loads, so a seeded beard or veil cannot override the portrait likeness.
Pictures remain in profiles; no picture plane or raster map is placed on the head.

This is stylized single-image estimation. Painted likenesses, perspective and
lighting affect the result, and unseen skull geometry is procedural. It does not
recover a scan-quality head, hair or a full body from the picture.

## Rebuild locally

Run from the repository root. Use a separate Python 3.9–3.12 authoring environment;
none of these Python packages or model weights ships with the application.

```sh
python3 -m venv /tmp/pentacles-face-venv
/tmp/pentacles-face-venv/bin/python -m pip install 'mediapipe==0.10.21' 'pillow==11.3.0'
curl --fail --location 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' --output /tmp/pentacles-face-landmarker.task
curl --fail --location 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.21/mediapipe/modules/face_geometry/data/canonical_face_model.obj' --output /tmp/pentacles-canonical-face.obj
/tmp/pentacles-face-venv/bin/python scripts/bake-portrait-faces.py \
  --model /tmp/pentacles-face-landmarker.task \
  --topology /tmp/pentacles-canonical-face.obj
bun run test:court
```

MediaPipe may need access to macOS graphics services during initialization even
with the CPU delegate. The script performs inference locally and never uploads
the portraits. Downloads above are authoring setup only. Runtime code fetches
small static JSON assets from this application's own origin and uses Three.js;
there is no inference request, paid generation API or runtime model download.

The bake normalizes head tilt and scale from the detected eyes/forehead/chin,
preserves estimated depth, and samples local median colors with reduced portrait
lighting contrast. Run it again after changing profile artwork. Tests reject stale
source hashes, missing assets, non-finite coordinates and incomplete geometry.

Reference: [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker).
The [canonical face topology](https://github.com/google-ai-edge/mediapipe/blob/v0.10.21/mediapipe/modules/face_geometry/data/canonical_face_model.obj)
is Apache-2.0, with attribution in `../../licenses/mediapipe.txt`. The generated
TypeScript triangle indices retain that attribution; model weights are not bundled.
