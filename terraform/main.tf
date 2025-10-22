locals {
  resolved_lambda_package_path       = abspath(var.lambda_package_path)
  resolved_lambda_layer_package_path = abspath(var.lambda_layer_package_path)
  base_tags                          = merge({ Application = "PoliTopicsRecap", Environment = var.environment }, var.tags)
}

module "prompt_queue" {
  source = "./modules/sqs"
  count  = var.create_prompt_queue ? 1 : 0

  name                       = var.sqs_queue_name
  visibility_timeout_seconds = var.lambda_circuit_breaker_visibility_timeout_seconds
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 345600
  max_message_size           = 262144
  delay_seconds              = 0
  tags                       = local.base_tags
}

locals {
  prompt_queue_url_override = var.create_prompt_queue ? module.prompt_queue[0].queue_url : null
  prompt_queue_arn_override = var.create_prompt_queue ? module.prompt_queue[0].queue_arn : null
}

module "service" {
  source = "./service"

  environment                                       = var.environment
  tags                                              = var.tags
  lambda_name                                       = var.lambda_name
  lambda_package_path                               = local.resolved_lambda_package_path
  lambda_layer_package_path                         = local.resolved_lambda_layer_package_path
  prompt_bucket_name                                = var.prompt_bucket_name
  politopics_table_name                             = var.politopics_table_name
  sqs_queue_name                                    = var.sqs_queue_name
  lambda_memory_mb                                  = var.lambda_memory_mb
  lambda_timeout_seconds                            = var.lambda_timeout_seconds
  sqs_batch_size                                    = var.sqs_batch_size
  lambda_maximum_batching_window_seconds            = var.lambda_maximum_batching_window_seconds
  lambda_maximum_concurrency                        = var.lambda_maximum_concurrency
  lambda_reserved_concurrency                       = var.lambda_reserved_concurrency
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
  enable_sqs_alarm_eventbridge                      = var.enable_sqs_alarm_eventbridge
  scheduler_target_lambda_arn                       = var.scheduler_target_lambda_arn
  scheduler_use_processor_lambda_as_target          = var.scheduler_use_processor_lambda_as_target
  sqs_queue_url_override                            = local.prompt_queue_url_override
  sqs_queue_arn_override                            = local.prompt_queue_arn_override
  lookup_sqs_queue                                  = var.create_prompt_queue ? false : true
  gemini_api_key                                    = var.gemini_api_key

}

output "politopics_recap_lambda_arn" {
  description = "ARN of the PoliTopicsRecap SQS processing Lambda function"
  value       = module.service.politopics_recap_lambda_arn
}

output "politopics_recap_event_source_mapping_uuid" {
  description = "UUID of the SQS -> Lambda event source mapping"
  value       = module.service.politopics_recap_event_source_mapping_uuid
}
