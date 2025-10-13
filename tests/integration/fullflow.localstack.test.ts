import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { SQSEvent } from 'aws-lambda';

import storeData, { type Article } from '../../src/dynamoDB/storeData';
import { handler } from '../../src/lambda_handler';

const endpoint = process.env.AWS_ENDPOINT_URL;
const region = process.env.AWS_REGION ?? 'us-east-1';

if (!endpoint) {
  throw new Error('AWS_ENDPOINT_URL must be defined for LocalStack integration tests');
}

const s3Client = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
});
const sqsClient = new SQSClient({ region, endpoint });
const dynamoClient = new DynamoDBClient({ region, endpoint });
const dynamoDoc = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

interface QueueResource {
  queueUrl: string;
  queueArn: string;
  queueName: string;
}

const REQUIRED_ENV_KEYS = [
  'PROMPT_QUEUE_URL',
  'PROMPT_QUEUE_ARN',
  'IDEMPOTENCY_TABLE_NAME',
  'GEMINI_API_KEY',
] as const;

describe('LocalStack SQS to Lambda to S3 to LLM integration', () => {
  let envSnapshot: Record<string, string | undefined> = {};

  afterAll(async () => {
    s3Client.destroy();
    sqsClient.destroy();
    dynamoClient.destroy();
  });

  beforeEach(() => {
    envSnapshot = {};
    for (const key of REQUIRED_ENV_KEYS) {
      envSnapshot[key] = process.env[key];
    }

    global.__geminiGenerateMock.mockReset();
    global.__geminiGenerateMock.mockResolvedValue({
      response: { text: () => 'stubbed llm output' },
    });
    global.__geminiGetModelMock.mockReset();
    global.__geminiGetModelMock.mockReturnValue({
      generateContent: global.__geminiGenerateMock,
    });
    global.__googleGenerativeAiCtorMock.mockReset();
    global.__googleGenerativeAiCtorMock.mockImplementation(() => ({
      getGenerativeModel: global.__geminiGetModelMock,
    }));
  });

  afterEach(() => {
    for (const key of REQUIRED_ENV_KEYS) {
      const value = envSnapshot[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test('processes map prompt messages end to end', async () => {
    const bucketName = uniqueName('map-bucket');
    await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));

    const queue = await createQueue(uniqueName('map-queue'));
    try {
      const sourceKey = 'inputs/source.txt';
      const sourceBody = 'Chair: Welcome to the meeting. Speaker: Agenda overview.';
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: sourceKey,
          Body: sourceBody,
        }),
      );

      const mapMessage = {
        type: 'map' as const,
        url: `s3://${bucketName}/${sourceKey}`,
        result_url: `s3://${bucketName}/results/output.json`,
        llm: 'gemini',
        llmModel: 'gemini-1.5-pro',
        retryAttempts: 0,
        meta: { fixture: true },
      };

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queue.queueUrl,
          MessageBody: JSON.stringify(mapMessage),
        }),
      );

      const event = await receiveOneMessageAsEvent(queue);
      setEnvForHandler(queue);

      await handler(event);

      expect(global.__geminiGenerateMock).toHaveBeenCalledTimes(1);
      const invocation = global.__geminiGenerateMock.mock.calls[0]?.[0];
      expect(invocation).toBeDefined();
      expect(invocation.contents?.[0]?.parts?.[0]?.text).toContain(sourceBody);

      const { Messages } = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queue.queueUrl,
          WaitTimeSeconds: 1,
        }),
      );
      expect(Messages ?? []).toHaveLength(0);
    } finally {
      await cleanupQueue(queue);
      await cleanupBucket(bucketName);
    }
  });

  test('processes reduce prompt messages end to end', async () => {
    const bucketName = uniqueName('reduce-bucket');
    await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));

    const queue = await createQueue(uniqueName('reduce-queue'));
    try {
      const chunkAKey = 'chunks/chunk-a.json';
      const chunkBKey = 'chunks/chunk-b.json';
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: chunkAKey,
          Body: JSON.stringify({
            middleSummary: 'Debate focused on education reforms.',
            participants: ['Member A', 'Member B'],
          }),
        }),
      );
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: chunkBKey,
          Body: JSON.stringify({
            middleSummary: 'Budget adjustments were proposed.',
            participants: ['Member C'],
          }),
        }),
      );

      const reduceMessage = {
        type: 'reduce' as const,
        chunk_result_urls: [
          `s3://${bucketName}/${chunkAKey}`,
          `s3://${bucketName}/${chunkBKey}`,
        ],
        prompt: 'Combine the chunk summaries into a final recap.',
        issueID: 'ISSUE-123',
        meeting: {
          issueID: 'ISSUE-123',
          nameOfMeeting: 'Special Committee on Education',
          nameOfHouse: 'House of Representatives',
          date: '2024-09-01',
          numberOfSpeeches: 2,
        },
        llm: 'gemini',
        llmModel: 'gemini-1.5-pro',
        retryAttempts: 0,
        meta: { fixture: true },
      };

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queue.queueUrl,
          MessageBody: JSON.stringify(reduceMessage),
        }),
      );

      const event = await receiveOneMessageAsEvent(queue);
      setEnvForHandler(queue);

      await handler(event);

      expect(global.__geminiGenerateMock).toHaveBeenCalledTimes(1);
      const invocation = global.__geminiGenerateMock.mock.calls[0]?.[0];
      expect(invocation).toBeDefined();
      const promptText = invocation.contents?.[0]?.parts?.[0]?.text;
      expect(promptText).toContain('ISSUE-123');
      expect(promptText).toContain('Special Committee on Education');
      expect(promptText).toContain('Debate focused on education reforms.');
      expect(promptText).toContain('Budget adjustments were proposed.');

      const { Messages } = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queue.queueUrl,
          WaitTimeSeconds: 1,
        }),
      );
      expect(Messages ?? []).toHaveLength(0);
    } finally {
      await cleanupQueue(queue);
      await cleanupBucket(bucketName);
    }
  });

  test('stores article metadata in DynamoDB and exposes query indexes', async () => {
    const tableName = uniqueName('articles-table');
    await createArticlesTable(tableName);
    try {
      const article = buildArticleFixture();

      const result = await storeData({ doc: dynamoDoc, table_name: tableName }, article);
      expect(result).toEqual({ ok: true, id: article.id });

      const mainItem = await dynamoDoc.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `A#${article.id}`, SK: 'META' },
        }),
      );
      expect(mainItem.Item?.title).toBe(article.title);
      expect(mainItem.Item?.type).toBe('ARTICLE');

      const categoryResults = await dynamoDoc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: {
            ':pk': `CATEGORY#${article.categories[0]}`,
          },
        }),
      );
      expect(findArticle(categoryResults.Items, article.id)).toBe(true);

      const keywordRecentResults = await dynamoDoc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: {
            ':pk': 'KEYWORD_RECENT',
          },
        }),
      );
      expect(keywordRecentResults.Items?.some((item) => item.keyword === article.keywords[0]?.keyword)).toBe(true);

      const gsi1Results = await dynamoDoc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'ArticleByDate',
          KeyConditionExpression: 'GSI1PK = :gsi1pk',
          ExpressionAttributeValues: {
            ':gsi1pk': 'ARTICLE',
          },
        }),
      );
      expect(findArticle(gsi1Results.Items, article.id)).toBe(true);

      const gsi2Results = await dynamoDoc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'MonthDateIndex',
          KeyConditionExpression: 'GSI2PK = :gsi2pk',
          ExpressionAttributeValues: {
            ':gsi2pk': `Y#2024#M#09`,
          },
        }),
      );
      expect(findArticle(gsi2Results.Items, article.id)).toBe(true);
    } finally {
      await deleteArticlesTable(tableName);
    }
  });
});

