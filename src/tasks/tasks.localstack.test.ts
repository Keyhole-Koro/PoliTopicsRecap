import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

process.env.GEMINI_API_KEY ??= "dummy-gemini-key";
process.env.DISCORD_WEBHOOK_ERROR ??= "https://discord.invalid/error";
process.env.DISCORD_WEBHOOK_WARN ??= "https://discord.invalid/warn";
process.env.DISCORD_WEBHOOK_BATCH ??= "https://discord.invalid/batch";
process.env.DISCORD_WEBHOOK_ACCESS ??= "https://discord.invalid/access";
process.env.APP_ENVIRONMENT ??= "localstackTest";

jest.mock("@google/generative-ai");

const { GoogleGenerativeAI: googleGenerativeAiCtorMock } = jest.requireMock("@google/generative-ai") as {
  GoogleGenerativeAI: jest.Mock;
};

const generateContentMock = jest.fn();
const getGenerativeModelMock = jest.fn();

/*
 * processes a single_chunk task, stores reduce result, and marks it completed
 * [Contract] Pending single_chunk tasks must invoke Gemini, write reduce output, persist article/meta, and finish with status=completed.
 * [Reason] Single-chunk meetings skip chunk orchestration but still need recap persistence.
 * [Accident] Without this, single-chunk tasks could stay pending or miss asset writes and drop articles.
 * [Odd] Uses Japanese speaker fixtures and updatedAt truncated to YYYY-MM-DD to mimic real data; S3 keys live under prompts/reduce/results.
 * [History] No recorded incident; regression guardrail.
 *
 * processes a chunked task, marks chunks ready, and writes reduce output
 * [Contract] Chunked tasks must progress notReady→ready→completed across handler invocations and emit reduce output plus article assets.
 * [Reason] Normal long-meeting flow depends on chunk readiness before reduce.
 * [Accident] Without this, chunked tasks could stall pending and never publish recaps.
 * [Odd] Single CHUNK#0 definition with sequential handler calls and mocked Gemini responses for chunk then reduce.
 * [History] No recorded incident; preventive coverage.
 */

