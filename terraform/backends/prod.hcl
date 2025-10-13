bucket         = "politopics-recap-prod-terraform"
key            = "state/terraform.tfstate"
region         = "ap-northeast-3"
dynamodb_table = "politopics-recap-prod-terraform-lock"
encrypt        = true
