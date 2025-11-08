/**
 * Scalability Note — Schema-on-Queue validation
 * ---------------------------------------------
 * To improve prompt scalability and keep workers simple, we let the SQS message
 * carry the authoritative Article schema (or a reference to it) and validate
 * before any LLM/DynamoDB work.
 *
 * Why this helps
 * --------------
 * - Early rejection: malformed or incompatible payloads fail fast, saving LLM/DDB.
 * - Contract-first: producers and consumers share an explicit, versioned schema.
 * - Decoupling: multiple reducers/consumers can evolve independently across languages.
 * - Safer evolution: schema versioning + compatibility rules enable gradual rollout.
 *
 * How to implement
 * ----------------
 * 1) Include schema metadata in the SQS body:
 *    {
 *      "schemaVersion": "2025-10-01",
 *      "schemaRef": "s3://schemas/article/2025-10-01.json", // or inline "schema"
 *      "articleContract": { ... optional partial/article defaults ... },
 *      "chunk_result_urls": [ ... ],
 *      ...
 *    }
 *
 * 2) At the very start of `processReduceRecord`:
 *    - Resolve the JSON Schema (inline or fetch from S3 via `schemaRef`).
 *    - Validate BOTH:
 *        a) `message` envelope (required fields like meeting, chunk_result_urls, retryMs_in)
 *        b) the final Article shape we will persist (pre-validate using LLM defaults if needed)
 *    - If validation fails → log reason, NACK or requeue with backoff; consider DLQ on repeated failures.
 *
 * 3) Versioning & compatibility:
 *    - Use date-stamped semantic versions (e.g., "2025-10-01") and keep N previous versions in S3.
 *    - Producers set `schemaVersion`; consumers support a compatibility matrix:
 *        - Non-breaking changes: new optional fields → ACCEPT.
 *        - Breaking changes: increment version; roll out consumers before producers.
 *
 * 4) Validation strategy:
 *    - Validate chunk JSONs individually if they have their own mini-schemas
 *      (e.g., `ChunkJson` with `middleSummary`, `participants`, etc.).
 *    - After LLM returns, validate the merged `Article` again before DynamoDB persist.
 *    - Reject obviously unsafe/oversized fields (e.g., overly long `summary`) to prevent hot partitions.
 *
 * 5) Operational considerations:
 *    - Cache schemas (ETag-based) to avoid S3 hot reads; fall back to last-known-good on transient errors.
 *    - Emit structured validation errors with `issueID`, `schemaVersion`, and field paths for observability.
 *    - Route hard validation failures to DLQ for manual inspection; keep transient fetch errors on retry path.
 *
 * Minimal example (message shape)
 * ------------------------------
 * {
 *   "schemaVersion": "2025-10-01",
 *   "schemaRef": "s3://schemas/article/2025-10-01.json",
 *   "meeting": { "issueID": "xxx", "nameOfHouse": "...", "nameOfMeeting": "...", "date": "YYYY-MM-DD", "session": "..." },
 *   "chunk_result_urls": ["s3://.../chunk1.json", "s3://.../chunk2.json"],
 *   "prompt": "Reduce these chunks into an Article...",
 *   "retryMs_in": 120,
 *   "articleContract": { "imageKind": "会議録", "categories": [] } // optional defaults/constraints
 * }
 */



import type { S3Client } from '@aws-sdk/client-s3';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { SQSRecord } from 'aws-lambda';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import type { ReducePromptTaskMessage } from '@sqs/reduce';
import type Article from '@dynamoDB/article';

import { ensureObjectExists, fetchJsonObject, parseS3Uri } from '@utils/s3';
import { deleteMessage, requeueWithDelay } from './sqsActions';
import { LlmClient } from '@llm/llmClient';
import storeData from 'src/dynamoDB/storeData';
// ===== Types =====

export interface ProcessReduceRecordArgs {
  message: ReducePromptTaskMessage;
  record: SQSRecord;
  queueUrl: string;
  sqsClient: SQSClient;
  s3Client: S3Client;
  llmClient: LlmClient;
}

type ChunkJson = {
  middleSummary?: string;
  participants?: unknown[];
  dialogs?: string[];
  terms?: string[];
  keywords?: string[];
  // additional fields are allowed
};

// ===== Public entrypoint =====

