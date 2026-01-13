bucket                  = "politopics-recap-local-state"
key                     = "politopics-recap/local.tfstate"
region                  = "ap-northeast-3"
endpoints                = {
    s3 = "http://localhost:4566"
}
use_path_style        = true
skip_credentials_validation = true
skip_region_validation      = true
