# Terraform コマンド (PoliTopics Recap)
[English Version](../README.md)

このモジュールは `stage`、`prod`、`localstack` 環境をサポートしています。以下のコマンドは `PoliTopicsRecap/terraform` にいることを前提としています。

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
# Fargate タスクのネットワーク設定
export TF_VAR_fargate_subnet_ids='["subnet-...","subnet-..."]'
export TF_VAR_fargate_security_group_ids='["sg-..."]'

# terraform init が localstack を参照する場合
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
# Fargate タスクのネットワーク設定
export TF_VAR_fargate_subnet_ids='["subnet-...","subnet-..."]'
export TF_VAR_fargate_security_group_ids='["sg-..."]'

# terraform init が localstack を参照する場合
# unset AWS_ENDPOINT_URL
# aws configure

terraform init -backend-config="backends/prod.hcl"
terraform plan -var-file="tfvars/prod.tfvars" -out=tfplan
terraform apply tfplan
```

## ノート

- AWS をターゲットにする場合、`terraform init` の前にステートバケットを作成してください:
  - `./scripts/create-state-bucket.sh stage`
  - `./scripts/create-state-bucket.sh prod`
  - `./scripts/create-state-bucket.sh local`
- 必要に応じて既存のリソースをインポートしてください: `./import_all.sh tfvars/<env>.tfvars`
- LocalStack では Fargate リソースを無効化しています (`enable_fargate = false`)。ストレージのみを管理する場合は `enable_fargate` と `enable_fargate_schedule` を `false` にしてください。
