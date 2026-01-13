#!/usr/bin/env bash
set -euo pipefail

# Ensures LocalStack resources exist before running tests.
# If resources are missing, runs ./scripts/localstack_apply.sh <env> (default: local).

ENVIRONMENT="${1:-${RECAP_LOCALSTACK_ENV:-local}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$MODULE_DIR/.." && pwd)"
APPLY_SCRIPT="$MODULE_DIR/scripts/localstack_apply.sh"
VERIFY_SCRIPT="$ROOT_DIR/scripts/verify_localstack_resources.sh"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd aws

if [[ ! -x "$APPLY_SCRIPT" ]]; then
  echo "Apply script not found: $APPLY_SCRIPT" >&2
  exit 1
fi

if [[ ! -x "$VERIFY_SCRIPT" ]]; then
  echo "Verify script not found: $VERIFY_SCRIPT" >&2
  exit 1
fi

echo "[ensure-localstack] Checking Recap LocalStack resources..."
if "$VERIFY_SCRIPT" -only Recap >/dev/null 2>&1; then
  echo "[ensure-localstack] Resources already present. Skipping apply."
  exit 0
fi

echo "[ensure-localstack] Resources missing. Running apply ($ENVIRONMENT)..."
exec "$APPLY_SCRIPT" "$ENVIRONMENT"
