# Terraform + LocalStack クイックスタート
[English Version](../../docs/terraform-localstack.md)

1. コンテナ実行向けの TypeScript 出力をビルドします (インフラだけ作る場合は省略できます):

   ```bash
   pnpm run build
   ```

2. Terraform 設定ディレクトリに切り替えます:

   ```bash
   cd terraform
   ```

3. LocalStack バックエンド設定で Terraform を初期化します:

   ```bash
   export ENV=local
   terraform init -backend-config=backends/local.hcl
   ```

4. **変更を計画します** (LocalStack 変数ファイルを使用)。
   ローカル環境は、`create_task_table = true` を設定し、Terraform を LocalStack エンドポイントに向けることで、独自の DynamoDB リソース (PoliTopics + PoliTopics-llm-tasks) を作成するようになりました:

   ```bash
   terraform plan \
     -var-file="tfvars/localstack.tfvars" \
     -out=tfplan
   ```

   これにより、実行プランが表示され、安全で再現可能な適用のために `tfplan` に保存されます。

5. **計画された変更を適用します**:

   ```bash
   terraform apply "tfplan"
   ```

   (あるいは、保存されたプランをスキップして、次を実行することもできます:
   `terraform apply -var-file="tfvars/localstack.tfvars"`.)

6. スタックが立ち上がったら、Dynamo ワークフローテストを一度実行します (LocalStack を指す):

   ```bash
   LOCALSTACK_ENDPOINT_URL=http://localstack:4566 \
   npm test -- --runInBand src/tasks/tasks.localstack.test.ts
   ```

   ワーカーは `StatusIndex` GSI を介して `PoliTopics-llm-tasks` テーブルから直接タスクを取得し、`storeData` を使用して `PoliTopics` 記事テーブルに最終的なリデュース結果を書き込みます。

# ユーティリティ (デバッグ)

### S3 バケット

```bash
# LocalStack 内のすべての S3 バケットをリスト
aws --no-cli-pager --endpoint-url http://localstack:4566 --region ap-northeast-3 s3api list-buckets

aws --endpoint-url http://localstack:4566   s3 ls s3://politopics-prompts/demo/<path> \
   --recursive \
   --human-readable \
   --summarize
```

- Recap はデバッグのために無効なリデュース出力を S3 にダンプします。以下を確認してください。
  `s3://<article-asset-bucket>/invalid-payloads/<taskId>/<timestamp>.txt`
  (Discord 通知に正確な URI が含まれています)。

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
