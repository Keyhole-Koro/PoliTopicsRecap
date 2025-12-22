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