"""Tests for the inference worker: the real model against a fake Supabase.

Run from the repo root:  python -m unittest discover -s tests -v
"""

import base64
import io
import json
import logging
import tempfile
import unittest
import urllib.error
import urllib.request
import uuid
from email import policy
from email.parser import BytesParser
from pathlib import Path

import httpx
import numpy as np
from PIL import Image
from supabase import ClientOptions, create_client

import inference_endpoint as ie

logging.disable(logging.CRITICAL)  # the failure-path tests log errors on purpose

CLASSIFIER = ie.Classifier()
BUCKET = "injury-photos"


def encode(img: Image.Image, fmt: str = "PNG", **params) -> bytes:
    buf = io.BytesIO()
    img.save(buf, fmt, **params)
    return buf.getvalue()


def photo() -> bytes:
    pixels = np.random.default_rng(0).integers(0, 256, (480, 640, 3), dtype=np.uint8)
    return encode(Image.fromarray(pixels), "JPEG")


class FakeSupabase:
    """Just enough of Supabase's REST and Storage APIs, served through httpx.MockTransport."""

    def __init__(self):
        self.rows: list[dict] = []
        self.objects: dict[tuple[str, str], bytes] = {}
        self.failing_downloads = 0  # make the next N downloads fail with a connection error
        self.on_download = None  # called before each download is answered

    def client(self):
        http = httpx.Client(transport=httpx.MockTransport(self.handle))
        return create_client("https://example.supabase.co", "sb_secret_test", ClientOptions(httpx_client=http))

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == f"/rest/v1/{ie.TABLE}":
            return self.table(request)
        if path.startswith("/storage/v1/object/"):
            bucket, _, key = path.removeprefix("/storage/v1/object/").partition("/")
            return self.storage(request, bucket, key)
        raise AssertionError(f"unexpected request {request.method} {request.url}")

    def matching(self, params: httpx.QueryParams) -> list[dict]:
        filters = {}
        for column, condition in params.items():
            if column not in ("select", "order", "limit"):
                op, _, value = condition.partition(".")
                assert op == "eq", condition
                filters[column] = value
        return [r for r in self.rows if all(str(r.get(c)) == v for c, v in filters.items())]

    def table(self, request: httpx.Request) -> httpx.Response:
        params = request.url.params
        if request.method == "GET":
            rows = sorted(self.matching(params), key=lambda r: r["created_at"])[: int(params["limit"])]
            columns = params["select"].split(",")
            return httpx.Response(200, json=[{c: r[c] for c in columns} for r in rows])
        if request.method == "PATCH":
            rows = self.matching(params)
            for r in rows:
                r.update(json.loads(request.content))
            return httpx.Response(200, json=rows)
        if request.method == "POST":
            row = self.add_row(**json.loads(request.content))
            return httpx.Response(201, json=[row])
        raise AssertionError(f"unexpected {request.method}")

    def storage(self, request: httpx.Request, bucket: str, key: str) -> httpx.Response:
        if request.method == "GET":
            if self.on_download:
                self.on_download()
            if self.failing_downloads:
                self.failing_downloads -= 1
                raise httpx.ConnectError("connection reset", request=request)
            if (bucket, key) not in self.objects:
                return httpx.Response(400, json={"statusCode": "404", "error": "not_found", "message": "Object not found"})
            return httpx.Response(200, content=self.objects[(bucket, key)])
        if request.method == "DELETE":
            paths = json.loads(request.content)["prefixes"]
            removed = [p for p in paths if self.objects.pop((bucket, p), None) is not None]
            return httpx.Response(200, json=[{"name": p, "bucket_id": bucket} for p in removed])
        if request.method == "POST":  # upload: a multipart form holding the file
            header = b"Content-Type: " + request.headers["content-type"].encode() + b"\r\n\r\n"
            form = BytesParser(policy=policy.HTTP).parsebytes(header + request.content)
            self.objects[(bucket, key)] = next(p.get_content() for p in form.iter_parts() if p.get_filename())
            return httpx.Response(200, json={"Key": f"{bucket}/{key}", "Id": str(uuid.uuid4())})
        raise AssertionError(f"unexpected {request.method}")

    def add_row(self, **fields) -> dict:
        row = {
            "id": str(uuid.uuid4()),
            "status": "queued",
            "inference": "incomplete",
            "created_at": f"2026-10-14T10:00:{len(self.rows):02d}Z",
            **fields,
        }
        self.rows.append(row)
        return row


