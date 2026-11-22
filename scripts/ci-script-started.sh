#!/bin/sh
# A pnpm shim for the tv and wire jobs (T1-17). The job puts it first on PATH and names the real pnpm in
# OCTAVE_CI_REAL_PNPM. An emulator step that sets OCTAVE_CI_SCRIPT_STARTED gets that file created (or left, when it is
# already there: scripts/tv-wire.mjs starts pnpm again with the variable inherited) before the real pnpm starts, and
# the real pnpm does not start when the file cannot be created. So the file exists exactly when the script started.
# With the variable unset (every other step) it only passes the arguments through.
real="${OCTAVE_CI_REAL_PNPM:-}"
if [ -z "$real" ] || [ ! -f "$real" ] || [ ! -x "$real" ]; then
  echo "ERROR ci: OCTAVE_CI_REAL_PNPM does not name an executable file" >&2
  exit 1
fi
if [ -n "${OCTAVE_CI_SCRIPT_STARTED:-}" ]; then
  if ! touch -- "$OCTAVE_CI_SCRIPT_STARTED" 2>/dev/null; then
    echo "ERROR ci: cannot create the start marker $OCTAVE_CI_SCRIPT_STARTED" >&2
    exit 1
  fi
fi
exec "$real" "$@"
