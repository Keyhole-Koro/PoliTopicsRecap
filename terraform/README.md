# Terraform Commands (PoliTopics Recap)
[日本語版](./jp/README.md)

This module supports `stage`, `prod`, and `localstack` environments. The commands below assume you are in `PoliTopicsRecap/terraform`.

## LocalStack

```bash
export ENV=local

terraform init -backend-config="backends/local.hcl"
terraform plan -var-file="tfvars/localstack.tfvars" -out=tfplan
terraform apply tfplan
```

## Stage

```bash
export ENV=stage
export TF_VAR_gemini_api_key="<your-key>"
export TF_VAR_discord_webhook_error="<your-webhook>"
export TF_VAR_discord_webhook_warn="<your-webhook>"
export TF_VAR_discord_webhook_batch="<your-webhook>"
export TF_VAR_r2_endpoint_url="<r2-endpoint>"
export TF_VAR_r2_access_key_id="<r2-key>"
export TF_VAR_r2_secret_access_key="<r2-secret>"
# Provide networking for the Fargate task
export TF_VAR_fargate_subnet_ids='["subnet-...","subnet-..."]'
export TF_VAR_fargate_security_group_ids='["sg-..."]'

# when terraform init reference to localstack
# unset AWS_ENDPOINT_URL
# aws configure

terraform init -backend-config="backends/stage.hcl"
terraform plan -var-file="tfvars/stage.tfvars" -out=tfplan
terraform apply tfplan
```

## Prod

```bash
export ENV=prod
export TF_VAR_gemini_api_key="<your-key>"
export TF_VAR_discord_webhook_error="<your-webhook>"
export TF_VAR_discord_webhook_warn="<your-webhook>"
export TF_VAR_discord_webhook_batch="<your-webhook>"
export TF_VAR_r2_endpoint_url="<r2-endpoint>"
export TF_VAR_r2_access_key_id="<r2-key>"
export TF_VAR_r2_secret_access_key="<r2-secret>"
# Provide networking for the Fargate task
export TF_VAR_fargate_subnet_ids='["subnet-...","subnet-..."]'
export TF_VAR_fargate_security_group_ids='["sg-..."]'

# when terraform init reference to localstack
# unset AWS_ENDPOINT_URL
# aws configure

terraform init -backend-config="backends/prod.hcl"
terraform plan -var-file="tfvars/prod.tfvars" -out=tfplan
terraform apply tfplan
```

## Notes

- Create the state bucket before `terraform init` when targeting AWS:
  - `./scripts/create-state-bucket.sh stage`
  - `./scripts/create-state-bucket.sh prod`
  - `./scripts/create-state-bucket.sh local`
- Import existing resources if needed: `./import_all.sh tfvars/<env>.tfvars`
- Fargate resources are disabled in LocalStack (`enable_fargate = false`). Set `enable_fargate` and `enable_fargate_schedule` to false if you only want to manage storage resources.
