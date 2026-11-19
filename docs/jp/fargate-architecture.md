# PoliTopicsRecap Fargate アーキテクチャ

## 概要

PoliTopicsRecapはECS Fargateタスクとして実行され、EventBridge Schedulerによって1日1回トリガーされます。コンテナは設定可能なレートリミットでペンディング中のLLMタスクを処理し、完了後に終了します。Lambda実行は廃止済みです。

## アーキテクチャ図

```
EventBridge Scheduler (1日1回)
         │
         ▼
   ECS Fargate Task (起動)
         │
         ▼
   ┌─────────────────────────────────────┐
   │  Recap Container                    │
   │  ├── Rate Limiter (設定可能)        │
   │  ├── Task Loop                      │
   │  │   ├── ペンディングタスク取得      │
   │  │   ├── レートリミット適用で処理    │
   │  │   └── 完了/上限まで繰り返し      │
   │  └── Exit code 0/1 で終了           │
   └─────────────────────────────────────┘
         │
         ▼
   コンテナ終了 → Fargateタスク終了
```

## 処理フロー

```mermaid
flowchart TD
  A[起動] --> B[readyタスク数をカウント]
  B --> C[maxTasks = max(RPD, ready)]
  C --> D{major mismatch の完了タスクを再投入?}
  D -->|Yes| E[上限まで再投入]
  D -->|No| F
  E --> F[processed < maxTasks の間ループ]

  F --> G{次タスク取得}
  G -->|なし| H[正常終了 (exit 0)]
  G -->|あり| I[processTaskWithChunkLoop]

  I --> J{日次上限?}
  J -->|Yes| H
  J -->|No| K[RateLimiter.waitIfNeeded]
  K --> L[processTask]

  L --> M{結果}
  M -->|成功| N[Stats: succeeded]
  M -->|失敗| O[Stats: failed + cooldown]
  M -->|スキップ| P[Stats: skipped]

  N --> Q[Stats: processed++]
  O --> Q
  P --> Q
  Q --> F
```

## Chunkedタスクのサブフロー

```mermaid
flowchart TD
  A[processTaskWithChunkLoop] --> B{日次上限?}
  B -->|Yes| Z[バッチ停止]
  B -->|No| C[RateLimiter.waitIfNeeded]
  C --> D[processTask]
  D --> E{結果}
  E -->|失敗/スキップ| Y[結果を返す]
  E -->|成功| F[タスク状態を再取得]
  F --> G{completed?}
  G -->|Yes| Y
  G -->|No| H{processingMode = chunked?}
  H -->|No| Y
  H -->|Yes| I{未完了chunkあり?}
  I -->|Yes| B
  I -->|No| J[reduce処理 (processTask内)]
  J --> B
```

## 設定

### レートリミット設定 (config.ts)

```typescript
rateLimit: {
  requestsPerMinute: number; // RPM制限 (デフォルト: 15)
  requestsPerDay: number; // 日次リクエスト上限 (デフォルト: 1500)
  maxConsecutiveErrors: number; // 連続エラー閾値 (デフォルト: 5)
  cooldownOnErrorMs: number; // エラー時の待機時間 (デフォルト: 30000ms)
}

batch: {
  maxTasksPerRun: number | "auto"; // 'auto' = max(requestsPerDay, ペンディングタスク数)
  gracefulShutdownTimeoutMs: number; // シャットダウン待機時間 (デフォルト: 10000ms)
}

chunking: {
  // 利用可能な入力トークンに対するチャンク分割比率
  CHUNK_PACKING_TOKEN_BUDGET_RATIO: number; // デフォルト: 0.85
  // single_chunk を許可する最大発言数
  SINGLE_CHUNK_MAX_SPEECHES: number; // デフォルト: 40
  // single_chunk を許可する最大トークン使用率
  SINGLE_CHUNK_MAX_TOKEN_USAGE_RATIO: number; // デフォルト: 0.5
}
```

### 環境変数

