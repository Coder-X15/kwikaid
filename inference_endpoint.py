"""KwikAid inference worker.

Polls the inference_queue table, classifies each queued injury photo with the
ResNet18 ONNX model and writes the label back for the frontend to pick up.
Photos are processed in memory, so there is no local image cache to clean up.

    python inference_endpoint.py               # run the worker (needs .env.local)
    python inference_endpoint.py photo.jpg     # classify one local photo and exit
"""

import io
import logging
import os
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from dotenv import load_dotenv
from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env.local")
load_dotenv(HERE / ".env")

BUCKET = os.getenv("SUPABASE_BUCKET", "injury-images")
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL_SECONDS", "3"))
BATCH_SIZE = 5

# ImageNet statistics, the torchvision default for a ResNet18 backbone.
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kwikaid-worker")
logging.getLogger("httpx").setLevel(logging.WARNING)  # otherwise every poll is logged

# ONNX Runtime picks up resent18_trained.onnx.data from the same folder.
session = ort.InferenceSession(str(HERE / "resent18_trained.onnx"), providers=["CPUExecutionProvider"])
model_input = session.get_inputs()[0]
_, _, height, width = model_input.shape
INPUT_SIZE = (width if isinstance(width, int) else 224, height if isinstance(height, int) else 224)

# Class names, one per line, in the same order the model was trained with.
labels_file = HERE / "labels.txt"
LABELS = [l.strip() for l in labels_file.read_text().splitlines() if l.strip()] if labels_file.exists() else []
if not LABELS:
    log.warning("labels.txt missing or empty; results will be reported as class_<n>")


def preprocess(image_bytes: bytes) -> np.ndarray:
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    image = image.resize(INPUT_SIZE, Image.Resampling.BILINEAR)
    pixels = (np.asarray(image, dtype=np.float32) / 255.0 - MEAN) / STD
    return pixels.transpose(2, 0, 1)[np.newaxis]  # HWC -> NCHW


def classify(image_bytes: bytes) -> tuple[str, float]:
    logits = session.run(None, {model_input.name: preprocess(image_bytes)})[0][0]
    probs = np.exp(logits - logits.max())
    probs /= probs.sum()
    best = int(probs.argmax())
    label = LABELS[best] if best < len(LABELS) else f"class_{best}"
    return label, float(probs[best])


def claim(client, row_id: str) -> bool:
    """Move a row from queued to processing; False if another worker got there first."""
    result = (
        client.table("inference_queue")
        .update({"status": "processing"})
        .eq("id", row_id)
        .eq("status", "queued")
        .execute()
    )
    return bool(result.data)


def process(client, row: dict) -> None:
    if not claim(client, row["id"]):
        return
    try:
        image_bytes = client.storage.from_(BUCKET).download(row["storage_path"])
        label, confidence = classify(image_bytes)
        update = {"status": "completed", "inference": label}
        log.info("%s -> %s (%.0f%%)", row["id"], label, confidence * 100)
    except Exception as exc:  # mark the row failed so it is not retried forever
        update = {"status": "failed", "inference": f"error: {exc}"[:500]}
        log.exception("%s failed", row["id"])
    client.table("inference_queue").update(update).eq("id", row["id"]).execute()


def main() -> None:
    from supabase import create_client

    # Must be the service_role key: the worker reads every user's rows and photos.
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    log.info("Watching inference_queue every %ss (input %s, %d labels)", POLL_INTERVAL, INPUT_SIZE, len(LABELS))
    while True:
        try:
            rows = (
                client.table("inference_queue")
                .select("id, storage_path")
                .eq("status", "queued")
                .order("created_at")
                .limit(BATCH_SIZE)
                .execute()
                .data
            )
            for row in rows:
                process(client, row)
        except Exception:
            log.exception("Polling failed; retrying")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        label, confidence = classify(Path(sys.argv[1]).read_bytes())
        print(f"{label} ({confidence:.0%})")
    else:
        main()
