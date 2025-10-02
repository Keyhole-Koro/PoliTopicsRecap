locals {
  lambda_package_hash = try(filebase64sha256(var.lambda_package_path), "")
  lambda_role_name    = "${var.lambda_name}-role"
  log_group_name      = "/aws/lambda/${var.lambda_name}"
}

data "aws_sqs_queue" "politopics_recap" {
  name = var.sqs_queue_name
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_dynamodb_table" "politopics_recap_idempotency" {
  name         = var.idempotency_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "idempotencyKey"

  attribute {
    name = "idempotencyKey"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

resource "aws_iam_role" "politopics_recap" {
  name               = local.lambda_role_name
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda_execution" {
  statement {
    sid    = "AllowWritingLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = [
      aws_cloudwatch_log_group.politopics_recap.arn,
      "${aws_cloudwatch_log_group.politopics_recap.arn}:*"
    ]
  }

  statement {
    sid    = "AllowQueueProcessing"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueUrl"
    ]
    resources = [data.aws_sqs_queue.politopics_recap.arn]
  }

  statement {
    sid    = "AllowIdempotencyPersistence"
    effect = "Allow"
    actions = [
      "dynamodb:DeleteItem",
      "dynamodb:DescribeTable",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem"
    ]
    resources = [aws_dynamodb_table.politopics_recap_idempotency.arn]
  }
}

resource "aws_iam_role_policy" "politopics_recap" {
  name   = "${var.lambda_name}-inline"
  role   = aws_iam_role.politopics_recap.id
  policy = data.aws_iam_policy_document.lambda_execution.json
}

resource "aws_cloudwatch_log_group" "politopics_recap" {
  name              = local.log_group_name
  retention_in_days = 14
}

resource "aws_lambda_function" "politopics_recap" {
  function_name = var.lambda_name
  description   = "Processes PoliTopicsRecap messages from SQS"
  role          = aws_iam_role.politopics_recap.arn
  filename      = var.lambda_package_path

  source_code_hash = local.lambda_package_hash
  handler          = "lambda_handler.handler"
  runtime          = "nodejs20.x"
  timeout          = var.lambda_timeout_seconds
  memory_size      = var.lambda_memory_mb

  reserved_concurrent_executions = var.lambda_reserved_concurrency

  environment {
    variables = {
      PROMPT_QUEUE_URL                           = data.aws_sqs_queue.politopics_recap.url
      IDEMPOTENCY_TABLE_NAME                     = aws_dynamodb_table.politopics_recap_idempotency.name
      IDEMPOTENCY_TTL_SECONDS                    = tostring(var.idempotency_ttl_seconds)
      IDEMPOTENCY_IN_PROGRESS_TTL_SECONDS        = tostring(var.idempotency_in_progress_ttl_seconds)
      RATE_LIMIT_RPS                             = tostring(var.lambda_rate_limit_rps)
      RATE_LIMIT_BURST                           = tostring(var.lambda_rate_limit_burst)
      BACKOFF_BASE_SECONDS                       = tostring(var.lambda_backoff_base_seconds)
      BACKOFF_CAP_SECONDS                        = tostring(var.lambda_backoff_cap_seconds)
      MAX_ATTEMPTS                               = tostring(var.lambda_max_attempts)
      API_TIMEOUT_MS                             = tostring(var.lambda_api_timeout_ms)
      OVERALL_TIMEOUT_MS                         = tostring(var.lambda_overall_timeout_ms)
      CIRCUIT_BREAKER_FAILURE_THRESHOLD          = tostring(var.lambda_circuit_breaker_failure_threshold)
      CIRCUIT_BREAKER_MIN_REQUESTS               = tostring(var.lambda_circuit_breaker_minimum_requests)
      CIRCUIT_BREAKER_COOLDOWN_SECONDS           = tostring(var.lambda_circuit_breaker_cooldown_seconds)
      CIRCUIT_BREAKER_VISIBILITY_TIMEOUT_SECONDS = tostring(var.lambda_circuit_breaker_visibility_timeout_seconds)
      CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS        = tostring(var.lambda_circuit_breaker_half_open_max_calls)
    }
  }
}

resource "aws_lambda_event_source_mapping" "politopics_recap" {
  event_source_arn                   = data.aws_sqs_queue.politopics_recap.arn
  function_name                      = aws_lambda_function.politopics_recap.arn
  batch_size                         = var.sqs_batch_size
  enabled                            = true
  maximum_batching_window_in_seconds = var.lambda_maximum_batching_window_seconds

  dynamic "scaling_config" {
    for_each = var.lambda_maximum_concurrency == null ? [] : [var.lambda_maximum_concurrency]
    content {
      maximum_concurrency = scaling_config.value
    }
  }
}

output "politopics_recap_lambda_arn" {
  description = "ARN of the PoliTopicsRecap SQS processing Lambda function"
  value       = aws_lambda_function.politopics_recap.arn
}

output "politopics_recap_event_source_mapping_uuid" {
  description = "UUID of the SQS -> Lambda event source mapping"
  value       = aws_lambda_event_source_mapping.politopics_recap.uuid
}