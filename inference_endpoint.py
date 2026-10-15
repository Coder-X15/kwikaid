"""FastAPI inference service for the KwikAid PyTorch image classifier."""

import asyncio
import io
import logging
import os
import warnings
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from dotenv import load_dotenv
from supabase import create_client
from torch import nn

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env.local")
load_dotenv(HERE / ".env")

MODEL_PATH = Path(os.getenv("MODEL_PATH", HERE / "model_cpu.pth"))
LABELS_PATH = Path(os.getenv("LABELS_PATH", HERE / "labels.txt"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "injury-images")
POLL_INTERVAL_SECONDS = float(os.getenv("POLL_INTERVAL_SECONDS", "3"))
INPUT_SIZE = 224
NUM_CLASSES = 7
DEFAULT_LABELS = [
    "Abrasions",
    "Bruises",
    "Burns",
    "Cut",
    "Ingrown_nails",
    "Laceration",
    "Stab_wound",
]
if MAX_UPLOAD_BYTES <= 0:
    raise ValueError("MAX_UPLOAD_BYTES must be greater than zero")
if POLL_INTERVAL_SECONDS <= 0:
    raise ValueError("POLL_INTERVAL_SECONDS must be greater than zero")

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("kwikaid-inference")
BATCH_SIZE = 5


class InjuryClassifier(nn.Module):
    """Network matching the conv1/conv2/fc layers in model_cpu.pth."""

    def __init__(self) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(3, 32, kernel_size=3, padding=1)
        self.relu1 = nn.ReLU()
        self.pool1 = nn.MaxPool2d(kernel_size=2)
        self.conv2 = nn.Conv2d(32, 16, kernel_size=3, padding=1)
        self.relu2 = nn.ReLU()
        self.pool2 = nn.MaxPool2d(kernel_size=2)
        self.fc = nn.Linear(16 * 56 * 56, NUM_CLASSES)
        self.sigmoid = nn.Sigmoid()

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        features = self.pool1(self.relu1(self.conv1(images)))
        features = self.pool2(self.relu2(self.conv2(features)))
        return self.sigmoid(self.fc(torch.flatten(features, start_dim=1)))


def load_labels() -> list[str]:
    if not LABELS_PATH.is_file():
        log.warning("%s missing; using built-in wound labels", LABELS_PATH)
        return DEFAULT_LABELS.copy()

    labels = [line.strip() for line in LABELS_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(labels) != NUM_CLASSES:
        raise ValueError(f"{LABELS_PATH} must contain exactly {NUM_CLASSES} non-empty labels")
    return labels


def load_model() -> InjuryClassifier:
    if not MODEL_PATH.is_file():
        raise FileNotFoundError(f"Model checkpoint not found: {MODEL_PATH}")

    model = InjuryClassifier()
    state_dict = torch.load(MODEL_PATH, map_location="cpu", weights_only=True)
    model.load_state_dict(state_dict, strict=True)
    model.eval()
    return model


LABELS = load_labels()
MODEL = load_model()


def infer_image(image_bytes: bytes) -> dict[str, object]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image_bytes)) as image:
                image = ImageOps.exif_transpose(image).convert("RGB")
                image = image.resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR)
                pixels = np.asarray(image, dtype=np.float32).copy() / 255.0
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError("The image is not a valid supported image.") from exc

    tensor = torch.from_numpy(pixels.transpose(2, 0, 1)).unsqueeze(0)
    with torch.inference_mode():
        scores = MODEL(tensor)[0].tolist()

    if not any(scores):
        label = "None"
        confidence = 0.0
    else:
        best_index = int(np.argmax(scores))
        label = LABELS[best_index]
        confidence = scores[best_index]

    return {
        "label": label,
        "confidence": confidence,
        "scores": [{"label": label, "score": score} for label, score in zip(LABELS, scores)],
    }


def claim_queue_row(client, row_id: str) -> bool:
    result = (
        client.table("inference_queue")
        .update({"status": "processing"})
        .eq("id", row_id)
        .eq("status", "queued")
        .select("id")
        .execute()
    )
    return bool(result.data)


def process_queue_row(client, row: dict[str, str]) -> None:
    row_id = row["id"]
    if not claim_queue_row(client, row_id):
        return

    image_bytes = None
    try:
        image_bytes = client.storage.from_(SUPABASE_BUCKET).download(row["storage_path"])
        result = infer_image(image_bytes)
        update = {"status": "completed", "inference": str(result["label"])}
        log.info("Queue row %s classified as %s", row_id, result["label"])
    except Exception as exc:
        update = {"status": "failed", "inference": f"error: {exc}"[:500]}
        log.exception("Queue row %s failed", row_id)
    finally:
        image_bytes = None

    client.table("inference_queue").update(update).eq("id", row_id).execute()


def process_queue_batch(client) -> None:
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
        try:
            process_queue_row(client, row)
        except Exception:
            log.exception("Could not update queue row %s", row.get("id", "<unknown>"))


async def queue_worker(client) -> None:
    log.info("Polling inference_queue every %s seconds", POLL_INTERVAL_SECONDS)
    while True:
        try:
            await asyncio.to_thread(process_queue_batch, client)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Supabase queue poll failed; retrying")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    if not supabase_url or not supabase_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY are required to run the queue worker")

    client = create_client(supabase_url, supabase_key)
    worker_task = asyncio.create_task(queue_worker(client))
    app.state.queue_worker_task = worker_task
    try:
        yield
    finally:
        worker_task.cancel()
        with suppress(asyncio.CancelledError):
            await worker_task


app = FastAPI(title="KwikAid Inference API", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str | bool]:
    task = getattr(app.state, "queue_worker_task", None)
    worker_running = task is not None and not task.done()
    return {
        "status": "ok",
        "model_loaded": True,
        "queue_worker_running": worker_running,
        "device": "cpu",
    }


@app.post("/predict")
def predict(file: UploadFile = File(...)) -> dict[str, object]:
    image_bytes = file.file.read(MAX_UPLOAD_BYTES + 1)
    if not image_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds the {MAX_UPLOAD_BYTES}-byte limit.")

    try:
        return infer_image(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
