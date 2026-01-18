#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ENVIRONMENT_INPUT=""

for arg in "$@"; do
  case "$arg" in
    --batch)
      ;;
    local|ghaTest|stage|prod)
      ENVIRONMENT_INPUT="$arg"
      ;;
  esac
done

if [[ -z "$ENVIRONMENT_INPUT" ]]; then
  echo "Usage: $0 <local|ghaTest|stage|prod>" >&2
  exit 1
fi

case "$ENVIRONMENT_INPUT" in
  local)
    VAR_FILE_INPUT="$TF_DIR/tfvars/localstack.tfvars"
    ;;
  ghaTest)
    VAR_FILE_INPUT="$TF_DIR/tfvars/ghaTest.tfvars"
    ;;
  stage)
    VAR_FILE_INPUT="$TF_DIR/tfvars/stage.tfvars"
    ;;
  prod)
    VAR_FILE_INPUT="$TF_DIR/tfvars/prod.tfvars"
    ;;
  *)
    echo "Unknown environment: $ENVIRONMENT_INPUT" >&2
    echo "Usage: $0 <local|ghaTest|stage|prod>" >&2
    exit 1
    ;;
esac

if [[ ! -f "$VAR_FILE_INPUT" ]]; then
  echo "Variable file not found: $VAR_FILE_INPUT" >&2
  exit 1
fi

VAR_FILE="$(cd "$(dirname "$VAR_FILE_INPUT")" && pwd)/$(basename "$VAR_FILE_INPUT")"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd terraform
require_cmd python3

eval "$(
  python3 - "$VAR_FILE" <<'PY'
import pathlib
import re
import shlex
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()

def extract_raw(key: str):
  pattern = re.compile(rf'(?m)^\s*{re.escape(key)}\s*=\s*(.+)$')
  match = pattern.search(text)
  if not match:
    return None
  raw = match.group(1).strip()
  if "#" in raw:
    raw = raw.split("#", 1)[0].strip()
  return raw if raw != "" else None

def parse_value(raw):
  if raw is None:
    return None
  lowered = raw.lower()
  if lowered == "null":
    return None
  if lowered == "true":
    return True
  if lowered == "false":
    return False
  if raw.startswith('"') and raw.endswith('"'):
    return raw[1:-1]
  if raw.startswith("'") and raw.endswith("'"):
    return raw[1:-1]
  try:
    if "." in raw:
      return float(raw)
    return int(raw)
  except ValueError:
    return raw

keys = [
  "aws_region",
  "environment",
  "prompt_bucket_name",
  "article_asset_bucket_name",
  "politopics_table_name",
  "task_table_name",
  "enable_fargate",
  "enable_fargate_schedule",
]

values = {k: parse_value(extract_raw(k)) for k in keys}

aws_region = values.get("aws_region") or ""
environment = values.get("environment") or ""
prompt_bucket = values.get("prompt_bucket_name") or ""
article_asset_bucket = values.get("article_asset_bucket_name") or ""
politopics_table = values.get("politopics_table_name") or ""
task_table = values.get("task_table_name") or ""
enable_fargate = bool(values.get("enable_fargate"))
enable_fargate_schedule = bool(values.get("enable_fargate_schedule"))

def emit(name, value):
  if value is None:
    value = ""
  elif isinstance(value, bool):
    value = "true" if value else "false"
  else:
    value = str(value)
  print(f"{name}={shlex.quote(value)}")

emit("AWS_REGION", aws_region)
emit("ENVIRONMENT", environment)
emit("PROMPT_BUCKET_NAME", prompt_bucket)
emit("ARTICLE_ASSET_BUCKET_NAME", article_asset_bucket)
emit("POLITOPICS_TABLE_NAME", politopics_table)
emit("TASK_TABLE_NAME", task_table)
emit("FARGATE_ENABLED", "true" if enable_fargate else "false")
emit("FARGATE_SCHEDULE_ENABLED", "true" if enable_fargate_schedule else "false")
PY
)"

for required in AWS_REGION PROMPT_BUCKET_NAME ARTICLE_ASSET_BUCKET_NAME POLITOPICS_TABLE_NAME TASK_TABLE_NAME; do
  if [[ -z "${!required:-}" ]]; then
    echo "Missing required value for $required (check $VAR_FILE)" >&2
    exit 1
  fi
done

TF_CMD=(terraform "-chdir=$TF_DIR")

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"

run_import() {
  local address="$1"
  local identifier="$2"
  if [[ -z "$identifier" || "$identifier" == "None" ]]; then
    echo "Skipping $address because identifier is empty" >&2
    return
  fi

  if "${TF_CMD[@]}" state show "$address" >/dev/null 2>&1; then
    echo "skip   -> $address (already in state)"
    return
  fi

  echo "import -> $address :: $identifier"
  set +e
  import_output="$("${TF_CMD[@]}" import "-var-file=$VAR_FILE" -no-color "$address" "$identifier" 2>&1)"
  import_status=$?
  set -e

  if [[ $import_status -ne 0 ]]; then
    if echo "$import_output" | grep -q "Cannot import non-existent remote object"; then
      echo "skip   -> $address (missing remote object)"
      return
    fi
    if echo "$import_output" | grep -q "Configuration for import target does not exist"; then
      echo "skip   -> $address (missing configuration)"
      return
    fi
    if echo "$import_output" | grep -q "couldn't find resource"; then
      echo "skip   -> $address (missing resource)"
      return
    fi
    echo "$import_output" >&2
    exit "$import_status"
  fi
  echo "$import_output"
}

