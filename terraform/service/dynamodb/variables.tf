variable "table_name" {
  type        = string
  description = "Primary DynamoDB table name for PoliTopics records"
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to DynamoDB tables"
  default     = {}
}