| 変数名                  | 説明                                                         | 必須                |
| ----------------------- | ------------------------------------------------------------ | ------------------- |
| `APP_ENVIRONMENT`       | 環境 (prod/stage/local)                                      | Yes                 |
| `LLM_PROVIDER`          | `anthropic`（デフォルト）または `gemini`（ロールバック用）   | No                  |
| `ANTHROPIC_API_KEY`     | Anthropic APIキー（Fargate では SSM Parameter Store から渡す） | Yes (prod/stage、`LLM_PROVIDER=anthropic` のとき) |
| `ANTHROPIC_MODEL`       | Claude のモデル (デフォルト: `claude-haiku-5-5`)              | No                  |
| `ANTHROPIC_EFFORT`      | `output_config.effort`: `low`/`medium`/`high`/`xhigh`/`max` (デフォルト: `medium`) | No |
| `ANTHROPIC_TIMEOUT_MS`  | Claude 呼び出し 1 回のタイムアウト。リトライを含む (デフォルト: 600000) | No   |
| `ANTHROPIC_MAX_INPUT_TOKEN`  | チャンクあたりの Claude 入力上限 (デフォルト: 64000)     | No                  |
| `ANTHROPIC_MAX_OUTPUT_TOKEN` | Claude の `max_tokens` (デフォルト: 64000)               | No                  |
| `GEMINI_API_KEY`        | Gemini APIキー                                               | Yes (prod/stage、`LLM_PROVIDER=gemini` のとき) |
| `GEMINI_MAX_INPUT_TOKEN`  | Gemini入力上限 (prod/stageデフォルト: 64000)               | No                  |
| `GEMINI_MAX_OUTPUT_TOKEN` | Gemini出力上限 (デフォルト: 64000)                          | No                  |
| `CHUNK_PACKING_TOKEN_BUDGET_RATIO` | 利用可能入力トークンに対するチャンク分割比率 (デフォルト: 0.85) | No |
| `SINGLE_CHUNK_MAX_SPEECHES` | `single_chunk` を許可する最大発言数 (デフォルト: 40) | No |
| `SINGLE_CHUNK_MAX_TOKEN_USAGE_RATIO` | `single_chunk` を許可する最大トークン使用率 (デフォルト: 0.5) | No |
| `DISCORD_WEBHOOK_ERROR` | エラー通知Webhook                                            | Yes                 |
| `DISCORD_WEBHOOK_WARN`  | 警告通知Webhook                                              | Yes                 |
| `DISCORD_WEBHOOK_BATCH` | バッチ通知Webhook                                            | Yes                 |
| `R2_WRITE_ENDPOINT_URL` | Cloudflare R2エンドポイント                                  | Yes (prod/stage)    |
| `R2_ACCESS_KEY_ID`      | R2アクセスキーID                                             | Yes (prod/stage)    |
| `R2_SECRET_ACCESS_KEY`  | R2シークレットアクセスキー                                   | Yes (prod/stage)    |
| `R2_ARTICLE_BUCKET`     | R2記事アセットバケット                                       | No (デフォルト使用) |
| `R2_REGION`             | R2リージョン (デフォルト: "auto")                            | No                  |
| `R2_PUBLIC_ASSET_URL`   | R2パブリックURL (デフォルト: "https://asset.politopics.net") | No                  |

## LLM プロバイダ

Recap は既定で、Anthropic API の **Claude Haiku 5.5**（`claude-haiku-5-5`）で要約を作ります。Gemini はロールバック用に残してあり、`LLM_PROVIDER=gemini`（Terraform では `llm_provider = "gemini"`）で戻せます。

- **クライアント**: `src/llm/anthropicClient.ts`（`@anthropic-ai/sdk`）。`max_tokens` が大きいと SDK がストリーミングでない呼び出しを拒むため、`messages.stream(...).finalMessage()` で受けます。`ANTHROPIC_TIMEOUT_MS` は、SDK のリトライ 2 回（429・5xx・接続エラー）を含めた 1 回の呼び出し全体の上限です。
- **パラメータ**: `model`、`max_tokens`（`ANTHROPIC_MAX_OUTPUT_TOKEN`。欠けた発言の補完だけは 8000。思考も `max_tokens` に数えられるため）、`output_config.effort`（`ANTHROPIC_EFFORT`、デフォルト `medium`）。adaptive thinking がモデルの既定なので `thinking` は送りません。`temperature`/`top_p`/`top_k` とアシスタントのプレフィルは送りません（Claude Haiku 5.5 では 400 になる）。
- **JSON 出力**: Claude にだけ、JSON オブジェクトだけを返す（前置き・コードフェンスなし）よう短い日本語の system 指示を付けます。共有プロンプトと `PROMPT_VERSION` は変えていないので、完了済みタスクは作り直されません。
- **応答の扱い**: `text` ブロックだけを読みます（思考ブロックが先に来る）。`stop_reason: "refusal"` は拒否の分類をログに残してタスクを失敗にします（Claude Haiku 5.5 にはサーバー側のフォールバックがない）。`max_tokens` と `model_context_window_exceeded` は、途中で切れた JSON を保存せず、チャンクも完了にせずにタスクを失敗にします。API のエラーは SDK のクラスと status のまま投げ直すので、400「prompt is too long」（や 413）では今までどおりチャンクを小さくして作り直します。
- **ログ**: 呼び出しごとに message id、`stop_reason`、usage（入力・出力・思考・キャッシュのトークン数）。失敗時は status、request ID、エラーコード。API キーとプロンプトはログに出しません。
- **トークン数**: チャンク分割は、生成と同じモデルで `messages.countTokens` を呼んで数えます（Gemini とトークナイザが違う）。空のテキストは API を呼ばずに 0 です。値は推定で数トークン多めに出ることがあり、チャンクが少し小さくなるだけです。count_tokens は無料ですが、利用階層ごとのレート制限があります。
- **タスクの `llm` の値**: `anthropic`、`gemini`、`fake` のいずれか。`anthropic` と `gemini` はどちらも今の設定のプロバイダで処理します。切り替え前に Gemini 用に準備されたタスクは Claude で処理を終えます（警告ログあり）。ロールバック時も逆向きに同じです。`task.llmModel` は、今のプロバイダのモデルのときだけ使います。`fake` はテスト用の echo クライアント、それ以外の値はスキップします。
- **Fargate での API キー**: Terraform が SSM Parameter Store の SecureString `/politopics/<env>/recap/anthropic-api-key` を ECS の `secrets` でコンテナに `ANTHROPIC_API_KEY` として渡します。キーは Terraform の state、タスク定義、GitHub のどこにも入りません。デプロイ前にパラメータを作ってください（`terraform/jp/README.md`）。
- **スモークテスト**（実 API、明示的に有効にしたときだけ）: `RUN_ANTHROPIC_SMOKE_TEST=true ANTHROPIC_API_KEY=... APP_ENVIRONMENT=localstackTest ENABLE_NOTIFICATION=false ./node_modules/.bin/jest --config jest.config.ts --runInBand src/llm/anthropicClient.smoke.test.ts`