function findArticle(items: any[] | undefined, id: string): boolean {
  return Boolean(items?.some((item) => item.articleId === id || item.PK === `A#${id}`));
}

function uniqueName(prefix: string): string {
  const random = Math.random().toString(16).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

async function createQueue(queueName: string): Promise<QueueResource> {
  const { QueueUrl } = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: queueName,
    }),
  );

  if (!QueueUrl) {
    throw new Error('Failed to create queue');
  }

  const { Attributes } = await sqsClient.send(
    new GetQueueAttributesCommand({
      QueueUrl,
      AttributeNames: ['QueueArn'],
    }),
  );

  const queueArn = Attributes?.QueueArn ?? `arn:aws:sqs:${region}:000000000000:${queueName}`;

  return { queueUrl: QueueUrl, queueArn, queueName };
}

async function receiveOneMessageAsEvent(queue: QueueResource): Promise<SQSEvent> {
  for (let attempts = 0; attempts < 5; attempts += 1) {
    const { Messages } = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queue.queueUrl,
        AttributeNames: ['All'],
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
      }),
    );

    const message = Messages?.[0];
    if (message) {
      return toSQSEvent(message, queue.queueArn);
    }
  }

  throw new Error(`No messages received from queue ${queue.queueName}`);
}

function toSQSEvent(message: Message, queueArn: string): SQSEvent {
  if (!message.Body || !message.ReceiptHandle || !message.MessageId) {
    throw new Error('Received message missing required fields');
  }

  const timestamp = Date.now().toString();
  return {
    Records: [
      {
        messageId: message.MessageId,
        receiptHandle: message.ReceiptHandle,
        body: message.Body,
        attributes: {
          ApproximateReceiveCount: message.Attributes?.ApproximateReceiveCount ?? '1',
          SentTimestamp: message.Attributes?.SentTimestamp ?? timestamp,
          SenderId: message.Attributes?.SenderId ?? '000000000000',
          ApproximateFirstReceiveTimestamp: message.Attributes?.ApproximateFirstReceiveTimestamp ?? timestamp,
        },
        messageAttributes: {},
        md5OfBody: message.MD5OfBody ?? '',
        eventSource: 'aws:sqs',
        eventSourceARN: queueArn,
        awsRegion: region,
      },
    ],
  };
}

