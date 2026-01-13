import { PutObjectCommand, GetObjectCommand, S3Client, ListBucketsCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  PROMPT_VERSION,
  reduce_prompt,
  chunk_prompt,
  buildTestReduceInput,
} from "./prompts.for.llmtest";

// Mock Gemini to avoid real API calls; responses are queued per test.
jest.mock("@llm/geminiClient", () => {
  const responseQueue: string[] = [];
  return {
    GeminiClient: class {
      async generate() {
        if (responseQueue.length === 0) {
          throw new Error("No mock Gemini response queued");
        }
        const text = responseQueue.shift()!;
        return { text, raw: { mock: true } };
      }
    },
    __setGeminiResponses: (responses: string[]) => {
      responseQueue.splice(0, responseQueue.length, ...responses);
    },
  };
});

jest.setTimeout(120000);

const { GoogleGenerativeAI: googleGenerativeAiCtorMock } = jest.requireMock("@google/generative-ai") as {
  GoogleGenerativeAI: jest.Mock;
};
const { __setGeminiResponses } = jest.requireMock("@llm/geminiClient") as {
  __setGeminiResponses: (responses: string[]) => void;
};

const generateContentMock = jest.fn();
const getGenerativeModelMock = jest.fn();

/*
 * polling lambda_handler every minute eventually stores a recap in PoliTopics
 * [Contract] Minute-based polls must move a pending single_chunk task to completed and persist article metadata/asset_url.
 * [Reason] Mirrors scheduled poller behavior to ensure recaps appear after periodic runs.
 * [Accident] Without this, cron-style execution could loop forever without publishing recaps.
 * [Odd] Uses three handler invocations with `_minute` prompt/result keys and mocked Gemini reduce JSON.
 * [History] No known bug; regression guardrail.
 *
 * chunked processing completes after sequential minute polls
 * [Contract] Chunked tasks must advance to ready chunks, write chunk outputs, then reduce into a completed article after enough polls.
 * [Reason] Validates chunk progression when driven by scheduled polling rather than a single run.
 * [Accident] Without this, chunked recaps could linger pending and never emit reduce output.
 * [Odd] Two chunk prompts assert PROMPT_VERSION and use stripCodeFence to handle fenced LLM replies; minutePolls=chunkCount+2.
 * [History] No known bug; preventive coverage.
 */

