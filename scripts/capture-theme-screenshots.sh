#!/usr/bin/env bash
#
# Captures a real screenshot of every bundled theme.
#
# Builds a demo site per theme with the bundled zola, serves it, points Safari
# at it, screenshots the window, and writes the result to
# themes/<type>/default/screenshot.png — the filename each theme.toml declares.
#
#   bash scripts/capture-theme-screenshots.sh            # all types
#   bash scripts/capture-theme-screenshots.sh docs wiki  # only these
#
# macOS only. Needs Screen Recording permission for the terminal
# (System Settings ▸ Privacy & Security ▸ Screen Recording), otherwise
# `screencapture` writes a desktop-wallpaper image instead of the window.
#
# Screenshots are optional: a theme without one falls back to a generated
# wireframe in the publish dialog, so a failed run degrades rather than breaks.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZOLA="$ROOT/src-tauri/binaries/zola"
THEMES="$ROOT/themes"
WORK="$(mktemp -d)"
PORT=8787
# The window is opened at a fixed size, captured whole, then trimmed.
WIN_W=1600
# Physical pixels of Safari's title bar and toolbar, on a 2x display.
CHROME_H=156

TYPES=("$@")
if [ ${#TYPES[@]} -eq 0 ]; then
  TYPES=(docs blog book slides wiki portfolio changelog kb)
fi

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

if [ ! -x "$ZOLA" ]; then
  echo "zola binary not found at $ZOLA" >&2
  exit 1
fi

# ---------------------------------------------------------------- demo content
#
# Written once and reused for every theme, so the screenshots differ only by
# theme rather than by the text in them.

write_content() {
  local dir="$1" type="$2"
  mkdir -p "$dir/content/guide"

  cat > "$dir/content/_index.md" <<'EOF'
+++
title = "Meridian"
sort_by = "SORT_BY"
render = true
template = "index.html"
+++
Everything you need to build, ship, and operate with Meridian.
EOF
  sed -i '' "s/SORT_BY/$(sort_key "$type")/" "$dir/content/_index.md"

  page "$dir/content/getting-started.md" "Getting Started" 1 "2026-05-18" \
    "Install Meridian and send your first request in under five minutes."
  page "$dir/content/authentication.md" "Authentication" 2 "2026-04-22" \
    "API keys, token rotation, and scoping requests to an environment."
  page "$dir/content/rate-limits.md" "Rate Limits" 3 "2026-03-30" \
    "How quotas are counted, and what to do when you hit one."
  page "$dir/content/guide/concepts.md" "Core Concepts" 4 "2026-03-11" \
    "Projects, environments, and the objects that connect them."
  page "$dir/content/guide/webhooks.md" "Webhooks" 5 "2026-02-02" \
    "Subscribe to events and verify their signatures."

  cat > "$dir/content/guide/_index.md" <<EOF
+++
title = "Guide"
sort_by = "$(sort_key "$type")"
render = true
description = "Longer-form material once the basics are working."
+++
EOF
}

sort_key() {
  case "$1" in
    blog|changelog) echo "date" ;;
    wiki) echo "title" ;;
    *) echo "weight" ;;
  esac
}

