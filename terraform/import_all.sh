#!/usr/bin/env bash
set -euo pipefail

TF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAR_FILE_INPUT="${1:-$TF_DIR/tfvars/stage.tfvars}"

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
require_cmd aws

eval "$(
  python3 - "$VAR_FILE" <<'PY'
import pathlib
import re
import shlex
import sys
from collections import OrderedDict

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
  "lambda_name",
  "prompt_bucket_name",
  "politopics_table_name",
  "enable_scheduler",
  "scheduler_use_cloudwatch_events",
  "scheduler_use_processor_lambda_as_target",
  "scheduler_target_lambda_arn",
  "scheduler_cron_expression",
  "scheduler_start_time",
  "scheduler_end_time",
  "scheduler_minute_step",
]

values = {k: parse_value(extract_raw(k)) for k in keys}

aws_region = values.get("aws_region") or ""
environment = values.get("environment") or ""
lambda_name = values.get("lambda_name") or ""
prompt_bucket = values.get("prompt_bucket_name") or ""
politopics_table = values.get("politopics_table_name") or ""

enable_scheduler = bool(values.get("enable_scheduler"))
use_cloudwatch = bool(values.get("scheduler_use_cloudwatch_events"))
use_processor_target = bool(values.get("scheduler_use_processor_lambda_as_target"))
explicit_target = (values.get("scheduler_target_lambda_arn") or "").strip()

cron_expr_raw = values.get("scheduler_cron_expression")
cron_expr_clean = cron_expr_raw.strip() if isinstance(cron_expr_raw, str) else ""
cron_provided = cron_expr_clean != ""

start_time_raw = values.get("scheduler_start_time")
end_time_raw = values.get("scheduler_end_time")
minute_step_val = values.get("scheduler_minute_step")
try:
  minute_step = int(minute_step_val) if minute_step_val is not None else 0
except (TypeError, ValueError):
  minute_step = 0

def parse_time(value):
  if not isinstance(value, str):
    return (None, None)
  trimmed = value.strip()
  if not trimmed:
    return (None, None)
  parts = trimmed.split(":")
  if len(parts) != 2:
    return (None, None)
  try:
    return (int(parts[0]), int(parts[1]))
  except ValueError:
    return (None, None)

start_hour, start_minute = parse_time(start_time_raw)
end_hour, end_minute = parse_time(end_time_raw)

have_window = (
  (not cron_provided)
  and start_hour is not None
  and end_hour is not None
  and start_minute is not None
  and end_minute is not None
  and 1 <= minute_step <= 59
)

crosses_midnight = (
  have_window and (
    end_hour < start_hour
    or (end_hour == start_hour and end_minute < start_minute)
  )
)

start_hour_minutes = []
end_hour_minutes = []
same_hour_minutes = []

if have_window:
  for m in range(60):
    if m >= start_minute and (m - start_minute) % minute_step == 0:
      start_hour_minutes.append(m)
    condition = ((m - start_minute) % minute_step + minute_step) % minute_step == 0
    if m <= end_minute and condition:
      end_hour_minutes.append(m)
    if start_hour == end_hour and start_minute <= m <= end_minute and condition:
      same_hour_minutes.append(m)

start_hour_csv = ",".join(str(m) for m in start_hour_minutes)
end_hour_csv = ",".join(str(m) for m in end_hour_minutes)
same_hour_csv = ",".join(str(m) for m in same_hour_minutes)

interior_non_wrap = ""
interior_wrap_a = ""
interior_wrap_b = ""

if have_window and not crosses_midnight and (end_hour - start_hour) >= 2:
  interior_non_wrap = f"{start_hour + 1}-{end_hour - 1}"

if have_window and crosses_midnight and (23 - start_hour) >= 1:
  interior_wrap_a = f"{start_hour + 1}-23"

if have_window and crosses_midnight and (end_hour - 0) >= 1:
  interior_wrap_b = f"0-{end_hour - 1}"

expressions = OrderedDict()

if cron_provided:
  expressions["direct"] = cron_expr_clean
