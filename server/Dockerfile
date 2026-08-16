# Frontmatter Sync — collaboration server
#
# Build context is ./server, so everything the image needs lives in one
# directory and the image cannot accidentally pick up the desktop app.

FROM python:3.12-slim AS base

# 3.12 rather than latest: pycrdt builds a native extension, and pinning the
# interpreter keeps the wheel resolution predictable across rebuilds.

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first, as their own layer: application edits are frequent and
# must not invalidate the (slow) dependency install.
COPY requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

COPY . /app/server/

# The default database and snapshot paths live here, and it is the documented
# mount point. Owned by the runtime user so a bind mount is writable.
RUN useradd --create-home --uid 10001 frontmatter \
    && mkdir -p /data/snapshots \
    && chown -R frontmatter:frontmatter /data /app

USER frontmatter

ENV FM_DATABASE_URL="sqlite+aiosqlite:////data/frontmatter.db" \
    FM_SNAPSHOT_PATH="/data/snapshots"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4).status==200 else 1)"

# One worker on purpose. Rooms hold their Yjs document in process memory, so
# every peer of a document must land in the same process; a second worker would
# put two editors of one file in separate processes that never exchange
# updates. Scaling past one worker needs per-room affinity or shared pub/sub,
# and the snapshot ownership rules change with it.
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
