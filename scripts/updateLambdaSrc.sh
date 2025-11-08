#!/bin/bash
current_dir=$(basename "$PWD")

if [ "$current_dir" != "terraform" ]; then
  cd terraform || exit 1
fi

npm run build:local \
terraform plan  -var-file="tfvars/localstack.tfvars" \
  -target=aws_iam_role.lambda_exec \
  -target=aws_lambda_function.processor \
  -out=tfplan_bootstrap \
&& terraform apply tfplan_bootstrap \
&& terraform plan  -var-file="tfvars/localstack.tfvars" -out=tfplan \
&& terraform apply tfplan \
&& export PROMPT_QUEUE_URL="http://sqs.ap-northeast-3.localhost.localstack.cloud:4566/000000000000/politopics-recap-queue.fifo" \
&& export PROMPT_BUCKET_NAME="politopics-prompts" \
&& export AWS_ENDPOINT_URL="http://localstack:4566" \
&& npm run enqueue-mock
