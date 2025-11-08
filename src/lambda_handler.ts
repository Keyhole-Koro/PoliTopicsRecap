import { S3Client } from '@aws-sdk/client-s3';
import {
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

import { GeminiClient } from '@llm/geminiClient';
import { FakeLlmClient } from '@llm/fakeLlmClient';
import { processMapRecord } from 'lambda/processMapRecord';
import { processReduceRecord } from './lambda/processReduceRecord';
import { parsePromptTaskMessage, type PromptTaskMessage } from './lambda/parsePromptTaskMessage';
import { deleteMessage } from './lambda/sqsActions';
import { resolveConfig } from '@utils/config';
import { getAwsBaseConfig, getS3ClientConfig } from '@utils/aws';

type SchedulerEvent = {
  source?: string;
  [key: string]: unknown;
};

export async function handler(event: SQSEvent | SchedulerEvent | undefined = undefined): Promise<void> {
  const config = resolveConfig();

  const awsBase = getAwsBaseConfig();
  const s3Cfg   = getS3ClientConfig();

  const sqsClient = new SQSClient(awsBase);
  const s3Client  = new S3Client(s3Cfg);

  const queueUrl = config.queueUrl;

  const records = await resolveRecords(event, sqsClient, queueUrl, config.queueArn);
  if (records.length === 0) {
    console.log('[handler] No SQS messages to process');
    return;
  }

  for (const record of records) {
    let message: PromptTaskMessage;
    let llmClient: GeminiClient | FakeLlmClient | undefined;

    try {
      message = parsePromptTaskMessage(record);
      console.log(message)
      if (message.llm == "gemini") {
        llmClient = new GeminiClient({
          apiKey: config.geminiApiKey,
          model: message.llmModel,
        });
      } else if (message.llm == "fake") {
        llmClient = new FakeLlmClient({
          mode: "echo",
        });
      } else {
        console.error('Dropping SQS record with unknown or unsupported LLM', {
          messageId: record.messageId,
          llm: (message as { llm?: unknown }).llm,
        });
        await deleteMessage({
          sqsClient,
          queueUrl: config.queueUrl,
          receiptHandle: record.receiptHandle,
        });
        continue;
      }
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

function isSqsEvent(event: unknown): event is SQSEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    Array.isArray((event as { Records?: unknown }).Records)
  );
}

async function resolveRecords(
  event: SQSEvent | SchedulerEvent | undefined,
  sqsClient: SQSClient,
  queueUrl: string,
  queueArn: string,
): Promise<SQSRecord[]> {
  if (event && isSqsEvent(event)) {
    return event.Records;
  }

  const response = await sqsClient.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
      WaitTimeSeconds: 0,
    }),
  );

  const [message] = response.Messages ?? [];
  if (!message) {
    return [];
  }

  const record = messageToRecord(message, queueArn);
  if (!record) {
    return [];
  }

  return [record];
}

function messageToRecord(message: Message, queueArn: string): SQSRecord | null {
  if (!message.Body || !message.ReceiptHandle || !message.MessageId) {
    console.warn('[handler] Received SQS message missing body/receipt/messageId, skipping', {
      message,
    });
    return null;
  }

  const timestamp = Date.now().toString();
  const arnParts = queueArn.split(':');
  const regionFromArn = arnParts.length >= 4 ? arnParts[3] : undefined;

  return {
    messageId: message.MessageId,
    receiptHandle: message.ReceiptHandle,
    body: message.Body,
    attributes: {
      ApproximateReceiveCount: message.Attributes?.ApproximateReceiveCount ?? '1',
      SentTimestamp: message.Attributes?.SentTimestamp ?? timestamp,
      SenderId: message.Attributes?.SenderId ?? 'scheduler',
      ApproximateFirstReceiveTimestamp:
        message.Attributes?.ApproximateFirstReceiveTimestamp ?? timestamp,
      MessageGroupId: message.Attributes?.MessageGroupId,
      MessageDeduplicationId: message.Attributes?.MessageDeduplicationId,
      SequenceNumber: message.Attributes?.SequenceNumber,
    },
    messageAttributes: convertMessageAttributes(message.MessageAttributes),
    md5OfBody: message.MD5OfBody ?? '',
    eventSource: 'aws:sqs',
    eventSourceARN: queueArn,
    awsRegion: regionFromArn ?? process.env.AWS_REGION ?? 'us-east-1',
  };
}

function convertMessageAttributes(
  attributes: Message['MessageAttributes'],
): SQSRecord['messageAttributes'] {
  if (!attributes) {
    return {};
  }

  const converted: SQSRecord['messageAttributes'] = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!value) {
      continue;
    }

    converted[key] = {
      stringValue: value.StringValue,
      binaryValue: toBase64(value.BinaryValue),
      stringListValues: value.StringListValues ?? [],
      binaryListValues: (value.BinaryListValues ?? []).map(toBase64).filter(isString),
      dataType: value.DataType ?? 'String',
    };
  }
  return converted;
}

function toBase64(value: string | Uint8Array | undefined | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  return Buffer.from(value).toString('base64');
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}