elif have_window:
  if start_hour == end_hour and same_hour_csv:
    expressions["same_hour"] = f"cron({same_hour_csv} {start_hour} ? * * *)"
  if start_hour != end_hour and start_hour_csv:
    expressions["start_hour"] = f"cron({start_hour_csv} {start_hour} ? * * *)"
  if interior_non_wrap:
    expressions["interior"] = f"cron(0/{minute_step} {interior_non_wrap} ? * * *)"
  if interior_wrap_a:
    expressions["interior_a"] = f"cron(0/{minute_step} {interior_wrap_a} ? * * *)"
  if interior_wrap_b:
    expressions["interior_b"] = f"cron(0/{minute_step} {interior_wrap_b} ? * * *)"
  if start_hour != end_hour and end_hour_csv:
    expressions["end_hour"] = f"cron({end_hour_csv} {end_hour} ? * * *)"

scheduler_has_target = bool(explicit_target) or use_processor_target
scheduler_is_enabled = enable_scheduler and scheduler_has_target and len(expressions) > 0

if scheduler_is_enabled:
  backend = "cloudwatch" if use_cloudwatch else "aws_scheduler"
else:
  backend = "none"

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
emit("LAMBDA_NAME", lambda_name)
emit("PROMPT_BUCKET_NAME", prompt_bucket)
emit("POLITOPICS_TABLE_NAME", politopics_table)
emit("ENABLE_SCHEDULER", "true" if enable_scheduler else "false")
emit("SCHEDULER_BACKEND", backend)
emit("SCHEDULER_KEYS", ",".join(expressions.keys()))
emit("SCHEDULER_HAS_TARGET", "true" if scheduler_has_target else "false")
PY
)"

for required in AWS_REGION LAMBDA_NAME PROMPT_BUCKET_NAME POLITOPICS_TABLE_NAME; do
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
  "${TF_CMD[@]}" import "-var-file=$VAR_FILE" -no-color "$address" "$identifier"
}

iam_role_exists() {
  local role_name="$1"
  aws iam get-role --role-name "$role_name" >/dev/null 2>&1
}

iam_role_policy_exists() {
  local role_name="$1"
  local policy_name="$2"
  aws iam get-role-policy --role-name "$role_name" --policy-name "$policy_name" >/dev/null 2>&1
}

scheduler_schedule_exists() {
  local schedule_name="$1"
  aws scheduler get-schedule --name "$schedule_name" >/dev/null 2>&1
}

PROMPT_BUCKET_RES="module.service.module.s3"
run_import "$PROMPT_BUCKET_RES.aws_s3_bucket.this" "$PROMPT_BUCKET_NAME"
run_import "$PROMPT_BUCKET_RES.aws_s3_bucket_versioning.this" "$PROMPT_BUCKET_NAME"
run_import "$PROMPT_BUCKET_RES.aws_s3_bucket_server_side_encryption_configuration.this" "$PROMPT_BUCKET_NAME"
run_import "$PROMPT_BUCKET_RES.aws_s3_bucket_public_access_block.this" "$PROMPT_BUCKET_NAME"

run_import "module.service.module.dynamodb.aws_dynamodb_table.politopics" "$POLITOPICS_TABLE_NAME"

LAMBDA_RES="module.service.module.lambda"
LAMBDA_ROLE_NAME="${LAMBDA_NAME}-role"
LAMBDA_POLICY_NAME="${LAMBDA_NAME}-inline"
LOG_GROUP_NAME="/aws/lambda/${LAMBDA_NAME}"
LAYER_NAME="${LAMBDA_NAME}-deps"

run_import "$LAMBDA_RES.aws_iam_role.this" "$LAMBDA_ROLE_NAME"
run_import "$LAMBDA_RES.aws_iam_role_policy.this" "${LAMBDA_ROLE_NAME}:${LAMBDA_POLICY_NAME}"
run_import "$LAMBDA_RES.aws_cloudwatch_log_group.this" "$LOG_GROUP_NAME"

