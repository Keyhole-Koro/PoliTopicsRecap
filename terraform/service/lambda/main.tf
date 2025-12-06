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
      "dynamodb:BatchWriteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem"
    ]
    resources = [
      var.task_table_arn,
      "${var.task_table_arn}/index/*",
      var.article_table_arn
    ]
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
  description   = "Processes PoliTopicsRecap tasks from DynamoDB"
  role          = aws_iam_role.this.arn
  filename      = var.lambda_package_path

  source_code_hash = local.lambda_package_hash
  handler          = "lambda_handler.handler"
  runtime          = "nodejs20.x"
  timeout          = var.lambda_timeout_seconds
  memory_size      = var.lambda_memory_mb

  layers = [aws_lambda_layer_version.dependencies.arn]

  environment {
    variables = {
      LLM_TASK_TABLE         = var.task_table_name
      LLM_TASK_STATUS_INDEX  = var.task_status_index_name
      ARTICLE_TABLE_NAME     = var.article_table_name
      PROMPT_BUCKET_NAME     = var.prompt_bucket_name
      GEMINI_API_KEY         = var.gemini_api_key
      NODE_PATH              = "/opt/nodejs/node_modules"
    }
  }

  tags = var.tags
}
