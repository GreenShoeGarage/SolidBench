#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ -n "${FREECAD_PYTHON:-}" ]; then exec "$FREECAD_PYTHON" launch.py "$@"; fi
if command -v micromamba >/dev/null 2>&1; then exec micromamba run -n solidbench python launch.py "$@"; fi
exec "${FREECAD_PYTHON:-python3}" launch.py "$@"
