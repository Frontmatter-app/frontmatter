"""Signing in as your git provider account.

The server needs to know *who* somebody is, and the repository already knows.
Rather than asking people to invent a password for a second account whose only
purpose is to mirror the first, they sign in with the provider that owns the
repositories they came here to edit. Their cursor then carries their real name,
and their commits their real address, without anybody typing either.

Two credentials, deliberately kept apart:

  * **This one** authorises the server to learn an identity, and asks for
    nothing else — `read:user` and `user:email` on GitHub. It cannot read code
    and cannot write anything.
  * **The desktop app's**, from the device flow in `src/forge/deviceFlow.ts`,
    can write to repositories and never leaves the user's keychain.

Keeping them separate is what lets `forge/ports.ts` keep its promise: a
compromised server cannot commit to anybody's repository, because it has never
held a credential that could.

The port exists so the flow can be tested without GitHub, and so a second
provider is an implementation rather than a rewrite.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlencode

import httpx

from server.config import get_settings


@dataclass(frozen=True)
class ForgeProfile:
    """Who the provider says this is."""

    provider: str
    external_id: str
    login: str
    email: str | None
    display_name: str | None
    avatar_url: str | None


class IdentityError(Exception):
    """The provider refused, or answered with something unusable."""


class IdentityProvider(Protocol):
    name: str

    def authorize_url(self, *, state: str, redirect_uri: str) -> str: ...

    async def exchange(self, *, code: str, redirect_uri: str) -> ForgeProfile: ...


class GitHubIdentity:
    """GitHub's OAuth authorization-code flow, for identity only."""

    name = "github"

    # Identity, and nothing else. `read:user` reads the profile; `user:email`
    # reads the verified address even when the user hides it publicly — without
    # it, commits made on their behalf carry no attribution.
    SCOPES = "read:user user:email"

    def __init__(self, client_id: str, client_secret: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret

    def authorize_url(self, *, state: str, redirect_uri: str) -> str:
        query = urlencode(
            {
                "client_id": self._client_id,
                "redirect_uri": redirect_uri,
                "scope": self.SCOPES,
                "state": state,
                "allow_signup": "true",
            }
        )
        return f"https://github.com/login/oauth/authorize?{query}"

    async def exchange(self, *, code: str, redirect_uri: str) -> ForgeProfile:
        async with httpx.AsyncClient(timeout=15) as client:
            token = await self._access_token(client, code=code, redirect_uri=redirect_uri)
            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }

            profile = await client.get("https://api.github.com/user", headers=headers)
            if profile.status_code != 200:
                raise IdentityError("GitHub would not describe the account.")
            body = profile.json()

            email = body.get("email")
            if not email:
                email = await self._primary_email(client, headers)

        if not body.get("id") or not body.get("login"):
            raise IdentityError("GitHub returned an account with no identity.")

        return ForgeProfile(
            provider=self.name,
            external_id=str(body["id"]),
            login=body["login"],
            email=email,
            display_name=body.get("name") or body.get("login"),
            avatar_url=body.get("avatar_url"),
        )

    async def _access_token(
        self, client: httpx.AsyncClient, *, code: str, redirect_uri: str
    ) -> str:
        response = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
        if response.status_code != 200:
            raise IdentityError("GitHub rejected the sign-in.")

        payload = response.json()
        # GitHub reports failure with a 200 and an `error` field, so the status
        # code alone is not enough to tell success from an expired code.
        if payload.get("error") or not payload.get("access_token"):
            raise IdentityError("That sign-in link has expired. Try again.")
        return str(payload["access_token"])

    async def _primary_email(self, client: httpx.AsyncClient, headers: dict[str, str]) -> str | None:
        """The verified primary address, when the profile hides it.

        Unverified addresses are ignored: an address somebody has not proved
        they control is not an identity, and writing it into commit trailers
        would attribute writing to whoever really owns it.
        """
        response = await client.get("https://api.github.com/user/emails", headers=headers)
        if response.status_code != 200:
            return None
        for entry in response.json():
            if entry.get("primary") and entry.get("verified"):
                return entry.get("email")
        return None


class FakeIdentity:
    """Answers with a fixed profile. For tests and for local development."""

    name = "fake"

    def __init__(self, profile: ForgeProfile | None = None) -> None:
        self.profile = profile or ForgeProfile(
            provider="fake",
            external_id="1",
            login="testuser",
            email="test@example.com",
            display_name="Test User",
            avatar_url=None,
        )
        self.exchanged: list[str] = []

    def authorize_url(self, *, state: str, redirect_uri: str) -> str:
        return f"https://identity.test/authorize?state={state}&redirect_uri={redirect_uri}"

    async def exchange(self, *, code: str, redirect_uri: str) -> ForgeProfile:
        if code == "bad-code":
            raise IdentityError("That sign-in link has expired. Try again.")
        self.exchanged.append(code)
        return self.profile


_providers: dict[str, IdentityProvider] = {}


def configured_providers() -> list[str]:
    """Which providers this deployment can actually sign somebody in with.

    Read from configuration rather than from the registry so that `/config`
    tells a client the truth before anybody has signed in and populated it.
    """
    settings = get_settings()
    names: list[str] = []
    if settings.github_client_id and settings.github_client_secret:
        names.append("github")
    names.extend(name for name in _providers if name not in names)
    return names


def get_identity_provider(name: str) -> IdentityProvider:
    if name in _providers:
        return _providers[name]

    settings = get_settings()
    if name == "github":
        if not settings.github_client_id or not settings.github_client_secret:
            raise IdentityError("GitHub sign-in is not configured on this server.")
        provider = GitHubIdentity(settings.github_client_id, settings.github_client_secret)
        _providers[name] = provider
        return provider

    raise IdentityError(f"Unknown sign-in provider: {name}")


def set_identity_provider(name: str, provider: IdentityProvider | None) -> None:
    """Installs a provider. Tests use this; so does a self-hosted extension."""
    if provider is None:
        _providers.pop(name, None)
    else:
        _providers[name] = provider


def new_state() -> str:
    """Opaque value tying a callback back to the request that started it."""
    return secrets.token_urlsafe(24)
