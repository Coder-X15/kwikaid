# KwikAid inference worker

Polls the `inference_queue` table, downloads each `queued` photo from the
`injury-images` bucket, classifies it with the ResNet18 ONNX model and writes
the label back (`status` -> `completed`, or `failed` with the error in `inference`).
The frontend polls the same row and opens the matching first-aid protocol.

## Setup

1. Run `supabase_setup.sql` once in Supabase -> SQL Editor (table, row-level security, bucket).
2. Put the class names in `labels.txt`, one per line, **in the order used during training**
   (the model has 8 outputs). Without it, results come back as `class_0` ... `class_7`.
3. Copy `sample.env.local` to `.env.local` and set `SUPABASE_KEY` to the **service_role** key.

## Run

```sh
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # .venv/bin/python on Linux/macOS
.venv/Scripts/python inference_endpoint.py                 # start the worker
.venv/Scripts/python inference_endpoint.py photo.jpg       # test the model on one image
```

Docker: `docker build -t kwikaid-worker .` then `docker run --env-file .env.local kwikaid-worker`.
