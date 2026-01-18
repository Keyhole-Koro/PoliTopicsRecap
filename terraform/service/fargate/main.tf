locals {
  name_prefix    = "politopics-recap-${var.environment}"
  task_family    = "politopics-recap-task-${var.environment}"
  container_name = "recap-batch"
  log_group_name = "/ecs/${local.name_prefix}"
  r2_enabled     = var.r2_endpoint_url != ""

  base_env = {
    APP_ENVIRONMENT       = var.environment
    AWS_REGION            = var.aws_region
    GEMINI_API_KEY        = var.gemini_api_key
    DISCORD_WEBHOOK_ERROR = var.discord_webhook_error
    DISCORD_WEBHOOK_WARN  = var.discord_webhook_warn
    DISCORD_WEBHOOK_BATCH = var.discord_webhook_batch
    ENABLE_NOTIFICATION   = var.enable_notification ? "true" : "false"
    NOTIFICATION_DELAY_MS = tostring(var.notification_delay_ms)
  }

  r2_env = local.r2_enabled ? {
    R2_ENDPOINT_URL      = var.r2_endpoint_url
    R2_REGION            = var.r2_region
    R2_ACCESS_KEY_ID     = var.r2_access_key_id
    R2_SECRET_ACCESS_KEY = var.r2_secret_access_key
    R2_ARTICLE_BUCKET    = var.r2_article_bucket
    R2_PUBLIC_URL_BASE   = var.r2_public_url_base
  } : {}

  env_vars_raw = merge(local.base_env, local.r2_env, var.extra_environment_variables)

  env_vars = [
    for key, value in local.env_vars_raw :
    {
      name  = key
      value = tostring(value)
    }
    if value != null && tostring(value) != ""
  ]
}

resource "aws_ecr_repository" "this" {
  count = var.enabled ? 1 : 0

  name                 = local.name_prefix
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "this" {
  count = var.enabled ? 1 : 0

  name              = local.log_group_name
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_iam_role" "execution" {
  count = var.enabled ? 1 : 0

  name = "${local.name_prefix}-task-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  count = var.enabled ? 1 : 0

  role       = aws_iam_role.execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  count = var.enabled ? 1 : 0

  name = "${local.name_prefix}-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "task" {
  count = var.enabled ? 1 : 0

  name = "${local.name_prefix}-task-policy"
  role = aws_iam_role.task[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [
          var.prompt_bucket_arn,
          var.article_asset_bucket_arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          "${var.prompt_bucket_arn}/*",
          "${var.article_asset_bucket_arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:BatchGetItem",
          "dynamodb:DescribeTable"
        ]
        Resource = [
          var.task_table_arn,
          "${var.task_table_arn}/index/*",
          var.article_table_arn,
          "${var.article_table_arn}/index/*"
        ]
      }
    ]
  })
}

resource "aws_ecs_cluster" "this" {
  count = var.enabled ? 1 : 0

  name = local.name_prefix
  tags = var.tags
}

resource "aws_ecs_task_definition" "this" {
  count = var.enabled ? 1 : 0

  family                   = local.task_family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.execution[0].arn
  task_role_arn            = aws_iam_role.task[0].arn

  container_definitions = jsonencode([
    {
      name        = local.container_name
      image       = "${aws_ecr_repository.this[0].repository_url}:${var.container_image_tag}"
      essential   = true
      environment = local.env_vars
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.this[0].name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "recap"
        }
      }
    }
  ])

  tags = var.tags
}

locals {
  schedule_enabled = var.enabled && var.enable_schedule
}

resource "aws_iam_role" "scheduler" {
  count = local.schedule_enabled ? 1 : 0

  name = "${local.name_prefix}-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "scheduler.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "scheduler" {
  count = local.schedule_enabled ? 1 : 0

  name = "${local.name_prefix}-scheduler-policy"
  role = aws_iam_role.scheduler[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["ecs:RunTask"]
        Resource = [
          aws_ecs_task_definition.this[0].arn,
          aws_ecs_cluster.this[0].arn
        ]
      },
      {
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.execution[0].arn,
          aws_iam_role.task[0].arn
        ]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ecs-tasks.amazonaws.com"
          }
        }
      }
    ]
  })
}

resource "aws_scheduler_schedule" "this" {
  count = local.schedule_enabled ? 1 : 0

  name                         = "${local.name_prefix}-daily"
  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = var.schedule_timezone
  state                        = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.this[0].arn
    role_arn = aws_iam_role.scheduler[0].arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.this[0].arn
      task_count          = 1
      launch_type         = "FARGATE"

      network_configuration {
        subnets          = var.subnet_ids
        security_groups  = var.security_group_ids
        assign_public_ip = var.assign_public_ip
      }
    }
  }
}
