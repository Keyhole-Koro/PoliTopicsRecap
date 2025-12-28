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

variable "lambda_name" {
  description = "Unique name for the PoliTopicsRecap SQS-driven Lambda function"
  type        = string
  default     = "politopics-recap-sqs-processor"
}

variable "environment" {
  description = "Deployment environment identifier (e.g., dev, stage, prod)"
  type        = string
  default     = "dev"
}

variable "app_environment" {
  description = "Application environment identifier (local, stage, prod)"
  type        = string
  default     = "local"
}

variable "tags" {
  description = "Additional resource tags to apply"
  type        = map(string)
  default     = {}
}

variable "lambda_package_path" {
  description = "Relative path to the packaged Lambda artifact (ZIP file)"
  type        = string
  default     = "../dist/lambda_handler.zip"
}

variable "lambda_layer_package_path" {
  description = "Relative path to the packaged Lambda layer artifact (ZIP file)"
  type        = string
  default     = "../dist/lambda_layer.zip"
}

variable "prompt_bucket_name" {
  description = "S3 bucket name used for prompt storage"
  type        = string
  default     = "politopics-prompts"
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

variable "lambda_memory_mb" {
  description = "Memory size for the Lambda function"
  type        = number
  default     = 256
}

variable "lambda_timeout_seconds" {
  description = "Timeout (in seconds) for the Lambda function"
  type        = number
  default     = 60
}

variable "lambda_max_attempts" {
  description = "Maximum retry attempts performed by the Lambda before failing"
  type        = number
  default     = 5
}

variable "lambda_api_timeout_ms" {
  description = "Per-attempt API timeout in milliseconds"
  type        = number
  default     = 10000
}

variable "lambda_overall_timeout_ms" {
  description = "Overall per-message processing timeout in milliseconds"
  type        = number
  default     = 45000
}

variable "scheduler_target_lambda_arn" {
  description = "Optional ARN of an external starter Lambda invoked by the SQS backlog alarm"
  type        = string
  default     = null
}

variable "scheduler_use_processor_lambda_as_target" {
  description = "If true and no external target ARN is provided, connect the backlog alarm rule to the processor Lambda"
  type        = bool
  default     = false
}

variable "scheduler_use_cloudwatch_events" {
  description = "Fallback to CloudWatch EventBridge rules instead of AWS Scheduler (useful for LocalStack where Scheduler is unavailable)"
  type        = bool
  default     = false
}

variable "scheduler_cron_expression" {
  description = "Cron expression used by the EventBridge Scheduler to invoke the processor"
  type        = string
  default     = null
}

variable "scheduler_start_time" {
  description = "Daily start time (HH:MM, 24h) that bounds the scheduler window when cron expression is not provided"
  type        = string
  default     = null
}

variable "scheduler_end_time" {
  description = "Daily end time (HH:MM, 24h) that bounds the scheduler window when cron expression is not provided"
  type        = string
  default     = null
}

variable "scheduler_timezone" {
  description = "IANA timezone identifier applied to the scheduler cron expression"
  type        = string
  default     = "UTC"
}

variable "scheduler_minute_step" {
  description = "Minute step interval for the scheduler when cron expression is not provided"
  type        = number
  default     = 15
}

variable "enable_scheduler" {
  description = "Enable EventBridge Scheduler resources that invoke the processor"
  type        = bool
  default     = true
}

variable "gemini_api_key" {
  description = "API key for accessing the Gemini API"
  type        = string
  default     = ""
}
