FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt /app/requirements.txt

RUN pip install -r requirements.txt

# Only what the worker needs: never .env or the tests.
COPY inference_endpoint.py labels.txt resent18_trained.onnx resent18_trained.onnx.data /app/

RUN useradd --create-home --uid 1000 app
USER app

CMD ["python", "inference_endpoint.py"]

# GET /health (change with the PORT variable)
EXPOSE 5000
