import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { SQSRecord } from 'aws-lambda';

import type { MapPromptTaskMessage } from '../sqs/map';
import type { ReducePromptTaskMessage } from '../sqs/reduce';

const MAX_SQS_DELAY_SECONDS = 900;
export const FIVE_MINUTES_SECONDS = 5 * 60;

export type PromptTaskUnion = MapPromptTaskMessage | ReducePromptTaskMessage;

export type RequeueWithDelayArgs = {
  sqsClient: SQSClient;
  queueUrl: string;
  record: SQSRecord;
  message: PromptTaskUnion;
  delaySeconds: number;
};

export async function requeueWithDelay({
  sqsClient,
  queueUrl,
  record,
  message,
  delaySeconds,
}: RequeueWithDelayArgs): Promise<void> {
  const nextRetry = message.retryAttempts + 1;
  const payload = JSON.stringify({
    ...message,
    retryAttempts: nextRetry,
  });

  const safeDelay = Math.min(MAX_SQS_DELAY_SECONDS, Math.max(0, Math.floor(delaySeconds)));

  try {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: payload,
        DelaySeconds: safeDelay,
      }),
    );

    await deleteMessage({ sqsClient, queueUrl, receiptHandle: record.receiptHandle });
  } catch (err) {
    console.error('Failed to requeue message, extending visibility', {
      messageId: record.messageId,
      error: err,
    });

    await sqsClient.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: record.receiptHandle,
        VisibilityTimeout: safeDelay || FIVE_MINUTES_SECONDS,
      }),
    );

    throw err;
  }
}

export async function deleteMessage({
  sqsClient,
  queueUrl,
  receiptHandle,
}: {
  sqsClient: SQSClient;
  queueUrl: string;
  receiptHandle: string;
}): Promise<void> {
  await sqsClient.send(
    new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    }),
  );
}

export function pickRequeueDelaySeconds(delayMs: number | undefined): number {
  if (delayMs === undefined) {
    return FIVE_MINUTES_SECONDS;
  }

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    return FIVE_MINUTES_SECONDS;
  }

  return Math.min(MAX_SQS_DELAY_SECONDS, Math.max(0, Math.round(delayMs / 1000)));
}
