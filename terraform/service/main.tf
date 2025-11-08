#############################################
# Global locals and modules
#############################################

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

  sqs_queue_arn = coalesce(var.sqs_queue_arn_override, local.sqs_lookup_arn)
  sqs_queue_url = coalesce(var.sqs_queue_url_override, local.sqs_lookup_url)

  # LocalStack (< 3.6) cannot deserialize Alarm Tags; suppress them for local envs to avoid noisy warnings.
  cloudwatch_alarm_tags = var.environment == "local" ? null : local.tags
}

data "aws_sqs_queue" "politopics_recap" {
  count = var.lookup_sqs_queue ? 1 : 0
  name  = var.sqs_queue_name
}

module "s3" {
  source        = "./s3"
  bucket_name   = var.prompt_bucket_name
  force_destroy = false
  tags          = local.tags
}

module "dynamodb" {
  source     = "./dynamodb"
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

#############################################
# Flexible Scheduler logic
#############################################

# Example variables (define in variables.tf if not present):
# variable "scheduler_minute_step" { type = number, default = 5 }
# variable "scheduler_timezone"    { type = string, default = "Asia/Tokyo" }
# variable "scheduler_cron_expression" { type = string, default = null }
# variable "scheduler_start_time"  { type = string, default = null }  # e.g. "06:00"
# variable "scheduler_end_time"    { type = string, default = null }  # e.g. "17:55"
# variable "scheduler_target_lambda_arn" { type = string, default = null }
# variable "scheduler_use_processor_lambda_as_target" { type = bool, default = true }

locals {
  # ---- Target Lambda ARN ----
  scheduler_has_target = (
    var.scheduler_target_lambda_arn != null && var.scheduler_target_lambda_arn != "" ?
    true :
    var.scheduler_use_processor_lambda_as_target
  )

  scheduler_target_lambda_arn = (
    var.scheduler_target_lambda_arn != null && var.scheduler_target_lambda_arn != "" ?
    var.scheduler_target_lambda_arn :
    (var.scheduler_use_processor_lambda_as_target ? module.lambda.lambda_function_arn : null)
  )

  scheduler_cron_expression_clean = (
    var.scheduler_cron_expression != null ? trimspace(var.scheduler_cron_expression) : ""
  )

  # true if a non-empty cron expression is explicitly provided
  scheduler_cron_provided = local.scheduler_cron_expression_clean != ""

  # normalize start/end strings (fall back to empty when null)
  scheduler_start_clean = (
    var.scheduler_start_time != null ? trimspace(var.scheduler_start_time) : ""
  )
  scheduler_end_clean = (
    var.scheduler_end_time != null ? trimspace(var.scheduler_end_time) : ""
  )


  scheduler_start_parts = local.scheduler_start_clean != "" ? split(":", local.scheduler_start_clean) : []
  scheduler_end_parts   = local.scheduler_end_clean != "" ? split(":", local.scheduler_end_clean) : []

  scheduler_start_hour   = (length(local.scheduler_start_parts) == 2 && can(tonumber(local.scheduler_start_parts[0])) ? tonumber(local.scheduler_start_parts[0]) : null)
  scheduler_start_minute = (length(local.scheduler_start_parts) == 2 && can(tonumber(local.scheduler_start_parts[1])) ? tonumber(local.scheduler_start_parts[1]) : null)
  scheduler_end_hour     = (length(local.scheduler_end_parts) == 2 && can(tonumber(local.scheduler_end_parts[0])) ? tonumber(local.scheduler_end_parts[0]) : null)
  scheduler_end_minute   = (length(local.scheduler_end_parts) == 2 && can(tonumber(local.scheduler_end_parts[1])) ? tonumber(local.scheduler_end_parts[1]) : null)

  minute_step = var.scheduler_minute_step

  # ---- Validation ----
  have_window = (
    !local.scheduler_cron_provided &&
    local.scheduler_start_hour != null &&
    local.scheduler_end_hour != null &&
    local.scheduler_start_minute != null &&
    local.scheduler_end_minute != null &&
    local.minute_step >= 1 && local.minute_step <= 59
  )

  # Determine if window crosses midnight
  crosses_midnight = local.have_window && (
    local.scheduler_end_hour < local.scheduler_start_hour ||
    (local.scheduler_end_hour == local.scheduler_start_hour && local.scheduler_end_minute < local.scheduler_start_minute)
  )

  # ---- Minute lists for edge hours ----
  start_hour_minutes_csv = (
    local.have_window ?
    join(",", [
      for m in range(0, 60) :
      m if(
        m >= local.scheduler_start_minute &&
        (m - local.scheduler_start_minute) % local.minute_step == 0
      )
    ]) : ""
  )

  end_hour_minutes_csv = (
    local.have_window ?
    join(",", [
      for m in range(0, 60) :
      m if(
        m <= local.scheduler_end_minute &&
        ((m - local.scheduler_start_minute) % local.minute_step + local.minute_step) % local.minute_step == 0
      )
    ]) : ""
  )

  same_hour_minutes_csv = (
    local.have_window && local.scheduler_start_hour == local.scheduler_end_hour ?
    join(",", [
      for m in range(0, 60) :
      m if(
        m >= local.scheduler_start_minute &&
        m <= local.scheduler_end_minute &&
        (m - local.scheduler_start_minute) % local.minute_step == 0
      )
    ]) : ""
  )

  # ---- Interior hours ----
  interior_hours_non_wrap = (
    !local.crosses_midnight && (local.scheduler_end_hour - local.scheduler_start_hour >= 2) ?
    format("%d-%d", local.scheduler_start_hour + 1, local.scheduler_end_hour - 1) :
    ""
  )

  interior_hours_wrap_a = (
    local.crosses_midnight && (23 - local.scheduler_start_hour >= 1) ?
    format("%d-%d", local.scheduler_start_hour + 1, 23) : ""
  )

  interior_hours_wrap_b = (
    local.crosses_midnight && (local.scheduler_end_hour - 0 >= 1) ?
    format("%d-%d", 0, local.scheduler_end_hour - 1) : ""
  )

  # ---- Build map of cron expressions ----
  scheduler_expressions = (
    local.scheduler_cron_provided ? {
      direct = local.scheduler_cron_expression_clean
    } :
    local.have_window ? merge(
      (
        local.scheduler_start_hour == local.scheduler_end_hour ? {
          same_hour = format("cron(%s %d ? * * *)", local.same_hour_minutes_csv, local.scheduler_start_hour)
        } : {}
      ),
      (
        local.scheduler_start_hour != local.scheduler_end_hour && local.start_hour_minutes_csv != "" ? {
          start_hour = format("cron(%s %d ? * * *)", local.start_hour_minutes_csv, local.scheduler_start_hour)
        } : {}
      ),
      (
        local.interior_hours_non_wrap != "" ? {
          interior = format("cron(0/%d %s ? * * *)", local.minute_step, local.interior_hours_non_wrap)
        } : {}
      ),
      (
        local.interior_hours_wrap_a != "" ? {
          interior_a = format("cron(0/%d %s ? * * *)", local.minute_step, local.interior_hours_wrap_a)
        } : {}
      ),
      (
        local.interior_hours_wrap_b != "" ? {
          interior_b = format("cron(0/%d %s ? * * *)", local.minute_step, local.interior_hours_wrap_b)
        } : {}
      ),
      (
        local.scheduler_start_hour != local.scheduler_end_hour && local.end_hour_minutes_csv != "" ? {
          end_hour = format("cron(%s %d ? * * *)", local.end_hour_minutes_csv, local.scheduler_end_hour)
        } : {}
      )
    ) : {}
  )

  scheduler_is_enabled         = var.enable_scheduler && local.scheduler_has_target && length(local.scheduler_expressions) > 0
  scheduler_schedule_base_name = "${var.lambda_name}-schedule"
}

# ---- IAM Role for Scheduler ----
resource "aws_iam_role" "scheduler" {
  count = (!var.scheduler_use_cloudwatch_events && var.enable_scheduler && length(local.scheduler_expressions) > 0) ? 1 : 0

  name = "${var.lambda_name}-scheduler-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "scheduler_invoke_lambda" {
  count = (!var.scheduler_use_cloudwatch_events && local.scheduler_is_enabled) ? 1 : 0

  name = "${var.lambda_name}-scheduler-invoke"
  role = aws_iam_role.scheduler[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = local.scheduler_target_lambda_arn
    }]
  })
}

