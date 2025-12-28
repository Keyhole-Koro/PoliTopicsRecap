# Terraform Commands (PoliTopics Recap)

This module supports `stage`, `prod`, and `localstack` environments. The commands below assume you are in `PoliTopicsRecap/terraform`.

## LocalStack

```bash
export ENV=local
export TF_VAR_gemini_api_key="fake"

terraform init -backend-config="backends/local.hcl"
terraform plan -var-file="tfvars/localstack.tfvars" -out=tfplan
terraform apply tfplan
```

## Stage

```bash
export ENV=stage
export TF_VAR_gemini_api_key="<your-key>"

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
