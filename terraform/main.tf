module "service" {
  source = "./service"

  environment               = var.environment
  tags                      = var.tags
  aws_region                = var.aws_region
  prompt_bucket_name        = var.prompt_bucket_name
  article_asset_bucket_name = var.article_asset_bucket_name
  politopics_table_name     = var.politopics_table_name
  task_table_name           = var.task_table_name
  task_status_index_name    = var.task_status_index_name
  create_task_table         = var.create_task_table

  enable_fargate              = var.enable_fargate
  fargate_subnet_ids          = var.fargate_subnet_ids
  fargate_security_group_ids  = var.fargate_security_group_ids
  fargate_assign_public_ip    = var.fargate_assign_public_ip
  fargate_task_cpu            = var.fargate_task_cpu
  fargate_task_memory         = var.fargate_task_memory
  fargate_container_image_tag = var.fargate_container_image_tag
  fargate_log_retention_days  = var.fargate_log_retention_days
  enable_fargate_schedule     = var.enable_fargate_schedule
  fargate_schedule_expression = var.fargate_schedule_expression
  fargate_schedule_timezone   = var.fargate_schedule_timezone

  gemini_api_key        = var.gemini_api_key
  discord_webhook_error = var.discord_webhook_error
  discord_webhook_warn  = var.discord_webhook_warn
  discord_webhook_batch = var.discord_webhook_batch

  r2_endpoint_url      = var.r2_endpoint_url
  r2_region            = var.r2_region
  r2_access_key_id     = var.r2_access_key_id
  r2_secret_access_key = var.r2_secret_access_key
  r2_article_bucket    = var.r2_article_bucket
  r2_public_url_base   = var.r2_public_url_base

  enable_notification                 = var.enable_notification
  notification_delay_ms               = var.notification_delay_ms
  fargate_extra_environment_variables = var.fargate_extra_environment_variables
}