class PreprocessTests(unittest.TestCase):
    def test_normalises_to_nchw_float32(self):
        x = ie.preprocess(encode(Image.new("RGB", (640, 480), (255, 0, 0))))
        self.assertEqual((x.shape, x.dtype), ((1, 3, 224, 224), np.float32))
        red = np.array([(1 - 0.485) / 0.229, -0.456 / 0.224, -0.406 / 0.225], dtype=np.float32)  # ImageNet mean/std
        np.testing.assert_allclose(x[0], np.broadcast_to(red[:, None, None], (3, 224, 224)), rtol=1e-6)

    def test_resizes_short_side_then_center_crops(self):
        img = Image.new("L", (512, 256), 0)  # short side already 256, so no resampling
        img.paste(255, (256, 0, 512, 256))  # right half white
        x = ie.preprocess(encode(img))[0, 0]  # the crop spans columns 144..367
        self.assertTrue((x[:, :112] < 0).all() and (x[:, 112:] > 0).all())

    def test_applies_exif_rotation(self):
        img = Image.new("RGB", (400, 300), (0, 0, 0))
        img.paste((255, 255, 255), (0, 0, 200, 300))
        exif = Image.Exif()
        exif[0x0112] = 6  # "rotate 90° clockwise to display", as phones write it
        np.testing.assert_array_equal(
            ie.preprocess(encode(img, exif=exif)),
            ie.preprocess(encode(img.transpose(Image.Transpose.ROTATE_270))),
        )

    def test_rejects_non_images_and_extreme_shapes(self):
        with self.assertRaises(Exception):
            ie.preprocess(b"definitely not an image")
        with self.assertRaises(ValueError):
            ie.preprocess(encode(Image.new("RGB", (4000, 100))))


