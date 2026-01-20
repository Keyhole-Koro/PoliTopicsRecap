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

Agent: Codex
Date/Time: 2025-12-28 12:45 UTC
Keywords: recap, s3, invalid-payload, notification
Topic: Dump invalid reduce payloads to S3 and link in alerts
Details:
- When article persistence fails (e.g., JSON parse errors), the raw reduce payload is uploaded to S3 under `invalid-payloads/<env>/<taskId>/<timestamp>.txt`, logged to stdout, and linked in the warning notification.
- Added a payload dump field to the Recap notification for skipped persistence.
- Documented the S3 dump path in `docs/terraform-localstack.md`.
- Files changed:
  - `src/lambda/taskProcessor.ts`
  - `src/lambda/notifications.ts`
  - `docs/terraform-localstack.md`

Agent: Codex
Date/Time: 2026-01-05 13:54 JST
Keywords: recap, retryAttempts, error-handling, tests
Topic: Increment retryAttempts on recap task failures
Details:
- Ensured retryAttempts increments even when task error notifications fail by attempting notification and retry updates independently.
- Added unit coverage for retryAttempts increment when a task processing failure occurs and notifications error out.
- Files changed:
  - `PoliTopicsRecap/src/lambda_handler.ts`
  - `PoliTopicsRecap/src/retryAttempts.test.ts`
  - `PoliTopicsRecap/changes.agent.md`

Agent: Codex
Date/Time: 2026-01-05 18:45 JST
Keywords: dynamodb, thin-index, asset-key, recap, tests
Topic: Include card metadata on recap thin index items for frontend queries
Details:
- Persisted both asset key and URL when uploading article assets and stored them on the main item.
- Expanded thin index items (CATEGORY/KEYWORD/PERSON/etc.) to include description, categories, keywords, participants, and asset pointers needed for frontend cards.
- Updated storeData tests to assert asset key/url propagation on index items and main records.
- Files changed:
  - `PoliTopicsRecap/src/dynamoDB/storeData.ts`
  - `PoliTopicsRecap/src/dynamoDB/storeData.test.ts`

Agent: Codex
Date/Time: 2026-01-05 19:20 JST
Keywords: tests, env, localstack, integration
Topic: Require explicit test env export instead of dummy fallbacks
Details:
- Removed dummy environment fallbacks from LocalStack integration tests and added guidance to source `scripts/export_test_env.sh` when required vars are missing.
- Made config/handler imports lazy and skip suites when env prerequisites are absent, preventing circular JSON errors from missing LocalStack setup.
- Files changed:
  - `PoliTopicsRecap/src/lambda_handler.integration.test.ts`
  - `PoliTopicsRecap/src/tasks/tasks.localstack.test.ts`

Agent: Codex
Date/Time: 2026-01-05 19:40 JST
Keywords: jest, reporter, columns, setup
Topic: Stabilize Jest reporter width to avoid RangeError
Details:
- Added a test setup file to normalize stdout/stderr columns and prevent negative padding in Jest’s summary reporter.
- Registered the setup file in Jest config.
- Files changed:
  - `PoliTopicsRecap/jest.config.ts`
  - `PoliTopicsRecap/src/testSetup.ts`

Agent: Codex
Date/Time: 2026-01-06 10:05 JST
Keywords: lambda-build, dist-path, tsc-alias, pnpm
Topic: Fix recap lambda build to pick compiled outputs
Details:
- Updated the local lambda build script to point tsc-alias at `dist` and copy compiled sources from `dist` (not `dist/src`), fixing “Compiled sources not found” during build.
- Files changed:
  - `PoliTopicsRecap/scripts/build-local-lambda.js`

Agent: Codex
Date/Time: 2026-01-06 11:05 JST
Keywords: tests, gemini, mock, integration
Topic: Make recap integration tests use mocked Gemini responses
Details:
- Mocked the Gemini client with a response queue and reset between tests to avoid real API calls and 400 errors.
- Queued canned JSON outputs for single/chunked flows in the LocalStack integration test.
- Files changed:
  - `PoliTopicsRecap/src/lambda_handler.integration.test.ts`

