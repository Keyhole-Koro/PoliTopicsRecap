# changes.agent.md

Agent: Codex
Date/Time: 2025-12-22 03:38 UTC
Keywords: localstack, terraform, state-bucket
Topic: Align state bucket creation with backend config
Details:
- Standardized the Recap state-bucket script arguments to match the shared local/stage/prod format without changing backend names.

Agent: Gemini
Date/Time: 2025-12-22 13:00 JST
Keywords: terraform, import, localstack, cloudwatch, dynamodb
Topic: Fix Terraform import and logic errors
Details:
- Added automatic creation of application buckets (`politopics-prompts`, `politopics-articles-local`) in `create-state-bucket.sh` for local environment.
- Updated `import_all.sh` to gracefully skip non-existent objects and properly import the `llm_tasks` DynamoDB table.
- Fixed `Invalid for_each` error in `aws_cloudwatch_event_target` and permissions by referencing map keys instead of resources.
- Files changed:
  - `terraform/service/main.tf`
  - `terraform/scripts/create-state-bucket.sh`
  - `terraform/scripts/import_all.sh`

Agent: Gemini
Date/Time: 2025-12-23 00:00 UTC
Keywords: payload, asset, naming convention
Topic: Rename 'payload' to 'asset' in relevant contexts
Details:
- Renamed `readArticlePayload` to `readArticleAsset` and updated its usages in `src/tasks/tasks.localstack.test.ts`.
- Changed `payload.json` to `asset.json` in two assertions in `src/lambda_handler.integration.test.ts`.
- In `src/dynamoDB/storeData.ts`:
    - Renamed type `ArticlePayload` to `ArticleAsset`.
    - Renamed function `persistArticlePayload` to `persistArticleAsset` and updated its parameter.
    - Changed `payload.json` to `asset.json` and `data: payload` to `data: asset` within the function.
    - Updated the call to `persistArticlePayload` to `persistArticleAsset`.
- In `src/dynamoDB/storeData.test.ts`, changed `payload.json` to `asset.json` in one assertion.

Agent: Gemini
Date/Time: 2025-12-24 12:00 JST
Keywords: build-fix, typescript, s3, uploadJson
Topic: Fix compilation errors in storeData.ts
Details:
- Fixed `persistArticleAsset` function signature to accept `ArticleAssetStorage` correctly.
- Replaced undefined `putJsonS3` with `uploadJson` from `@utils/s3`.
- Corrected property access on `assets` object.
- Renamed `assets` parameter to `storageConfig` in `persistArticleAsset` for clarity.
- Files changed:
  - `src/dynamoDB/storeData.ts`

Agent: Codex
Date/Time: 2025-12-26 10:03 JST
Keywords: terraform, import, dynamodb
Topic: Remove count-based gating and align imports
Details:
- Removed `count = ... ? 0 : 1` gating for the task table and always manage it as a resource.
- Updated import logic to use non-indexed addresses and skip missing configuration/resources.
- Files changed:
  - `PoliTopicsRecap/terraform/service/main.tf`
  - `PoliTopicsRecap/terraform/scripts/import_all.sh`

Agent: Codex
Date/Time: 2025-12-28 07:26 UTC
Keywords: config, env, terraform, lambda, gemini
Topic: Require Gemini key and propagate APP_ENVIRONMENT
Details:
- Switched `src/config.ts` to read `GEMINI_API_KEY` from environment and to resolve `APP_ENVIRONMENT` (local/stage/prod) at startup.
- Passed `APP_ENVIRONMENT` into the Recap Lambda environment via Terraform using the existing `environment` variable (removed the extra `app_environment` input).
- Files changed:
  - `PoliTopicsRecap/src/config.ts`
  - `PoliTopicsRecap/terraform/main.tf`
  - `PoliTopicsRecap/terraform/variables.tf`
  - `PoliTopicsRecap/terraform/service/main.tf`
  - `PoliTopicsRecap/terraform/service/variables.tf`
  - `PoliTopicsRecap/terraform/service/lambda/main.tf`
  - `PoliTopicsRecap/terraform/service/lambda/variables.tf`