export async function processReduceRecord({
  message,
  record,
  queueUrl,
  sqsClient,
  s3Client,
  llmClient,
}: ProcessReduceRecordArgs): Promise<void> {
  try {
    const docClient = createDocClient();

    // 1) Verify prerequisites (all S3 objects exist)
    const referencedUris = Array.from(new Set(message.chunk_result_urls));
    const missingSources = await findMissingObjects(s3Client, referencedUris);
    if (missingSources.length > 0) {
      await handleMissingPrerequisites({
        sqsClient,
        queueUrl,
        record,
        message,
        missingSources,
      });
      return;
    }

    // 2) Load chunk JSONs from S3
    const chunkResults = await loadChunkResults(s3Client, referencedUris);

    // 3) Build prompt for LLM
    const combinedPrompt = buildReducePrompt(message, chunkResults);

    logReadyForLLM({
      record,
      message,
      promptLength: combinedPrompt.length,
    });

    // 4) Call LLM
    const llmText = await callLLM(llmClient, combinedPrompt);

    // 5) Safely parse LLM JSON and merge flattened arrays from chunks
    const extras = {
      dialogs: collectArrayFieldTyped<Article['dialogs'][number]>(chunkResults, "dialogs"),
      terms: collectArrayFieldTyped<Article['terms'][number]>(chunkResults, "terms"),
      keywords: collectArrayFieldTyped<Article['keywords'][number]>(chunkResults, "keywords"),
      participants: collectArrayFieldTyped<Article['participants'][number]>(chunkResults, "participants"),
    };

    // Parse JSON as Partial<Article>
    const base = parseLLMJson<Article>(llmText);

    // Build a validated, complete Article (will merge base + extras and validate required fields)
    const article = buildArticle(base, extras, message);

    // 6) Persist to DynamoDB
    await persistArticle(docClient, 'politopics', article);

    // 7) Remove SQS message
    await deleteMessage({ sqsClient, queueUrl, receiptHandle: record.receiptHandle });

    // TODO: remove temporary S3 objects in a follow-up step

  } catch (err) {
    console.error('Reduce processing failed; rescheduling', {
      messageId: record.messageId,
      error: err,
    });
    await requeueWithDelay({
      sqsClient,
      queueUrl,
      record,
      message,
      delaySeconds: message.retryMs_in,
    });
  }
}

// ===== Helpers =====

function createDocClient(): DynamoDBDocumentClient {
  if (process.env.ENV == 'local') {
    var ddbClient = new DynamoDBClient({
      region: 'ap-northeast-3',
      endpoint: 'http://localstack:4566',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
    });
  } else {
    var ddbClient = new DynamoDBClient({});
  }

  return DynamoDBDocumentClient.from(ddbClient);
}

async function findMissingObjects(s3Client: S3Client, uris: string[]): Promise<string[]> {
  const missing: string[] = [];
  await Promise.all(
    uris.map(async (uri) => {
      const { bucket, key } = parseS3Uri(uri);
      const exists = await ensureObjectExists(s3Client, bucket, key);
      if (!exists) missing.push(uri);
    }),
  );
  return missing;
}

async function handleMissingPrerequisites(args: {
  sqsClient: SQSClient;
  queueUrl: string;
  record: SQSRecord;
  message: ReducePromptTaskMessage;
  missingSources: string[];
}) {
  const { sqsClient, queueUrl, record, message, missingSources } = args;
  console.warn('Missing prerequisites for reduce; requeueing', {
    messageId: record.messageId,
    missingSources,
  });
  await requeueWithDelay({
    sqsClient,
    queueUrl,
    record,
    message,
    delaySeconds: message.retryMs_in,
  });
}

async function loadChunkResults(
  s3Client: S3Client,
  uris: string[],
): Promise<ChunkJson[]> {
  return Promise.all(
    uris.map(async (uri) => {
      const { bucket, key } = parseS3Uri(uri);
      return fetchJsonObject<ChunkJson>(s3Client, bucket, key);
    }),
  );
}

function buildReducePrompt(
  message: ReducePromptTaskMessage,
  chunkResults: ChunkJson[],
): string {
  const summaries: string[] = [];
  const participants: string[] = [];

  // Extract middle summaries and participants
  for (const result of chunkResults) {
    if (typeof result.middleSummary === 'string') {
      summaries.push(result.middleSummary);
    }
    const chunkParticipants = Array.isArray(result.participants)
      ? result.participants.filter((p): p is string => typeof p === 'string')
      : [];
    participants.push(...chunkParticipants);
  }

  const meetingInfo = `Meeting: ${message.meeting.nameOfMeeting} (${message.meeting.nameOfHouse}) on ${message.meeting.date}`;
  const expectedChunks = message.chunk_result_urls.length;

  // Compose final prompt lines
  const lines = [
    message.prompt,
    '',
    meetingInfo,
    `Issue ID: ${message.issueID}`,
    `Chunks received: ${chunkResults.length} / ${expectedChunks}`,
    '',
    'Participants:',
    ...(participants.length > 0 ? participants : ['(none provided)']),
    '',
    'Chunk Summaries:',
    ...(summaries.length > 0 ? summaries : ['(none provided)']),
  ];

  return lines.join('\n');
}

