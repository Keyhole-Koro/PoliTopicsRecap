import type { ChunkItem, ChunkStatus, ProcessingMode, TaskItem, TaskStatus } from "./types";

const TASK_STATUSES: TaskStatus[] = ["pending", "completed"];
const CHUNK_STATUSES: ChunkStatus[] = ["notReady", "ready"];
const PROCESSING_MODES: ProcessingMode[] = ["direct", "chunked"];

export function asTaskItem(raw: unknown): TaskItem | null {
  if (!isRecord(raw)) return null;
  if (!isString(raw.pk)) return null;
  if (!isTaskStatus(raw.status)) return null;
  if (!isProcessingMode(raw.processingMode)) return null;
  if (!isString(raw.llm) || !isString(raw.llmModel)) return null;
  if (!isFiniteNumber(raw.retryAttempts)) return null;
  if (!isIsoDateString(raw.createdAt) || !isIsoDateString(raw.updatedAt)) return null;
  if (!isString(raw.prompt_url) || !raw.prompt_url.startsWith("s3://")) return null;
  if (!isString(raw.result_url) || !raw.result_url.startsWith("s3://")) return null;
  if (!isMeeting(raw.meeting)) return null;

  if (raw.processingMode === "chunked") {
    if (!Array.isArray(raw.chunks) || raw.chunks.length === 0) {
      return null;
    }
    if (!raw.chunks.every(isChunkItem)) {
      return null;
    }
  }

  return raw as TaskItem;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUSES.includes(value as TaskStatus);
}

function isProcessingMode(value: unknown): value is ProcessingMode {
  return typeof value === "string" && PROCESSING_MODES.includes(value as ProcessingMode);
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && value.length >= 10;
}

function isMeeting(value: unknown): value is TaskItem["meeting"] {
  if (!isRecord(value)) return false;
  return (
    isString(value.issueID) &&
    isString(value.nameOfMeeting) &&
    isString(value.nameOfHouse) &&
    isString(value.date) &&
    isFiniteNumber(value.numberOfSpeeches) &&
    isFiniteNumber(value.session)
  );
}

function isChunkItem(value: unknown): value is ChunkItem {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.prompt_key) &&
    isString(value.prompt_url) &&
    value.prompt_url.startsWith("s3://") &&
    isString(value.result_url) &&
    value.result_url.startsWith("s3://") &&
    isChunkStatus(value.status)
  );
}

function isChunkStatus(value: unknown): value is ChunkStatus {
  return typeof value === "string" && CHUNK_STATUSES.includes(value as ChunkStatus);
}
