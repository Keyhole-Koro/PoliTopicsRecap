output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = try(aws_ecr_repository.this[0].repository_url, null)
}

output "cluster_name" {
  description = "ECS cluster name"
  value       = try(aws_ecs_cluster.this[0].name, null)
}

output "task_definition_arn" {
  description = "ECS task definition ARN"
  value       = try(aws_ecs_task_definition.this[0].arn, null)
}

output "scheduler_name" {
  description = "Scheduler schedule name"
  value       = try(aws_scheduler_schedule.this[0].name, null)
}
