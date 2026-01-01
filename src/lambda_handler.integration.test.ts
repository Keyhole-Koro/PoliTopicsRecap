import {
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { handler } from "./lambda_handler";
import {
  PROMPT_VERSION,
  reduce_prompt,
  chunk_prompt,
  buildTestReduceInput,
} from "./prompts.for.llmtest";
import { appConfig } from "./config";

const region = process.env.AWS_REGION ?? appConfig.aws.region;
const endpoint =
  process.env.LOCALSTACK_ENDPOINT_URL ??
  process.env.AWS_ENDPOINT_URL ??
  process.env.LOCALSTACK_URL ??
  process.env.LOCALSTACK_ENDPOINT ??
  "";
const credentials = appConfig.aws.credentials ?? {
  accessKeyId: "test",
  secretAccessKey: "test",
};

const shouldRunLocalstack = process.env.RUN_LOCALSTACK_TESTS === "true" && Boolean(endpoint);
const describeIfEndpoint = shouldRunLocalstack ? describe : describe.skip;

jest.setTimeout(120000);

const { GoogleGenerativeAI: googleGenerativeAiCtorMock } = jest.requireMock("@google/generative-ai") as {
  GoogleGenerativeAI: jest.Mock;
};

const generateContentMock = jest.fn();
const getGenerativeModelMock = jest.fn();

describeIfEndpoint("lambda_handler LocalStack integration", () => {
  if (!endpoint) {
    it("skipped because no LocalStack endpoint is configured", () => {
      expect(true).toBe(true);
    });
    return;
  }

  const s3Client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials,
  });
  const dynamoClient = new DynamoDBClient({
    region,
    endpoint,
    credentials,
  });
  const dynamoDoc = DynamoDBDocumentClient.from(dynamoClient, {
    marshallOptions: { removeUndefinedValues: true },
  });

  async function ensureBucketExists(bucket: string) {
    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
      if (err?.name !== "BucketAlreadyOwnedByYou" && err?.name !== "BucketAlreadyExists") {
        throw err;
      }
    }
  }

  beforeAll(async () => {
    const promptBucket = appConfig.promptBucketName;
    const articleAssetBucket = appConfig.articleAssetBucketName || promptBucket;
    await ensureBucketExists(promptBucket);
    await ensureBucketExists(articleAssetBucket);
  });

  afterAll(async () => {
    s3Client.destroy();
    dynamoClient.destroy();
  });

  beforeEach(() => {
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

  test("polling lambda_handler every minute eventually stores a recap in PoliTopics", async () => {
    const bucket = appConfig.promptBucketName;
    const articleAssetBucket = appConfig.articleAssetBucketName || bucket;
    const tableName = appConfig.taskTableName;
    const articleTableName = appConfig.articleTableName;

    await cleanupBucket(bucket);
    await cleanupBucket(articleAssetBucket);
    await cleanupTaskTable(tableName);
    await cleanupArticleTable(articleTableName);

    const issueID = uniqueIssue();
    const promptKey = `prompts/reduce/${issueID}_minute.txt`;
    const resultKey = `results/${issueID}_minute_reduce.json`;
    await putPrompt(promptKey, reduce_prompt(buildTestReduceInput(issueID)));
    const attachedAssetsUrl = await putAttachedAssets(issueID, [
      { order: 1, speaker: "Chair", originalText: "Original speech text" },
    ]);

    const createdAt = new Date().toISOString();
    const updatedAt = createdAt.slice(0, 10);
    await dynamoDoc.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: issueID,
          status: "pending",
          llm: "gemini",
          llmModel: "gemini-2.5-flash",
          retryAttempts: 0,
          createdAt,
          updatedAt,
          processingMode: "single_chunk",
          prompt_url: `s3://${bucket}/${promptKey}`,
          result_url: `s3://${bucket}/${resultKey}`,
          meeting: makeMeeting(issueID),
          attachedAssets: { speakerMetadataUrl: attachedAssetsUrl },
        },
      }),
    );

    generateContentMock.mockResolvedValueOnce({
      response: { text: () => JSON.stringify(buildReduceArticle(issueID)) },
    });

    for (let minute = 0; minute < 3; minute += 1) {
      await handler();
    }

    const stored = await getTask(tableName, issueID);
    expect(stored?.status).toBe("completed");

    const articleItem = await getArticle(articleTableName, issueID);
    expect(articleItem?.asset_url).toBe(`s3://${articleAssetBucket}/articles/${issueID}/asset.json`);
  });

  async function getTask(tableName: string, issueID: string) {
    const res = await dynamoDoc.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: issueID },
      }),
    );
    return res.Item;
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

  async function cleanupTaskTable(tableName: string) {
    const items = await scanAllItems(tableName);
    if (items.length === 0) return;
    await batchDelete(tableName, items.map((item) => ({ pk: item.pk })));
  }

  async function cleanupArticleTable(tableName: string) {
    const items = await scanAllItems(tableName);
    const keys = items
      .map((item) => ({ PK: item.PK, SK: item.SK }))
      .filter((key) => key.PK && key.SK);
    if (keys.length === 0) return;
    await batchDelete(tableName, keys);
  }

  async function scanAllItems(tableName: string) {
    const items: Record<string, any>[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const res = await dynamoDoc.send(
        new ScanCommand({
          TableName: tableName,
          ExclusiveStartKey: lastKey,
        }),
      );
      if (res.Items) {
        items.push(...res.Items);
      }
      lastKey = res.LastEvaluatedKey as Record<string, any> | undefined;
    } while (lastKey);
    return items;
  }

  async function batchDelete(tableName: string, keys: Record<string, any>[]) {
    const chunkSize = 25;
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      if (!chunk.length) continue;
      await dynamoDoc.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: chunk.map((key) => ({
              DeleteRequest: { Key: key },
            })),
          },
        }),
      );
    }
  }

  async function cleanupBucket(bucket: string) {
    const listed = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
      }),
    );
    if (!listed.Contents || listed.Contents.length === 0) return;
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: listed.Contents.map((obj) => ({ Key: obj.Key! })),
          Quiet: true,
        },
      }),
    );
  }

  async function putPrompt(key: string, body: string) {
    const bucket = appConfig.promptBucketName;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "text/plain; charset=utf-8",
      }),
    );
  }

  async function putAttachedAssets(issueID: string, speeches: any[]) {
    const bucket = appConfig.promptBucketName;
    const key = `attachedAssets/${issueID}.json`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify({ speeches }, null, 2),
        ContentType: "application/json; charset=utf-8",
      }),
    );
    return `s3://${bucket}/${key}`;
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

  test("chunked processing completes after sequential minute polls", async () => {
    const bucket = appConfig.promptBucketName;
    const articleAssetBucket = appConfig.articleAssetBucketName || bucket;
    const tableName = appConfig.taskTableName;
    const articleTableName = appConfig.articleTableName;

    await cleanupBucket(bucket);
    await cleanupBucket(articleAssetBucket);
    await cleanupTaskTable(tableName);
    await cleanupArticleTable(articleTableName);

    const issueID = uniqueIssue();
    const chunkDefinitions = [
      {
        id: "CHUNK#0",
        promptKey: `prompts/chunks/${issueID}_0.txt`,
        resultKey: `results/chunks/${issueID}_0.json`,
        promptBody: chunk_prompt(
          buildChunkInput(issueID, "前半", [
            "[order 1] 委員長が開会を宣言し、補正予算案の審議目的を確認。",
            "[order 2] 財務大臣が総額8兆円の補正案の概要を説明。",
            "[order 3] 野党議員が災害復旧費の執行遅延を指摘。",
          ]),
        ),
      },
      {
        id: "CHUNK#1",
        promptKey: `prompts/chunks/${issueID}_1.txt`,
        resultKey: `results/chunks/${issueID}_1.json`,
        promptBody: chunk_prompt(
          buildChunkInput(issueID, "後半", [
            "[order 4] 大臣が執行指針を3月末までに示すと回答。",
            "[order 5] 与党議員が利子補給制度の拡充を質問。",
            "[order 6] 経産省が金利補助率を引き上げる案を報告。",
            "[order 7] 複数委員が防災投資の長期計画を求めた。",
          ]),
        ),
      },
    ];

    for (const chunk of chunkDefinitions) {
      await putPrompt(chunk.promptKey, chunk.promptBody);
    }

    const reducePromptKey = `prompts/reduce/${issueID}_chunked.txt`;
    const reduceResultKey = `results/${issueID}_chunked_reduce.json`;
    await putPrompt(reducePromptKey, reduce_prompt(buildTestReduceInput(issueID)));
    const attachedAssetsUrl = await putAttachedAssets(issueID, [
      { order: 1, speaker: "Chair 1", originalText: "Chunk 1 text" },
      { order: 2, speaker: "Member 2", originalText: "Chunk 2 text" },
      { order: 3, speaker: "Member 3", originalText: "Chunk 3 text" },
      { order: 4, speaker: "Member 4", originalText: "Chunk 4 text" },
      { order: 5, speaker: "Member 5", originalText: "Chunk 5 text" },
      { order: 6, speaker: "Member 6", originalText: "Chunk 6 text" },
      { order: 7, speaker: "Member 7", originalText: "Chunk 7 text" },
    ]);

    const createdAt = new Date().toISOString();
    const updatedAt = createdAt.slice(0, 10);
    await dynamoDoc.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: issueID,
          status: "pending",
          llm: "gemini",
          llmModel: "gemini-2.5-flash",
          retryAttempts: 0,
          createdAt,
          updatedAt,
          processingMode: "chunked",
          prompt_url: `s3://${bucket}/${reducePromptKey}`,
          result_url: `s3://${bucket}/${reduceResultKey}`,
          meeting: makeMeeting(issueID),
          attachedAssets: { speakerMetadataUrl: attachedAssetsUrl },
          chunks: chunkDefinitions.map((chunk) => ({
            id: chunk.id,
            prompt_key: chunk.promptKey,
            prompt_url: `s3://${bucket}/${chunk.promptKey}`,
            result_url: `s3://${bucket}/${chunk.resultKey}`,
            status: "notReady",
          })),
        },
      }),
    );

    generateContentMock
      .mockResolvedValueOnce({
        response: { text: () => JSON.stringify(buildChunkOutput(issueID)) },
      })
      .mockResolvedValueOnce({
        response: { text: () => JSON.stringify(buildChunkOutput(issueID)) },
      })
      .mockResolvedValueOnce({
        response: { text: () => JSON.stringify(buildReduceArticle(issueID)) },
      });

    const minutePolls = chunkDefinitions.length + 2;
    for (let minute = 0; minute < minutePolls; minute += 1) {
      await handler();
    }

    const stored = await getTask(tableName, issueID);
    expect(stored?.status).toBe("completed");
    expect(stored?.chunks?.every((chunk: any) => chunk.status === "ready")).toBe(true);

    for (const chunk of chunkDefinitions) {
      const chunkOutput = JSON.parse(stripCodeFence(await readObjectText(bucket, chunk.resultKey)));
      expect(chunkOutput.id).toBe(issueID);
      expect(chunkOutput.prompt_version).toBe(PROMPT_VERSION);
    }

    const reduceOutput = JSON.parse(stripCodeFence(await readObjectText(bucket, reduceResultKey)));
    expect(reduceOutput.id).toBe(issueID);

    const articleItem = await getArticle(articleTableName, issueID);
    expect(articleItem?.asset_url).toBe(`s3://${articleAssetBucket}/articles/${issueID}/asset.json`);
  });

  function stripCodeFence(payload: string): string {
    const trimmed = payload.trim();
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    return trimmed;
  }
});

