"""Getting a browser sign-in back to the desktop app.

The sign-in happens in the real browser — where the address bar is visible and
the user's existing provider session already lives — but the session it produces
is needed by an application on the other side of the operating system. Something
has to carry it across.

A custom URL scheme (`frontmatter://`) is the usual answer and is deliberately
not used here: it has to be registered per platform, breaks under some browsers
and most sandboxes, and fails in a way the user cannot act on. Instead the app
opens the browser holding a pairing code, and polls for it — the same shape as
the device flow people already use to connect a provider, and it works anywhere
a browser and a network exist.

The store is in-process, which matches the rest of the deployment: rooms are
process-local and the container runs one worker on purpose. Pairing codes live
for minutes, so losing them to a restart costs somebody one retry.
"""
from __future__ import annotations

import secrets
import time
from dataclasses import dataclass

# Long enough that guessing is hopeless, short enough to stay a URL parameter.
CODE_BYTES = 32

# The window between opening the browser and finishing the sign-in. Generous,
# because it may include creating an account or approving an organisation.
PAIRING_TTL_SECONDS = 10 * 60


@dataclass
class Pairing:
    code: str
    provider: str
    state: str
    expires_at: float
    token: str | None = None
    refresh_token: str | None = None
    error: str | None = None

    @property
    def is_settled(self) -> bool:
        return self.token is not None or self.error is not None


class PairingStore:
    """Pending and completed sign-ins, by code."""

    def __init__(self) -> None:
        self._pairings: dict[str, Pairing] = {}
        # Indexed separately because the callback arrives knowing only the
        # `state` it was given, never the code.
        self._by_state: dict[str, str] = {}

    def begin(self, provider: str) -> Pairing:
        self._evict_expired()
        pairing = Pairing(
            code=secrets.token_urlsafe(CODE_BYTES),
            provider=provider,
            state=secrets.token_urlsafe(24),
            expires_at=time.monotonic() + PAIRING_TTL_SECONDS,
        )
        self._pairings[pairing.code] = pairing
        self._by_state[pairing.state] = pairing.code
        return pairing

    def by_state(self, state: str) -> Pairing | None:
        self._evict_expired()
        code = self._by_state.get(state)
        return self._pairings.get(code) if code else None

    def settle(
        self,
        state: str,
        *,
        token: str | None = None,
        refresh_token: str | None = None,
        error: str | None = None,
    ) -> bool:
        """Records the outcome of a callback. Returns whether it was expected."""
        pairing = self.by_state(state)
        if pairing is None:
            return False
        # First outcome wins. A replayed callback must not overwrite a session
        # that has already been handed to the app.
        if pairing.is_settled:
            return True
        pairing.token = token
        pairing.refresh_token = refresh_token
        pairing.error = error
        return True

    def claim(self, code: str) -> Pairing | None:
        """Hands over a settled sign-in, once.

        Single-use: the token is removed as it is read, so a code intercepted
        after the app has already claimed it is worth nothing. An unsettled
        pairing is returned without being consumed, because the app is still
        polling for it.
        """
        self._evict_expired()
        pairing = self._pairings.get(code)
        if pairing is None:
            return None
        if not pairing.is_settled:
            return pairing

        self._pairings.pop(code, None)
        self._by_state.pop(pairing.state, None)
        return pairing

    def _evict_expired(self) -> None:
        now = time.monotonic()
        stale = [code for code, pairing in self._pairings.items() if pairing.expires_at <= now]
        for code in stale:
            pairing = self._pairings.pop(code)
            self._by_state.pop(pairing.state, None)

    def clear(self) -> None:
        self._pairings.clear()
        self._by_state.clear()


store = PairingStore()
