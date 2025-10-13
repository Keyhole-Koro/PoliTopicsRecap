variable "name" {
  type        = string
  description = "Name of the SQS queue"
}

variable "visibility_timeout_seconds" {
  type        = number
  description = "Visibility timeout for the queue"
  default     = 30
}

variable "receive_wait_time_seconds" {
  type        = number
  description = "Long polling wait time"
  default     = 20
}

variable "message_retention_seconds" {
  type        = number
  description = "Message retention period"
  default     = 345600
}

variable "max_message_size" {
  type        = number
  description = "Maximum message size in bytes"
  default     = 262144
}

variable "delay_seconds" {
  type        = number
  description = "Delivery delay for messages"
  default     = 0
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to the queue"
  default     = {}
}
