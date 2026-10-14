"""KwikAid inference worker.

Watches the Supabase `inference_queue` table for injury photos waiting to be
classified. For each one it downloads the photo from Storage, runs it through
the ResNet18 ONNX model, writes the predicted label to the row's `inference`
column and deletes the photo.

A row's `status` goes queued -> processing -> completed, or -> failed if the
photo can't be read or keeps erroring after MAX_ATTEMPTS tries.

    python inference_endpoint.py                  # keep polling until stopped
    python inference_endpoint.py --once           # empty the queue, then exit
    python inference_endpoint.py --predict a.jpg  # classify a local photo, no Supabase
    python inference_endpoint.py --enqueue a.jpg  # upload a photo and queue it (testing)
"""

import argparse
import base64
import io
import json
import logging
import mimetypes
import os
import re
import signal
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np
import onnxruntime as ort
from dotenv import load_dotenv
from PIL import Image, ImageOps
from supabase import Client, ClientOptions, create_client

log = logging.getLogger("inference")

BASE_DIR = Path(__file__).resolve().parent
# ONNX Runtime loads the weights from resent18_trained.onnx.data in the same
# folder. The .onnx file refers to it by that exact name, so don't rename it.
MODEL_PATH = BASE_DIR / "resent18_trained.onnx"
LABELS_PATH = BASE_DIR / "labels.txt"

TABLE = "inference_queue"
BATCH_SIZE = 10  # rows fetched per poll
MAX_ATTEMPTS = 3  # tries per row before a download/network error marks it failed

# Input size. Preprocessing must match the training notebook (Kaggle
# samrubenabraham/first-aid-id, cell 7): RGB, cv2.resize to 224x224 with
# INTER_LINEAR (squashed, not cropped), scaled to 0..1, no mean/std normalization.
SIZE = 224
MAX_PIXELS = 50_000_000  # refuse anything bigger before decoding it

# https://<ref>.supabase.co/storage/v1/object/[public/|sign/|authenticated/]<bucket>/<path>
STORAGE_URL_BUCKET = re.compile(r"/storage/v1/(?:object|render/image)/(?:public/|sign/|authenticated/)?([^/]+)/")


class PermanentError(Exception):
    """A problem with the row or photo itself; retrying won't help."""


def preprocess(image_bytes: bytes) -> np.ndarray:
    """Decode a photo into the model's 1x3x224x224 float32 input, as in training."""
    with Image.open(io.BytesIO(image_bytes)) as img:
        if img.width * img.height > MAX_PIXELS:
            raise ValueError(f"image too large: {img.width}x{img.height}")
        # Phones save photos sideways plus an EXIF rotation tag; cv2.imread in
        # training applied that tag too.
        img = ImageOps.exif_transpose(img).convert("RGB")
    x = cv2.resize(np.asarray(img), (SIZE, SIZE), interpolation=cv2.INTER_LINEAR)
    return (x.astype(np.float32) / 255).transpose(2, 0, 1)[np.newaxis]  # like ToTensor(): HWC -> NCHW, 0..1


def load_labels(path: Path) -> list[str]:
    """Class names, one per line in model output order. Blank lines and #-comments are skipped."""
    lines = (line.split("#", 1)[0].strip() for line in path.read_text(encoding="utf-8").splitlines())
    return [line for line in lines if line]


class Classifier:
    def __init__(self, model_path: Path = MODEL_PATH, labels_path: Path = LABELS_PATH):
        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.labels = load_labels(labels_path)
        n_classes = self.session.get_outputs()[0].shape[-1]
        if len(self.labels) != n_classes:
            raise ValueError(
                f"{labels_path.name} lists {len(self.labels)} labels but the model has {n_classes} classes"
            )

    def classify(self, image_bytes: bytes) -> list[tuple[str, float]]:
        """(label, probability) for every class, most likely first."""
        logits = self.session.run(None, {self.input_name: preprocess(image_bytes)})[0][0]
        probs = np.exp(logits - logits.max())
        probs /= probs.sum()
        return sorted(zip(self.labels, probs.tolist()), key=lambda lp: lp[1], reverse=True)