Agent: Codex
Date/Time: 2026-01-06 11:20 JST
Keywords: prompts, keywords, reduce, recap
Topic: Ensure reduce prompts emit keywords
Details:
- Updated reduce-mode prompt instructions/output format to require keywords (with priority) alongside participants and summaries.
- Files changed:
  - `PoliTopicsRecap/src/prompts.for.llmtest.ts`

Agent: Gemini
Date/Time: 2026-01-15 JST
Keywords: logging, debug, recap
Topic: Add comprehensive stdout logs for debugging
Details:
- Added structured logs to `lambda_handler.ts` and `taskProcessor.ts` to trace task lifecycle, prompt fetching, LLM usage, and result persistence.
- Included truncation for prompt/response text to keep logs readable.
- Files changed:
  - `PoliTopicsRecap/src/lambda_handler.ts`
  - `PoliTopicsRecap/src/lambda/taskProcessor.ts`

Agent: Gemini
Date/Time: 2026-01-18 10:00:00 JST
Keywords: documentation, translation, japanese
Topic: Translate documentation to Japanese
Details:
- Translated `docs/scripts_and_usage.md`, `docs/terraform-localstack.md`, and `terraform/README.md` to Japanese in `jp/` subdirectories.
- Added links between English and Japanese versions.
Files:
- PoliTopicsRecap/docs/jp/scripts_and_usage.md
- PoliTopicsRecap/docs/jp/terraform-localstack.md
- PoliTopicsRecap/terraform/jp/README.md

Agent: Codex
Date/Time: 2026-01-18 13:38 JST
Keywords: fargate, lambda-removal, batch, terraform, docs, tests
Topic: Remove Lambda runtime and standardize on Fargate processing
Details:
- Moved task processing helpers into `src/processor`, added a shared task runner, and rewired batch execution/tests to use it.
- Deleted Lambda handler/tests/build scripts and simplified LocalStack checks for container-only workflows.
- Removed Lambda/Scheduler Terraform variables and modules, plus updated LocalStack apply/import scripts and docs.
- Files changed:
  - PoliTopicsRecap/src/container_main.ts
  - PoliTopicsRecap/src/processor/taskRunner.ts
  - PoliTopicsRecap/src/processor/llmFactory.ts
  - PoliTopicsRecap/src/processor/notifications.ts
  - PoliTopicsRecap/src/processor/speakerMetadata.ts
  - PoliTopicsRecap/src/processor/taskProcessor.ts
  - PoliTopicsRecap/src/processor/taskProcessor.metadata.test.ts
  - PoliTopicsRecap/src/tasks/tasks.localstack.test.ts
  - PoliTopicsRecap/src/tasks/retryAttempts.test.ts
  - PoliTopicsRecap/src/utils/schedule.ts
  - PoliTopicsRecap/src/lambda_handler.ts
  - PoliTopicsRecap/src/lambda_handler.integration.test.ts
  - PoliTopicsRecap/src/lambda/llmFactory.ts
  - PoliTopicsRecap/src/lambda/notifications.ts
  - PoliTopicsRecap/src/lambda/speakerMetadata.ts
  - PoliTopicsRecap/src/lambda/taskProcessor.ts
  - PoliTopicsRecap/src/lambda/taskProcessor.metadata.test.ts
  - PoliTopicsRecap/scripts/build-lambda.js
  - PoliTopicsRecap/scripts/build-local-lambda.js
  - PoliTopicsRecap/scripts/ensure-localstack.sh
  - PoliTopicsRecap/scripts/localstack_apply.sh
  - PoliTopicsRecap/package.json
  - PoliTopicsRecap/docs/scripts_and_usage.md
  - PoliTopicsRecap/docs/jp/scripts_and_usage.md
  - PoliTopicsRecap/docs/terraform-localstack.md
  - PoliTopicsRecap/docs/jp/terraform-localstack.md
  - PoliTopicsRecap/docs/fargate-architecture.md
  - PoliTopicsRecap/docs/jp/fargate-architecture.md
  - PoliTopicsRecap/terraform/main.tf
  - PoliTopicsRecap/terraform/variables.tf
  - PoliTopicsRecap/terraform/provider.tf
  - PoliTopicsRecap/terraform/scripts/import_all.sh
  - PoliTopicsRecap/terraform/service/main.tf
  - PoliTopicsRecap/terraform/service/variables.tf
  - PoliTopicsRecap/terraform/service/outputs.tf
  - PoliTopicsRecap/terraform/service/lambda/main.tf
  - PoliTopicsRecap/terraform/service/lambda/outputs.tf
  - PoliTopicsRecap/terraform/service/lambda/variables.tf
  - PoliTopicsRecap/terraform/tfvars/localstack.tfvars
  - PoliTopicsRecap/terraform/tfvars/ghaTest.tfvars
  - PoliTopicsRecap/terraform/tfvars/stage.tfvars
  - PoliTopicsRecap/terraform/tfvars/prod.tfvars
  - PoliTopicsRecap/changes.agent.md

