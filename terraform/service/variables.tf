variable "environment" {
  type        = string
  description = "Deployment environment identifier"
}

variable "app_environment" {
  type        = string
  description = "Application environment identifier (local, stage, prod)"
}

variable "tags" {
  type        = map(string)
  description = "Additional tags applied to service resources"
  default     = {}
}

variable "lambda_name" {
  type        = string
  description = "Lambda function name"
}

variable "lambda_package_path" {
  type        = string
  description = "Absolute path to the Lambda artifact (ZIP file)"
}

variable "lambda_layer_package_path" {
  type        = string
  description = "Absolute path to the Lambda layer artifact (ZIP file)"
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

variable "enable_scheduler" {
  type        = bool
  description = "Whether to create EventBridge Scheduler resources that invoke the processor"
  default     = true
}

variable "lambda_memory_mb" {
  type        = number
  description = "Lambda memory size"
}

variable "lambda_timeout_seconds" {
  type        = number
  description = "Lambda timeout in seconds"
}

variable "lambda_max_attempts" {
  type        = number
  description = "Maximum retry attempts"
}

variable "lambda_api_timeout_ms" {
  type        = number
  description = "API timeout per attempt (ms)"
}

variable "lambda_overall_timeout_ms" {
  type        = number
  description = "Overall timeout per message (ms)"
}

variable "scheduler_target_lambda_arn" {
  type        = string
  description = "Optional ARN of a starter Lambda invoked by the backlog alarm"
  default     = null
}

variable "scheduler_use_processor_lambda_as_target" {
  type        = bool
  description = "Use the processor Lambda as the EventBridge target when no explicit ARN is provided"
  default     = false
}

variable "scheduler_use_cloudwatch_events" {
  type        = bool
  description = "Use CloudWatch EventBridge rules instead of AWS Scheduler (handy for LocalStack where Scheduler is unavailable)"
  default     = false
}

variable "scheduler_cron_expression" {
  type        = string
  description = "Cron expression used by the EventBridge Scheduler to invoke the processor"
  default     = null
}

variable "scheduler_start_time" {
  type        = string
  description = "Daily start time (HH:MM, 24h) that bounds the scheduler window when cron expression is not provided"
  default     = null
}

variable "scheduler_end_time" {
  type        = string
  description = "Daily end time (HH:MM, 24h) that bounds the scheduler window when cron expression is not provided"
  default     = null
}

variable "scheduler_timezone" {
  type        = string
  description = "IANA timezone identifier applied to the scheduler cron expression"
  default     = "UTC"
}

variable "scheduler_minute_step" {
  type        = number
  description = "Minute step interval for the scheduler when cron expression is not provided"
  default     = 15
}

variable "gemini_api_key" {
  description = "API key for accessing the Gemini API"
  type        = string
  default     = ""
}
