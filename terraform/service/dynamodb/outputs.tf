output "politopics_table_name" {
  description = "Primary PoliTopics DynamoDB table name"
  value       = aws_dynamodb_table.politopics.name
}

output "politopics_table_arn" {
  description = "Primary PoliTopics DynamoDB table ARN"
  value       = aws_dynamodb_table.politopics.arn
}