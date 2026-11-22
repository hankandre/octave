#!/usr/bin/env bash
# Starts the three pinned fixture servers (Jellyfin 10.11, Jellyfin 12.4, Jellyscale).
# Jellyscale makes its only user at its first start, from a password given in the
# environment (T2-08), so the password is generated first into a gitignored file and
# is never printed. The file is kept as it is when it already exists.
# --env-only stops after the file step (the unit test uses it).
set -euo pipefail
umask 077

script_dir="${OCTAVE_FIXTURE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
env_file="$script_dir/.jellyscale.env"

if [ ! -f "$env_file" ]; then
  printf 'JELLYSCALE_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 16)" > "$env_file"
  chmod 600 "$env_file"
  echo "[fixture-up] wrote $env_file"
fi

if [ "${1:-}" = "--env-only" ]; then
  exit 0
fi

# T3-05 item 8: this checkout's own Compose project. The module is found from this script's real location, not
# OCTAVE_FIXTURE_DIR, and only after the --env-only exit, so the env step still works when the script is copied alone.
here="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"
project="$(node "$here/compose-project.mjs")"
# The host ports are fixed: stop, naming the holder, when another project publishes one. Nothing is removed here.
node "$here/compose-project.mjs" --check-ports
echo "[fixture-up] Compose project $project"
exec docker compose -p "$project" -f "$here/docker-compose.yml" up -d --wait
