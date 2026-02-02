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

```
起動 → タスク数カウント → max(RPD, tasks)を上限に設定
           │
    ┌──────▼──────────────────────────────────────┐
    │                                             │
    ▼                                             │
タスク取得 ──→ なし ──→ 正常終了 (exit 0)          │
    │                                             │
    ▼ あり                                        │
Rate Limit待機                                    │
    │                                             │
    ▼                                             │
タスク処理                                        │
    │                                             │
    ├── 成功 → カウンター増加、連続エラーリセット    │
    │         上限到達? ──→ Yes ──→ 正常終了       │
    │              │                              │
    │              ▼ No                           │
    │              └──────────────────────────────┘
    │
    └── 失敗 → 連続エラー増加
              閾値超過? ──→ Yes ──→ エラー終了 (exit 1)
                  │
                  ▼ No
              待機 → 次のタスクへ ────────────────┘
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
```

### 環境変数

| 変数名                  | 説明                                                         | 必須                |
| ----------------------- | ------------------------------------------------------------ | ------------------- |
| `APP_ENVIRONMENT`       | 環境 (prod/stage/local)                                      | Yes                 |
| `GEMINI_API_KEY`        | Gemini APIキー                                               | Yes (prod/stage)    |
| `DISCORD_WEBHOOK_ERROR` | エラー通知Webhook                                            | Yes                 |
| `DISCORD_WEBHOOK_WARN`  | 警告通知Webhook                                              | Yes                 |
| `DISCORD_WEBHOOK_BATCH` | バッチ通知Webhook                                            | Yes                 |
| `R2_WRITE_ENDPOINT_URL` | Cloudflare R2エンドポイント                                  | Yes (prod/stage)    |
| `R2_ACCESS_KEY_ID`      | R2アクセスキーID                                             | Yes (prod/stage)    |
| `R2_SECRET_ACCESS_KEY`  | R2シークレットアクセスキー                                   | Yes (prod/stage)    |
| `R2_ARTICLE_BUCKET`     | R2記事アセットバケット                                       | No (デフォルト使用) |
| `R2_REGION`             | R2リージョン (デフォルト: "auto")                            | No                  |
| `R2_PUBLIC_ASSET_URL`   | R2パブリックURL (デフォルト: "https://asset.politopics.net") | No                  |

## ストレージアーキテクチャ

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

- **タスク実行ロール**: ECRイメージプル、CloudWatchログ
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
