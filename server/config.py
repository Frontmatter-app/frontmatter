"""Server configuration, entirely from the environment.

Every default here is chosen so that `docker compose up` works with no cloud
accounts, no external identity provider, and no configuration file: SQLite on a
volume, snapshots on a volume, identity handled in-process.

That is a deliberate inversion of the previous backend, which could not start
without a Firebase service account, a Cloudflare R2 bucket, a Creem key, and a
Resend key — four paid services to run a text editor's sync server.
"""
from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="FM_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Identity ──────────────────────────────────────────────────────────────
    # `builtin` needs nothing external. `oidc` delegates to any OIDC issuer
    # (Keycloak, Authentik, Zitadel, Okta). `forge` trusts a GitHub/GitLab token.
    identity: Literal["builtin", "oidc", "forge"] = "builtin"

    # Signing key for session tokens. Generated on first boot if unset, which is
    # fine for a single-process deployment and wrong for more than one: every
    # replica would mint tokens the others reject. Set it explicitly in
    # production — the startup log says so.
    secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(48))

    # Short, because a JWT cannot be revoked: once issued it is good until it
    # expires, whatever happens to the account meanwhile. An hour bounds that.
    # It used to be seven days, which is both long enough for a stolen token to
    # be worth having and short enough to sign out anyone who keeps the app
    # open — the worst of both, and the reason refresh tokens exist.
    access_token_lifetime_seconds: int = 60 * 60

    # Long, because this one *can* be revoked: it is stored, rotated on every
    # use, and retired the moment it looks compromised.
    refresh_token_lifetime_seconds: int = 60 * 60 * 24 * 60

    # Whether a new account must confirm its email before signing in. Off by
    # default because the default mailer writes to the console; turn it on once
    # SMTP is configured.
    require_email_verification: bool = False
    allow_registration: bool = True

    oidc_issuer: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None

    # Sign in with a git provider. The credential this authorises reads a
    # profile and nothing else — it cannot read code and cannot write. The
    # token that *can* write to repositories is issued to the desktop app by
    # its own device flow and never reaches this server.
    github_client_id: str | None = None
    github_client_secret: str | None = None

    # ── Storage ───────────────────────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./data/frontmatter.db"

    snapshot_store: Literal["filesystem", "s3"] = "filesystem"
    snapshot_path: Path = Path("./data/snapshots")

    s3_endpoint_url: str | None = None
    s3_bucket: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_region: str = "auto"

    # ── Mail ──────────────────────────────────────────────────────────────────
    # `console` prints the message instead of sending it, so a fresh deployment
    # can complete a signup before anyone configures SMTP.
    mailer: Literal["console", "smtp"] = "console"
    mail_from: str = "Frontmatter <noreply@localhost>"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = True

    # ── HTTP ──────────────────────────────────────────────────────────────────
    # The desktop app has no fixed web origin, so the default is permissive.
    # Narrow it if you expose a browser build.
    #
    # Held as a comma-separated string rather than a list because
    # pydantic-settings JSON-decodes complex types at the environment-source
    # level, before any validator runs — so `FM_CORS_ORIGINS=*` raises a parse
    # error rather than reaching a `mode="before"` hook. A string always
    # arrives intact; `cors_origin_list` does the splitting.
    cors_origins: str = "*"
    public_url: str = "http://localhost:8000"

    # ── Collaboration ─────────────────────────────────────────────────────────
    awareness_ttl_seconds: int = 30
    snapshot_debounce_seconds: int = 10
    # A room with no connections is evicted from memory after this long. Kept
    # briefly rather than immediately so a reconnect does not pay a reload.
    room_idle_eviction_seconds: int = 60

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def secret_key_is_ephemeral(self) -> bool:
        """True when no key was configured, so one was invented for this boot.

        Sessions do not survive a restart in that state, and multiple replicas
        would reject each other's tokens.
        """
        import os

        return not os.environ.get("FM_SECRET_KEY")


@lru_cache
def get_settings() -> Settings:
    return Settings()