Agent: Codex
Date/Time: 2026-01-18 14:25 JST
Keywords: terraform, fargate, ecs, ecr, scheduler
Topic: Add Fargate IaC for Recap batch runner
Details:
- Added ECS/Fargate, ECR, IAM, logs, and scheduler resources for the recap batch task.
- Wired Fargate variables into the service module and documented required TF_VAR settings.
- Files changed:
  - PoliTopicsRecap/terraform/main.tf
  - PoliTopicsRecap/terraform/variables.tf
  - PoliTopicsRecap/terraform/provider.tf
  - PoliTopicsRecap/terraform/service/main.tf
  - PoliTopicsRecap/terraform/service/variables.tf
  - PoliTopicsRecap/terraform/service/outputs.tf
  - PoliTopicsRecap/terraform/service/fargate/main.tf
  - PoliTopicsRecap/terraform/service/fargate/variables.tf
  - PoliTopicsRecap/terraform/service/fargate/outputs.tf
  - PoliTopicsRecap/terraform/tfvars/localstack.tfvars
  - PoliTopicsRecap/terraform/tfvars/ghaTest.tfvars
  - PoliTopicsRecap/terraform/tfvars/stage.tfvars
  - PoliTopicsRecap/terraform/tfvars/prod.tfvars
  - PoliTopicsRecap/terraform/README.md
  - PoliTopicsRecap/terraform/jp/README.md
  - PoliTopicsRecap/changes.agent.md

### Changes After Review
- Added optional Fargate checks to the LocalStack verification script and imports for Fargate resources in the Terraform import helper.
- Files changed:
  - PoliTopicsRecap/scripts/ensure-localstack.sh
  - PoliTopicsRecap/terraform/scripts/import_all.sh
  - PoliTopicsRecap/changes.agent.md

Agent: Codex
Date/Time: 2026-01-18 13:08 JST
Keywords: jest, tests, rate-limiter, integration
Topic: Avoid real-time waits in rate limiter integration test
Details:
- Switched the rate limiter integration test to Jest fake timers and asserted the expected wait duration without real delays.
- Files changed:
  - `PoliTopicsRecap/src/batch/batchProcessor.integration.test.ts`
  - `PoliTopicsRecap/changes.agent.md`

Agent: Gemini
Date/Time: 2026-01-20 15:00 JST
Keywords: logging, cli, output
Topic: Add structured batch execution summary
Details:
- Enhanced `container_main.ts` to display a structured summary table (Environment, Duration, Processed, Succeeded, Failed, Skipped) at the end of execution for better visibility.
- Files changed:
  - `PoliTopicsRecap/src/container_main.ts`
  - `PoliTopicsRecap/changes.agent.md`