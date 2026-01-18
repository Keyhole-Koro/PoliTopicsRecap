# スクリプトと使用法 (PoliTopicsRecap)
[English Version](../../docs/scripts_and_usage.md)

このドキュメントでは、Recap モジュールの実行可能なスクリプトと一般的なワークフローをリストします。
パスは `PoliTopicsRecap` からの相対パスです。

## NPM スクリプト
- `pnpm run dev`: ローカル呼び出しを実行します (`src/local_invoke.ts`)。
- `pnpm run build`: コンテナ実行向けに TypeScript をコンパイルします。
- `pnpm run build:container`: `pnpm run build` のエイリアスです。
- `pnpm run test`: `APP_ENVIRONMENT=localstackTest` で Jest を実行します。
- `pnpm run test:gha`: `APP_ENVIRONMENT=ghaTest` で Jest を実行します。
- `pnpm run local:test:e2e`: 統合テストフローを実行します。
- `pnpm run ensure:localstack`: LocalStack リソースを検証し、不足している場合は作成します。
- `pnpm run pretest`: `ensure:localstack` と同じです。
- `pnpm run enqueue-mock`: モックプロンプトをエンキューします (`scripts/enqueue-mock-prompts.ts` を想定していますが、現在は欠落しています)。

## ヘルパースクリプト
- `scripts/ensure-localstack.sh`: LocalStack のバケット/テーブルを確認します。`--check-only` と環境引数 (デフォルト: `RECAP_LOCALSTACK_ENV` または `local`) をサポートします。
- `scripts/localstack_apply.sh`: ビルド、ステートバケットの作成、リソースのインポート、および LocalStack または ghaTest 用の Terraform plan/apply を実行します (`pnpm` が必要)。
- `scripts/debug_tsc.sh`: クイック TypeScript コンパイルチェック + ファイルリストプローブ。
- `terraform/scripts/create-state-bucket.sh <local|ghaTest|stage|prod>`: Terraform ステートバケットを作成/検証します。
- `terraform/scripts/import_all.sh <local|ghaTest|stage|prod>`: 既存のリソースを Terraform ステートにインポートします。

## ユースケース

### 開発中のローカル呼び出し
```bash
pnpm install
pnpm run dev
```

### LocalStack インフラをブートストラップする
```bash
bash scripts/localstack_apply.sh local
```

### LocalStack でテストを実行する
```bash
pnpm run ensure:localstack
pnpm run test
```

### デプロイ可能なアーティファクトをビルドする
```bash
pnpm run build
```

## 関連ドキュメント
- `docs/jp/terraform-localstack.md`
