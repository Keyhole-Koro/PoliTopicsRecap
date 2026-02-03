import type { S3Client } from "@aws-sdk/client-s3";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { appConfig } from "../config";
import { uploadJson, parseS3Uri, fetchJsonObject } from "@utils/s3";
import { countTokens } from "@llm/tokenCounter";
import { buildOrderLenByTokens, packIndexSets } from "@utils/packing";
import type { RawMeetingPayload, RawMeetingRecord, RawSpeechRecord } from "../types/rawMeeting";
import type { TaskItem, ChunkItem, ProcessingMode, TaskStatus } from "../tasks/types";
import { chunk_prompt, reduce_prompt, single_chunk_prompt, PROMPT_VERSION } from "../prompts/prompts";
import { formatSpeechLine } from "../prompts/promptInput";
import { updateTaskForPrompt, type TaskRepositoryConfig } from "../tasks/taskRepository";

let cachedPromptTokenCost: number | null = null;

type PreparationArgs = {
  task: TaskItem;
  s3Client: S3Client;
  docClient: DynamoDBDocumentClient;
  status: TaskStatus;
  repoConfig: TaskRepositoryConfig;
  maxInputToken?: number;
  retryAttempts?: number;
};

export async function prepareTaskFromRaw(args: PreparationArgs): Promise<TaskItem> {
  const { task, s3Client, docClient, status, repoConfig } = args;
  if (!task.raw_url) {
    throw new Error(`Task ${task.pk} missing raw_url; cannot prepare prompts`);
  }

  const payload = await readRawPayload(s3Client, task.raw_url);
  const meeting = payload.meeting;
  const speeches = normalizeSpeechArray(meeting.speechRecord);
  if (speeches.length === 0) {
    throw new Error(`Raw payload for ${task.pk} has no speeches`);
  }

  const chunkPromptTemplate = chunk_prompt("");
  const reducePromptTemplate = reduce_prompt("");
  const singleChunkPromptTemplate = single_chunk_prompt("");

  const maxInputToken = args.maxInputToken ?? appConfig.geminiMaxInputToken;
  const promptTokenCost = await getPromptTokenCost(chunkPromptTemplate);
  const availableTokens = maxInputToken - promptTokenCost;
  if (availableTokens <= 0) {
    throw new Error("Chunk prompt exceeds available token budget");
  }

  const orderLens = await buildOrderLenByTokens({
    speeches,
    countFn: countTokens,
    buildText: (speech) => formatSpeechLine(speech) ?? "",
  });
  const packs = packIndexSets(orderLens, availableTokens);
  if (!packs.length) {
    throw new Error(`Unable to create chunk packs within token budget for ${task.pk}`);
  }

  const meetingInfo = task.meeting ?? buildMeetingInfo(meeting, speeches.length);
  const range = {
    from: meetingInfo.date,
    until: meetingInfo.date,
  };

  const promptBucket = appConfig.promptBucketName;
  const reducePromptKeyBase = `prompts/reduce/${task.pk}`;
  const singleChunkMode = packs.length === 1 && !packs[0].oversized;

  let promptUrl = "";
  let resultUrl = "";
  let processingMode: ProcessingMode = "single_chunk";
  let chunks: ChunkItem[] = [];

  if (singleChunkMode) {
    const pack = packs[0];
    const chunkSpeeches = pack.indices.map((idx) => speeches[idx]).filter(Boolean);
    const singleChunkPromptKey = `${reducePromptKeyBase}_direct.json`;
    const payloadBody = {
      mode: "single_chunk",
      singleChunkPromptTemplate,
      meeting: meetingInfo,
      range,
      packIndices: pack.indices,
      speechIds: pack.speech_ids,
      speeches: chunkSpeeches,
      runId: "",
    };
    await uploadJson({
      client: s3Client,
      bucket: promptBucket,
      key: singleChunkPromptKey,
      data: payloadBody,
      opts: { pretty: true },
    });
    promptUrl = `s3://${promptBucket}/${singleChunkPromptKey}`;
    resultUrl = `s3://${promptBucket}/results/${task.pk}_reduce.json`;
    processingMode = "single_chunk";
    chunks = [];
  } else {
    const CONTEXT_WINDOW = 2;
    processingMode = "chunked";
    chunks = [];
    for (const pack of packs) {
      const chunkSpeeches = pack.indices.map((idx) => speeches[idx]).filter(Boolean);
      const firstIndex = Math.min(...pack.indices);
      const lastIndex = Math.max(...pack.indices);
      const contextBefore =
        Number.isFinite(firstIndex)
          ? speeches.slice(Math.max(0, firstIndex - CONTEXT_WINDOW), firstIndex)
          : [];
      const contextAfter =
        Number.isFinite(lastIndex)
          ? speeches.slice(lastIndex + 1, lastIndex + 1 + CONTEXT_WINDOW)
          : [];
      const s3key = `prompts/${task.pk}_${pack.indices.join("-")}.json`;
      const resultKey = `results/${task.pk}_${pack.indices.join("-")}_result.json`;
      await uploadJson({
        client: s3Client,
        bucket: promptBucket,
        key: s3key,
        data: {
          prompt: chunkPromptTemplate,
          meeting: meetingInfo,
          speeches: chunkSpeeches,
          contextBefore,
          contextAfter,
          speechIds: pack.speech_ids,
          indices: pack.indices,
        },
        opts: { pretty: true },
      });
      chunks.push({
        id: `CHUNK#${chunks.length}`,
        prompt_key: s3key,
        prompt_url: `s3://${promptBucket}/${s3key}`,
        result_url: `s3://${promptBucket}/${resultKey}`,
        status: "notReady",
      });
    }

    const reducePromptKey = `${reducePromptKeyBase}.json`;
    await uploadJson({
      client: s3Client,
      bucket: promptBucket,
      key: reducePromptKey,
      data: {
        mode: "chunked",
        reducePromptTemplate,
        meeting: meetingInfo,
        range,
        chunks,
        chunkResultUrls: chunks.map((chunk) => chunk.result_url),
        runId: "",
      },
      opts: { pretty: true },
    });

    promptUrl = `s3://${promptBucket}/${reducePromptKey}`;
    resultUrl = `s3://${promptBucket}/results/${task.pk}_reduce.json`;
  }

  const now = new Date().toISOString();
  const llmModel = appConfig.geminiModel;
  const retryAttempts = status === "remake"
    ? 0
    : (args.retryAttempts ?? task.retryAttempts ?? 0);
  const next: TaskItem = {
    ...task,
    status,
    llm: "gemini",
    llmModel,
    retryAttempts,
    updatedAt: now,
    processingMode,
    prompt_version: PROMPT_VERSION,
    prompt_url: promptUrl,
    result_url: resultUrl,
    chunks,
    maxInputToken,
  };

  await updateTaskForPrompt(docClient, repoConfig, task.pk, {
    status,
    llm: "gemini",
    llmModel,
    retryAttempts,
    updatedAt: now,
    processingMode,
    prompt_version: PROMPT_VERSION,
    prompt_url: promptUrl,
    result_url: resultUrl,
    chunks,
    maxInputToken,
  });

  return next;
}

async function readRawPayload(client: S3Client, uri: string): Promise<RawMeetingPayload> {
  const { bucket, key } = parseS3Uri(uri);
  return fetchJsonObject<RawMeetingPayload>(client, bucket, key);
}

function normalizeSpeechArray(value: RawMeetingRecord["speechRecord"] | RawSpeechRecord[] | RawSpeechRecord | undefined): RawSpeechRecord[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function buildMeetingInfo(meeting: RawMeetingRecord, numberOfSpeeches: number) {
  return {
    issueID: meeting.issueID,
    nameOfMeeting: meeting.nameOfMeeting ?? "",
    nameOfHouse: meeting.nameOfHouse ?? "",
    date: meeting.date ?? "",
    numberOfSpeeches,
    session: meeting.session ?? 0,
  };
}

async function getPromptTokenCost(promptText: string): Promise<number> {
  if (cachedPromptTokenCost !== null) return cachedPromptTokenCost;
  cachedPromptTokenCost = await countTokens(promptText);
  return cachedPromptTokenCost;
}
