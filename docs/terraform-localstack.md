# Terraform + LocalStack Quickstart

1. Build or update the Lambda function and dependency layer so the `lambda_package_path` and `lambda_layer_package_path` files exist:

   ```bash
   # because of the free tier of localstack, lambda layer is restricted to create so this script copy # node_modules to the same directory of source code (lambda function)
   dummy of lambda_layer is created so that terraform doesnt need to distinguish local and remote.
   npm run build:local
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

4. **Plan the changes** using the LocalStack variables file:

   ```bash
   export TF_VAR_gemini_api_key="your gemini api key"
   terraform plan -var-file="tfvars/localstack.tfvars" -out=tfplan
   ```

   This shows the execution plan and saves it to `tfplan` for a safe, reproducible apply.

5. **Apply the planned changes**:

   ```bash
   terraform apply "tfplan"
   ```

   (Alternatively, you can skip the saved plan and run:
   `terraform apply -var-file="tfvars/localstack.tfvars"`.)

6. (Optional) Seed the queue with rich mock data before a dry-run recap:

   ```bash
   export PROMPT_QUEUE_URL="http://sqs.ap-northeast-3.localhost.localstack.cloud:4566/000000000000/politopics-recap-queue"
   export PROMPT_BUCKET_NAME="politopics-prompts"
   export AWS_ENDPOINT_URL="http://localstack:4566"
   npm run enqueue-mock
   ```

   The script uploads two map source documents plus their pre-baked chunk results to S3 and enqueues two map tasks and one reduce task for the recap rehearsal.

7. Run the end-to-end test once the stack is up:

   ```bash
   AWS_ENDPOINT_URL=http://localstack:4566 npm test -- --runInBand tests/integration/fullflow.localstack.test.ts
   ```

   Use `cd terraform` (or `terraform -chdir=terraform …` from the repo root) so Terraform can resolve paths correctly on Windows shells.

# Test with mock

```bash
export DELAY_STEP_SECONDS=60
# after terraform applying to localstack
npm run enqueue-mock
```

# Apply changes of lambda

```bash
nom run build:local
```

# utilities (debuging)

### S3 buckets

```bash
# List all S3 buckets in LocalStack
aws --no-cli-pager --endpoint-url http://localstack:4566 --region ap-northeast-3 s3api list-buckets

aws --endpoint-url http://localstack:4566   s3 ls s3://politopics-prompts/demo/<path> \
   --recursive \
   --human-readable \
   --summarize
```

### SQS

```bash
# Set SQS queue URL variable
Q="http://sqs.ap-northeast-3.localhost.localstack.cloud:4566/000000000000/politopics-recap-queue"

# Purge all messages in the SQS queue
aws --endpoint-url http://localstack:4566 --region ap-northeast-3 sqs purge-queue --queue-url "$Q"

# List all SQS queues
aws --debug --no-cli-pager --endpoint-url http://localstack:4566 --region ap-northeast-3 sqs list-queues

# Get the SQS queue URL by name
aws --endpoint-url http://localstack:4566 --region ap-northeast-3 sqs get-queue-url --queue-name politopics-recap-queue

# Get SQS queue attributes (e.g. number of messages)
aws --endpoint-url http://localstack:4566 --region ap-northeast-3 \
  sqs get-queue-attributes \
  --queue-url $Q \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --output json

# Receive messages from the SQS queue for debugging
aws --endpoint-url http://localstack:4566 --region ap-northeast-3 \
  sqs receive-message --queue-url "$Q" \
  --max-number-of-messages 10 --visibility-timeout 0 --wait-time-seconds 3 \
  --output json

# List CloudWatch log streams for the Lambda function
aws --endpoint-url http://localstack:4566 --region ap-northeast-3 logs describe-log-streams --log-group-name "/aws/lambda/politopics-recap-local"
```

### download layer

```bash
URL=$(aws lambda get-layer-version \
  --layer-name politopics-recap-local-deps \
  --version-number <version> \
  --region ap-northeast-3 \
  --output text \
  --query 'Content.Location')

URL_FIXED=$(echo "$URL" | sed 's/localhost\.localstack\.cloud/localstack/')

curl -fSL -o layer.zip "$URL_FIXED"

unzip layer.zip -d layer_content
```

### lambda config

```bash
aws lambda get-function-configuration \
  --function-name politopics-recap-local \
  --region ap-northeast-3 \
  --endpoint-url http://localstack:4566 \
  --query 'Environment.Variables'

# invoke
aws lambda invoke --function-name politopics-recap-local --endpoint-url http://localstack:4566 --region ap-northeast-3 out.json
```
