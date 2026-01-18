# Scripts and Usage (PoliTopicsRecap)
[Japanese Version](./jp/scripts_and_usage.md)

This document lists runnable scripts and common workflows for the Recap module.
Paths are relative to `PoliTopicsRecap`.

## NPM scripts
- `pnpm run dev`: Run local invocation (`src/local_invoke.ts`).
- `pnpm run build`: Compile TypeScript for the container runtime.
- `pnpm run build:container`: Alias for `pnpm run build`.
- `pnpm run test`: Run Jest with `APP_ENVIRONMENT=localstackTest`.
- `pnpm run test:gha`: Run Jest with `APP_ENVIRONMENT=ghaTest`.
- `pnpm run local:test:e2e`: Run the integration test flow.
- `pnpm run ensure:localstack`: Verify LocalStack resources and create them if missing.
- `pnpm run pretest`: Same as `ensure:localstack`.
- `pnpm run enqueue-mock`: Enqueue mock prompts (expects `scripts/enqueue-mock-prompts.ts`, which is currently missing).

## Helper scripts
- `scripts/ensure-localstack.sh`: Check LocalStack buckets/tables. Supports `--check-only` and an environment arg (default: `RECAP_LOCALSTACK_ENV` or `local`).
- `scripts/localstack_apply.sh`: Build, create the state bucket, import resources, and run Terraform plan/apply for LocalStack or ghaTest (requires `pnpm`).
- `scripts/debug_tsc.sh`: Quick TypeScript compile check + file list probe.
- `terraform/scripts/create-state-bucket.sh <local|ghaTest|stage|prod>`: Create/verify the Terraform state bucket.
- `terraform/scripts/import_all.sh <local|ghaTest|stage|prod>`: Import existing resources into Terraform state.

## Use cases

### Local invoke during development
```bash
pnpm install
pnpm run dev
```

### Bootstrap LocalStack infra
```bash
bash scripts/localstack_apply.sh local
```

### Run tests with LocalStack
```bash
pnpm run ensure:localstack
pnpm run test
```

### Build deployable artifacts
```bash
pnpm run build
```

## Related docs
- `docs/terraform-localstack.md`
