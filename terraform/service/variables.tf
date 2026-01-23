variable "environment" {
  type        = string
  description = "Deployment environment identifier"
}

variable "tags" {
  type        = map(string)
  description = "Additional tags applied to service resources"
  default     = {}
}

variable "prompt_bucket_name" {
  type        = string
  description = "S3 bucket name used for prompts"
}

variable "article_asset_bucket_name" {
  type        = string
  description = "S3 bucket name used for storing article payloads/assets"
}

variable "politopics_table_name" {
  type        = string
  description = "Primary DynamoDB table name for PoliTopics records"
}

variable "task_table_name" {
  type        = string
  description = "DynamoDB table that stores LLM map/reduce tasks"
}

variable "task_status_index_name" {
  type        = string
  description = "GSI name for querying pending tasks by status"
}

variable "create_task_table" {
  type        = bool
  description = "Whether to provision the LLM tasks table (set true for LocalStack)"
  default     = false
}

variable "aws_region" {
  type        = string
  description = "AWS region used for Fargate settings"
}

variable "enable_fargate" {
  type        = bool
  description = "Whether to provision Fargate resources"
  default     = true
}

variable "fargate_subnet_ids" {
  type        = list(string)
  description = "Subnet IDs for the Fargate task"
  default     = []
}

variable "fargate_security_group_ids" {
  type        = list(string)
  description = "Security group IDs for the Fargate task"
  default     = []
}

variable "fargate_assign_public_ip" {
  type        = bool
  description = "Assign public IP to the Fargate task"
  default     = true
}

variable "fargate_task_cpu" {
  type        = number
  description = "Fargate task CPU units"
  default     = 256
}

variable "fargate_task_memory" {
  type        = number
  description = "Fargate task memory (MiB)"
  default     = 512
}

variable "fargate_container_image_tag" {
  type        = string
  description = "Container image tag"
  default     = "latest"
}

variable "fargate_log_retention_days" {
  type        = number
  description = "CloudWatch log retention in days"
  default     = 14
}

variable "enable_fargate_schedule" {
  type        = bool
  description = "Enable the EventBridge Scheduler trigger"
  default     = true
}

variable "fargate_schedule_expression" {
  description = "Scheduler cron expression"
  default     = "cron(0 6 * * ? *)"
}

variable "fargate_schedule_timezone" {
  type        = string
  description = "Scheduler timezone"
  default     = "Asia/Tokyo"
}

variable "gemini_api_key" {
  type        = string
  description = "Gemini API key"
  sensitive   = true
  default     = ""
}

variable "discord_webhook_error" {
  type        = string
  description = "Discord webhook for error notifications"
  sensitive   = true
  default     = ""
}

variable "discord_webhook_warn" {
  type        = string
  description = "Discord webhook for warning notifications"
  sensitive   = true
  default     = ""
}

variable "discord_webhook_batch" {
  type        = string
  description = "Discord webhook for batch notifications"
  sensitive   = true
  default     = ""
}

variable "r2_endpoint_url" {
  type        = string
  description = "R2 endpoint URL"
  default     = ""
}

variable "r2_region" {
  type        = string
  description = "R2 region (e.g., auto)"
  default     = "auto"
}

variable "r2_access_key_id" {
  type        = string
  description = "R2 access key ID"
  sensitive   = true
  default     = ""
}

variable "r2_secret_access_key" {
  type        = string
  description = "R2 secret access key"
  sensitive   = true
  default     = ""
}

variable "r2_article_bucket" {
  type        = string
  description = "R2 bucket for article assets"
  default     = ""
}

variable "r2_public_url_base" {
  type        = string
  description = "R2 public URL base"
  default     = ""
}

variable "enable_notification" {
  type        = bool
  description = "Enable Discord notifications"
  default     = true
}

variable "notification_delay_ms" {
  type        = number
  description = "Notification delay in milliseconds"
  default     = 1000
}

variable "fargate_extra_environment_variables" {
  type        = map(string)
  description = "Additional environment variables for the Fargate task"
  default     = {}
}
