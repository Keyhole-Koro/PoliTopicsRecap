import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import { handler } from "../lambda_handler";

const region = process.env.AWS_REGION!;
const endpoint =
  process.env.LOCALSTACK_ENDPOINT_URL ??
  process.env.AWS_ENDPOINT_URL ??
  process.env.LOCALSTACK_URL ??
  process.env.LOCALSTACK_ENDPOINT ??
  "http://localstack:4566";

const { GoogleGenerativeAI: googleGenerativeAiCtorMock } = jest.requireMock("@google/generative-ai") as {
  GoogleGenerativeAI: jest.Mock;
};

const generateContentMock = jest.fn();
const getGenerativeModelMock = jest.fn();

const STATUS_INDEX_NAME = "StatusIndex";
const describeIfEndpoint = endpoint ? describe : describe.skip;

describeIfEndpoint("PoliTopics task consumer (LocalStack)", () => {
  if (!endpoint) {
    it("skipped because no LocalStack endpoint is set", () => {
      expect(true).toBe(true);
    });
    return;
  }

  const s3Client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  const dynamoClient = new DynamoDBClient({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  const dynamoDoc = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: { removeUndefinedValues: true },
  });

  let envSnapshot: Record<string, string | undefined> = {};

  async function ensureBucketExists(bucket: string) {
    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
      if (err?.name !== "BucketAlreadyOwnedByYou" && err?.name !== "BucketAlreadyExists") {
        // ignore already-provisioned buckets
      }
    }
  }

  beforeAll(async () => {
    const promptBucket = process.env.PROMPT_BUCKET_NAME!;
    const articleAssetBucket = process.env.ARTICLE_ASSET_BUCKET_NAME ?? promptBucket;
    await ensureBucketExists(promptBucket);
    await ensureBucketExists(articleAssetBucket);
  });

  afterAll(async () => {
    s3Client.destroy();
    dynamoClient.destroy();
  });

  beforeEach(() => {
    envSnapshot = {
      LLM_TASK_TABLE: process.env.LLM_TASK_TABLE,
      LLM_TASK_STATUS_INDEX: process.env.LLM_TASK_STATUS_INDEX,
      PROMPT_BUCKET_NAME: process.env.PROMPT_BUCKET_NAME,
      ARTICLE_ASSET_BUCKET_NAME: process.env.ARTICLE_ASSET_BUCKET_NAME,
      ARTICLE_TABLE_NAME: process.env.ARTICLE_TABLE_NAME,
    };

    generateContentMock.mockReset();
    getGenerativeModelMock.mockReset();
    getGenerativeModelMock.mockImplementation(() => ({
      generateContent: generateContentMock,
    }));
    googleGenerativeAiCtorMock.mockReset();
    googleGenerativeAiCtorMock.mockImplementation(() => ({
      getGenerativeModel: getGenerativeModelMock,
    }));
  });

  afterEach(() => {
    process.env.LLM_TASK_TABLE = envSnapshot.LLM_TASK_TABLE ?? 'PoliTopics-llm-tasks';
    process.env.LLM_TASK_STATUS_INDEX = envSnapshot.LLM_TASK_STATUS_INDEX ?? 'StatusIndex';
    process.env.PROMPT_BUCKET_NAME = envSnapshot.PROMPT_BUCKET_NAME ?? 'politopics-prompts';
    process.env.ARTICLE_ASSET_BUCKET_NAME = envSnapshot.ARTICLE_ASSET_BUCKET_NAME ?? 'politopics-articles';
    process.env.ARTICLE_TABLE_NAME = envSnapshot.ARTICLE_TABLE_NAME ?? 'PoliTopics';
  });

  test("processes a direct task, stores reduce result, and marks it completed", async () => {
    const bucket = process.env.PROMPT_BUCKET_NAME!;
    const articleAssetBucket = process.env.ARTICLE_ASSET_BUCKET_NAME ?? bucket;
    const tableName = process.env.LLM_TASK_TABLE!;
    const articleTableName = process.env.ARTICLE_TABLE_NAME!;

    try {
      await cleanupBucket(bucket);
      await cleanupBucket(articleAssetBucket);

      const issueID = uniqueIssue();
      const promptKey = `prompts/reduce/${issueID}_direct.json`;
      const resultKey = `results/${issueID}_reduce.json`;

      await putJson(promptKey, {
        mode: "direct",
        prompt: "Summarize the speeches.",
      });

      const now = new Date().toISOString();
      await dynamoDoc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: issueID,
            status: "pending",
            llm: "gemini",
            llmModel: "gemini-pro",
            retryAttempts: 0,
            createdAt: now,
            updatedAt: now,
            processingMode: "direct",
            prompt_url: `s3://${bucket}/${promptKey}`,
            result_url: `s3://${bucket}/${resultKey}`,
            meeting: makeMeeting(issueID),
          },
        }),
      );

      generateContentMock.mockResolvedValueOnce({
        response: { text: () => JSON.stringify(buildArticle(issueID)) },
      });

      await handler();

      const stored = await getTask(tableName, issueID);
      expect(stored?.status).toBe("completed");

      const reduceOutput = await readObjectText(bucket, resultKey);
      expect(JSON.parse(reduceOutput).id).toBe(issueID);

      const articleItem = await getArticle(articleTableName, issueID);
      expect(articleItem?.title).toContain("Test Committee");
      expect(articleItem?.payload_url).toBe(`s3://${articleAssetBucket}/articles/${issueID}/payload.json`);
    } finally {
      // await cleanupTestRun(tableName);
    }
  });

  test("processes a chunked task, marks chunks ready, and writes reduce output", async () => {
    const bucket = process.env.PROMPT_BUCKET_NAME!;
    const articleAssetBucket = process.env.ARTICLE_ASSET_BUCKET_NAME ?? bucket;
    const tableName = process.env.LLM_TASK_TABLE!;
    const articleTableName = process.env.ARTICLE_TABLE_NAME!;
    
    try {
      await cleanupBucket(bucket);
      await cleanupBucket(articleAssetBucket);

      const issueID = uniqueIssue();
      const chunkPromptKey = `prompts/${issueID}_0-1.json`;
      const chunkResultKey = `results/${issueID}_0-1_result.json`;
      const reducePromptKey = `prompts/reduce/${issueID}.json`;
      const reduceResultKey = `results/${issueID}_reduce.json`;

      await putJson(chunkPromptKey, {
        mode: "chunk",
        prompt: "Chunk prompt body",
      });
      await putJson(reducePromptKey, {
        mode: "chunked",
        chunks: [chunkResultKey],
      });

      const now = new Date().toISOString();
      await dynamoDoc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: issueID,
            status: "pending",
            llm: "gemini",
            llmModel: "gemini-pro",
            retryAttempts: 0,
            createdAt: now,
            updatedAt: now,
            processingMode: "chunked",
            prompt_url: `s3://${bucket}/${reducePromptKey}`,
            result_url: `s3://${bucket}/${reduceResultKey}`,
            meeting: makeMeeting(issueID),
            chunks: [
              {
                id: "CHUNK#0",
                prompt_key: chunkPromptKey,
                prompt_url: `s3://${bucket}/${chunkPromptKey}`,
                result_url: `s3://${bucket}/${chunkResultKey}`,
                status: "notReady",
              },
            ],
          },
        }),
      );

      generateContentMock
        .mockResolvedValueOnce({ response: { text: () => '{"chunk":"ok"}' } })
        .mockResolvedValueOnce({ response: { text: () => JSON.stringify(buildArticle(issueID)) } });

      // First invocation handles a single chunk.
      await handler();
      const afterChunk = await getTask(tableName, issueID);
      expect(afterChunk?.status).toBe("pending");
      expect(afterChunk?.chunks?.[0]?.status).toBe("ready");
      const chunkOutput = await readObjectText(bucket, chunkResultKey);
      expect(chunkOutput).toContain('{"chunk":"ok"}');

      // Second invocation runs the reduce phase now that all chunks are ready.
      await handler();
      const stored = await getTask(tableName, issueID);
      expect(stored?.status).toBe("completed");

      const reduceOutput = await readObjectText(bucket, reduceResultKey);
      expect(JSON.parse(reduceOutput).id).toBe(issueID);

      const articleItem = await getArticle(articleTableName, issueID);
      expect(articleItem?.title).toContain("Test Committee");
      expect(articleItem?.payload_url).toBe(`s3://${articleAssetBucket}/articles/${issueID}/payload.json`);
    } finally {
      // await cleanupTestRun(tableName);
    }
  });

  async function waitForTable(tableName: string) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await dynamoClient.send(
        new DescribeTableCommand({ TableName: tableName }),
      );
      if (res.Table?.TableStatus === "ACTIVE") {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Table ${tableName} did not become ACTIVE`);
  }

  async function fetchTasksByIssue(tableName: string, issueID: string) {
    const res = await dynamoDoc.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: issueID },
      }),
    );
    return res.Item ?? null;
  }

  async function getArticle(tableName: string, issueID: string) {
    const res = await dynamoDoc.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `A#${issueID}`, SK: "META" },
      }),
    );
    return res.Item;
  }

  async function cleanupTestRun(taskTable: string) {
    await cleanupBucket(process.env.PROMPT_BUCKET_NAME!);
    if (process.env.ARTICLE_ASSET_BUCKET_NAME) {
      await cleanupBucket(process.env.ARTICLE_ASSET_BUCKET_NAME);
    }
    const articleTable = process.env.ARTICLE_TABLE_NAME!;
    // This is a simplistic cleanup. In a real scenario with many tests,
    // you might need a more robust way to track and clean up created items.
    const taskItems = await dynamoDoc.send(new ScanCommand({ TableName: taskTable, ProjectionExpression: "pk" }));
    if (taskItems.Items && taskItems.Items.length > 0) {
      await dynamoDoc.send(new BatchWriteCommand({ RequestItems: { [taskTable]: taskItems.Items.map(it => ({ DeleteRequest: { Key: { pk: it.pk } } })) } }));
    }
    const articleItems = await dynamoDoc.send(new ScanCommand({ TableName: articleTable, ProjectionExpression: "PK, SK" }));
    if (articleItems.Items && articleItems.Items.length > 0) {
      await dynamoDoc.send(new BatchWriteCommand({ RequestItems: { [articleTable]: articleItems.Items.map(it => ({ DeleteRequest: { Key: { PK: it.PK, SK: it.SK } } })) } }));
    }
  }

  async function cleanupBucket(bucket: string) {
    const listed = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket }),
    );
    if (!listed.Contents || listed.Contents.length === 0) return;

    await s3Client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: listed.Contents.map(obj => ({ Key: obj.Key! })),
        Quiet: true,
      }
    }));
  }

  async function putJson(key: string, value: unknown) {
    const bucket = process.env.PROMPT_BUCKET_NAME!;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
      }),
    );
  }

  async function getTask(tableName: string, issueID: string) {
    const res = await dynamoDoc.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: issueID },
      }),
    );
    return res.Item;
  }

  async function readObjectText(bucket: string, key: string): Promise<string> {
    const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return streamToString(res.Body as any);
  }

  function streamToString(stream: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }
});

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`.toLowerCase();
}

function uniqueIssue(): string {
  return `ISSUE-${Math.random().toString(36).slice(2, 10)}`;
}

function makeMeeting(issueID: string) {
  return {
    issueID,
    nameOfMeeting: "Test Committee",
    nameOfHouse: "House of Representatives",
    date: "2025-01-01",
    numberOfSpeeches: 1,
  };
}

function buildArticle(issueID: string) {
  return {
    id: issueID,
    title: "Test Committee Summary",
    date: "2025-01-01T00:00:00Z",
    month: "2025-01",
    imageKind: "会議録",
    session: 1,
    nameOfHouse: "House of Representatives",
    nameOfMeeting: "Test Committee",
    categories: ["test"],
    description: "Automated test article",
    summary: { based_on_orders: [1], summary: "要約" },
    soft_summary: { based_on_orders: [1], summary: "やわらか説明" },
    middle_summary: [{ based_on_orders: [1], summary: "main" }],
    dialogs: [{
      order: 1,
      summary: "Chairが開会宣言をした",
      soft_language: "委員長が落ちついて会議開始を伝えた",
      speaker: "Chair",
    }],
    participants: [{
      name: "Member A",
      position: "委員",
      summary: "議事について発言",
      based_on_orders: [1],
    }],
    keywords: [{ keyword: "test", priority: "high" }],
    terms: [{ term: "Term", definition: "説明" }],
  };
}