function uniqueIssue(): string {
  return `ISSUE-${Math.random().toString(36).slice(2, 10)}`;
}

function makeMeeting(issueID: string) {
  return {
    issueID,
    nameOfMeeting: "Test Committee",
    nameOfHouse: "House of Representatives",
    date: "2025-01-01",
    session: 1,
    numberOfSpeeches: 1,
  };
}

function buildChunkInput(issueID: string, label: string, orders: string[]): string {
  return `議事録ID: ${issueID}
chunk: ${label}

${orders.join("\n")}

[meta]
idは必ず ${issueID} を使用すること。`;
}

function buildChunkOutput(issueID: string) {
  return {
    prompt_version: PROMPT_VERSION,
    id: issueID,
    middle_summary: [{ based_on_orders: [1], summary: "chunk summary" }],
    soft_language_summary: { based_on_orders: [1], summary: "chunk soft summary" },
    summary: { based_on_orders: [1], summary: "chunk summary detail" },
    dialogs: [
      {
        order: 1,
        summary: "chunk dialog",
        soft_language: "chunk dialog soft",
        original_text: "chunkの原文っぽい感じだよ。",
      },
    ],
    participants: [{ name: "Member A", position: "委員", summary: "chunk participant" }],
    terms: [{ term: "Term", definition: "説明" }],
    keywords: [{ keyword: "budget", priority: "high" }],
  };
}

function buildReduceArticle(issueID: string) {
  return {
    prompt_version: PROMPT_VERSION,
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
    summary: { based_on_orders: [1], summary: "summary" },
    soft_language_summary: { based_on_orders: [1], summary: "soft summary" },
    middle_summary: [{ based_on_orders: [1], summary: "middle summary" }],
    dialogs: [
      {
        order: 1,
        summary: "Chairが開会宣言をした",
        soft_language: "委員長が落ちついて会議開始を伝えた",
        original_text: "委員長が開会を宣言して、これから始めるよって感じだったよ。",
        speaker: "Chair",
      },
    ],
    participants: [
      {
        name: "Member A",
        position: "委員",
        summary: "議事について発言",
        based_on_orders: [1],
      },
    ],
    keywords: [{ keyword: "test", priority: "high" }],
    terms: [{ term: "Term", definition: "説明" }],
  };
}
