"""Trading a claim for a room.

This is the only place a coordinate is turned into a room name, which is what
keeps the naming scheme single-sourced: clients never compute a room id, they
are told one. It is also where the optimistic join is decided, so it is the
natural home for the honesty the design depends on — the response says what was
verified and what was merely claimed, and the client is expected to show the
difference rather than quietly implying a guarantee.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from server.auth.users import current_active_user
from server.collab.room import registry
from server.models import User
from server.rooms import grants
from server.rooms.coordinates import InvalidCoordinate, canonicalize
from server.rooms.verify import Claim, apply_verdict, get_repo_verifier

logger = logging.getLogger("frontmatter.rooms")

router = APIRouter(prefix="/rooms", tags=["rooms"])


class CoordinateBody(BaseModel):
    provider: str = Field(max_length=32)
    host: str = Field(max_length=255)
    repo: str = Field(max_length=512)
    branch: str = Field(max_length=255)
    path: str = Field(max_length=1024)


class ClaimBody(BaseModel):
    permission: str = Field(pattern="^(read|write|admin)$")
    login: str = Field(max_length=255)
    externalId: str | None = Field(default=None, max_length=128)
    repoId: str | None = Field(default=None, max_length=128)


class GrantRequest(BaseModel):
    coordinate: CoordinateBody
    claim: ClaimBody


class GrantResponse(BaseModel):
    roomId: str
    token: str
    expiresIn: int
    renewAfter: int
    access: str
    verification: str
    peers: int


@router.post("/grant", response_model=GrantResponse)
async def grant_room_access(
    body: GrantRequest,
    user: User = Depends(current_active_user),
) -> GrantResponse:
    try:
        coordinate = canonicalize(
            provider=body.coordinate.provider,
            host=body.coordinate.host,
            repo=body.coordinate.repo,
            branch=body.coordinate.branch,
            path=body.coordinate.path,
        )
    except InvalidCoordinate as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error

    claim = Claim(
        permission=body.claim.permission,  # type: ignore[arg-type]
        login=body.claim.login,
        external_id=body.claim.externalId,
        repo_id=body.claim.repoId,
    )

    # Verification is on the request path only because it is expected to be
    # fast or absent. A verifier that needs to be slow should return `None`
    # here and downgrade the live connection when it has an answer, rather than
    # holding up the join.
    try:
        verdict = await get_repo_verifier().verify(coordinate=coordinate, claim=claim)
    except Exception as error:
        # A verifier that is down must not take collaboration down with it. An
        # unavailable authority means "cannot determine", which is what an
        # absent one means too.
        logger.warning("verifier failed for %s: %s", coordinate.repo, error)
        verdict = None

    access = apply_verdict(claim.level, verdict)
    if access == "none":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You do not have access to this repository.",
        )

    room_id = coordinate.room_id
    grant = grants.mint(room_id=room_id, user_id=str(user.id), access=access)

    return GrantResponse(
        roomId=room_id,
        token=grants.encode(grant),
        expiresIn=grants.GRANT_TTL_SECONDS,
        renewAfter=int(grants.GRANT_TTL_SECONDS * grants.GRANT_RENEW_AT),
        access=access,
        verification="verified" if verdict is not None else "unverified",
        peers=registry.peer_count(room_id),
    )
