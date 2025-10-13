import type { SQSRecord } from 'aws-lambda';

import { parsePromptTaskMessage } from 'src/lambda/parsePromptTaskMessage';

function buildRecord(body: unknown): SQSRecord {
  return {
    messageId: 'msg-1',
    receiptHandle: 'receipt',
    body: JSON.stringify(body),
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
  } as SQSRecord;
}

describe('parsePromptTaskMessage', () => {
  it('parses map messages', () => {
    const record = buildRecord({
      type: 'map',
      url: 's3://bucket/key',
      llm: 'gemini',
      llmModel: 'gemini-pro',
      retryAttempts: 1,
    });

    const parsed = parsePromptTaskMessage(record);
    expect(parsed.type).toBe('map');
    expect(parsed.retryAttempts).toBe(1);
  });

  it('parses reduce messages', () => {
    const record = buildRecord({
      type: 'reduce',
      chunk_result_urls: ['s3://bucket/a'],
      prompt: 'hello',
      issueID: 'issue',
      meeting: {
        issueID: 'issue',
        nameOfMeeting: 'Meeting',
        nameOfHouse: 'House',
        date: '2024-01-01',
        numberOfSpeeches: 1,
      },
      llm: 'gemini',
      llmModel: 'gemini-pro',
      retryAttempts: 0,
    });

    const parsed = parsePromptTaskMessage(record);
    expect(parsed.type).toBe('reduce');
    if (parsed.type === 'reduce') {
      expect(parsed.issueID).toBe('issue');
    }
  });

  it('throws on invalid message types', () => {
    const record = buildRecord({ type: 'other' });
    expect(() => parsePromptTaskMessage(record)).toThrow('Invalid prompt task message');
  });
});
