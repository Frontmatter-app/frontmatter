#!/usr/bin/env bash
#
# Downloads the Zola binary that Frontmatter bundles to build published sites.
#
# The binary is not committed (it is ~34 MB and platform-specific), so a fresh
# clone has no `src-tauri/binaries/zola` and the publish wizard fails at the
# build step. Run this once after cloning.
#
# THE VERSION IS PINNED FOR LICENSING REASONS, NOT ONLY COMPATIBILITY ONES.
# Zola relicensed from MIT to EUPL-1.2 after v0.19.2. Bumping this pin changes
# the license of a binary we redistribute, so it requires re-reviewing the terms
# and updating NOTICE and src-tauri/binaries/LICENSE-zola. See NOTICE section 1.
set -euo pipefail

ZOLA_VERSION="v0.19.2"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest_dir="${repo_root}/src-tauri/binaries"
dest="${dest_dir}/zola"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  asset="zola-${ZOLA_VERSION}-aarch64-apple-darwin.tar.gz" ;;
  Darwin-x86_64) asset="zola-${ZOLA_VERSION}-x86_64-apple-darwin.tar.gz" ;;
  Linux-x86_64)  asset="zola-${ZOLA_VERSION}-x86_64-unknown-linux-gnu.tar.gz" ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "On Windows, download ${ZOLA_VERSION} manually from" >&2
    echo "  https://github.com/getzola/zola/releases/tag/${ZOLA_VERSION}" >&2
    echo "and place zola.exe at src-tauri/binaries/zola.exe" >&2
    exit 1
    ;;
  *)
    echo "No prebuilt Zola for $(uname -s)-$(uname -m)." >&2
    echo "Build it from source and place the binary at ${dest}" >&2
    exit 1
    ;;
esac

if [ -x "${dest}" ] && "${dest}" --version 2>/dev/null | grep -q "${ZOLA_VERSION#v}"; then
  echo "Zola ${ZOLA_VERSION} already present at ${dest}"
  exit 0
fi

url="https://github.com/getzola/zola/releases/download/${ZOLA_VERSION}/${asset}"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

echo "Downloading ${asset}..."
curl -sSfL "${url}" -o "${tmp}/zola.tar.gz"

tar -xzf "${tmp}/zola.tar.gz" -C "${tmp}"
mkdir -p "${dest_dir}"
mv "${tmp}/zola" "${dest}"
chmod +x "${dest}"

echo "Installed $("${dest}" --version) at ${dest}"
