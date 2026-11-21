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

## Anthropic API key (SSM Parameter Store)

The Fargate task gets `ANTHROPIC_API_KEY` from an SSM Parameter Store SecureString through ECS `secrets`, so the key never passes through Terraform variables, state, the task definition or GitHub. Create the parameter once per environment **before** deploying with `llm_provider = "anthropic"` (the default); without it the task fails to start.

```bash
# read -rs keeps the key out of shell history and off the screen (paste the key, then Enter).
# printf is a shell builtin and the CLI reads the value from stdin, so the key is not in the
# process list (ps) either.
read -rs ANTHROPIC_KEY && printf '%s' "$ANTHROPIC_KEY" | aws ssm put-parameter --region ap-northeast-3 \
  --name /politopics/stage/recap/anthropic-api-key \
  --type SecureString --overwrite --value file:///dev/stdin; unset ANTHROPIC_KEY
```

- Prod uses `/politopics/prod/recap/anthropic-api-key`. Set `anthropic_api_key_ssm_parameter_name` to use another name.
- Rotation: run the same command with the new key; the next task run picks it up.
- With the default `aws/ssm` KMS key no extra KMS permission is needed. Terraform grants the task execution role `ssm:GetParameters` on this one parameter only.

## LLM provider and rollback

- `llm_provider` (`"anthropic"` by default, or `"gemini"`) is exported to the container as `LLM_PROVIDER`.
- `tfvars/prod.tfvars` sets `llm_provider = "gemini"`, so prod keeps using Gemini until a stage run on Claude has been checked. To switch prod, create the prod parameter first, then delete that line.
- To roll back to Gemini, set `llm_provider = "gemini"` in `tfvars/<env>.tfvars` (or `export TF_VAR_llm_provider=gemini`) and deploy again. `TF_VAR_gemini_api_key` must be set then (the deploy workflow already passes it). The Anthropic parameter is not needed while on Gemini.

## Stage

```bash
export ENV=stage
export TF_VAR_gemini_api_key="<your-key>"  # used only with llm_provider = "gemini" (rollback)
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
export TF_VAR_gemini_api_key="<your-key>"  # used only with llm_provider = "gemini" (rollback)
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
