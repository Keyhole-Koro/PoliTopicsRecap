locals {
  tags = merge(
    {
      Application = "PoliTopicsRecap"
      Environment = var.environment
    },
    var.tags
  )

  sqs_lookup_arn = var.lookup_sqs_queue ? data.aws_sqs_queue.politopics_recap[0].arn : null
  sqs_lookup_url = var.lookup_sqs_queue ? data.aws_sqs_queue.politopics_recap[0].url : null

  sqs_queue_arn = coalesce(
    var.sqs_queue_arn_override,
    local.sqs_lookup_arn,
  )
  sqs_queue_url = coalesce(
    var.sqs_queue_url_override,
    local.sqs_lookup_url,
  )
}

data "aws_sqs_queue" "politopics_recap" {
  count = var.lookup_sqs_queue ? 1 : 0
  name  = var.sqs_queue_name
}

module "s3" {
  source = "./s3"

  bucket_name   = var.prompt_bucket_name
  force_destroy = false
  tags          = local.tags
}

module "dynamodb" {
  source = "./dynamodb"

  table_name = var.politopics_table_name
  tags       = local.tags
}

module "lambda" {
  source = "./lambda"

  lambda_name                                       = var.lambda_name
  lambda_package_path                               = var.lambda_package_path
  lambda_layer_package_path                         = var.lambda_layer_package_path
  lambda_memory_mb                                  = var.lambda_memory_mb
  lambda_timeout_seconds                            = var.lambda_timeout_seconds
  lambda_reserved_concurrency                       = var.lambda_reserved_concurrency
  sqs_batch_size                                    = var.sqs_batch_size
  lambda_maximum_batching_window_seconds            = var.lambda_maximum_batching_window_seconds
  lambda_maximum_concurrency                        = var.lambda_maximum_concurrency
  lambda_rate_limit_rps                             = var.lambda_rate_limit_rps
  lambda_rate_limit_burst                           = var.lambda_rate_limit_burst
  lambda_backoff_base_seconds                       = var.lambda_backoff_base_seconds
  lambda_backoff_cap_seconds                        = var.lambda_backoff_cap_seconds
  lambda_max_attempts                               = var.lambda_max_attempts
  lambda_api_timeout_ms                             = var.lambda_api_timeout_ms
  lambda_overall_timeout_ms                         = var.lambda_overall_timeout_ms
  lambda_circuit_breaker_failure_threshold          = var.lambda_circuit_breaker_failure_threshold
  lambda_circuit_breaker_minimum_requests           = var.lambda_circuit_breaker_minimum_requests
  lambda_circuit_breaker_cooldown_seconds           = var.lambda_circuit_breaker_cooldown_seconds
  lambda_circuit_breaker_visibility_timeout_seconds = var.lambda_circuit_breaker_visibility_timeout_seconds
  lambda_circuit_breaker_half_open_max_calls        = var.lambda_circuit_breaker_half_open_max_calls
  sqs_queue_arn                                     = local.sqs_queue_arn
  sqs_queue_url                                     = local.sqs_queue_url
  prompt_bucket_name                                = module.s3.bucket_name
  tags                                              = local.tags
  gemini_api_key                                    = var.gemini_api_key
}

locals {
  scheduler_target_lambda_arn = (
    var.scheduler_target_lambda_arn != null && var.scheduler_target_lambda_arn != "" ?
    var.scheduler_target_lambda_arn :
    (var.scheduler_use_processor_lambda_as_target ? module.lambda.lambda_function_arn : null)
  )
}

resource "aws_cloudwatch_metric_alarm" "sqs_backlog" {
  alarm_name          = "${var.lambda_name}-${var.environment}-sqs-backlog"
  alarm_description   = "Triggers when the ${var.sqs_queue_name} queue accumulates visible or in-flight messages."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  threshold           = 1
  treat_missing_data  = "notBreaching"
  actions_enabled     = true

  metric_query {
    id          = "m1"
    return_data = false
    metric {
      metric_name = "ApproximateNumberOfMessagesVisible"
      namespace   = "AWS/SQS"
      stat        = "Maximum"
      period      = 60
      dimensions = {
        QueueName = var.sqs_queue_name
      }
    }
  }

  metric_query {
    id          = "m2"
    return_data = false
    metric {
      metric_name = "ApproximateNumberOfMessagesNotVisible"
      namespace   = "AWS/SQS"
      stat        = "Maximum"
      period      = 60
      dimensions = {
        QueueName = var.sqs_queue_name
      }
    }
  }

  metric_query {
    id          = "m3"
    expression  = "m1 + m2"
    label       = "TotalMessages"
    return_data = true
  }

  alarm_actions             = []
  ok_actions                = []
  insufficient_data_actions = []

  tags = local.tags
}

resource "aws_cloudwatch_event_rule" "sqs_alarm_state_change" {
  count = var.enable_sqs_alarm_eventbridge && local.scheduler_target_lambda_arn != null ? 1 : 0

  name        = "${var.lambda_name}-${var.environment}-sqs-alarm-state"
  description = "Fires when the SQS backlog alarm transitions into ALARM"

  event_pattern = jsonencode({
    source        = ["aws.cloudwatch"],
    "detail-type" = ["CloudWatch Alarm State Change"],
    detail = {
      state         = { value = ["ALARM"] },
      previousState = { value = ["OK", "INSUFFICIENT_DATA"] },
      alarmName     = [aws_cloudwatch_metric_alarm.sqs_backlog.alarm_name]
    }
  })
}

resource "aws_cloudwatch_event_target" "sqs_alarm_target" {
  count = var.enable_sqs_alarm_eventbridge && local.scheduler_target_lambda_arn != null ? 1 : 0

  rule      = aws_cloudwatch_event_rule.sqs_alarm_state_change[0].name
  target_id = "sqs-backlog-trigger"
  arn       = local.scheduler_target_lambda_arn
  input = jsonencode({
    alarmName   = aws_cloudwatch_metric_alarm.sqs_backlog.alarm_name,
    queueUrl    = local.sqs_queue_url,
    environment = var.environment
  })
}

resource "aws_lambda_permission" "allow_eventbridge_alarm" {
  count = var.enable_sqs_alarm_eventbridge && var.scheduler_use_processor_lambda_as_target && local.scheduler_target_lambda_arn != null ? 1 : 0

  statement_id  = "AllowExecutionFromEventBridgeSqsAlarm"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda.lambda_function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sqs_alarm_state_change[0].arn
}
