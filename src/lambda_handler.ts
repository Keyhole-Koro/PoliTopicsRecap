import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import type { SQSEvent } from 'aws-lambda';

import { processChunkRecord } from './lambda/processChunkRecord';
import { processReduceRecord } from './lambda/processReduceRecord';
import { parsePromptTaskMessage, type PromptTaskMessage } from './lambda/parsePromptTaskMessage';
import { deleteMessage } from './lambda/sqsActions';
import { resolveConfig } from './utils/config';
import { getAwsClientConfig } from './utils/aws';

export async function handler(event: SQSEvent): Promise<void> {
  const config = resolveConfig();
  const awsConfig = getAwsClientConfig();
  const sqsClient = new SQSClient(awsConfig);
  const s3Client = new S3Client(awsConfig);

  for (const record of event.Records) {
    let message: PromptTaskMessage;

    try {
      message = parsePromptTaskMessage(record);
    } catch (err) {
      console.error('Dropping unparseable SQS record', {
        messageId: record.messageId,
        error: err,
      });
      await deleteMessage({
        sqsClient,
        queueUrl: config.queueUrl,
        receiptHandle: record.receiptHandle,
      });
      continue;
    }

    if (message.type === 'chunk') {
      await processChunkRecord({
        message,
        record,
        sqsClient,
        s3Client,
        queueUrl: config.queueUrl,
      });
    } else {
      await processReduceRecord({
        message,
        record,
        sqsClient,
        s3Client,
        queueUrl: config.queueUrl,
      });
    }
  }
}