## ストレージアーキテクチャ

タスクチャンクのメタデータ:
- `chunks[].based_on_orders` に各 chunk がカバーする発言 order を保持。
- reduce プロンプト組み立て時にこの情報を入力（`[chunk orders] ...`）へ渡す。
- 旧タスクで `based_on_orders` が無い場合は、chunk 出力本文や URL パターンからフォールバック推定する。

### Cloudflare R2 連携

記事アセット（要約、会話データ）はコスト削減とエッジパフォーマンスのため、AWS S3ではなくCloudflare R2に保存されます。

#### カスタムドメインによるパブリックアクセス

アセットは `asset.politopics.net` 経由で公開されます：

```
フロントエンド (politopics.net)
       │
       ├── APIリクエスト ──► api.politopics.net ──► DynamoDB (メタデータのみ)
       │                          │
       │                          ▼
       │                     { article, assetUrl }
       │
       └── アセットリクエスト ──► asset.politopics.net ──► R2 (CDNキャッシュ)
                                   │
                                   ▼
                              { summary, dialogs, ... }
```

#### データフロー

1. **APIレスポンス**: バックエンドが `assetUrl` 付きの記事メタデータを返す
2. **アセット取得**: フロントエンドがR2から直接アセットを取得
3. **マージ**: フロントエンドでメタデータ + アセットをマージして表示

このアーキテクチャのメリット：

- **高速なAPIレスポンス**: バックエンドでS3/R2読み込み不要
- **CDNキャッシュ**: Cloudflareエッジでアセットがキャッシュされる
- **エグレスコストゼロ**: R2はエグレス料金無料

### R2設定

R2はS3互換APIを使用します。環境ごとの設定：

| 環境  | R2有効 | バケット                  | パブリックURL                |
| ----- | ------ | ------------------------- | ---------------------------- |
| local | No     | LocalStack S3             | N/A                          |
| stage | Yes    | politopics-articles-stage | https://asset.politopics.net |
| prod  | Yes    | politopics-articles-prod  | https://asset.politopics.net |

### Cloudflare Dashboard設定（必須）

カスタムドメインでパブリックアクセスを有効にする手順：

1. **R2バケット設定** → カスタムドメイン接続 → `asset.politopics.net`
2. **CORS設定**:
   ```json
   [
     {
       "AllowedOrigins": ["https://politopics.net", "https://*.politopics.net"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```
3. **キャッシュルール**: `/articles/*` に `Cache-Control: public, max-age=31536000, immutable` を設定

## Exit Code

| コード | 意味               | アクション |
| ------ | ------------------ | ---------- |
| 0      | 全タスク正常完了   | 正常終了   |
| 1      | 連続エラー上限到達 | エラー終了 |

## AWSリソース

### ECS Fargate

- **クラスター**: `politopics-recap-{env}`
- **タスク定義**: `politopics-recap-task-{env}`
- **CPU**: 256 (0.25 vCPU)
- **メモリ**: 512 MB

### ECR

- **リポジトリ**: `politopics-recap`
- **イメージタグ**: `{env}-{git-sha}`

### EventBridge Scheduler

- **スケジュール**: `cron(0 9 * * ? *)` (毎日9:00 JST)
- **ターゲット**: ECS Fargateタスク

### IAMロール

- **タスク実行ロール**: ECRイメージプル、CloudWatchログ、Anthropic API キーのパラメータの読み取り（`llm_provider = "anthropic"` のとき、そのパラメータだけに `ssm:GetParameters`）
- **タスクロール**: DynamoDB、S3、SQSアクセス

## ローカルテスト

### Docker Compose (LocalStack)

```bash
# LocalStackとアプリを起動
docker-compose up -d

# バッチモードでコンテナ実行
docker-compose run --rm app-batch
```

### コンテナ手動実行

```bash
# イメージビルド
docker build -t politopics-recap:local .

# LocalStackと接続して実行
docker run --rm \
  --network politopics-network \
  -e APP_ENVIRONMENT=local \
  -e AWS_ENDPOINT=http://localstack:4566 \
  politopics-recap:local
```