# ---- One AWS Scheduler per cron expression ----
resource "aws_scheduler_schedule" "processor" {
  for_each = (!var.scheduler_use_cloudwatch_events && local.scheduler_is_enabled) ? local.scheduler_expressions : {}

  name        = "${local.scheduler_schedule_base_name}-${each.key}"
  description = "Invokes ${var.lambda_name} (${each.key})"

  schedule_expression          = each.value
  schedule_expression_timezone = var.scheduler_timezone
  state                        = "ENABLED"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = local.scheduler_target_lambda_arn
    role_arn = aws_iam_role.scheduler[0].arn
    input = jsonencode({
      source = "eventbridge-scheduler"
      lambda = var.lambda_name
    })
  }
}

resource "aws_lambda_permission" "allow_scheduler_invoke" {
  for_each = (!var.scheduler_use_cloudwatch_events && local.scheduler_is_enabled) ? aws_scheduler_schedule.processor : {}

  statement_id  = "AllowExecutionFromScheduler-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda.lambda_function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = aws_scheduler_schedule.processor[each.key].arn
}

# ---- CloudWatch EventBridge rule fallback (LocalStack) ----
resource "aws_cloudwatch_event_rule" "scheduler" {
  for_each = (var.scheduler_use_cloudwatch_events && local.scheduler_is_enabled) ? local.scheduler_expressions : {}

  name                = "${local.scheduler_schedule_base_name}-${each.key}"
  description         = "Invokes ${var.lambda_name} (${each.key}) via CloudWatch schedule"
  schedule_expression = each.value
}