function logReadyForLLM({
  record,
  message,
  promptLength,
}: {
  record: SQSRecord;
  message: ReducePromptTaskMessage;
  promptLength: number;
}) {
  console.log('Reduce message ready for LLM processing', {
    messageId: record.messageId,
    issueID: message.issueID,
    retryAttempts: message.retryAttempts,
    promptLength,
  });
}

async function callLLM(llmClient: LlmClient, prompt: string): Promise<string> {
  const result = await llmClient.generate({
    messages: [{ role: 'user', content: prompt }],
  });
  return result.text;
}

// Collects a specific T[] field from all chunks as a flattened, de-duplicated 1D array
function collectArrayFieldTyped<T>(
  results: ChunkJson[],
  field: keyof Pick<ChunkJson, "dialogs" | "terms" | "keywords" | "participants">,
  keySelector?: (item: T) => string | number,
): T[] {
  const flat = results.flatMap((chunk) =>
    Array.isArray((chunk as any)[field]) ? ((chunk as any)[field] as T[]) : [],
  );

  // Default dedupe: stringify-based (robustだが重い)。必要なら keySelector を渡す。
  if (!keySelector) {
    const seen = new Set<string>();
    const deduped: T[] = [];
    for (const item of flat) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }
    return deduped;
  }

  const seen = new Set<string | number>();
  const deduped: T[] = [];
  for (const item of flat) {
    const key = keySelector(item);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }
  return deduped;
}

// Parses LLM JSON safely as Partial<T>
function parseLLMJson<T extends object>(llmText: string): Partial<T> {
  try {
    const parsed = JSON.parse(llmText);
    return (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
      ? (parsed as Partial<T>)
      : {};
  } catch {
    return {};
  }
}

function buildArticle(
  base: Partial<Article>,
  extras: {
    dialogs: Article['dialogs'];
    terms: Article['terms'];
    keywords: Article['keywords'];
    participants: Article['participants'];
  },
  message: ReducePromptTaskMessage,
): Article {
  const nowIso = new Date().toISOString();

  const meeting = message.meeting;

  // Core
  const id = meeting.issueID;
  const title = base.title ?? message.meeting?.nameOfMeeting ?? `Issue ${message.issueID}`;
  const date = meeting.date;
  const month = base.month ?? (typeof date === 'string' ? date.slice(0, 7) : nowIso.slice(0, 7));

  // These fields are required by Article; try to pick from base or message, otherwise throw
  const imageKind = base.imageKind; // must be one of "会議録" | "目次" | "索引" | "附録" | "追録"
  const session = base.session ?? (message as any)?.meeting?.session;
  const nameOfHouse = meeting.nameOfHouse;
  const nameOfMeeting = meeting.nameOfMeeting;
  const categories = base.categories ?? [];
  const description = base.description ?? '';

  // Complex summaries (keep as-is from LLM; you can set safer defaults if必要)
  const summary = base.summary as Article['summary'];
  const soft_summary = base.soft_summary as Article['soft_summary'];
  const middle_summary = (base.middle_summary as Article['middle_summary']) ?? [];

  // Merge arrays: prefer union of base + extras with dedupe
  const dialogs = dedupeByStringify([
    ...((base.dialogs as Article['dialogs']) ?? []),
    ...extras.dialogs,
  ]) as Article['dialogs'];

  const participants = dedupeByStringify([
    ...((base.participants as Article['participants']) ?? []),
    ...extras.participants,
  ]) as Article['participants'];

  const keywords = dedupeByStringify([
    ...((base.keywords as Article['keywords']) ?? []),
    ...extras.keywords,
  ]) as Article['keywords'];

  const terms = dedupeByStringify([
    ...((base.terms as Article['terms']) ?? []),
    ...extras.terms,
  ]) as Article['terms'];

  // Compose final
  const article: Article = {
    id,
    title,
    date,
    month,
    imageKind: imageKind as Article['imageKind'],
    session: session as Article['session'],
    nameOfHouse: nameOfHouse as Article['nameOfHouse'],
    nameOfMeeting: nameOfMeeting as Article['nameOfMeeting'],
    categories,
    description,
    summary,
    soft_summary,
    middle_summary,
    dialogs,
    participants,
    keywords,
    terms,
  };

  return article;
}

function dedupeByStringify<T>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

// Persists the final object to DynamoDB
async function persistArticle(
  doc: DynamoDBDocumentClient,
  tableName: string,
  item: Article,
) {
  await storeData(
    {
      doc,
      table_name: tableName,
    },
    item,
  );
}
