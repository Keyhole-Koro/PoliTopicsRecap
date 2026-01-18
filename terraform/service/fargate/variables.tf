variable "enabled" {
  type        = bool
  description = "Whether to provision the Fargate resources"
  default     = true
}

variable "environment" {
  type        = string
  description = "Deployment environment identifier"
}

variable "aws_region" {
  type        = string
  description = "AWS region used for logs and task settings"
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to Fargate resources"
  default     = {}
}

variable "prompt_bucket_arn" {
  type        = string
  description = "ARN of the prompt bucket"
}

variable "article_asset_bucket_arn" {
  type        = string
  description = "ARN of the article asset bucket"
}

variable "task_table_arn" {
  type        = string
  description = "ARN of the task DynamoDB table"
}

variable "article_table_arn" {
  type        = string
  description = "ARN of the article DynamoDB table"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnet IDs for the Fargate task"
  default     = []
}

variable "security_group_ids" {
  type        = list(string)
  description = "Security group IDs for the Fargate task"
  default     = []
}

variable "assign_public_ip" {
  type        = bool
  description = "Assign public IP to the Fargate task"
  default     = true
}

variable "task_cpu" {
  type        = number
  description = "Fargate task CPU units"
  default     = 256
}

variable "task_memory" {
  type        = number
  description = "Fargate task memory (MiB)"
  default     = 512
}

variable "container_image_tag" {
  type        = string
  description = "Container image tag to deploy"
  default     = "latest"
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention in days"
  default     = 14
}

variable "enable_schedule" {
  type        = bool
  description = "Whether to create the EventBridge Scheduler trigger"
  default     = true
}

variable "schedule_expression" {
  type        = string
  description = "Scheduler cron expression"
  default     = "cron(0 9 * * ? *)"
}

variable "schedule_timezone" {
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

variable "extra_environment_variables" {
  type        = map(string)
  description = "Additional environment variables for the task"
  default     = {}
}
