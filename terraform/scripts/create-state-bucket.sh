#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <local|stage|prod>"
  exit 1
fi

ENVIRONMENT="$1"
REGION="ap-northeast-3"
LOCALSTACK_ENDPOINT="${LOCALSTACK_ENDPOINT:-http://localstack:4566}"
AWS_ARGS=()

case "$ENVIRONMENT" in
  local)
    BUCKET="politopics-recap-local-state"
    AWS_ARGS+=(--endpoint-url "$LOCALSTACK_ENDPOINT")
    ;;
  stage)
    BUCKET="politopics-recap-stage-state"
    ;;
  prod)
    BUCKET="politopics-recap-prod-state"
    ;;
  *)
    echo "Unknown environment: $ENVIRONMENT"
    echo "Usage: $0 <local|stage|prod>"
    exit 1
    ;;
esac

echo "Environment : $ENVIRONMENT"
echo "Bucket      : $BUCKET"
echo "Region      : $REGION"
if [ "$ENVIRONMENT" = "local" ]; then
  echo "Endpoint    : $LOCALSTACK_ENDPOINT"
fi
echo

echo "==> Checking S3 bucket exists..."

if aws "${AWS_ARGS[@]}" s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "S3 bucket already exists: $BUCKET"
else
  echo "Creating S3 bucket: $BUCKET"
  aws "${AWS_ARGS[@]}" s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"

  echo "Enabling default encryption (AES256)..."
  aws "${AWS_ARGS[@]}" s3api put-bucket-encryption \
    --bucket "$BUCKET" \
    --server-side-encryption-configuration '{
      "Rules": [{
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }]
    }'

  echo "Enabling versioning..."
  aws "${AWS_ARGS[@]}" s3api put-bucket-versioning \
    --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled
fi

if [ "$ENVIRONMENT" = "local" ]; then
  echo "==> Ensuring application buckets exist (local only)..."
  APP_BUCKETS=("politopics-prompts" "politopics-articles-local")
  for APP_BUCKET in "${APP_BUCKETS[@]}"; do
    if aws "${AWS_ARGS[@]}" s3api head-bucket --bucket "$APP_BUCKET" 2>/dev/null; then
      echo "App bucket already exists: $APP_BUCKET"
    else
      echo "Creating App bucket: $APP_BUCKET"
      aws "${AWS_ARGS[@]}" s3api create-bucket \
        --bucket "$APP_BUCKET" \
        --region "$REGION" \
        --create-bucket-configuration LocationConstraint="$REGION"
    fi
  done
fi

echo
echo "✅ S3 bucket setup completed."
