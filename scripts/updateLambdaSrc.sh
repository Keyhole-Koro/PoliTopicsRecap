npm run build:local
terraform plan -var-file="tfvars/localstack.tfvars" -out=tfplan
terraform apply "tfplan"
npm run enqueue-mock