page() {
  local file="$1" title="$2" weight="$3" date="$4" desc="$5"
  mkdir -p "$(dirname "$file")"
  cat > "$file" <<EOF
+++
title = "$title"
template = "page.html"
slug = "$(echo "$title" | tr '[:upper:] ' '[:lower:]-')"
weight = $weight
date = $date
description = "$desc"

[extra]
word_count = 780
reading_time_minutes = 4
depth = 0
tags = ["api", "platform"]
updated_at = "2026-05-19T08:30:00Z"
backlinks = [{ path = "getting-started/", title = "Getting Started" }, { path = "authentication/", title = "Authentication" }]
+++

$desc

## Before you start

Meridian speaks JSON over HTTPS. Every request carries an API key, and every
response includes a request id you can quote in a support thread.

\`\`\`bash
curl https://api.meridian.dev/v1/projects \\
  -H "Authorization: Bearer \$MERIDIAN_KEY"
\`\`\`

## Handling errors

A failed call returns a machine-readable \`code\` alongside a human-readable
\`message\`. Retry on \`5xx\`; fix and resend on \`4xx\`.

| Status | Meaning | Retry |
|---|---|---|
| 401 | Key missing or revoked | No |
| 429 | Quota exhausted | After the reset |
| 503 | Upstream unavailable | With backoff |

---

## What comes next

Read the [guide](guide/concepts.md) once the first call succeeds.
EOF
}

# ------------------------------------------------------------------- capture

capture() {
  local type="$1"
  local theme_dir="$THEMES/$type/default"
  local site="$WORK/$type"

  if [ ! -d "$theme_dir/templates" ]; then
    echo "  no theme at $theme_dir — skipping"
    return
  fi

  rm -rf "$site"
  mkdir -p "$site"
  cp -R "$theme_dir/templates" "$site/"
  [ -d "$theme_dir/sass" ] && cp -R "$theme_dir/sass" "$site/"
  [ -d "$theme_dir/static" ] && cp -R "$theme_dir/static" "$site/"

  cat > "$site/config.toml" <<EOF
base_url = "http://127.0.0.1:$PORT"
title = "Meridian"
description = "The API platform for teams that ship."
author = "Meridian"
build_search_index = true
compile_sass = true
default_language = "en"

[extra]
repo_url = "https://github.com/meridian/meridian"
product_url = "https://meridian.dev"
contact_url = "mailto:hello@meridian.dev"
support_url = "https://meridian.dev/support"
EOF

  write_content "$site" "$type"

  ( cd "$site" && "$ZOLA" build >/dev/null 2>&1 ) || {
    echo "  build failed for $type — skipping"
    return
  }

  # A leftover server keeps the port and silently serves the *previous*
  # theme, so every later screenshot came out identical.
  lsof -ti ":$PORT" | xargs kill -9 2>/dev/null || true

  python3 -m http.server "$PORT" --directory "$site/public" >/dev/null 2>&1 &
  SERVER_PID=$!
  sleep 1

  # Slides open on the deck itself; every other theme leads with its landing
  # page, which is what the picker should preview.
  local path="/"
  [ "$type" = "slides" ] && path="/getting-started/"

  # The window id must come back from the same script that opens the page:
  # fetching it in a second `osascript` call races with the navigation and
  # silently captured the previous theme's window.
  local wid
  wid=$(osascript <<OSA
tell application "Safari"
  activate
  if (count of documents) = 0 then make new document
  set URL of front document to "http://127.0.0.1:$PORT$path"
  delay 3
  set bounds of front window to {0, 0, $WIN_W, 1100}
  delay 1.5
  return id of front window as string
end tell
OSA
  )

  if [ -z "$wid" ]; then
    echo "  could not get a Safari window for $type"
    kill "$SERVER_PID" 2>/dev/null || true
    unset SERVER_PID
    return
  fi

  # Capture the window, not a screen region: `-R` grabs whatever is on top at
  # those coordinates, so any window overlapping Safari lands in the shot.
  screencapture -o -x -l "$wid" "$theme_dir/screenshot.png" 2>/dev/null || {
    echo "  screencapture failed for $type — check Screen Recording permission"
    kill "$SERVER_PID" 2>/dev/null || true
    unset SERVER_PID
    return
  }

  # `sips --cropOffset` is a no-op on this version, so the toolbar is removed
  # with a centred crop that takes an equal strip off the bottom. Losing the
  # last strip of a preview costs nothing.
  local h w
  h=$(sips -g pixelHeight "$theme_dir/screenshot.png" | awk '/pixelHeight/{print $2}')
  w=$(sips -g pixelWidth "$theme_dir/screenshot.png" | awk '/pixelWidth/{print $2}')
  echo "    raw ${w}x${h} -> crop $((h - 2 * CHROME_H))"
  sips -c "$((h - 2 * CHROME_H))" "$w" "$theme_dir/screenshot.png" >/dev/null 2>&1 || true
  sips -Z "$WIN_W" "$theme_dir/screenshot.png" >/dev/null 2>&1 || true
  echo "    final $(sips -g pixelWidth "$theme_dir/screenshot.png" | awk '/pixelWidth/{print $2}')x$(sips -g pixelHeight "$theme_dir/screenshot.png" | awk '/pixelHeight/{print $2}')"

  kill "$SERVER_PID" 2>/dev/null || true
  unset SERVER_PID
  echo "  wrote $theme_dir/screenshot.png"
}

for type in "${TYPES[@]}"; do
  echo "capturing $type"
  capture "$type"
done

osascript -e 'tell application "Safari" to close front window' >/dev/null 2>&1 || true
echo "done"
