# Terraform + LocalStack Quickstart

1. Build or update the Lambda function and dependency layer so the `lambda_package_path` and `lambda_layer_package_path` files exist:
   ```bash
   npm run build
   ```
   This produces `dist/lambda_handler.zip` (function code) and `dist/lambda_layer.zip` (Node.js dependencies).
2. Switch into the Terraform configuration directory:
   ```bash
   cd terraform
   ```
3. Initialise Terraform with the LocalStack backend configuration:
   ```bash
   terraform init -backend-config=backends/local.hcl
   ```
4. Apply the LocalStack variables file (this creates the SQS queue when `create_prompt_queue=true` in `tfvars/localstack.tfvars`):
   ```bash
   terraform apply -var-file="tfvars/localstack.tfvars"
   terraform apply -var-file="tfvars/localstack.tfvars" -var="create_prompt_queue=true"
   ```
5. (Optional) Seed the queue with rich mock data before a dry-run recap:
   ```bash
   export PROMPT_QUEUE_URL="http://sqs.ap-northeast-3.localhost.localstack.cloud:4566/000000000000/politopics-recap-queue"
   export PROMPT_BUCKET_NAME="politopics-prompts"
   export AWS_ENDPOINT_URL="http://localstack:4566"
   npx ts-node -r tsconfig-paths/register scripts/enqueue-mock-prompts.ts
   ```
   The script uploads two map source documents plus their pre-baked chunk results to S3 and enqueues two map tasks and one reduce task for the recap rehearsal.
6. Run the end-to-end test once the stack is up:
   ```bash
   AWS_ENDPOINT_URL=http://localstack:4566 npm test -- --runInBand tests/integration/fullflow.localstack.test.ts
   ```
   Use `cd terraform` (or `terraform -chdir=terraform …` from the repo root) so Terraform can resolve paths correctly on Windows shells.

# Test with mock

```bash
npm run enqueue-mock
```

# utilities

```bash
aws --no-cli-pager --endpoint-url http://localstack:4566 --region ap-northeast-3 s3api list-buckets

aws --debug --no-cli-pager --endpoint-url http://localstack:4566 --region ap-northeast-3 sqs list-queues
aws --endpoint-url http://localstack:4566 --region ap-northeast-3 sqs get-queue-url --queue-name politopics-recap-queue
aws --endpoint-url http://localstack:4566 --region ap-northeast-3 \
  sqs get-queue-attributes \
  --queue-url "http://sqs.ap-northeast-3.localhost.localstack.cloud:4566/000000000000/politopics-recap-queue" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --output json
aws --endpoint-url http://localstack:4566 --region ap-northeast-3 \
  sqs receive-message --queue-url "$Q" \
  --max-number-of-messages 10 --visibility-timeout 0 --wait-time-seconds 3 \
  --output json

```