def locate_image(row: dict, bucket: str | None = None) -> tuple[str, str]:
    """(bucket, object path) of a queue row's photo.

    The bucket is SUPABASE_BUCKET if set, otherwise read from the row's storage_url.
    """
    path = (row.get("storage_path") or "").lstrip("/")
    if not bucket:
        match = STORAGE_URL_BUCKET.search(urlparse(row.get("storage_url") or "").path)
        bucket = match.group(1) if match else None
    if not bucket or not path:
        raise PermanentError(
            f"can't locate the photo (storage_path={row.get('storage_path')!r}, "
            f"storage_url={row.get('storage_url')!r})"
        )
    if path.startswith(bucket + "/"):  # saved as "<bucket>/<path>"
        path = path[len(bucket) + 1 :]
    return bucket, path


class Worker:
    def __init__(self, client: Client, classifier: Classifier, bucket: str | None = None, interval: float = 5):
        self.db = client
        self.classifier = classifier
        self.bucket = bucket
        self.interval = interval
        self.stop = threading.Event()
        self.attempts: dict[str, int] = {}  # row id -> failed tries so far
        self.stats = {"completed": 0, "failed": 0}
        self.heartbeat = time.time()  # last time the loop made progress

    def run(self, once: bool = False) -> None:
        """Poll until stopped or, with once=True, until the queue is empty."""
        while not self.stop.is_set():
            try:
                fetched = self.poll()
            except Exception as e:
                if once:
                    raise
                log.error("couldn't poll %s: %s", TABLE, e)
                fetched = 0
            if once and fetched == 0:
                return
            if fetched < BATCH_SIZE:  # queue drained; wait before looking again
                self.stop.wait(self.interval)

    def poll(self) -> int:
        """Handle one batch of queued rows, oldest first. Returns how many were fetched."""
        rows = (
            self.db.table(TABLE)
            .select("id", "storage_path", "storage_url")
            .eq("status", "queued")
            .order("created_at")
            .limit(BATCH_SIZE)
            .execute()
            .data
        )
        self.heartbeat = time.time()
        for row in rows:
            if self.stop.is_set():
                break
            self.handle(row)
            self.heartbeat = time.time()
        return len(rows)

    def recover(self) -> None:
        """Re-queue rows an earlier run left in 'processing' because it died mid-photo.

        Meant for a single worker. If a second copy is running, its current row
        just gets redone, since every status change here is conditional.
        """
        stuck = self.db.table(TABLE).update({"status": "queued"}).eq("status", "processing").execute().data
        if stuck:
            log.warning("re-queued %d row(s) an earlier run left in 'processing'", len(stuck))

    def handle(self, row: dict) -> None:
        row_id = row["id"]
        if not self._move(row_id, "queued", "processing"):
            return  # another worker claimed it first
        try:
            bucket, path = locate_image(row, self.bucket)
            image = self.db.storage.from_(bucket).download(path)
            try:
                label, confidence = self.classifier.classify(image)[0]
            except Exception as e:
                raise PermanentError(f"unreadable image: {e}") from e
            saved = self._move(row_id, "processing", "completed", inference=label)
        except PermanentError as e:
            self._fail(row_id, str(e))
            return
        except Exception as e:  # network or storage hiccup
            self._retry(row_id, e)
            return
        self.attempts.pop(row_id, None)
        if not saved:
            log.warning("row %s changed while it was being processed; result dropped", row_id)
            return
        self.stats["completed"] += 1
        log.info("row %s: %s (%.0f%%)", row_id, label, confidence * 100)
        # The label is saved, so the photo is no longer needed.
        try:
            if not self.db.storage.from_(bucket).remove([path]):
                log.warning("row %s: nothing deleted at %s/%s (already gone?)", row_id, bucket, path)
        except Exception as e:
            log.error("row %s: label saved, but deleting %s/%s failed: %s", row_id, bucket, path, e)

    def _move(self, row_id: str, from_status: str, to_status: str, **fields) -> bool:
        """Change a row's status only if it still has from_status. True if it did."""
        result = (
            self.db.table(TABLE)
            .update({"status": to_status, **fields})
            .eq("id", row_id)
            .eq("status", from_status)
            .execute()
        )
        return bool(result.data)

    def _retry(self, row_id: str, error: Exception) -> None:
        tries = self.attempts.get(row_id, 0) + 1
        if tries >= MAX_ATTEMPTS:
            self._fail(row_id, f"gave up after {tries} tries: {error}")
            return
        self.attempts[row_id] = tries
        log.warning("row %s: try %d/%d failed (%s); will retry", row_id, tries, MAX_ATTEMPTS, error)
        try:
            self._move(row_id, "processing", "queued")
        except Exception as e:
            log.error("row %s: couldn't put it back in the queue: %s", row_id, e)

    def _fail(self, row_id: str, reason: str) -> None:
        self.attempts.pop(row_id, None)
        log.error("row %s failed: %s", row_id, reason)
        try:
            if self._move(row_id, "processing", "failed"):
                self.stats["failed"] += 1
        except Exception as e:
            log.error("row %s: couldn't mark it failed: %s", row_id, e)

    def healthy(self) -> bool:
        return time.time() - self.heartbeat < max(60, 3 * self.interval)


