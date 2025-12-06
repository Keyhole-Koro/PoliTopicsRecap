locals {
  resolved_lambda_package_path       = abspath(var.lambda_package_path)
  resolved_lambda_layer_package_path = abspath(var.lambda_layer_package_path)
  base_tags                          = merge({ Application = "PoliTopicsRecap", Environment = var.environment }, var.tags)
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
  task_table_name                                   = var.task_table_name
  task_status_index_name                            = var.task_status_index_name
  create_task_table                                 = var.create_task_table
  lambda_memory_mb                                  = var.lambda_memory_mb
  lambda_timeout_seconds                            = var.lambda_timeout_seconds
  lambda_max_attempts                               = var.lambda_max_attempts
  lambda_api_timeout_ms                             = var.lambda_api_timeout_ms
  lambda_overall_timeout_ms                         = var.lambda_overall_timeout_ms
  scheduler_target_lambda_arn                       = var.scheduler_target_lambda_arn
  scheduler_use_processor_lambda_as_target          = var.scheduler_use_processor_lambda_as_target
  scheduler_use_cloudwatch_events                   = var.scheduler_use_cloudwatch_events
  scheduler_cron_expression                         = var.scheduler_cron_expression
  scheduler_start_time                              = var.scheduler_start_time
  scheduler_end_time                                = var.scheduler_end_time
  scheduler_timezone                                = var.scheduler_timezone
  scheduler_minute_step                             = var.scheduler_minute_step
  enable_scheduler                                  = var.enable_scheduler
  gemini_api_key                                    = var.gemini_api_key

}

output "politopics_recap_lambda_arn" {
  description = "ARN of the PoliTopicsRecap task processing Lambda function"
  value       = module.service.politopics_recap_lambda_arn
}
