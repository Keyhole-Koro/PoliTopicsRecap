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
   export ENV=local
   export TF_VAR_gemini_api_key="fake"
   terraform init -backend-config=backends/local.hcl
   ```

4. **Plan the changes** using the LocalStack variables file.  
   Local environments now create their own DynamoDB resources (PoliTopics + PoliTopics-llm-tasks) by setting `create_task_table = true` and pointing Terraform at the LocalStack endpoint:

   ```bash
   terraform plan \
     -var-file="tfvars/localstack.tfvars" \
     -out=tfplan
   ```

   This shows the execution plan and saves it to `tfplan` for a safe, reproducible apply.

5. **Apply the planned changes**:

   ```bash
   terraform apply "tfplan"
   ```

   (Alternatively, you can skip the saved plan and run:
   `terraform apply -var-file="tfvars/localstack.tfvars"`.)

6. Run the new Dynamo workflow test once the stack is up (point at LocalStack):

   ```bash
   LOCALSTACK_ENDPOINT_URL=http://localstack:4566 \
   npm test -- --runInBand src/tasks/tasks.localstack.test.ts
   ```

   The worker now pulls tasks directly from the `PoliTopics-llm-tasks` table via its `StatusIndex` GSI, and it writes final reduce results to the `PoliTopics` article table using `storeData`.

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

### DynamoDB

```bash
aws dynamodb list-tables \
  --endpoint-url http://localstack:4566 \
  --region ap-northeast-3

aws dynamodb scan \
  --table-name politopics \
  --endpoint-url http://localstack:4566 \
  --region ap-northeast-3 \
  --output json

```
