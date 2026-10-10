#!/usr/bin/env bash
set -euo pipefail
URL="${1:-${DEMO_URL:-http://127.0.0.1:${PORT:-8080}}}"
HEADERS=()
if [[ -n "${RESET_TOKEN:-}" ]]; then
  HEADERS+=(-H "Authorization: Bearer ${RESET_TOKEN}")
fi
curl -fsS -X POST "${URL%/}/api/reset" "${HEADERS[@]}"
echo
