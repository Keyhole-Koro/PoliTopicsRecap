resource "aws_sqs_queue" "this" {
  name = var.name

  visibility_timeout_seconds = var.visibility_timeout_seconds
  receive_wait_time_seconds  = var.receive_wait_time_seconds
  message_retention_seconds  = var.message_retention_seconds
  max_message_size           = var.max_message_size
  delay_seconds              = var.delay_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 2
  })

  tags = var.tags
}

resource "aws_sqs_queue" "dlq" {
  name = "${var.name}-dlq"
}
