# PoliTopics Recap
[日本語版](./jp/README.md)

Summarization and article persistence: consume tasks from DynamoDB, pull prompts from S3, generate recaps, store article assets in R2, and metadata in DynamoDB. Runs on AWS Fargate (scheduled by EventBridge) with Discord notifications.

## Architecture

```mermaid
---
config:
  layout: dagre
---
flowchart LR
  subgraph RP["PoliTopicsRecap / Processing Service"]
        RecapSchedule["EventBridge (Cron)<br>RecapSchedule"]
        RecapBatch["AWS Fargate Task (Node.js)<br>RecapBatch"]
        S1["① Start Batch<br>Trigger Recap Job"]
        S2["② Fetch Ready/Ingested Tasks<br>from TaskTable"]
        S3["③ Build Prompts/Chunks (if needed)<br>update task to pending/remake"]
        S4["④ Load Raw/Prompt/Chunks<br>from LLMArtifactsBucket"]
        S5["⑤ Summarize via LLM"]
        S6["⑥ Persist Results<br>R2 assets + ArticleTable + S3 results"]
        S7["⑦ Update Task Status as Completed"]
        AssetBucket[("Cloudflare R2 (S3 API)<br>AssetBucket")]
        TaskTable[("DynamoDB<br>TaskTable: llm_task_table")]
        ArticleTable[("DynamoDB<br>ArticleTable: politopics_article_table")]
        LlmBucket[("Amazon S3<br>LLMArtifactsBucket<br>raw/prompts/results")]
  end
    RecapSchedule --> S1
    S1 --> RecapBatch
    RecapBatch --> S2 & S3 & S4 & S5 & S6 & S7
    S2 --> TaskTable
    S3 --> LlmBucket & TaskTable
    S4 --> LlmBucket
    S5 --> GeminiAPI["External<br>GeminiAPI<br>(LLM Summarization)"] & RecapBatch
    GeminiAPI --> S5
    S6 --> AssetBucket & ArticleTable & LlmBucket
    S7 --> TaskTable

     S1:::step
     S2:::step
     S3:::step
     S4:::step
     S5:::step
     S6:::step
     S7:::step
    classDef step fill:#f9f9f9,stroke:#333,stroke-width:1.5px
```

Highlights
- Prompts/results are read from S3; article assets (`asset.json`) are written to R2 with public/signed URLs.
- DynamoDB stores metadata and thin indexes for headlines/suggestions.
- Discord webhooks: error/warn/batch.

## Commands (pnpm)
- Install: `pnpm install`
- Ensure LocalStack resources: `pnpm run ensure:localstack`
- Test (LocalStack): `pnpm test` (`APP_ENVIRONMENT=localstackTest`, `pretest` applies resources)
- Test (gha): `pnpm run test:gha`
- Build: `pnpm build`
- Local invoke helper: `pnpm dev`

## Environment
- `APP_ENVIRONMENT` (`local`|`stage`|`prod`|`ghaTest`|`localstackTest`)
- `GEMINI_API_KEY`
- `GEMINI_MAX_INPUT_TOKEN`, `GEMINI_MAX_OUTPUT_TOKEN`
- `CHUNK_PACKING_TOKEN_BUDGET_RATIO` (default `0.85`)
- `SINGLE_CHUNK_MAX_SPEECHES` (default `40`)
- `SINGLE_CHUNK_MAX_TOKEN_USAGE_RATIO` (default `0.5`)
- `TASK_TABLE_NAME`, `TASK_STATUS_INDEX_NAME`
- `PROMPT_BUCKET_NAME` (S3)
- `ARTICLE_TABLE_NAME`, `ARTICLE_ASSET_BUCKET_NAME` (R2 bucket name)
- R2 access: `R2_WRITE_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ARTICLE_BUCKET`, `R2_PUBLIC_ASSET_URL`
- Notifications: `DISCORD_WEBHOOK_ERROR`, `DISCORD_WEBHOOK_WARN`, `DISCORD_WEBHOOK_BATCH`
- AWS: `AWS_REGION` (default `ap-northeast-3`), `AWS_ENDPOINT_URL` for LocalStack

Chunking notes:
- `single_chunk` is used only for small meetings (speech-count/token-ratio thresholds).
- In `chunked` mode, each chunk stores `based_on_orders` and reduce input includes that coverage metadata.

Tip: from repo root, `source ../scripts/export_test_env.sh` to populate LocalStack defaults before running tests.

## Local flow
1) Start LocalStack (root `docker-compose.yml`).
2) `pnpm run ensure:localstack`
3) `pnpm test` or `pnpm dev` for local invocation.

## Terraform
- LocalStack guide: `docs/terraform-localstack.md`
- Typical flow:
```bash
cd terraform
terraform init -backend-config=backends/local.hcl
terraform plan -var-file=tfvars/localstack.tfvars -out=tfplan
terraform apply tfplan
```

## Observability
- Discord notifications for errors/warns/batch.
- CloudWatch logs for the Fargate task (or LocalStack logs locally).
