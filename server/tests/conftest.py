from __future__ import annotations

import os
import tempfile

# Set before anything imports server.config, whose Settings are cached: tests
# must never touch a developer's real database or snapshot directory.
_tmp = tempfile.mkdtemp(prefix="frontmatter-tests-")
os.environ.setdefault("FM_DATABASE_URL", f"sqlite+aiosqlite:///{_tmp}/test.db")
os.environ.setdefault("FM_SNAPSHOT_PATH", f"{_tmp}/snapshots")
os.environ.setdefault("FM_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("FM_MAILER", "console")

import pytest  # noqa: E402


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"
