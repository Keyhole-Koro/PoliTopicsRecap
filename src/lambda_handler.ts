import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import type { SQSEvent } from 'aws-lambda';

import { GeminiClient } from '@llm/geminiClient';
import { processMapRecord } from 'lambda/processMapRecord';
import { processReduceRecord } from './lambda/processReduceRecord';
import { parsePromptTaskMessage, type PromptTaskMessage } from './lambda/parsePromptTaskMessage';
import { deleteMessage } from './lambda/sqsActions';
import { resolveConfig } from '@utils/config';
import { getAwsBaseConfig, getS3ClientConfig } from '@utils/aws';

export async function handler(event: SQSEvent): Promise<void> {
  const config = resolveConfig();

  const awsBase = getAwsBaseConfig();
  const s3Cfg   = getS3ClientConfig();

  const sqsClient = new SQSClient(awsBase);
  const s3Client  = new S3Client(s3Cfg);

  const llmClient = new GeminiClient({ apiKey: config.geminiApiKey });
  const queueUrl = config.queueUrl;

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

    // validate if the corresponding record exists later implementation
    if (message.type === 'map') {
      await processMapRecord({
        message,
        record,
        sqsClient,
        s3Client,
        llmClient,
        queueUrl: config.queueUrl,
      });
    } else if (message.type === 'reduce') {
      await processReduceRecord({
        message,
        record,
        sqsClient,
        s3Client,
        llmClient,
        queueUrl: config.queueUrl,
      });
    } else {
        console.error('Dropping SQS record with unknown task type', {
        messageId: record.messageId,
        taskType: (message as { type?: unknown }).type,
      });
      await deleteMessage({
        sqsClient,
        queueUrl: config.queueUrl,
        receiptHandle: record.receiptHandle,
      });
    }
  }
}
