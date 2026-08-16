"""Outgoing mail, behind a port.

The default writes to the log instead of sending. That is not a stub for later
— it is what makes a fresh `docker compose up` able to complete a password
reset before anyone has configured SMTP, which is the difference between a
self-hoster getting to a working system in one step or three.

The previous backend hard-required Resend, a paid account, to send an invite.
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from functools import lru_cache
from typing import Protocol

from server.config import get_settings

logger = logging.getLogger("frontmatter.mail")


class Mailer(Protocol):
    async def send(self, *, to: str, subject: str, body: str) -> None: ...


class ConsoleMailer:
    """Logs the message. Default, and the right default for a first boot."""

    async def send(self, *, to: str, subject: str, body: str) -> None:
        logger.warning(
            "\n"
            "──────── email (not sent: FM_MAILER=console) ────────\n"
            "To:      %s\n"
            "Subject: %s\n"
            "\n%s\n"
            "─────────────────────────────────────────────────────",
            to,
            subject,
            body,
        )


class SmtpMailer:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.smtp_host:
            raise RuntimeError("FM_MAILER=smtp requires FM_SMTP_HOST.")
        self._settings = settings

    async def send(self, *, to: str, subject: str, body: str) -> None:
        import asyncio

        settings = self._settings
        message = EmailMessage()
        message["From"] = settings.mail_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)

        def _deliver() -> None:
            with smtplib.SMTP(settings.smtp_host or "", settings.smtp_port) as smtp:
                if settings.smtp_starttls:
                    smtp.starttls()
                if settings.smtp_username and settings.smtp_password:
                    smtp.login(settings.smtp_username, settings.smtp_password)
                smtp.send_message(message)

        # smtplib is blocking; keep it off the event loop that is also serving
        # collaboration sockets.
        await asyncio.get_running_loop().run_in_executor(None, _deliver)


@lru_cache
def get_mailer() -> Mailer:
    settings = get_settings()
    if settings.mailer == "smtp":
        return SmtpMailer()
    return ConsoleMailer()
