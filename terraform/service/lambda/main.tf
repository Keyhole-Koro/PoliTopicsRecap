locals {
  lambda_package_hash       = try(filebase64sha256(var.lambda_package_path), "")
  lambda_layer_package_hash = try(filebase64sha256(var.lambda_layer_package_path), "")
  lambda_role_name          = "${var.lambda_name}-role"
  log_group_name            = "/aws/lambda/${var.lambda_name}"
  prompt_bucket_arn         = "arn:aws:s3:::${var.prompt_bucket_name}"
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

resource "aws_iam_role" "this" {
  name               = local.lambda_role_name
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = var.tags
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
      aws_cloudwatch_log_group.this.arn,
      "${aws_cloudwatch_log_group.this.arn}:*"
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
    resources = [var.sqs_queue_arn]
  }

  statement {
    sid    = "AllowPromptBucketAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject"
    ]
    resources = ["${local.prompt_bucket_arn}/*"]
  }

  statement {
    sid    = "AllowPromptBucketList"
    effect = "Allow"
    actions = [
      "s3:ListBucket"
    ]
    resources = [local.prompt_bucket_arn]
  }
}

resource "aws_iam_role_policy" "this" {
  name   = "${var.lambda_name}-inline"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.lambda_execution.json
}

resource "aws_cloudwatch_log_group" "this" {
  name              = local.log_group_name
  retention_in_days = 14
  tags              = var.tags
}

resource "aws_lambda_layer_version" "dependencies" {
  layer_name          = "${var.lambda_name}-deps"
  description         = "Runtime dependencies for ${var.lambda_name}"
  filename            = var.lambda_layer_package_path
  source_code_hash    = local.lambda_layer_package_hash
  compatible_runtimes = ["nodejs20.x"]
}

resource "aws_lambda_function" "this" {
  function_name = var.lambda_name
  description   = "Processes PoliTopicsRecap messages from SQS"
  role          = aws_iam_role.this.arn
  filename      = var.lambda_package_path

  source_code_hash = local.lambda_package_hash
  handler          = "lambda_handler.handler"
  runtime          = "nodejs20.x"
  timeout          = var.lambda_timeout_seconds
  memory_size      = var.lambda_memory_mb

  reserved_concurrent_executions = var.lambda_reserved_concurrency
  layers                         = [aws_lambda_layer_version.dependencies.arn]

  environment {
    variables = {
      PROMPT_QUEUE_URL                           = var.sqs_queue_url
      PROMPT_QUEUE_ARN                           = var.sqs_queue_arn
      PROMPT_BUCKET_NAME                         = var.prompt_bucket_name
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
      GEMINI_API_KEY                             = var.gemini_api_key
      NODE_PATH                                  = "/opt/nodejs/node_modules"
    }
  }

  tags = var.tags
}

resource "aws_lambda_event_source_mapping" "this" {
  event_source_arn                   = var.sqs_queue_arn
  function_name                      = aws_lambda_function.this.arn
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
