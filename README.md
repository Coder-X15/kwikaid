# KwikAid inference API

FastAPI service and queue worker for the bundled PyTorch image classifier. The
server loads the checkpoint on CPU, polls Supabase for queued rows, downloads
photos from the configured Storage bucket, and updates each row to `completed`
or `failed`. It also exposes an optional direct prediction endpoint. Images are
processed in memory and are not written to a local cache or deleted from Storage.

## Model files

`model_cpu.pth` is a state dictionary for a 224x224, 7-class classifier. Its
outputs map in order to `Abrasions`, `Bruises`, `Burns`, `Cut`, `Ingrown_nails`,
`Laceration`, and `Stab_wound`. If `labels.txt` exists, it must contain these
seven class names, one per line and in model-output order; otherwise, these
built-in labels are used. If all seven output scores are zero, the predicted
label is `None`. The checkpoint does not include preprocessing metadata; the API
currently converts images to RGB, resizes them to 224x224, and scales pixel
values to [0, 1]. Confirm this matches the model's training pipeline before
relying on predictions.

## Run locally

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.0"
python -m pip install -r requirements.txt
uvicorn inference_endpoint:app --host 0.0.0.0 --port 8000
```

Configure `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_BUCKET`, and
`POLL_INTERVAL_SECONDS` in `.env.local` (copy `sample.env.local` and set
`SUPABASE_KEY` to the service-role key). The worker requires the service-role key
to read and update queue rows and download private bucket objects. It selects
`queued` rows in creation order, conditionally claims each as `processing`, then
records the predicted label or an error as `failed`. Failed rows are not retried
automatically.

The interactive API docs are at `http://localhost:8000/docs`.

## API

`GET /health` reports service readiness. `POST /predict` accepts one image as
multipart form data under the `file` field (maximum 10 MiB):

```sh
curl -F "file=@photo.jpg" http://localhost:8000/predict
```

The response contains the highest-scoring label, its score as `confidence`, and
the scores for all seven classes. Scores are the model's sigmoid outputs and are
not calibrated probabilities.

## Docker

```sh
docker build -t kwikaid-inference .
docker run --rm --env-file .env.local -p 8000:8000 kwikaid-inference
```

Optional settings: `MODEL_PATH`, `LABELS_PATH`, `MAX_UPLOAD_BYTES`, and `LOG_LEVEL`.
The defaults point to `/app/model_cpu.pth`, `/app/labels.txt`, a 10 MiB upload
limit, and `INFO` logging. Local `.env*` files are excluded from the Docker build
context and should be passed at runtime.