function setEnvForHandler(queue: QueueResource): void {
  process.env.PROMPT_QUEUE_URL = queue.queueUrl;
  process.env.PROMPT_QUEUE_ARN = queue.queueArn;
  if (!process.env.IDEMPOTENCY_TABLE_NAME) {
    process.env.IDEMPOTENCY_TABLE_NAME = 'local-idempotency';
  }
  if (!process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = 'local-test-key';
  }
}

async function cleanupQueue(queue: QueueResource): Promise<void> {
  await sqsClient.send(
    new DeleteQueueCommand({
      QueueUrl: queue.queueUrl,
    }),
  );
}

async function cleanupBucket(bucket: string): Promise<void> {
  const listed = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
    }),
  );

  if (listed.Contents?.length) {
    for (const object of listed.Contents) {
      if (object.Key) {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: object.Key,
          }),
        );
      }
    }
  }

  await s3Client.send(
    new DeleteBucketCommand({
      Bucket: bucket,
    }),
  );
}

async function createArticlesTable(tableName: string): Promise<void> {
  await dynamoClient.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'ArticleByDate',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'MonthDateIndex',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );

  await waitForTableActive(tableName);
}

async function deleteArticlesTable(tableName: string): Promise<void> {
  await dynamoClient.send(
    new DeleteTableCommand({ TableName: tableName }),
  );

  await waitForTableDeletion(tableName);
}

async function waitForTableActive(tableName: string): Promise<void> {
  for (let i = 0; i < 15; i += 1) {
    const { Table } = await dynamoClient.send(
      new DescribeTableCommand({ TableName: tableName }),
    );
    if (Table?.TableStatus === 'ACTIVE') {
      return;
    }
    await delay(250);
  }
  throw new Error(`Table ${tableName} did not become ACTIVE in time`);
}

async function waitForTableDeletion(tableName: string): Promise<void> {
  for (let i = 0; i < 15; i += 1) {
    try {
      await dynamoClient.send(
        new DescribeTableCommand({ TableName: tableName }),
      );
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') {
        return;
      }
    }
    await delay(250);
  }
  throw new Error(`Table ${tableName} was not deleted in time`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildArticleFixture(): Article {
  const baseDate = '2024-09-01';
  return {
    id: `article-${uniqueName('fixture')}`,
    title: 'Education committee headline',
    date: baseDate,
    month: '2024-09',
    imageKind: 'IMAGE_PLACEHOLDER' as Article['imageKind'],
    session: 12,
    nameOfHouse: 'House of Representatives',
    nameOfMeeting: 'Special Committee on Education',
    categories: ['education', 'budget'],
    description: 'Key updates on education and budget matters.',
    summary: { text: 'Long-form summary' },
    soft_summary: { text: 'Soft summary' },
    middle_summary: [{ section: 'Overview', text: 'Concise review' }],
    dialogs: [
      { speaker: 'Chair', text: 'Opening remarks' },
      { speaker: 'Member A', text: 'Budget questions' },
    ],
    participants: [{ name: 'Member A' }, { name: 'Member B' }],
    keywords: [{ keyword: 'education' }, { keyword: 'budget' }],
    terms: [{ term: 'curriculum' }, { term: 'funding' }],
  };
}