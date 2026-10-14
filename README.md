# KwikAid inference worker

Labels injury photos for the KwikAid app.

It checks the Supabase `inference_queue` table every few seconds. For each row with `status = 'queued'` it:

1. marks the row `processing`
2. downloads the photo from Supabase Storage (`storage_path`)
3. runs it through the ResNet18 model (`resent18_trained.onnx`)
4. writes the predicted label to `inference` and marks the row `completed`
5. deletes the photo from the bucket

If the photo can't be read, the row is marked `failed` and the photo is kept. Network or download errors are retried 3 times before the row is marked `failed`.

## Setup

    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    cp sample.env.local .env        # then put the real key in .env

`.env` is git-ignored. Never commit it.

| Variable | Default | |
|---|---|---|
| `SUPABASE_URL` | required | Project URL |
| `SUPABASE_KEY` | required | The **service_role / secret** key. With the anon key, row-level security hides the queue and blocks updates. |
| `SUPABASE_BUCKET` | read from each row's `storage_url` | Bucket the app uploads photos to |
| `POLL_INTERVAL_SECONDS` | `5` | Wait between checks when the queue is empty |
| `PORT` | `5000` | Port for `GET /health` |
| `LOG_LEVEL` | `INFO` | |

Variables set by the host override `.env`.

## Running

    .venv/bin/python inference_endpoint.py                  # keep checking the queue (Ctrl-C to stop)
    .venv/bin/python inference_endpoint.py --once           # process what's queued, then exit
    .venv/bin/python inference_endpoint.py --predict a.jpg  # label a local photo, no Supabase needed

Sample inference against the real database (needs `SUPABASE_BUCKET`):

    .venv/bin/python inference_endpoint.py --enqueue photo.jpg   # uploads the photo and adds a queued row
    .venv/bin/python inference_endpoint.py --once                # processes it

The row should end up `completed` with a label in `inference`, and the photo should be gone from the bucket.

## Tests

    .venv/bin/python -m unittest discover -s tests -v

The tests run the real model against a fake Supabase, so they need no keys or network.

## Docker

    docker build -t kwikaid-inference .
    docker run --env-file .env -p 5000:5000 kwikaid-inference

`GET /health` returns 200 while the worker is running normally and 503 if it has stalled.

## Deployment notes

- Run a single instance. On startup it re-queues rows that a crashed run left in `processing`.
- The host must keep it running. If the host sleeps when there's no web traffic, the queue stops being checked.
- On a Mac, port 5000 is used by AirPlay. The worker still runs without `/health`, or set `PORT` to another port.

## Still to confirm

- [ ] `labels.txt` holds placeholder names (`class_0` to `class_7`). It needs the 8 real class names in the model's output order.
- [ ] Preprocessing is assumed to be `Resize(256)`, `CenterCrop(224)` and ImageNet mean/std normalization. It must match training.
