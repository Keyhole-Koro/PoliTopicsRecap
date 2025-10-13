bucket         = "politopics-recap-stage-terraform"
key            = "state/terraform.tfstate"
region         = "ap-northeast-3"
dynamodb_table = "politopics-recap-stage-terraform-lock"
encrypt        = true
