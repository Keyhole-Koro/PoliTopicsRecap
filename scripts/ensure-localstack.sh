#!/usr/bin/env bash
set -euo pipefail

# Ensures Recap LocalStack resources for Fargate batch processing.
# Use --with-fargate to include optional ECS/ECR checks (requires LocalStack services).

ENVIRONMENT="${RECAP_LOCALSTACK_ENV:-local}"
CHECK_ONLY=false
CHECK_FARGATE=false

for arg in "$@"; do
  case "$arg" in
    --check-only|--verify-only)
      CHECK_ONLY=true
      ;;
    --with-fargate|--fargate)
      CHECK_FARGATE=true
      ;;
    --batch)
      ;;
    *)
      ENVIRONMENT="$arg"
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APPLY_SCRIPT="$MODULE_DIR/scripts/localstack_apply.sh"

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

LOCALSTACK_URL="${LOCALSTACK_URL:-http://localstack:4566}"
AWS_REGION="${AWS_REGION:-ap-northeast-3}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION
export AWS_PAGER=""
AWS_ARGS=(--endpoint-url "$LOCALSTACK_URL" --region "$AWS_REGION")

failures=0

check_bucket() {
  local name="$1"
  if aws "${AWS_ARGS[@]}" s3api head-bucket --bucket "$name" >/dev/null 2>&1; then
    echo "[OK] s3 bucket: $name"
  else
    echo "[MISSING] s3 bucket: $name"
    failures=$((failures + 1))
  fi
}

check_table() {
  local name="$1"
  if aws "${AWS_ARGS[@]}" dynamodb describe-table --table-name "$name" >/dev/null 2>&1; then
    echo "[OK] dynamodb table: $name"
  else
    echo "[MISSING] dynamodb table: $name"
    failures=$((failures + 1))
  fi
}

check_ecr_repo() {
  local name="$1"
  if aws "${AWS_ARGS[@]}" ecr describe-repositories --repository-names "$name" >/dev/null 2>&1; then
    echo "[OK] ecr repo: $name"
  else
    echo "[MISSING] ecr repo: $name"
    failures=$((failures + 1))
  fi
}

check_ecs_cluster() {
  local name="$1"
  if aws "${AWS_ARGS[@]}" ecs describe-clusters --clusters "$name" --query 'clusters[0].status' --output text >/dev/null 2>&1; then
    echo "[OK] ecs cluster: $name"
  else
    echo "[MISSING] ecs cluster: $name"
    failures=$((failures + 1))
  fi
}

check_log_group() {
  local name="$1"
  local found
  found="$(aws "${AWS_ARGS[@]}" logs describe-log-groups --log-group-name-prefix "$name" --query "logGroups[?logGroupName=='$name'].logGroupName" --output text 2>/dev/null || true)"
  if [[ "$found" == "$name" ]]; then
    echo "[OK] log group: $name"
  else
    echo "[MISSING] log group: $name"
    failures=$((failures + 1))
  fi
}

echo "[ensure-localstack] Checking Recap LocalStack resources at $LOCALSTACK_URL"

# Core resources required for batch processing
check_bucket "politopics-prompts"
check_bucket "politopics-articles-local"
check_bucket "politopics-recap-local-state"
check_table "politopics-local"
check_table "politopics-llm-tasks-local"

if $CHECK_FARGATE; then
  fargate_prefix="politopics-recap-${ENVIRONMENT}"
  check_ecr_repo "$fargate_prefix"
  check_ecs_cluster "$fargate_prefix"
  check_log_group "/ecs/${fargate_prefix}"
fi

if [[ $failures -eq 0 ]]; then
  echo "[ensure-localstack] Resources already present."
  exit 0
fi

if $CHECK_ONLY; then
  echo "[ensure-localstack] Missing ${failures} Recap resource(s)."
  exit 1
fi

echo "[ensure-localstack] Resources missing. Running apply ($ENVIRONMENT)..."
exec "$APPLY_SCRIPT" "$ENVIRONMENT"
