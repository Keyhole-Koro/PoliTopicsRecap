# LocalStack Notes

This folder is reserved for local-only infrastructure definitions. If you need to spin up
mock AWS resources for development, place experimental Terraform configurations here
and point them at the LocalStack endpoint (`http://localhost:4566`).

There are no resources defined yet because the unit tests now create all required
queues and buckets on the fly when LocalStack is running.
