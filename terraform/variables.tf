variable "aws_region" {
  description = "AWS region to deploy the PoliTopicsRecap resources"
  type        = string
  default     = "ap-northeast-3"
}

variable "aws_endpoint_url" {
  description = "Optional endpoint override (e.g., http://localhost:4566 for LocalStack)"
  type        = string
  default     = null
}

variable "aws_access_key" {
  description = "Optional override for AWS access key; useful when pointing at LocalStack."
  type        = string
  default     = null
}

variable "aws_secret_key" {
  description = "Optional override for AWS secret key; useful when pointing at LocalStack."
  type        = string
  default     = null
}

variable "aws_session_token" {
  description = "Optional override for AWS session token; useful when pointing at LocalStack."
  type        = string
  default     = null
}

variable "environment" {
  description = "Deployment environment identifier (e.g., dev, stage, prod)"
  type        = string
  default     = "dev"
}

variable "tags" {
  description = "Additional resource tags to apply"
  type        = map(string)
  default     = {}
}

variable "prompt_bucket_name" {
  description = "S3 bucket name used for prompt storage"
  type        = string
  default     = "politopics-llm-artifacts-local"
}

variable "article_asset_bucket_name" {
  description = "S3 bucket name used for storing article payloads/assets"
  type        = string
  default     = "politopics-articles"
}

variable "politopics_table_name" {
  description = "Primary DynamoDB table name for PoliTopics records"
  type        = string
  default     = "PoliTopics"
}

variable "task_table_name" {
  description = "DynamoDB table that stores LLM map/reduce tasks"
  type        = string
  default     = "PoliTopics-llm-tasks"
}

variable "task_status_index_name" {
  description = "Name of the GSI that uses status as the partition key"
  type        = string
  default     = "StatusIndex"
}

variable "create_task_table" {
  description = "Whether to provision the LLM task table (enable for LocalStack)"
  type        = bool
  default     = false
}

variable "enable_fargate" {
  description = "Whether to provision Fargate resources"
  type        = bool
  default     = true
}

variable "fargate_subnet_ids" {
  description = "Subnet IDs for the Fargate task"
  type        = list(string)
  default     = []
}

variable "fargate_security_group_ids" {
  description = "Security group IDs for the Fargate task"
  type        = list(string)
  default     = []
}

variable "fargate_task_cpu" {
  description = "Fargate task CPU units"
  type        = number
  default     = 256
}

variable "fargate_task_memory" {
  description = "Fargate task memory (MiB)"
  type        = number
  default     = 512
}

variable "fargate_container_image_tag" {
  description = "Container image tag"
  type        = string
  default     = "latest"
}

variable "fargate_log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 14
}

variable "enable_fargate_schedule" {
  description = "Enable the EventBridge Scheduler trigger"
  type        = bool
  default     = true
}

variable "fargate_schedule_expression" {
  description = "Scheduler cron expression"
  type        = string
  default     = "cron(0 6 * * ? *)"
}

variable "fargate_schedule_timezone" {
  description = "Scheduler timezone"
  type        = string
  default     = "Asia/Tokyo"
}

variable "gemini_api_key" {
  description = "Gemini API key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "discord_webhook_error" {
  description = "Discord webhook for error notifications"
  type        = string
  sensitive   = true
  default     = ""
}

variable "discord_webhook_warn" {
  description = "Discord webhook for warning notifications"
  type        = string
  sensitive   = true
  default     = ""
}

variable "discord_webhook_batch" {
  description = "Discord webhook for batch notifications"
  type        = string
  sensitive   = true
  default     = ""
}

variable "r2_endpoint_url" {
  description = "R2 endpoint URL"
  type        = string
  default     = ""
}

variable "r2_region" {
  description = "R2 region (e.g., auto)"
  type        = string
  default     = "auto"
}

variable "r2_access_key_id" {
  description = "R2 access key ID"
  type        = string
  sensitive   = true
  default     = ""
}

variable "r2_secret_access_key" {
  description = "R2 secret access key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "r2_article_bucket" {
  description = "R2 bucket for article assets"
  type        = string
  default     = ""
}

variable "r2_public_url_base" {
  description = "R2 public URL base"
  type        = string
  default     = ""
}

variable "enable_notification" {
  description = "Enable Discord notifications"
  type        = bool
  default     = true
}

variable "notification_delay_ms" {
  description = "Notification delay in milliseconds"
  type        = number
  default     = 1000
}

variable "fargate_extra_environment_variables" {
  description = "Additional environment variables for the Fargate task"
  type        = map(string)
  default     = {}
}
