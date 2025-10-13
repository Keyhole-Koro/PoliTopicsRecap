# Terraform + LocalStack Quickstart

1. Build or update the Lambda bundle so the `lambda_package_path` file exists:
   ```bash
   npm run build
   ```
2. Switch into the Terraform configuration directory:
   ```bash
   cd terraform
   ```
3. Initialise Terraform with the LocalStack backend configuration:
   ```bash
   terraform init -backend-config="backends/stage.hcl"
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