if LAYER_ARN="$(aws lambda list-layer-versions --layer-name "$LAYER_NAME" --query 'max_by(LayerVersions, &Version).LayerVersionArn' --output text 2>/dev/null)"; then
  if [[ -n "$LAYER_ARN" && "$LAYER_ARN" != "None" ]]; then
    run_import "$LAMBDA_RES.aws_lambda_layer_version.dependencies" "$LAYER_ARN"
  else
    echo "Skipping lambda layer import; no versions found for $LAYER_NAME"
  fi
else
  echo "Unable to describe lambda layer $LAYER_NAME; skipping import." >&2
fi

run_import "$LAMBDA_RES.aws_lambda_function.this" "$LAMBDA_NAME"

declare -a SCHED_KEYS=()
if [[ -n "${SCHEDULER_KEYS:-}" ]]; then
  IFS=',' read -r -a SCHED_KEYS <<< "$SCHEDULER_KEYS"
fi

if [[ "${SCHEDULER_BACKEND:-none}" == "aws_scheduler" ]]; then
  SCHED_ROLE_NAME="${LAMBDA_NAME}-scheduler-role"
  SCHED_POLICY_NAME="${LAMBDA_NAME}-scheduler-invoke"
  if iam_role_exists "$SCHED_ROLE_NAME"; then
    run_import "module.service.aws_iam_role.scheduler[0]" "$SCHED_ROLE_NAME"
  else
    echo "Skipping scheduler role import; IAM role $SCHED_ROLE_NAME not found."
  fi
  if iam_role_policy_exists "$SCHED_ROLE_NAME" "$SCHED_POLICY_NAME"; then
    run_import "module.service.aws_iam_role_policy.scheduler_invoke_lambda[0]" "${SCHED_ROLE_NAME}:${SCHED_POLICY_NAME}"
  else
    echo "Skipping scheduler invoke policy import; inline policy ${SCHED_POLICY_NAME} not found on ${SCHED_ROLE_NAME}."
  fi

  declare -a EXISTING_SCHED_KEYS=()
  for key in "${SCHED_KEYS[@]}"; do
    [[ -z "$key" ]] && continue
    schedule_name="${LAMBDA_NAME}-schedule-${key}"
    if scheduler_schedule_exists "$schedule_name"; then
      EXISTING_SCHED_KEYS+=("$key")
    else
      echo "Skipping scheduler import for key '${key}'; schedule ${schedule_name} not found."
    fi
  done

  if [[ ${#EXISTING_SCHED_KEYS[@]} -eq 0 ]]; then
    echo "No AWS Scheduler schedules detected; skipping schedule imports."
  fi

  for key in "${EXISTING_SCHED_KEYS[@]}"; do
    schedule_name="${LAMBDA_NAME}-schedule-${key}"
    printf -v schedule_address 'module.service.aws_scheduler_schedule.processor["%s"]' "$key"
    run_import "$schedule_address" "$schedule_name"

    statement_id="AllowExecutionFromScheduler-${key}"
    printf -v perm_address 'module.service.aws_lambda_permission.allow_scheduler_invoke["%s"]' "$key"
    run_import "$perm_address" "${LAMBDA_NAME}/${statement_id}"
  done
elif [[ "${SCHEDULER_BACKEND:-none}" == "cloudwatch" ]]; then
  for key in "${SCHED_KEYS[@]}"; do
    [[ -z "$key" ]] && continue
    rule_name="${LAMBDA_NAME}-schedule-${key}"
    target_id="lambda-${key}"

    printf -v rule_address 'module.service.aws_cloudwatch_event_rule.scheduler["%s"]' "$key"
    run_import "$rule_address" "$rule_name"

    printf -v target_address 'module.service.aws_cloudwatch_event_target.scheduler["%s"]' "$key"
    run_import "$target_address" "${rule_name}/${target_id}"

    statement_id="AllowEventBridgeSchedule-${key}"
    printf -v perm_address 'module.service.aws_lambda_permission.allow_cloudwatch_schedule["%s"]' "$key"
    run_import "$perm_address" "${LAMBDA_NAME}/${statement_id}"
  done
else
  echo "Scheduler disabled or no expressions; skipping scheduler imports."
fi

echo "All import commands completed."
