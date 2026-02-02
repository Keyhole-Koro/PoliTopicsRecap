# PoliTopics Recap
[English Version](../README.md)

タスクを DynamoDB から取得し、S3 のプロンプトを読み込み、LLM で要約して R2 に記事アセットを保存、メタデータを DynamoDB に書き込む処理サービスです。EventBridge スケジュールで AWS Fargate を起動し、Discord に通知を送ります。

## アーキテクチャ

```mermaid
---
config:
  layout: dagre
---
flowchart LR
  subgraph RP["PoliTopicsRecap / 要約サービス"]
        RecapSchedule["EventBridge (Cron)<br>要約スケジュール"]
        RecapBatch["AWS Fargate タスク (Node.js)<br>RecapBatch"]
        S1["① バッチ開始<br>要約ジョブを起動"]
        S2["② 未処理タスクを取得<br>TaskTable から読む"]
        S3["③ 会議録を取得<br>PromptBucket から読む"]
        S4["④ LLM で要約生成"]
        S5["⑤ 結果を永続化"]
        S6["⑥ タスクを完了に更新"]
        AssetBucket[("Cloudflare R2 (S3 API)<br>AssetBucket")]
        TaskTable[("DynamoDB<br>TaskTable: llm_task_table")]
        ArticleTable[("DynamoDB<br>ArticleTable: politopics_article_table")]
        PromptBucket[("Amazon S3<br>PromptBucket")]
  end
    RecapSchedule --> S1
    S1 --> RecapBatch
    RecapBatch --> S2 & S3 & S4 & S5 & S6
    S2 --> TaskTable
    S3 --> PromptBucket
    S4 --> GeminiAPI["外部<br>GeminiAPI<br>(LLM 要約)"] & RecapBatch
    GeminiAPI --> S4
    S5 --> AssetBucket & ArticleTable
    S6 --> TaskTable

     S1:::step
     S2:::step
     S3:::step
     S4:::step
     S5:::step
     S6:::step
    classDef step fill:#f9f9f9,stroke:#333,stroke-width:1.5px
```

ポイント
- プロンプト/結果は S3、記事アセット (`asset.json`) は R2 に保存し、公開/署名付き URL を返す。
- メタデータと薄いインデックスは DynamoDB に保存し、ヘッドラインやサジェストを 1 クエリで取得。
- Discord Webhook を error/warn/batch に利用。

## コマンド (pnpm)
- インストール: `pnpm install`
- LocalStack リソース確認/作成: `pnpm run ensure:localstack`
- テスト (LocalStack): `pnpm test` (`APP_ENVIRONMENT=localstackTest`, `pretest` でリソース適用)
- テスト (gha): `pnpm run test:gha`
- ビルド: `pnpm build`
- ローカル呼び出し: `pnpm dev`

## 環境変数
- `APP_ENVIRONMENT` (`local`|`stage`|`prod`|`ghaTest`|`localstackTest`)
- `GEMINI_API_KEY`
- `TASK_TABLE_NAME`, `TASK_STATUS_INDEX_NAME`
- `PROMPT_BUCKET_NAME` (S3)
- `ARTICLE_TABLE_NAME`, `ARTICLE_ASSET_BUCKET_NAME` (R2 バケット名)
- R2: `R2_WRITE_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ARTICLE_BUCKET`, `R2_PUBLIC_ASSET_URL`
- 通知: `DISCORD_WEBHOOK_ERROR`, `DISCORD_WEBHOOK_WARN`, `DISCORD_WEBHOOK_BATCH`
- AWS: `AWS_REGION` (デフォルト `ap-northeast-3`), LocalStack 用 `AWS_ENDPOINT_URL`

ヒント: リポジトリルートで `source ../scripts/export_test_env.sh` を実行すると、LocalStack 用の主要デフォルトが一括で設定されます。

## ローカルフロー
1) LocalStack を起動 (リポジトリルートの `docker-compose.yml`)。
2) `pnpm run ensure:localstack`
3) `pnpm test` または `pnpm dev` を実行。

## Terraform
- LocalStack 手順: `docs/jp/terraform-localstack.md`
- 典型フロー:
```bash
cd terraform
terraform init -backend-config=backends/local.hcl
terraform plan -var-file=tfvars/localstack.tfvars -out=tfplan
terraform apply tfplan
```

## オブザーバビリティ
- Discord で error/warn/batch を通知。
- CloudWatch (Fargate) または LocalStack のログを確認。
