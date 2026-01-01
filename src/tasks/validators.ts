import type { ChunkItem, ChunkStatus, ProcessingMode, TaskItem, TaskStatus } from "./types";

const TASK_STATUSES: TaskStatus[] = ["pending", "completed"];
const CHUNK_STATUSES: ChunkStatus[] = ["notReady", "ready"];
const PROCESSING_MODES: ProcessingMode[] = ["single_chunk", "chunked"];

export function asTaskItem(raw: unknown): TaskItem | null {
  const issues: { path: string; message: string }[] = [];
  const pushIssue = (path: string, message: string) => issues.push({ path, message });

  if (!isRecord(raw)) {
    pushIssue("root", "expected object");
  } else {
    if (!isString(raw.pk)) pushIssue("pk", "expected string");
    if (!isTaskStatus(raw.status)) pushIssue("status", `unexpected value: ${String(raw.status)}`);
    if (!isProcessingMode(raw.processingMode)) {
      pushIssue("processingMode", `unexpected value: ${String(raw.processingMode)}`);
    }
    if (!isString(raw.llm)) pushIssue("llm", "expected string");
    if (!isString(raw.llmModel)) pushIssue("llmModel", "expected string");
    if (!isFiniteNumber(raw.retryAttempts)) pushIssue("retryAttempts", "expected finite number");
    if (!isIsoDateString(raw.createdAt)) pushIssue("createdAt", "expected ISO date string");
    if (!isIsoDateString(raw.updatedAt)) pushIssue("updatedAt", "expected ISO date string");
    if (!isString(raw.prompt_url) || !raw.prompt_url.startsWith("s3://")) {
      pushIssue("prompt_url", "expected s3:// URL string");
    }
    if (!isString(raw.result_url) || !raw.result_url.startsWith("s3://")) {
      pushIssue("result_url", "expected s3:// URL string");
    }

    validateAttachedAssets(raw.attachedAssets, pushIssue);
    validateMeeting(raw.meeting, pushIssue);

    if (raw.processingMode === "chunked") {
      if (!Array.isArray(raw.chunks) || raw.chunks.length === 0) {
        pushIssue("chunks", "expected non-empty array for chunked mode");
      } else {
        for (let i = 0; i < raw.chunks.length; i += 1) {
          validateChunkItem(raw.chunks[i], i, pushIssue);
        }
      }
    }
  }

  if (issues.length > 0) {
    console.warn("[TaskItem] validation failed", { issues });
    return null;
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

function validateMeeting(value: unknown, push: (path: string, message: string) => void): void {
  if (!isRecord(value)) {
    push("meeting", "expected object");
    return;
  }
  if (!isString(value.issueID)) push("meeting.issueID", "expected string");
  if (!isString(value.nameOfMeeting)) push("meeting.nameOfMeeting", "expected string");
  if (!isString(value.nameOfHouse)) push("meeting.nameOfHouse", "expected string");
  if (!isString(value.date)) push("meeting.date", "expected string");
  if (!isFiniteNumber(value.numberOfSpeeches)) {
    push("meeting.numberOfSpeeches", "expected finite number");
  }
  if (!isFiniteNumber(value.session)) push("meeting.session", "expected finite number");
}

function validateAttachedAssets(value: unknown, push: (path: string, message: string) => void): void {
  if (!isRecord(value)) {
    push("attachedAssets", "expected object");
    return;
  }
  if (!isString(value.speakerMetadataUrl) || !value.speakerMetadataUrl.startsWith("s3://")) {
    push("attachedAssets.speakerMetadataUrl", "expected s3:// URL string");
  }
}

function validateChunkItem(value: unknown, index: number, push: (path: string, message: string) => void): void {
  const basePath = `chunks[${index}]`;
  if (!isRecord(value)) {
    push(basePath, "expected object");
    return;
  }
  if (!isString(value.id)) push(`${basePath}.id`, "expected string");
  if (!isString(value.prompt_key)) push(`${basePath}.prompt_key`, "expected string");
  if (!isString(value.prompt_url) || !value.prompt_url.startsWith("s3://")) {
    push(`${basePath}.prompt_url`, "expected s3:// URL string");
  }
  if (!isString(value.result_url) || !value.result_url.startsWith("s3://")) {
    push(`${basePath}.result_url`, "expected s3:// URL string");
  }
  if (!isChunkStatus(value.status)) {
    push(`${basePath}.status`, `unexpected value: ${String(value.status)}`);
  }
}

function isChunkStatus(value: unknown): value is ChunkStatus {
  return typeof value === "string" && CHUNK_STATUSES.includes(value as ChunkStatus);
}