describe("PoliTopics task consumer (LocalStack)", () => {
  const { handler } = require("../lambda_handler") as typeof import("../lambda_handler");
  const { appConfig } = require("../config") as typeof import("../config");

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

  const endpointValue = endpoint || "http://localhost:4566";

  describe("with LocalStack", () => {
    const s3Client = new S3Client({
      region,
      endpoint: endpointValue,
      forcePathStyle: true,
      credentials,
    });
    const dynamoClient = new DynamoDBClient({
      region,
      endpoint: endpointValue,
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
      const promptBucket = appConfig.promptBucketName;
      const articleAssetBucket = appConfig.articleAssetBucketName || promptBucket;
      await safeS3Send(new ListBucketsCommand({}), "ListBuckets");
      await assertBucketExists(promptBucket);
      await assertBucketExists(articleAssetBucket);
      await assertTableExists(appConfig.taskTableName);
      await assertTableExists(appConfig.articleTableName);
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

    test("processes a single_chunk task, stores reduce result, and marks it completed", async () => {
      const bucket = appConfig.promptBucketName;
      const articleAssetBucket = appConfig.articleAssetBucketName || bucket;
      const tableName = appConfig.taskTableName;
      const articleTableName = appConfig.articleTableName;
      const issueID = uniqueIssue();
      const promptKey = `prompts/reduce/${issueID}_minute.txt`;
      const resultKey = `results/${issueID}_minute_reduce.json`;
      const attachedKey = `attachedAssets/${issueID}.json`;

      try {
        await putPrompt(promptKey, "Summarize the speeches.");
        await putJson(attachedKey, {
          speeches: [
            {
              order: 1,
              speaker: "架空太郎",
              speakerYomi: "かくうたろう",
              speakerGroup: "架空党・無所属",
              speakerPosition: null,
              originalText: "Original text 1",
            },
          ],
        });

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
              attachedAssets: { speakerMetadataUrl: `s3://${bucket}/${attachedKey}` },
            },
          }),
          `Put pending task ${issueID}`,
        );

        generateContentMock.mockResolvedValueOnce({
          response: { text: () => JSON.stringify(buildArticle(issueID)) },
        });

        await handler();

        const stored = await getTask(tableName, issueID);
        expect(stored?.status).toBe("completed");

        const reduceOutput = await readObjectText(bucket, resultKey);
        console.log("Reduce output:", reduceOutput);
        expect(JSON.parse(reduceOutput).id).toBe(issueID);

        const articleItem = await getArticle(articleTableName, issueID);
        expect(articleItem?.title).toContain("Test Committee");
        expect(articleItem?.asset_url).toBe(`s3://${articleAssetBucket}/articles/${issueID}/asset.json`);

        const asset = await readArticleAsset(articleItem?.asset_url);
        expect(asset?.dialogs?.[0]?.speaker).toBe("架空太郎");
        expect(asset?.dialogs?.[0]?.speakerYomi).toBe("かくうたろう");
        expect(asset?.dialogs?.[0]?.speakerGroup).toBe("架空党・無所属");
        expect(asset?.dialogs?.[0]?.speakerPosition).toBeUndefined();
      } finally {
        await deleteKeys(bucket, [promptKey, resultKey, attachedKey]);
        await deleteTask(tableName, issueID);
      }
    });

    test("processes a chunked task, marks chunks ready, and writes reduce output", async () => {
      const bucket = appConfig.promptBucketName;
      const articleAssetBucket = appConfig.articleAssetBucketName || bucket;
      const tableName = appConfig.taskTableName;
      const articleTableName = appConfig.articleTableName;
      const issueID = uniqueIssue();
      const chunkDefinition = {
        id: "CHUNK#0",
        promptKey: `prompts/chunks/${issueID}_0.txt`,
        resultKey: `results/chunks/${issueID}_0.json`,
        promptBody: [
          "[order 1] 内閣府が防災予算の増額を報告。",
          "[order 2] 委員が進捗管理の仕組みを質問。",
          "[order 3] 大臣が年度内に指針を示すと回答。",
        ].join("\n"),
      };
      const reducePromptKey = `prompts/reduce/${issueID}_chunked.txt`;
      const reduceResultKey = `results/${issueID}_chunked_reduce.json`;
      const attachedKey = `attachedAssets/${issueID}.json`;

      try {
        await putPrompt(chunkDefinition.promptKey, chunkDefinition.promptBody);

        await putPrompt(reducePromptKey, "Reduce chunked outputs.");
        await putJson(attachedKey, {
          speeches: [
            {
              order: 1,
              speaker: "架空花子",
              speakerYomi: "かくうはなこ",
              speakerGroup: "架空党",
              speakerPosition: null,
              originalText: "Original text chunked",
            },
          ],
        });

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
              attachedAssets: { speakerMetadataUrl: `s3://${bucket}/${attachedKey}` },
              chunks: [
                {
                  id: chunkDefinition.id,
                  prompt_key: chunkDefinition.promptKey,
                  prompt_url: `s3://${bucket}/${chunkDefinition.promptKey}`,
                  result_url: `s3://${bucket}/${chunkDefinition.resultKey}`,
                  status: "notReady",
                },
              ],
            },
          }),
          `Put chunked task ${issueID}`,
        );

        generateContentMock
          .mockResolvedValueOnce({
            response: { text: () => JSON.stringify(buildChunkOutput(issueID)) },
          })
          .mockResolvedValueOnce({
            response: { text: () => JSON.stringify(buildReduceOutput(issueID)) },
          });

        await handler(); // process chunk
        await handler(); // process reduce

        const stored = await getTask(tableName, issueID);
        expect(stored?.status).toBe("completed");
        const chunkStatuses = stored?.chunks?.map((c: any) => c.status) ?? [];
        expect(chunkStatuses.every((status: string) => status === "ready")).toBe(true);

        const reduceOutput = await readObjectText(bucket, reduceResultKey);
        expect(JSON.parse(reduceOutput).id).toBe(issueID);

        const articleItem = await getArticle(articleTableName, issueID);
        expect(articleItem?.asset_url).toBe(`s3://${articleAssetBucket}/articles/${issueID}/asset.json`);
      } finally {
        await deleteKeys(bucket, [
          chunkDefinition.promptKey,
          chunkDefinition.resultKey,
          reducePromptKey,
          reduceResultKey,
          attachedKey,
        ]);
        await deleteTask(tableName, issueID);
      }
    });

    async function putJson(key: string, data: unknown) {
      const bucket = appConfig.promptBucketName;
      await safeS3Send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: JSON.stringify(data, null, 2),
          ContentType: "application/json; charset=utf-8",
        }),
        `PutObject ${bucket}/${key}`,
      );
    }

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

    async function deleteKeys(bucket: string, keys: string[]) {
      if (keys.length === 0) return;
      await safeS3Send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: true },
        }),
        `DeleteObjects ${bucket}`,
      );
    }

    async function readObjectText(bucket: string, key: string): Promise<string> {
      const res = await safeS3Send(new GetObjectCommand({ Bucket: bucket, Key: key }), `GetObject ${bucket}/${key}`);
      return streamToString(res.Body as any);
    }

    async function readArticleAsset(assetUrl?: string) {
      if (!assetUrl) return undefined;
      const parsed = new URL(assetUrl);
      const bucket = parsed.hostname.split(".")[0];
      const key = parsed.pathname.replace(/^\/+/, "");
      const text = await readObjectText(bucket, key);
      return JSON.parse(text);
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

    async function deleteTask(tableName: string, issueID: string) {
      await safeDynamoSend(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: issueID },
        }),
        `DeleteTask ${issueID}`,
      );
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

    function streamToString(stream: any): Promise<string> {
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
    }

    function makeMeeting(issueID: string) {
      return {
        issueID,
        nameOfMeeting: "テスト委員会",
        nameOfHouse: "衆議院",
        date: "2025-01-01",
        session: 1,
        numberOfSpeeches: 1,
      };
    }

    function uniqueIssue(): string {
      return `ISSUE-${Math.random().toString(36).slice(2, 10)}`;
    }

    function buildArticle(issueID: string) {
      return {
        prompt_version: "v1",
        id: issueID,
        title: "Test Committee Recap",
        date: "2025-01-01T00:00:00Z",
        month: "2025-01",
        imageKind: "会議録",
        session: 1,
        nameOfHouse: "衆議院",
        nameOfMeeting: "テスト委員会",
        categories: ["test"],
        description: "Test article",
        summary: { based_on_orders: [1], summary: "summary" },
        soft_language_summary: { based_on_orders: [1], summary: "soft summary" },
        middle_summary: [{ based_on_orders: [1], summary: "middle summary" }],
        dialogs: [
          {
            order: 1,
            summary: "委員長が開会を宣言",
            soft_language: "委員長が穏やかに開始を伝えた",
            original_text: "委員長が開会を宣言した原文",
            speaker: "架空太郎",
            speakerYomi: "かくうたろう",
            speakerGroup: "架空党・無所属",
          },
        ],
        participants: [
          { name: "架空太郎", position: "委員", summary: "質問を行った", based_on_orders: [1] },
        ],
        keywords: [{ keyword: "test", priority: "high" }],
        terms: [{ term: "用語", definition: "説明" }],
      };
    }

    function buildChunkOutput(issueID: string) {
      return {
        prompt_version: "v1",
        id: issueID,
        middle_summary: [{ based_on_orders: [1], summary: "chunk summary" }],
        soft_language_summary: { based_on_orders: [1], summary: "chunk soft summary" },
        summary: { based_on_orders: [1], summary: "chunk summary detail" },
        dialogs: [
          {
            order: 1,
            summary: "chunk dialog",
            soft_language: "chunk dialog soft",
            original_text: "chunk original text",
          },
        ],
        participants: [{ name: "Member A", position: "委員", summary: "chunk participant" }],
        terms: [{ term: "Term", definition: "説明" }],
        keywords: [{ keyword: "chunk", priority: "high" }],
      };
    }

    function buildReduceOutput(issueID: string) {
      return {
        prompt_version: "v1",
        id: issueID,
        title: "Chunked Reduce Result",
        date: "2025-01-01T00:00:00Z",
        month: "2025-01",
        imageKind: "会議録",
        session: 1,
        nameOfHouse: "衆議院",
        nameOfMeeting: "テスト委員会",
        categories: ["chunked"],
        description: "Reduce output",
        summary: { based_on_orders: [1], summary: "reduce summary" },
        soft_language_summary: { based_on_orders: [1], summary: "reduce soft summary" },
        middle_summary: [{ based_on_orders: [1], summary: "reduce middle summary" }],
        dialogs: [
          {
            order: 1,
            summary: "reduce dialog",
            soft_language: "reduce dialog soft",
            original_text: "reduce original",
            speaker: "架空花子",
          },
        ],
        participants: [{ name: "架空花子", position: "委員", summary: "回答", based_on_orders: [1] }],
        keywords: [{ keyword: "reduce", priority: "high" }],
        terms: [{ term: "Term", definition: "説明" }],
      };
    }
  });
});
