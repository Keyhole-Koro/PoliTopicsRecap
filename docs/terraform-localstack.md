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
5. Run the end-to-end test once the stack is up:
   ```bash
   AWS_ENDPOINT_URL=http://localstack:4566 npm test -- --runInBand tests/integration/fullflow.localstack.test.ts
   ```
   Use `cd terraform` (or `terraform -chdir=terraform …` from the repo root) so Terraform can resolve paths correctly on Windows shells.
