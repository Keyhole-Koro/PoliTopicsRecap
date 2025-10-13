output "lambda_function_arn" {
  description = "Lambda function ARN"
  value       = aws_lambda_function.this.arn
}

output "lambda_function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.this.function_name
}

output "event_source_mapping_uuid" {
  description = "UUID for the SQS event source mapping"
  value       = aws_lambda_event_source_mapping.this.uuid
}

output "lambda_role_arn" {
  description = "IAM role ARN assumed by the Lambda function"
  value       = aws_iam_role.this.arn
}
