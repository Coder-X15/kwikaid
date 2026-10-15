FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt /app/requirements.txt

RUN pip install --no-cache-dir -r requirements.txt

COPY . /app

# Background worker: no port to expose. Pass secrets at run time, e.g.
#   docker run --env-file .env.local kwikaid-worker
CMD ["python", "inference_endpoint.py"]
