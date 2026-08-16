# Self-hosting Frontmatter Sync

Frontmatter Sync is the collaboration server. It is one process with no cloud
dependencies: accounts, live editing sessions, and snapshots. Nothing else.

**You do not need it to use Frontmatter.** Writing, the draft/write/revise
workflow, prose linting, git, and publishing all work offline with no account.
A server is only needed for real-time collaboration.

## Quick start

```bash
git clone --recursive https://github.com/frontmatter-app/frontmatter.git
cd frontmatter
docker compose up
```

That is the whole setup. No Firebase project, no object storage, no identity
provider, no SMTP. Then in Frontmatter: **Settings → Account → Server URL** →
`http://localhost:8000`, and create an account.

Verify it independently at any time:

```bash
./scripts/verify-server.sh http://localhost:8000
```

This registers an account, signs in, opens two websockets, and checks that what
one peer writes reaches the other. It is the same script CI runs against the
built image.

## Before exposing it to a network

Two settings matter more than the rest.

**Set `FM_SECRET_KEY`.** Without it a random key is generated per boot, so every
restart signs everyone out, and two replicas reject each other's tokens. The
server warns about this on startup.

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

**Terminate TLS.** The websocket carries document content and bearer tokens. Put
Caddy or nginx in front and use `wss://`. A one-line Caddyfile:

```
sync.example.com {
    reverse_proxy localhost:8000
}
```

Then set `FM_PUBLIC_URL=https://sync.example.com` so password-reset links point
somewhere real, and `FM_CORS_ORIGINS` to your actual origins rather than `*`.

## Configuration

Every option is an environment variable prefixed `FM_`.

### Identity

| Variable | Default | Notes |
|---|---|---|
| `FM_IDENTITY` | `builtin` | `builtin`, `oidc`, or `forge` |
| `FM_ALLOW_REGISTRATION` | `true` | Set `false` after creating your accounts to close signups |
| `FM_REQUIRE_EMAIL_VERIFICATION` | `false` | Turn on only once mail works, or nobody can confirm an address |
| `FM_SECRET_KEY` | random per boot | **Set this.** Signs session tokens |
| `FM_ACCESS_TOKEN_LIFETIME_SECONDS` | `604800` | Seven days |

`builtin` handles accounts in-process — signup, login, verification, password
reset — with no external service. It is a library, not a second container.

### Storage

| Variable | Default | Notes |
|---|---|---|
| `FM_DATABASE_URL` | SQLite at `/data/frontmatter.db` | Postgres: uncomment `asyncpg` in `server/requirements.txt` and use `postgresql+asyncpg://…` |
| `FM_SNAPSHOT_STORE` | `filesystem` | or `s3` |
| `FM_SNAPSHOT_PATH` | `/data/snapshots` | |
| `FM_S3_BUCKET`, `FM_S3_ENDPOINT_URL`, `FM_S3_ACCESS_KEY_ID`, `FM_S3_SECRET_ACCESS_KEY` | — | Any S3-compatible store: AWS, R2, MinIO |

SQLite is genuinely fine for a team. The database holds accounts and session
metadata — **not documents**, which are files in your git repository.

### Mail

| Variable | Default | Notes |
|---|---|---|
| `FM_MAILER` | `console` | Prints mail to the container log |
| `FM_SMTP_HOST`, `FM_SMTP_PORT`, `FM_SMTP_USERNAME`, `FM_SMTP_PASSWORD` | — | |
| `FM_MAIL_FROM` | `Frontmatter <noreply@localhost>` | |

`console` exists so a first boot can complete a password reset before SMTP is
configured. Read the link out of `docker compose logs server`.

## What to back up

The `/data` volume. It holds accounts and the snapshots of anything edited but
not yet committed to git — the durability boundary for in-flight work.

Your documents are not here. They are files in your repository.

## What this server never has

Worth stating plainly, because it shapes the threat model:

- **No git credentials.** Commits are made by the desktop app using credentials
  in your operating system keychain. A compromised server cannot write to your
  repositories.
- **No document store.** Documents are files in git.
- **No image store.** Images are committed alongside the markdown.

A compromised server can read and alter documents being *actively edited on it*,
and can impersonate accounts. It cannot reach your repository history.

## Scaling

The server runs **one worker on purpose**. Rooms hold their Yjs document in
process memory, so every peer of a document must land in the same process — a
second worker would put two editors of one file in processes that never exchange
updates.

For a team this is not a constraint worth engineering around: a room is cheap
and idle rooms are evicted. Going beyond one process needs per-room affinity or
shared pub/sub, and the snapshot ownership rules change with it.

## Upgrading

```bash
git pull --recurse-submodules
docker compose up -d --build
```

Schema changes are applied on boot. There is no migration tool yet; the schema
is small and additive, and when it stops being either this will say Alembic
instead.

## Troubleshooting

**Container restarts on boot.** `docker compose logs server`. A malformed `FM_`
value is the usual cause — the server fails loudly rather than starting with a
setting it could not parse.

**Editors do not see each other.** Both must point at the same server and be
signed in. Check `curl http://your-server/health` reports a room count above
zero while a document is open.

**Password reset link goes to localhost.** Set `FM_PUBLIC_URL`.

**"No collaboration server is configured."** The app has no server URL. Settings
→ Account. This is not an error state — it is what running Frontmatter standalone
looks like.
