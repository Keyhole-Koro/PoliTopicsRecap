# Terraform + LocalStack Quickstart
[Japanese Version](./jp/terraform-localstack.md)

1. Build the container TypeScript output (optional if you are only provisioning infra):

   ```bash
   pnpm run build
   ```

2. Switch into the Terraform configuration directory:

   ```bash
   cd terraform
   ```

3. Initialise Terraform with the LocalStack backend configuration:

   ```bash
   export ENV=local
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

6. Run the Dynamo workflow test once the stack is up (point at LocalStack):

   ```bash
   LOCALSTACK_ENDPOINT_URL=http://localstack:4566 \
   npm test -- --runInBand src/tasks/tasks.localstack.test.ts
   ```

   The worker now pulls tasks directly from the `PoliTopics-llm-tasks` table via its `StatusIndex` GSI, and it writes final reduce results to the `PoliTopics` article table using `storeData`.

# utilities (debugging)

### S3 buckets

```bash
# List all S3 buckets in LocalStack
aws --no-cli-pager --endpoint-url http://localstack:4566 --region ap-northeast-3 s3api list-buckets

aws --endpoint-url http://localstack:4566   s3 ls s3://politopics-prompts/demo/<path> \
   --recursive \
   --human-readable \
   --summarize
```

- Recap now dumps invalid reduce outputs to S3 for debugging. Look under  
  `s3://<article-asset-bucket>/invalid-payloads/<taskId>/<timestamp>.txt`  
  (the Discord notification includes the exact URI).

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
