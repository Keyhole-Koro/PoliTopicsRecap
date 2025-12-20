# Terraform Commands (PoliTopics Recap)

This module supports `stage`, `prod`, and `localstack` environments. The commands below assume you are in `PoliTopicsRecap/terraform`.

## LocalStack

```bash
export ENV=local
export TF_VAR_gemini_api_key="fake"

default_backend=backends/local.hcl
vars=tfvars/localstack.tfvars

terraform init -backend-config="$default_backend"
terraform plan -var-file="$vars" -out=tfplan
terraform apply tfplan
```

## Stage

```bash
export ENV=stage
export TF_VAR_gemini_api_key="<your-key>"

default_backend=backends/stage.hcl
vars=tfvars/stage.tfvars

terraform init -backend-config="$default_backend"
terraform plan -var-file="$vars" -out=tfplan
terraform apply tfplan
```

## Prod

```bash
export ENV=prod
export TF_VAR_gemini_api_key="<your-key>"

default_backend=backends/prod.hcl
vars=tfvars/prod.tfvars

terraform init -backend-config="$default_backend"
terraform plan -var-file="$vars" -out=tfplan
terraform apply tfplan
```

## Notes

- Create the state bucket before `terraform init` when targeting AWS:
  - `./scripts/create-state-bucket.sh stage`
  - `./scripts/create-state-bucket.sh prod`
  - `./scripts/create-state-bucket.sh local`
- Import existing resources if needed: `./import_all.sh tfvars/<env>.tfvars`
