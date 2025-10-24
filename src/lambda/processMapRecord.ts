import type { S3Client } from '@aws-sdk/client-s3';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { SQSRecord } from 'aws-lambda';

import type { MapPromptTaskMessage } from '../sqs/map';
import { fetchObjectText, parseS3Uri, PROMPT_BUCKET, uploadJson } from '../utils/s3';
import { deleteMessage, requeueWithDelay, FIVE_MINUTES_SECONDS } from './sqsActions';
import { LlmClient } from '@llm/llmClient';

export interface ProcessMapRecordArgs {
  message: MapPromptTaskMessage;
  record: SQSRecord;
  queueUrl: string;
  sqsClient: SQSClient;
  s3Client: S3Client;
  llmClient: LlmClient;
}

export async function processMapRecord({
  message,
  record,
  queueUrl,
  sqsClient,
  s3Client,
  llmClient,
}: ProcessMapRecordArgs): Promise<void> {
  try {
    const { bucket, key } = parseS3Uri(message.url);
    const sourceText = await fetchObjectText(s3Client, bucket, key);

    console.log('Downloaded Map payload', {
      messageId: record.messageId,
      bucket,
      key,
      bytes: Buffer.byteLength(sourceText, 'utf8'),
    });

    console.log('Map message ready for LLM processing', {
      messageId: record.messageId,
      resultUrl: message.result_url,
      retryAttempts: message.retryAttempts,
    });

    const result = await llmClient.generate({
      messages: [{ role: 'user', content: sourceText }],
    });

    const { bucket: resultBucket, key: resultKey } = parseS3Uri(message.result_url);

    await uploadJson({
      client: s3Client,
      bucket: resultBucket,
      key: resultKey,
      data: result,
      opts: {
        contentType: 'application/json',
      },
    });

    await deleteMessage({ sqsClient, queueUrl, receiptHandle: record.receiptHandle });
  } catch (err) {
    console.error('Map processing failed; rescheduling', {
      messageId: record.messageId,
      error: err,
    });
    await requeueWithDelay({
      sqsClient,
      queueUrl,
      record,
      message,
      delaySeconds: message.retryMs_in,
    });
  }
}
