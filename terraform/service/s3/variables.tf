variable "bucket_name" {
  type        = string
  description = "S3 bucket name"
}

variable "force_destroy" {
  type        = bool
  description = "Whether to allow Terraform to delete non-empty buckets"
  default     = false
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to the bucket"
  default     = {}
}