PROMPT_BUCKET_RES="module.service.module.s3"
run_import "$PROMPT_BUCKET_RES.aws_s3_bucket.this" "$PROMPT_BUCKET_NAME"
run_import "$PROMPT_BUCKET_RES.aws_s3_bucket_versioning.this" "$PROMPT_BUCKET_NAME"
run_import "$PROMPT_BUCKET_RES.aws_s3_bucket_server_side_encryption_configuration.this" "$PROMPT_BUCKET_NAME"
run_import "$PROMPT_BUCKET_RES.aws_s3_bucket_public_access_block.this" "$PROMPT_BUCKET_NAME"

ARTICLE_BUCKET_RES="module.service.module.article_asset_bucket"
run_import "$ARTICLE_BUCKET_RES.aws_s3_bucket.this" "$ARTICLE_ASSET_BUCKET_NAME"
run_import "$ARTICLE_BUCKET_RES.aws_s3_bucket_versioning.this" "$ARTICLE_ASSET_BUCKET_NAME"
run_import "$ARTICLE_BUCKET_RES.aws_s3_bucket_server_side_encryption_configuration.this" "$ARTICLE_ASSET_BUCKET_NAME"
run_import "$ARTICLE_BUCKET_RES.aws_s3_bucket_public_access_block.this" "$ARTICLE_ASSET_BUCKET_NAME"

run_import "module.service.module.dynamodb.aws_dynamodb_table.politopics" "$POLITOPICS_TABLE_NAME"
run_import "module.service.aws_dynamodb_table.llm_tasks" "$TASK_TABLE_NAME"

if [[ "${FARGATE_ENABLED:-false}" != "true" ]]; then
  echo "Fargate disabled; skipping ECS/ECR imports."
  echo "All import commands completed."
  exit 0
fi

require_cmd aws

FARGATE_NAME_PREFIX="politopics-recap-${ENVIRONMENT}"
TASK_FAMILY="politopics-recap-task-${ENVIRONMENT}"
LOG_GROUP_NAME="/ecs/${FARGATE_NAME_PREFIX}"

run_import "module.service.module.fargate.aws_ecr_repository.this[0]" "$FARGATE_NAME_PREFIX"
run_import "module.service.module.fargate.aws_cloudwatch_log_group.this[0]" "$LOG_GROUP_NAME"
run_import "module.service.module.fargate.aws_ecs_cluster.this[0]" "$FARGATE_NAME_PREFIX"

EXEC_ROLE_NAME="${FARGATE_NAME_PREFIX}-task-execution"
TASK_ROLE_NAME="${FARGATE_NAME_PREFIX}-task"
TASK_POLICY_NAME="${FARGATE_NAME_PREFIX}-task-policy"

run_import "module.service.module.fargate.aws_iam_role.execution[0]" "$EXEC_ROLE_NAME"
run_import "module.service.module.fargate.aws_iam_role_policy_attachment.execution[0]" "${EXEC_ROLE_NAME}/arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
run_import "module.service.module.fargate.aws_iam_role.task[0]" "$TASK_ROLE_NAME"
run_import "module.service.module.fargate.aws_iam_role_policy.task[0]" "${TASK_ROLE_NAME}:${TASK_POLICY_NAME}"

TASK_DEF_ARN="$(aws ecs list-task-definitions --family-prefix "$TASK_FAMILY" --sort DESC --max-items 1 --query 'taskDefinitionArns[0]' --output text 2>/dev/null)"
if [[ -n "$TASK_DEF_ARN" && "$TASK_DEF_ARN" != "None" ]]; then
  run_import "module.service.module.fargate.aws_ecs_task_definition.this[0]" "$TASK_DEF_ARN"
else
  echo "Skipping task definition import; no task definitions found for $TASK_FAMILY"
fi

if [[ "${FARGATE_SCHEDULE_ENABLED:-false}" == "true" ]]; then
  SCHED_ROLE_NAME="${FARGATE_NAME_PREFIX}-scheduler"
  SCHED_POLICY_NAME="${FARGATE_NAME_PREFIX}-scheduler-policy"
  SCHED_NAME="${FARGATE_NAME_PREFIX}-daily"

  run_import "module.service.module.fargate.aws_iam_role.scheduler[0]" "$SCHED_ROLE_NAME"
  run_import "module.service.module.fargate.aws_iam_role_policy.scheduler[0]" "${SCHED_ROLE_NAME}:${SCHED_POLICY_NAME}"
  run_import "module.service.module.fargate.aws_scheduler_schedule.this[0]" "$SCHED_NAME"
else
  echo "Fargate schedule disabled; skipping scheduler imports."
fi

echo "All import commands completed."
