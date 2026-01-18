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

output "fargate_cluster_name" {
  description = "ECS cluster name (null when disabled)"
  value       = module.fargate.cluster_name
}

output "fargate_task_definition_arn" {
  description = "ECS task definition ARN (null when disabled)"
  value       = module.fargate.task_definition_arn
}

output "fargate_ecr_repository_url" {
  description = "ECR repository URL (null when disabled)"
  value       = module.fargate.ecr_repository_url
}

output "fargate_scheduler_name" {
  description = "Scheduler schedule name (null when disabled)"
  value       = module.fargate.scheduler_name
}
