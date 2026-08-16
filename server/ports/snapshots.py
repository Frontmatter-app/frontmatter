"""Durable storage for room state, behind a port.

This is what makes losing a room safe. A Yjs room lives in process memory; if
the process dies, the snapshot is what the next reader loads. It is the
system's durability boundary — deliberately NOT git, because committing on
every keystroke would turn the history into noise, and committing rarely would
mean losing work. Snapshots are frequent and cheap; commits are meaningful and
sparse.

The previous implementation reached straight for a Cloudflare R2 bucket via a
module-level boto3 client, which made object storage a hard requirement for
running the sync server at all. The default here is a directory.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Protocol

from server.config import get_settings


class SnapshotStore(Protocol):
    async def load(self, key: str) -> bytes | None: ...
    async def store(self, key: str, payload: bytes) -> None: ...
    async def delete(self, key: str) -> None: ...


def _safe_relative_path(key: str) -> Path:
    """Maps a room key to a path that cannot escape the snapshot root.

    Room keys will eventually carry repository and branch names supplied by
    clients, so treating them as trusted path segments would be a directory
    traversal waiting to happen.
    """
    cleaned = key.replace("\\", "/")
    parts = [segment for segment in cleaned.split("/") if segment not in ("", ".", "..")]
    if not parts:
        raise ValueError(f"unusable snapshot key: {key!r}")
    return Path(*parts)


class FilesystemSnapshotStore:
    """Snapshots as files under a directory. The default."""

    def __init__(self, root: Path) -> None:
        self._root = Path(root).expanduser().resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self._root / _safe_relative_path(key)

    async def load(self, key: str) -> bytes | None:
        def _read() -> bytes | None:
            path = self._path(key)
            if not path.is_file():
                return None
            return path.read_bytes()

        return await asyncio.get_running_loop().run_in_executor(None, _read)

    async def store(self, key: str, payload: bytes) -> None:
        def _write() -> None:
            path = self._path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            # Write-then-rename: a crash mid-write must not leave a truncated
            # snapshot, because a truncated snapshot is an unrecoverable room.
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_bytes(payload)
            temporary.replace(path)

        await asyncio.get_running_loop().run_in_executor(None, _write)

    async def delete(self, key: str) -> None:
        def _unlink() -> None:
            self._path(key).unlink(missing_ok=True)

        await asyncio.get_running_loop().run_in_executor(None, _unlink)


class S3SnapshotStore:
    """Any S3-compatible bucket: AWS, Cloudflare R2, MinIO, Backblaze."""

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.s3_bucket:
            raise RuntimeError("FM_SNAPSHOT_STORE=s3 requires FM_S3_BUCKET.")
        import boto3

        self._bucket = settings.s3_bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            region_name=settings.s3_region,
        )

    async def _run(self, fn, *args, **kwargs):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))

    async def load(self, key: str) -> bytes | None:
        def _get() -> bytes | None:
            try:
                response = self._client.get_object(Bucket=self._bucket, Key=key)
                return response["Body"].read()
            except self._client.exceptions.NoSuchKey:
                return None
            except Exception:
                return None

        return await self._run(_get)

    async def store(self, key: str, payload: bytes) -> None:
        await self._run(
            self._client.put_object,
            Bucket=self._bucket,
            Key=key,
            Body=payload,
            ContentType="application/octet-stream",
        )

    async def delete(self, key: str) -> None:
        await self._run(self._client.delete_object, Bucket=self._bucket, Key=key)


_store: SnapshotStore | None = None


def get_snapshot_store() -> SnapshotStore:
    global _store
    if _store is None:
        settings = get_settings()
        if settings.snapshot_store == "s3":
            _store = S3SnapshotStore()
        else:
            _store = FilesystemSnapshotStore(settings.snapshot_path)
    return _store


def set_snapshot_store(store: SnapshotStore | None) -> None:
    """Test seam — lets a suite install an in-memory store."""
    global _store
    _store = store
