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

variable "politopics_table_name" {
  description = "Primary DynamoDB table name for PoliTopics records"
  type        = string
  default     = "politopics"
}

variable "sqs_queue_name" {
  description = "Name of the existing SQS queue to subscribe the Lambda to"
  type        = string
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

variable "sqs_batch_size" {
  description = "Maximum number of SQS messages the Lambda should process per invocation"
  type        = number
  default     = 10
}

variable "lambda_maximum_batching_window_seconds" {
  description = "Maximum batching window in seconds for SQS event source mapping"
  type        = number
  default     = 0
}

variable "lambda_maximum_concurrency" {
  description = "Maximum concurrency for the event source mapping"
  type        = number
  default     = null
}

variable "lambda_reserved_concurrency" {
  description = "Reserved concurrency for the Lambda function"
  type        = number
  default     = null
}

variable "lambda_rate_limit_rps" {
  description = "Local rate limiter tokens per second"
  type        = number
  default     = 5
}

variable "lambda_rate_limit_burst" {
  description = "Local rate limiter burst capacity"
  type        = number
  default     = 10
}

variable "lambda_backoff_base_seconds" {
  description = "Base backoff (seconds) used for exponential backoff"
  type        = number
  default     = 1
}

variable "lambda_backoff_cap_seconds" {
  description = "Maximum backoff (seconds) cap"
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

variable "lambda_circuit_breaker_failure_threshold" {
  description = "Number of consecutive failures that trip the circuit breaker"
  type        = number
  default     = 5
}

variable "lambda_circuit_breaker_minimum_requests" {
  description = "Minimum number of requests before the circuit breaker can trip"
  type        = number
  default     = 5
}

variable "lambda_circuit_breaker_cooldown_seconds" {
  description = "Cooldown period for the circuit breaker when open"
  type        = number
  default     = 60
}

variable "lambda_circuit_breaker_visibility_timeout_seconds" {
  description = "Visibility timeout to apply when the circuit breaker opens"
  type        = number
  default     = 60
}

variable "lambda_circuit_breaker_half_open_max_calls" {
  description = "Maximum number of test calls while the circuit breaker is half-open"
  type        = number
  default     = 1
}

variable "idempotency_table_name" {
  description = "DynamoDB table name used for idempotency tracking"
  type        = string
  default     = "politopics-recap-idempotency"
}

variable "idempotency_ttl_seconds" {
  description = "TTL (seconds) for completed idempotency records"
  type        = number
  default     = 86400
}

variable "idempotency_in_progress_ttl_seconds" {
  description = "TTL (seconds) for in-progress idempotency records"
  type        = number
  default     = 300
}

variable "enable_sqs_alarm_eventbridge" {
  description = "Whether to create the EventBridge rule/target reacting to the SQS backlog alarm"
  type        = bool
  default     = false
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

variable "create_prompt_queue" {
  description = "Whether to provision the prompt SQS queue (set true for LocalStack environments)"
  type        = bool
  default     = false
}