resource "aws_cloudwatch_event_target" "scheduler" {
  for_each = aws_cloudwatch_event_rule.scheduler

  rule      = aws_cloudwatch_event_rule.scheduler[each.key].name
  target_id = "lambda-${each.key}"
  arn       = local.scheduler_target_lambda_arn
  input = jsonencode({
    source = "cloudwatch-events-scheduler"
    lambda = var.lambda_name
  })
}

resource "aws_lambda_permission" "allow_cloudwatch_schedule" {
  for_each = aws_cloudwatch_event_rule.scheduler

  statement_id  = "AllowEventBridgeSchedule-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda.lambda_function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.scheduler[each.key].arn
}

#############################################
# CloudWatch Alarm for SQS backlog
#############################################

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
      dimensions  = { QueueName = var.sqs_queue_name }
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
      dimensions  = { QueueName = var.sqs_queue_name }
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
  tags                      = local.cloudwatch_alarm_tags
}

#############################################
# EventBridge trigger when SQS backlog alarm fires
#############################################

resource "aws_cloudwatch_event_rule" "sqs_alarm_state_change" {
  count = var.enable_sqs_alarm_eventbridge ? 1 : 0

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
  count = var.enable_sqs_alarm_eventbridge ? 1 : 0

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
  count = (var.enable_sqs_alarm_eventbridge && var.scheduler_use_processor_lambda_as_target) ? 1 : 0

  statement_id  = "AllowExecutionFromEventBridgeSqsAlarm"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda.lambda_function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sqs_alarm_state_change[0].arn
}
