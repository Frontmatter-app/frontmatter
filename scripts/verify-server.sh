#!/usr/bin/env bash
#
# Smoke-tests a running Frontmatter Sync server by doing what a user does:
# create an account, sign in, open a collaboration socket from two peers, and
# check that what one writes reaches the other.
#
# This exercises the deployed artifact — the container, over the network, with
# real TLS-less HTTP and a real websocket — rather than an in-process test
# client. It is what CI runs against the built image, so CI verifies the thing
# you actually deploy.
#
#     docker compose up -d
#     ./scripts/verify-server.sh
#
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
WS_URL="$(printf '%s' "$BASE_URL" | sed -e 's|^http|ws|')"

pass() { printf '  \033[32mok\033[0m    %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; exit 1; }

printf '\nVerifying %s\n\n' "$BASE_URL"

# ── health ───────────────────────────────────────────────────────────────────
status=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/health" || echo 000)
[ "$status" = "200" ] || fail "server is not answering on $BASE_URL (got $status)"
pass "health"

identity=$(curl -sS "$BASE_URL/config" | python3 -c 'import json,sys; print(json.load(sys.stdin)["identity"])')
pass "config reports identity=$identity"

# ── accounts, with no external identity provider ─────────────────────────────
email="verify-$(date +%s)-$RANDOM@example.com"
password="correct-horse-battery-staple"

code=$(curl -sS -o /tmp/fm-register.json -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"$password\"}" \
  "$BASE_URL/auth/register")
[ "$code" = "201" ] || fail "registration returned $code: $(cat /tmp/fm-register.json)"
user_id=$(python3 -c 'import json;print(json.load(open("/tmp/fm-register.json"))["id"])')
pass "registered a new account"

token=$(curl -sS -X POST \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "username=$email" \
  --data-urlencode "password=$password" \
  "$BASE_URL/auth/jwt/login" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
[ -n "$token" ] || fail "login returned no token"
pass "signed in"

code=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "$BASE_URL/users/me")
[ "$code" = "200" ] || fail "authenticated request returned $code"
pass "bearer token is accepted"

code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/users/me")
[ "$code" = "401" ] || fail "unauthenticated request returned $code, expected 401"
pass "unauthenticated request is refused"

# ── collaboration over a real websocket ──────────────────────────────────────
python3 - "$WS_URL" "$user_id" "$token" <<'PYTHON'
import asyncio, sys, subprocess

ws_base, user_id, token = sys.argv[1], sys.argv[2], sys.argv[3]

try:
    import websockets
    from pycrdt import Doc, Text
except ImportError:
    print("  \033[33mskip\033[0m  websocket checks (pip install websockets pycrdt)")
    raise SystemExit(0)

MSG_SYNC = 0
SYNC_STEP_1, SYNC_STEP_2, SYNC_UPDATE = 0, 1, 2

def w(v):
    out = bytearray()
    while True:
        b = v & 0x7F
        v >>= 7
        if v: out.append(b | 0x80)
        else:
            out.append(b); return bytes(out)

def r(data, off=0):
    val = shift = 0
    while True:
        b = data[off]; off += 1
        val |= (b & 0x7F) << shift
        if not b & 0x80: return val, off
        shift += 7

def rb(data, off):
    n, off = r(data, off)
    return data[off:off+n], off+n

def frame(sub, payload):
    return w(MSG_SYNC) + w(sub) + w(len(payload)) + payload

def ok(msg):  print(f"  \033[32mok\033[0m    {msg}")
def bad(msg): print(f"  \033[31mFAIL\033[0m  {msg}"); sys.exit(1)

room = f"{ws_base}/collab/user/{user_id}/verify.md?token={token}"

async def main():
    # Rejects an unauthenticated socket.
    try:
        async with websockets.connect(f"{ws_base}/collab/user/{user_id}/x.md"):
            bad("socket without a token was accepted")
    except Exception:
        ok("socket without a token is refused")

    async with websockets.connect(room) as a, websockets.connect(room) as b:
        first = await asyncio.wait_for(a.recv(), timeout=5)
        mt, off = r(first, 0); st, off = r(first, off)
        if (mt, st) != (MSG_SYNC, SYNC_STEP_1):
            bad("server did not open with its state vector")
        ok("server opens the sync handshake")
        await asyncio.wait_for(b.recv(), timeout=5)

        doc = Doc()
        text = doc.get("markdown", type=Text)
        text += "written by the first peer"
        await a.send(frame(SYNC_UPDATE, doc.get_update()))

        # The other peer must receive it.
        deadline = asyncio.get_event_loop().time() + 8
        received = None
        while asyncio.get_event_loop().time() < deadline:
            try:
                msg = await asyncio.wait_for(b.recv(), timeout=2)
            except asyncio.TimeoutError:
                continue
            mt, off = r(msg, 0)
            if mt != MSG_SYNC: continue
            st, off = r(msg, off)
            payload, _ = rb(msg, off)
            if payload:
                received = payload; break
        if received is None:
            bad("the second peer never received the first peer's edit")

        mirror = Doc()
        mirror.apply_update(received)
        if "written by the first peer" not in str(mirror.get("markdown", type=Text)):
            bad("the delivered update did not contain the text")
        ok("two peers converge on the same document")

asyncio.run(main())
PYTHON

printf '\n\033[32mAll checks passed.\033[0m\n\n'