def start_health_server(port: int, worker: Worker) -> ThreadingHTTPServer | None:
    """Serve GET /health: 200 while the worker is polling, 503 if it has stalled."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            ok = worker.healthy()
            body = json.dumps({"ok": ok, **worker.stats}).encode()
            self.send_response(200 if ok else 503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):  # keep health checks out of the log
            pass

    try:
        server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    except OSError as e:
        log.warning("health endpoint off: can't listen on port %d (%s)", port, e)
        return None
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("health endpoint on port %d", server.server_address[1])
    return server


def key_role(key: str) -> str | None:
    """What kind of Supabase API key this is ('service_role', 'anon', 'secret', ...), if it can be told."""
    if key.startswith(("sb_secret_", "sb_publishable_")):
        return key.split("_")[1]
    try:  # legacy keys are JWTs with a "role" claim
        payload = key.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["role"]
    except (IndexError, KeyError, TypeError, ValueError):
        return None


def connect() -> Client:
    url, key = os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_KEY must be set (copy sample.env.local to .env)")
    role = key_role(key)
    if role in ("anon", "publishable"):
        log.warning(
            "SUPABASE_KEY is the public %s key. Use the service_role (secret) key, or "
            "row-level security will hide the queue and silently block updates.",
            role,
        )
    options = ClientOptions(
        auto_refresh_token=False,
        persist_session=False,
        postgrest_client_timeout=30,
        storage_client_timeout=30,
    )
    return create_client(url, key, options)


def enqueue(client: Client, image_path: Path, bucket: str) -> str:
    """Upload a local photo and queue it the way the app would. Returns the new row's id."""
    path = f"test/{uuid.uuid4().hex}{image_path.suffix.lower()}"
    content_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    storage = client.storage.from_(bucket)
    storage.upload(path, image_path.read_bytes(), {"content-type": content_type})
    row = {"storage_path": path, "storage_url": storage.get_public_url(path)}
    return client.table(TABLE).insert(row).execute().data[0]["id"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="KwikAid inference worker")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="process everything queued, then exit")
    mode.add_argument("--predict", metavar="IMAGE", type=Path, help="classify a local photo (no Supabase)")
    mode.add_argument("--enqueue", metavar="IMAGE", type=Path, help="upload a photo and queue it, for testing")
    args = parser.parse_args(argv)

    load_dotenv(BASE_DIR / ".env")
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)  # it logs every request at INFO

    if args.predict:
        for label, prob in Classifier().classify(args.predict.read_bytes())[:3]:
            print(f"{prob:6.1%}  {label}")
        return 0

    client = connect()
    bucket = os.getenv("SUPABASE_BUCKET") or None
    if args.enqueue:
        if not bucket:
            sys.exit("set SUPABASE_BUCKET to the bucket the app uploads photos to")
        print("queued row", enqueue(client, args.enqueue, bucket))
        return 0

    worker = Worker(client, Classifier(), bucket, float(os.getenv("POLL_INTERVAL_SECONDS", "5")))

    def request_stop(signum, _frame):
        log.info("%s received; stopping after the current photo", signal.Signals(signum).name)
        worker.stop.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    if not args.once:
        start_health_server(int(os.getenv("PORT", "5000")), worker)
    worker.recover()
    log.info("watching %s every %gs", TABLE, worker.interval)
    worker.run(once=args.once)
    log.info("stopped: %(completed)d completed, %(failed)d failed", worker.stats)
    return 0


if __name__ == "__main__":
    sys.exit(main())
