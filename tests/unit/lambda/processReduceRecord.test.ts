import type { S3Client } from '@aws-sdk/client-s3';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { SQSRecord } from 'aws-lambda';

import { processReduceRecord } from 'src/lambda/processReduceRecord';
import type { ReducePromptTaskMessage } from 'src/sqs/reduce';

jest.mock('src/utils/s3', () => ({
  parseS3Uri: jest.fn(),
  ensureObjectExists: jest.fn(),
  fetchJsonObject: jest.fn(),
}));

jest.mock('src/lambda/sqsActions', () => ({
  deleteMessage: jest.fn(),
  requeueWithDelay: jest.fn(),
  pickRequeueDelaySeconds: jest.fn((delayMs?: number) => (delayMs ?? 0) / 1000),
}));

const { parseS3Uri, ensureObjectExists, fetchJsonObject } = jest.requireMock('src/utils/s3');
const { deleteMessage, requeueWithDelay, pickRequeueDelaySeconds } = jest.requireMock('src/lambda/sqsActions');

describe('processReduceRecord', () => {
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

  const sqsClient = { send: jest.fn() } as unknown as SQSClient;
  const s3Client = { send: jest.fn() } as unknown as S3Client;
  const llmClient = { generate: jest.fn().mockResolvedValue({ text: 'ok' }) };

  const baseMessage: ReducePromptTaskMessage = {
    type: 'reduce',
    chunk_result_urls: ['s3://bucket/a', 's3://bucket/b'],
    meta: {},
    prompt: 'Summarize',
    issueID: 'ISS-1',
    meeting: {
      issueID: 'ISS-1',
      nameOfMeeting: 'Meeting',
      nameOfHouse: 'House',
      date: '2024-04-01',
      numberOfSpeeches: 2,
    },
    llm: 'gemini',
    llmModel: 'gemini-pro',
    retryAttempts: 1,
    delayMs: 90000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    parseS3Uri.mockImplementation((uri: string) => {
      const parts = uri.replace('s3://', '').split('/');
      return { bucket: parts[0], key: parts.slice(1).join('/') };
    });
  });

  it('requeues when prerequisites are missing', async () => {
    ensureObjectExists.mockResolvedValueOnce(false).mockResolvedValue(true);

    await processReduceRecord({
      message: baseMessage,
      record,
      queueUrl: 'queue',
      sqsClient,
      s3Client,
      llmClient,
    });

    expect(pickRequeueDelaySeconds).toHaveBeenCalledWith(baseMessage.delayMs);
    expect(requeueWithDelay).toHaveBeenCalledWith({
      sqsClient,
      queueUrl: 'queue',
      record,
      message: baseMessage,
      delaySeconds: (baseMessage.delayMs ?? 0) / 1000,
    });
    expect(llmClient.generate).not.toHaveBeenCalled();
  });

  it('fetches chunk results and queues llm work when sources exist', async () => {
    ensureObjectExists.mockResolvedValue(true);
    fetchJsonObject.mockResolvedValueOnce({ middleSummary: 'summary A', participants: ['Alice'] });
    fetchJsonObject.mockResolvedValueOnce({});

    await processReduceRecord({
      message: baseMessage,
      record,
      queueUrl: 'queue',
      sqsClient,
      s3Client,
      llmClient,
    });

    expect(fetchJsonObject).toHaveBeenCalledTimes(2);
    expect(llmClient.generate).toHaveBeenCalledWith({
      messages: [
        expect.objectContaining({ role: 'user', content: expect.stringContaining('Summarize') }),
      ],
    });
    expect(deleteMessage).toHaveBeenCalledWith({
      sqsClient,
      queueUrl: 'queue',
      receiptHandle: 'receipt',
    });
  });
});
