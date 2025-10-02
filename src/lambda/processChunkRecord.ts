import type { S3Client } from '@aws-sdk/client-s3';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { SQSRecord } from 'aws-lambda';

import type { ChunkPromptTaskMessage } from '../sqs/chunk';
import { fetchObjectText, parseS3Uri } from '../utils/s3';
import { deleteMessage, requeueWithDelay, FIVE_MINUTES_SECONDS } from './sqsActions';

export interface ProcessChunkRecordArgs {
  message: ChunkPromptTaskMessage;
  record: SQSRecord;
  queueUrl: string;
  sqsClient: SQSClient;
  s3Client: S3Client;
}

export async function processChunkRecord({
  message,
  record,
  queueUrl,
  sqsClient,
  s3Client,
}: ProcessChunkRecordArgs): Promise<void> {
  try {
    const { bucket, key } = parseS3Uri(message.url);
    const sourceText = await fetchObjectText(s3Client, bucket, key);

    console.log('Downloaded chunk payload', {
      messageId: record.messageId,
      bucket,
      key,
      bytes: Buffer.byteLength(sourceText, 'utf8'),
    });

    // TODO: invoke LLM and store results at message.result_url
    console.log('Chunk message ready for LLM processing', {
      messageId: record.messageId,
      resultUrl: message.result_url,
      retryAttempts: message.retryAttempts,
    });

    await deleteMessage({ sqsClient, queueUrl, receiptHandle: record.receiptHandle });
  } catch (err) {
    console.error('Chunk processing failed; rescheduling', {
      messageId: record.messageId,
      error: err,
    });
    await requeueWithDelay({
      sqsClient,
      queueUrl,
      record,
      message,
      delaySeconds: FIVE_MINUTES_SECONDS,
    });
  }
}
