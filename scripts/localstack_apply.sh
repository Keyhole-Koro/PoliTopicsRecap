#!/usr/bin/env bash
set -euo pipefail

# Run LocalStack apply for the Recap module (container build + state bucket + import + plan/apply).

ENVIRONMENT="${1:-local}"

for arg in "$@"; do
  case "$arg" in
    --batch)
      ;;
    local|ghaTest|stage|prod)
      ENVIRONMENT="$arg"
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TF_DIR="$MODULE_DIR/terraform"
STATE_SCRIPT="$TF_DIR/scripts/create-state-bucket.sh"
IMPORT_SCRIPT="$TF_DIR/scripts/import_all.sh"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd terraform
require_cmd pnpm
require_cmd aws

echo "==> Recap: build (container)"
(cd "$MODULE_DIR" && pnpm install && pnpm exec tsc && pnpm exec tsc-alias)

echo "==> Recap: create state bucket"
"$STATE_SCRIPT" "$ENVIRONMENT"

BACKEND_CONFIG="backends/local.hcl"
TFVARS_FILE="tfvars/localstack.tfvars"
if [ "$ENVIRONMENT" == "ghaTest" ]; then
  BACKEND_CONFIG="backends/ghaTest.hcl"
  TFVARS_FILE="tfvars/ghaTest.tfvars"
fi

echo "==> Recap: terraform init"
terraform -chdir="$TF_DIR" init -input=false -reconfigure -backend-config="$BACKEND_CONFIG"

echo "==> Recap: terraform import"
"$IMPORT_SCRIPT" "$ENVIRONMENT"

echo "==> Recap: terraform plan"
set +e
terraform -chdir="$TF_DIR" plan -detailed-exitcode -var-file="$TFVARS_FILE" -out=tfplan
PLAN_EXIT_CODE=$?
set -e

case "$PLAN_EXIT_CODE" in
  0)
    echo "No changes detected. Skipping apply."
    ;;
  2)
    echo "Changes detected. Applying tfplan..."
    terraform -chdir="$TF_DIR" apply -input=false tfplan
    ;;
  *)
    echo "Terraform plan failed with exit code $PLAN_EXIT_CODE"
    exit "$PLAN_EXIT_CODE"
    ;;
esac