class ClassifierTests(unittest.TestCase):
    def test_returns_every_label_most_likely_first(self):
        results = CLASSIFIER.classify(photo())
        self.assertCountEqual([label for label, _ in results], CLASSIFIER.labels)
        probs = [p for _, p in results]
        self.assertAlmostEqual(sum(probs), 1.0, places=5)
        self.assertEqual(probs, sorted(probs, reverse=True))

    def test_label_count_must_match_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            labels = Path(tmp, "labels.txt")
            labels.write_text("cut\nburn\n")
            with self.assertRaises(ValueError):
                ie.Classifier(labels_path=labels)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeSupabase()
        self.worker = ie.Worker(self.fake.client(), CLASSIFIER, interval=0)

    def queue(self, image: bytes, path: str = "user-1/photo.jpg", status: str = "queued") -> dict:
        self.fake.objects[(BUCKET, path)] = image
        return self.fake.add_row(
            status=status,
            storage_path=path,
            storage_url=f"https://example.supabase.co/storage/v1/object/public/{BUCKET}/{path}",
        )

    def stored(self, row: dict) -> bool:
        return (BUCKET, row["storage_path"]) in self.fake.objects

    def test_labels_queued_photo_and_deletes_it(self):
        first, second = self.queue(photo()), self.queue(photo(), path="user-2/photo.jpg")
        self.worker.run(once=True)
        for row in (first, second):
            self.assertEqual(row["status"], "completed")
            self.assertIn(row["inference"], CLASSIFIER.labels)
        self.assertEqual(self.fake.objects, {})
        self.assertEqual(self.worker.stats, {"completed": 2, "failed": 0})

    def test_unreadable_photo_fails_and_is_kept(self):
        row = self.queue(b"not an image")
        self.worker.run(once=True)
        self.assertEqual((row["status"], row["inference"]), ("failed", "incomplete"))
        self.assertTrue(self.stored(row))

    def test_missing_photo_fails_after_retries(self):
        row = self.queue(photo())
        self.fake.objects.clear()
        self.worker.run(once=True)
        self.assertEqual(row["status"], "failed")

    def test_retries_download_errors(self):
        row = self.queue(photo())
        self.fake.failing_downloads = 1
        self.worker.run(once=True)
        self.assertEqual(row["status"], "completed")

    def test_gives_up_after_max_attempts(self):
        row = self.queue(photo())
        self.fake.failing_downloads = 99
        self.worker.run(once=True)
        self.assertEqual(row["status"], "failed")
        self.assertEqual(99 - self.fake.failing_downloads, ie.MAX_ATTEMPTS)
        self.assertTrue(self.stored(row))

    def test_leaves_rows_claimed_elsewhere_alone(self):
        row = self.queue(photo(), status="processing")
        self.worker.handle(dict(row))
        self.assertEqual(row["status"], "processing")
        self.assertTrue(self.stored(row))

    def test_keeps_photo_if_row_changes_mid_processing(self):
        row = self.queue(photo())
        self.fake.on_download = lambda: row.update(status="queued")  # e.g. re-queued by a restart
        self.worker.handle(dict(row))
        self.assertEqual((row["status"], row["inference"]), ("queued", "incomplete"))
        self.assertTrue(self.stored(row))

    def test_recover_requeues_stuck_rows_only(self):
        stuck = self.queue(photo(), status="processing")
        done = self.queue(photo(), path="user-1/old.jpg", status="completed")
        self.worker.recover()
        self.assertEqual((stuck["status"], done["status"]), ("queued", "completed"))

    def test_enqueue_then_process(self):
        with tempfile.TemporaryDirectory() as tmp:
            image = Path(tmp, "injury.jpg")
            image.write_bytes(photo())
            row_id = ie.enqueue(self.fake.client(), image, BUCKET)
        row = next(r for r in self.fake.rows if r["id"] == row_id)
        self.assertEqual(ie.locate_image(row)[0], BUCKET)
        self.worker.run(once=True)
        self.assertEqual(row["status"], "completed")
        self.assertEqual(self.fake.objects, {})

    def test_health_endpoint(self):
        server = ie.start_health_server(0, self.worker)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_address[1]}/health"
        with urllib.request.urlopen(url) as resp:
            self.assertEqual(resp.status, 200)
            self.assertTrue(json.load(resp)["ok"])
        self.worker.heartbeat = 0  # stalled
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(url)
        ctx.exception.close()
        self.assertEqual(ctx.exception.code, 503)


class HelperTests(unittest.TestCase):
    def test_locate_image(self):
        public = f"https://x.supabase.co/storage/v1/object/public/{BUCKET}/u1/a.jpg"
        signed = f"https://x.supabase.co/storage/v1/object/sign/{BUCKET}/u1/a.jpg?token=abc"
        self.assertEqual(ie.locate_image({"storage_path": "u1/a.jpg", "storage_url": public}), (BUCKET, "u1/a.jpg"))
        self.assertEqual(ie.locate_image({"storage_path": "u1/a.jpg", "storage_url": signed}), (BUCKET, "u1/a.jpg"))
        prefixed = {"storage_path": f"{BUCKET}/u1/a.jpg", "storage_url": public}
        self.assertEqual(ie.locate_image(prefixed), (BUCKET, "u1/a.jpg"))
        configured = {"storage_path": "u1/a.jpg", "storage_url": "anything"}
        self.assertEqual(ie.locate_image(configured, "photos"), ("photos", "u1/a.jpg"))
        with self.assertRaises(ie.PermanentError):
            ie.locate_image({"storage_path": "u1/a.jpg", "storage_url": "https://example.com/a.jpg"})

    def test_key_role(self):
        def jwt(claims: dict) -> str:
            payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
            return f"eyJhbGciOiJIUzI1NiJ9.{payload}.signature"

        self.assertEqual(ie.key_role(jwt({"role": "anon"})), "anon")
        self.assertEqual(ie.key_role(jwt({"role": "service_role"})), "service_role")
        self.assertEqual(ie.key_role("sb_secret_abc"), "secret")
        self.assertEqual(ie.key_role("sb_publishable_abc"), "publishable")
        self.assertIsNone(ie.key_role("not-a-key"))


if __name__ == "__main__":
    unittest.main()
