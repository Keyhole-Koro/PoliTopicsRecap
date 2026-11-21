aws_region                 = "ap-northeast-3"
environment                = "prod"
prompt_bucket_name         = "politopics-llm-artifacts-prod"
article_asset_bucket_name  = "politopics-articles-prod"
politopics_table_name      = "politopics-prod"
task_table_name            = "politopics-llm-tasks-prod"
task_status_index_name     = "StatusIndex"
enable_fargate             = true
enable_fargate_schedule    = true
fargate_subnet_ids         = []
fargate_security_group_ids = []

# Prod stays on Gemini until a stage run on Claude Haiku has been checked.
# To switch prod, create /politopics/prod/recap/anthropic-api-key first, then delete this line.
llm_provider = "gemini"
