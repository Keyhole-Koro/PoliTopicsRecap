variable "environment" {
  type        = string
  description = "Deployment environment identifier"
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

variable "politopics_table_name" {
  type        = string
  description = "Primary DynamoDB table name for PoliTopics records"
}

variable "sqs_queue_name" {
  type        = string
  description = "Name of the SQS queue to subscribe"
}

variable "sqs_queue_arn_override" {
  type        = string
  description = "Optional override for the SQS queue ARN"
  default     = null
}

variable "sqs_queue_url_override" {
  type        = string
  description = "Optional override for the SQS queue URL"
  default     = null
}

variable "lookup_sqs_queue" {
  type        = bool
  description = "Whether to resolve the SQS queue via aws_sqs_queue data source"
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

variable "sqs_batch_size" {
  type        = number
  description = "SQS batch size for Lambda trigger"
}

variable "lambda_maximum_batching_window_seconds" {
  type        = number
  description = "Maximum batching window in seconds"
}

variable "lambda_maximum_concurrency" {
  type        = number
  description = "Maximum concurrency for event source mapping"
  default     = null
}

variable "lambda_reserved_concurrency" {
  type        = number
  description = "Reserved concurrency for Lambda"
  default     = null
}

variable "lambda_rate_limit_rps" {
  type        = number
  description = "Rate limiter tokens per second"
}

variable "lambda_rate_limit_burst" {
  type        = number
  description = "Rate limiter burst capacity"
}

variable "lambda_backoff_base_seconds" {
  type        = number
  description = "Backoff base seconds"
}

variable "lambda_backoff_cap_seconds" {
  type        = number
  description = "Backoff cap seconds"
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

variable "lambda_circuit_breaker_failure_threshold" {
  type        = number
  description = "Circuit breaker failure threshold"
}

variable "lambda_circuit_breaker_minimum_requests" {
  type        = number
  description = "Circuit breaker minimum requests"
}

variable "lambda_circuit_breaker_cooldown_seconds" {
  type        = number
  description = "Circuit breaker cooldown in seconds"
}

variable "lambda_circuit_breaker_visibility_timeout_seconds" {
  type        = number
  description = "Visibility timeout when breaker trips"
}

variable "lambda_circuit_breaker_half_open_max_calls" {
  type        = number
  description = "Half-open breaker max calls"
}

variable "enable_sqs_alarm_eventbridge" {
  type        = bool
  description = "Whether to connect the SQS backlog alarm to EventBridge"
  default     = false
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
