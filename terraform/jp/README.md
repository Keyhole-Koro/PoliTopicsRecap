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

## Anthropic API キー（SSM Parameter Store）

Fargate タスクは、SSM Parameter Store の SecureString から ECS の `secrets` で `ANTHROPIC_API_KEY` を受け取ります。キーは Terraform の変数、state、タスク定義、GitHub のどこも通りません。`llm_provider = "anthropic"`（デフォルト）でデプロイする**前に**、環境ごとに 1 回パラメータを作ってください。無いとタスクが起動しません。

```bash
# read -rs を使うと、キーがシェルの履歴にも画面にも残りません（キーを貼り付けて Enter）。
# printf はシェルの組み込みコマンドで、CLI は値を標準入力から読むので、プロセス一覧（ps）にも出ません。
read -rs ANTHROPIC_KEY && printf '%s' "$ANTHROPIC_KEY" | aws ssm put-parameter --region ap-northeast-3 \
  --name /politopics/stage/recap/anthropic-api-key \
  --type SecureString --overwrite --value file:///dev/stdin; unset ANTHROPIC_KEY
```

- prod は `/politopics/prod/recap/anthropic-api-key`。別の名前にするときは `anthropic_api_key_ssm_parameter_name` を設定します。
- キーの入れ替え: 新しいキーで同じコマンドを実行すれば、次のタスク実行から使われます。
- 既定の `aws/ssm` KMS キーなら、KMS の追加の権限はいりません。Terraform はタスク実行ロールに、このパラメータ 1 つへの `ssm:GetParameters` だけを許可します。

## LLM プロバイダとロールバック

- `llm_provider`（デフォルト `"anthropic"`、または `"gemini"`）は、コンテナに `LLM_PROVIDER` として渡されます。
- `tfvars/prod.tfvars` には `llm_provider = "gemini"` を書いてあります。そのため、stage で Claude の実行を確かめるまで、prod は Gemini のままです。prod を切り替えるときは、先に prod のパラメータを作ってから、その行を消します。
- Gemini に戻すときは、`tfvars/<env>.tfvars` に `llm_provider = "gemini"` を書く（または `export TF_VAR_llm_provider=gemini`）して、もう一度デプロイします。このとき `TF_VAR_gemini_api_key` が必要です（デプロイのワークフローはすでに渡しています）。Gemini を使っている間は Anthropic のパラメータはいりません。

## Stage

```bash
export ENV=stage
export TF_VAR_gemini_api_key="<your-key>"  # llm_provider = "gemini"（ロールバック）のときだけ使う
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
export TF_VAR_gemini_api_key="<your-key>"  # llm_provider = "gemini"（ロールバック）のときだけ使う
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
