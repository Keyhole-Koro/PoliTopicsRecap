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
}

resource "aws_dynamodb_table" "llm_tasks" {
  name         = var.task_table_name
  billing_mode = "PAY_PER_REQUEST"

  hash_key = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = var.task_status_index_name
    hash_key        = "status"
    range_key       = "createdAt"
    projection_type = "ALL"
  }
}

module "s3" {
  source        = "./s3"
  bucket_name   = var.prompt_bucket_name
  force_destroy = false
  tags          = local.tags
}

module "article_asset_bucket" {
  source        = "./s3"
  bucket_name   = var.article_asset_bucket_name
  force_destroy = false
  tags          = local.tags
}

module "dynamodb" {
  source     = "./dynamodb"
  table_name = var.politopics_table_name
  tags       = local.tags
}

module "fargate" {
  source = "./fargate"

  enabled                  = var.enable_fargate
  environment              = var.environment
  aws_region               = var.aws_region
  tags                     = local.tags
  prompt_bucket_arn        = module.s3.bucket_arn
  article_asset_bucket_arn = module.article_asset_bucket.bucket_arn
  task_table_arn           = aws_dynamodb_table.llm_tasks.arn
  article_table_arn        = module.dynamodb.politopics_table_arn

  subnet_ids         = var.fargate_subnet_ids
  security_group_ids = var.fargate_security_group_ids
  assign_public_ip   = var.fargate_assign_public_ip

  task_cpu            = var.fargate_task_cpu
  task_memory         = var.fargate_task_memory
  container_image_tag = var.fargate_container_image_tag
  log_retention_days  = var.fargate_log_retention_days
  enable_schedule     = var.enable_fargate_schedule
  schedule_expression = var.fargate_schedule_expression
  schedule_timezone   = var.fargate_schedule_timezone

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

  enable_notification         = var.enable_notification
  notification_delay_ms       = var.notification_delay_ms
  extra_environment_variables = var.fargate_extra_environment_variables
}
