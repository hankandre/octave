#!/usr/bin/env bash
# Stops this checkout's fixture servers and removes their volumes (T3-05 item 8). Only this checkout's own Compose
# project is touched; another checkout's servers are left as they are.
set -euo pipefail

here="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"
project="$(node "$here/compose-project.mjs")"
docker compose -p "$project" -f "$here/docker-compose.yml" down -v