describe("lambda_handler LocalStack integration", () => {
  const { appConfig } = require("./config") as typeof import("./config");
  const { handler } = require("./lambda_handler") as typeof import("./lambda_handler");

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

describe("lambda_handler LocalStack integration", () => {
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

  const toSafeError = (err: any, context: string) => {
    const parts = [context];
    const code = err?.name || err?.code;
    if (code) parts.push(String(code));
    if (err?.message) parts.push(String(err.message));
    const status = err?.$metadata?.httpStatusCode;
    if (status) parts.push(`status=${status}`);
    const host = err?.hostname || err?.address;
    if (host) parts.push(`host=${host}`);
    return new Error(parts.join(" | "));
  };

  const safeS3Send = async (command: any, context: string): Promise<any> => {
    try {
      return await s3Client.send(command);
    } catch (err: any) {
      throw toSafeError(err, context);
    }
  };

  const safeDynamoSend = async (command: any, context: string): Promise<any> => {
    try {
      return await dynamoDoc.send(command);
    } catch (err: any) {
      throw toSafeError(err, context);
    }
  };

  const assertBucketExists = async (bucket: string) => {
    await safeS3Send(new HeadBucketCommand({ Bucket: bucket }), `HeadBucket ${bucket}`);
  };

  const assertTableExists = async (tableName: string) => {
    await safeDynamoSend(new DescribeTableCommand({ TableName: tableName }), `DescribeTable ${tableName}`);
  };

  beforeAll(async () => {
    try {
      await safeS3Send(new ListBucketsCommand({}), "ListBuckets");
      await assertBucketExists(appConfig.promptBucketName);
      await assertBucketExists(appConfig.articleAssetBucketName || appConfig.promptBucketName);
      await assertTableExists(appConfig.taskTableName);
      await assertTableExists(appConfig.articleTableName);
    } catch (err: any) {
      throw err;
    }
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
      __setGeminiResponses([]);
    });

    test("polling lambda_handler every minute eventually stores a recap in PoliTopics", async () => {
      const bucket = appConfig.promptBucketName;
      const articleAssetBucket = appConfig.articleAssetBucketName || bucket;
      const tableName = appConfig.taskTableName;
      const articleTableName = appConfig.articleTableName;

      const issueID = uniqueIssue();
      const promptKey = `prompts/reduce/${issueID}_minute.txt`;
      const resultKey = `results/${issueID}_minute_reduce.json`;
      await putPrompt(promptKey, reduce_prompt(buildTestReduceInput(issueID)));
      const attachedAssetsUrl = await putAttachedAssets(issueID, [
        { order: 1, speaker: "Chair", originalText: "Original speech text" },
      ]);

      const createdAt = new Date(0).toISOString();
      const updatedAt = createdAt.slice(0, 10);
      await safeDynamoSend(
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
        `Put pending task ${issueID}`,
      );

      __setGeminiResponses([JSON.stringify(buildReduceArticle(issueID))]);

      for (let minute = 0; minute < 3; minute += 1) {
        await handler();
      }

      const stored = await getTask(tableName, issueID);
      expect(stored).toBeDefined();
      expect(stored?.status).toBe("completed");

      const articleItem = await getArticle(articleTableName, issueID);
      expect(articleItem?.asset_url).toBe(`s3://${articleAssetBucket}/articles/${issueID}/asset.json`);
    });

    test("chunked processing completes after sequential minute polls", async () => {
      const bucket = appConfig.promptBucketName;
      const articleAssetBucket = appConfig.articleAssetBucketName || bucket;
      const tableName = appConfig.taskTableName;
      const articleTableName = appConfig.articleTableName;

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

      const createdAt = new Date(0).toISOString();
      const updatedAt = createdAt.slice(0, 10);
      await safeDynamoSend(
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
        `Put chunked task ${issueID}`,
      );

      __setGeminiResponses([
        JSON.stringify(buildChunkOutput(issueID)),
        JSON.stringify(buildChunkOutput(issueID)),
        JSON.stringify(buildReduceArticle(issueID)),
      ]);

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

    async function putPrompt(key: string, body: string) {
      const bucket = appConfig.promptBucketName;
      await safeS3Send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: "text/plain; charset=utf-8",
        }),
        `PutObject ${bucket}/${key}`,
      );
    }

    async function putAttachedAssets(issueID: string, speeches: any[]) {
      const bucket = appConfig.promptBucketName;
      const key = `attachedAssets/${issueID}.json`;
      await safeS3Send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: JSON.stringify({ speeches }, null, 2),
          ContentType: "application/json; charset=utf-8",
        }),
        `PutObject ${bucket}/${key}`,
      );
      return `s3://${bucket}/${key}`;
    }

    async function readObjectText(bucket: string, key: string): Promise<string> {
      const res = await safeS3Send(new GetObjectCommand({ Bucket: bucket, Key: key }), `GetObject ${bucket}/${key}`);
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

    async function getTask(tableName: string, issueID: string) {
      const res = await safeDynamoSend(
        new GetCommand({
          TableName: tableName,
          Key: { pk: issueID },
        }),
        `GetTask ${issueID}`,
      );
      return res.Item;
    }

    async function getArticle(tableName: string, issueID: string) {
      const res = await safeDynamoSend(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `A#${issueID}`, SK: "META" },
        }),
        `GetArticle ${issueID}`,
      );
      return res.Item;
    }

    function stripCodeFence(payload: string): string {
      const trimmed = payload.trim();
      const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
      if (match && match[1]) {
        return match[1].trim();
      }
      return trimmed;
    }

    // No wrapping; allow raw errors to surface for debugging.
  });
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
