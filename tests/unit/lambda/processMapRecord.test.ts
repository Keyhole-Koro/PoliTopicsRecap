import type { S3Client } from '@aws-sdk/client-s3';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { SQSRecord } from 'aws-lambda';

import { processMapRecord } from 'src/lambda/processMapRecord';
import type { MapPromptTaskMessage } from 'src/sqs/map';

jest.mock('src/utils/s3', () => ({
  parseS3Uri: jest.fn(),
  fetchObjectText: jest.fn(),
}));

jest.mock('src/lambda/sqsActions', () => ({
  deleteMessage: jest.fn(),
  requeueWithDelay: jest.fn(),
  FIVE_MINUTES_SECONDS: 300,
}));

const { parseS3Uri, fetchObjectText } = jest.requireMock('src/utils/s3');
const { deleteMessage, requeueWithDelay, FIVE_MINUTES_SECONDS } = jest.requireMock('src/lambda/sqsActions');

describe('processMapRecord', () => {
  const record: SQSRecord = {
    messageId: 'msg',
    receiptHandle: 'receipt',
    body: '{}',
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '0',
      SenderId: 'sender',
      ApproximateFirstReceiveTimestamp: '0',
    },
    md5OfBody: '',
    md5OfMessageAttributes: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn',
    awsRegion: 'ap-northeast-3',
    messageAttributes: {},
  };

  const baseMessage: MapPromptTaskMessage = {
    type: 'map',
    url: 's3://bucket/key',
    llm: 'gemini',
    llmModel: 'gemini-pro',
    retryAttempts: 0,
  };

  const sqsClient = { send: jest.fn() } as unknown as SQSClient;
  const s3Client = { send: jest.fn() } as unknown as S3Client;
  const llmClient = { generate: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    parseS3Uri.mockReturnValue({ bucket: 'bucket', key: 'key' });
    fetchObjectText.mockResolvedValue('payload');
    (llmClient.generate as jest.Mock).mockResolvedValue({ text: 'ok' });
  });

  it('processes successful map records', async () => {
    await processMapRecord({
      message: baseMessage,
      record,
      queueUrl: 'queue-url',
      sqsClient,
      s3Client,
      llmClient,
    });

    expect(parseS3Uri).toHaveBeenCalledWith('s3://bucket/key');
    expect(fetchObjectText).toHaveBeenCalledWith(s3Client, 'bucket', 'key');
    expect(llmClient.generate).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'payload' }],
    });
    expect(deleteMessage).toHaveBeenCalledWith({
      sqsClient,
      queueUrl: 'queue-url',
      receiptHandle: 'receipt',
    });
  });

  it('requeues failures with a five-minute delay', async () => {
    (llmClient.generate as jest.Mock).mockRejectedValue(new Error('boom'));

    await processMapRecord({
      message: baseMessage,
      record,
      queueUrl: 'queue-url',
      sqsClient,
      s3Client,
      llmClient,
    });

    expect(requeueWithDelay).toHaveBeenCalledWith({
      sqsClient,
      queueUrl: 'queue-url',
      record,
      message: baseMessage,
      delaySeconds: FIVE_MINUTES_SECONDS,
    });
  });
});
