variable "lambda_name" {
  type        = string
  description = "Lambda function name"
}

variable "lambda_package_path" {
  type        = string
  description = "Absolute path to the Lambda deployment package"
}

variable "lambda_layer_package_path" {
  type        = string
  description = "Absolute path to the Lambda layer package providing dependencies"
}

variable "lambda_memory_mb" {
  type        = number
  description = "Lambda memory size"
}

variable "lambda_timeout_seconds" {
  type        = number
  description = "Lambda timeout in seconds"
}

variable "lambda_reserved_concurrency" {
  type        = number
  description = "Reserved concurrency for Lambda"
  default     = null
}

variable "sqs_batch_size" {
  type        = number
  description = "Maximum number of SQS messages per invocation"
}

variable "lambda_maximum_batching_window_seconds" {
  type        = number
  description = "Maximum batching window in seconds"
}

variable "lambda_maximum_concurrency" {
  type        = number
  description = "Maximum concurrency for the event source mapping"
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
  description = "Circuit breaker cooldown seconds"
}

variable "lambda_circuit_breaker_visibility_timeout_seconds" {
  type        = number
  description = "Visibility timeout when breaker trips"
}

variable "lambda_circuit_breaker_half_open_max_calls" {
  type        = number
  description = "Half-open breaker max calls"
}

variable "sqs_queue_arn" {
  type        = string
  description = "ARN of the source SQS queue"
}

variable "sqs_queue_url" {
  type        = string
  description = "URL of the source SQS queue"
}

variable "prompt_bucket_name" {
  type        = string
  description = "Prompt storage bucket name"
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to Lambda resources"
  default     = {}
}

variable "gemini_api_key" {
  type      = string
  sensitive = true
}
