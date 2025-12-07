output "politopics_recap_lambda_arn" {
  description = "ARN of the PoliTopicsRecap task processing Lambda function"
  value       = module.lambda.lambda_function_arn
}

output "politopics_table_name" {
  description = "Primary PoliTopics DynamoDB table name"
  value       = module.dynamodb.politopics_table_name
}

output "politopics_table_arn" {
  description = "Primary PoliTopics DynamoDB table ARN"
  value       = module.dynamodb.politopics_table_arn
}

output "prompt_bucket_name" {
  description = "Prompt storage bucket name"
  value       = module.s3.bucket_name
}

output "prompt_bucket_arn" {
  description = "Prompt storage bucket ARN"
  value       = module.s3.bucket_arn
}

output "article_asset_bucket_name" {
  description = "Article payload storage bucket name"
  value       = module.article_asset_bucket.bucket_name
}

output "article_asset_bucket_arn" {
  description = "Article payload storage bucket ARN"
  value       = module.article_asset_bucket.bucket_arn
}
