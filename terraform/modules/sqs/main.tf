locals {
  queue_name = endswith(var.name, ".fifo") ? var.name : "${var.name}.fifo"
  dlq_base   = trimsuffix(local.queue_name, ".fifo")
}

resource "aws_sqs_queue" "this" {
  name = local.queue_name

  fifo_queue                  = true
  content_based_deduplication = true
  visibility_timeout_seconds  = var.visibility_timeout_seconds
  receive_wait_time_seconds   = var.receive_wait_time_seconds
  message_retention_seconds   = var.message_retention_seconds
  max_message_size            = var.max_message_size
  delay_seconds               = var.delay_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 2
  })

  tags = var.tags
}

resource "aws_sqs_queue" "dlq" {
  name = "${local.dlq_base}-dlq.fifo"

  fifo_queue                  = true
  content_based_deduplication = true
}
