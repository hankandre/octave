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
echo "[fixture-up] Compose project $project"
# T3-27: this checkout's own host ports, chosen and recorded in .fixture-ports, which Compose reads for the override.
# A port another project or process took since the choice makes `up` fail; the check then tells that apart from any
# other failure, and the choice is made again (at most three times). Nothing of another project is removed.
for attempt in 1 2 3; do
  node "$here/fixture-ports.mjs" --choose
  if docker compose -p "$project" -f "$here/docker-compose.yml" -f "$here/docker-compose.ports.yml" --env-file "$here/.fixture-ports" up -d --wait; then
    exit 0
  fi
  # Every recorded port is still usable: the failure was not a taken port.
  if node "$here/fixture-ports.mjs" --check; then
    exit 1
  fi
  echo "[fixture-up] a chosen port was taken meanwhile; choosing again"
done
exit 1
