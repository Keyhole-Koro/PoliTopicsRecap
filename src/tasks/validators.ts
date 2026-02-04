import type { ChunkItem, ChunkStatus, ProcessingMode, TaskItem, TaskStatus } from "./types";

const TASK_STATUSES: TaskStatus[] = ["ingested", "pending", "remake", "completed"];
const CHUNK_STATUSES: ChunkStatus[] = ["pending", "completed"];
const PROCESSING_MODES: ProcessingMode[] = ["single_chunk", "chunked"];

export function asTaskItem(raw: unknown): TaskItem | null {
  const issues: { path: string; message: string }[] = [];
  const pushIssue = (path: string, message: string) => issues.push({ path, message });

  if (!isRecord(raw)) {
    pushIssue("root", "expected object");
  } else {
    const record = normalizeTask(raw);
    if (!isString(record.pk)) pushIssue("pk", "expected string");
    if (!isTaskStatus(record.status)) pushIssue("status", `unexpected value: ${String(record.status)}`);
    const status = record.status as TaskStatus | undefined;
    if (record.processingMode !== undefined && !isProcessingMode(record.processingMode)) {
      pushIssue("processingMode", `unexpected value: ${String(record.processingMode)}`);
    }
    if (record.retryAttempts !== undefined && !isFiniteNumber(record.retryAttempts)) {
      pushIssue("retryAttempts", "expected finite number");
    }
    if (record.maxInputToken !== undefined && !isFiniteNumber(record.maxInputToken)) {
      pushIssue("maxInputToken", "expected finite number");
    }
    if (!isIsoDateString(record.createdAt)) pushIssue("createdAt", "expected ISO date string");
    if (!isIsoDateString(record.updatedAt)) pushIssue("updatedAt", "expected ISO date string");
    if (status === "ingested") {
      if (!isString(record.raw_url) || !record.raw_url.startsWith("s3://")) {
        pushIssue("raw_url", "expected s3:// URL string");
      }
      if (record.raw_hash !== undefined && !isString(record.raw_hash)) {
        pushIssue("raw_hash", "expected string");
      }
      if (record.prompt_url !== undefined && (!isString(record.prompt_url) || !record.prompt_url.startsWith("s3://"))) {
        pushIssue("prompt_url", "expected s3:// URL string");
      }
      if (record.result_url !== undefined && (!isString(record.result_url) || !record.result_url.startsWith("s3://"))) {
        pushIssue("result_url", "expected s3:// URL string");
      }
    } else {
      if (!isString(record.llm)) pushIssue("llm", "expected string");
      if (!isString(record.llmModel)) pushIssue("llmModel", "expected string");
      if (!isProcessingMode(record.processingMode)) {
        pushIssue("processingMode", `unexpected value: ${String(record.processingMode)}`);
      }
      if (!isString(record.prompt_url) || !record.prompt_url.startsWith("s3://")) {
        pushIssue("prompt_url", "expected s3:// URL string");
      }
      if (!isString(record.result_url) || !record.result_url.startsWith("s3://")) {
        pushIssue("result_url", "expected s3:// URL string");
      }
      if (record.raw_url !== undefined && (!isString(record.raw_url) || !record.raw_url.startsWith("s3://"))) {
        pushIssue("raw_url", "expected s3:// URL string");
      }
      if (record.raw_hash !== undefined && !isString(record.raw_hash)) {
        pushIssue("raw_hash", "expected string");
      }
    }

    validateAttachedAssets(record.attachedAssets, pushIssue);
    validateMeeting(record.meeting, pushIssue);

    if (record.processingMode === "chunked") {
      if (!Array.isArray(record.chunks) || record.chunks.length === 0) {
        pushIssue("chunks", "expected non-empty array for chunked mode");
      } else {
        for (let i = 0; i < record.chunks.length; i += 1) {
          validateChunkItem(record.chunks[i], i, pushIssue);
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
  if (value.based_on_orders !== undefined) {
    if (!Array.isArray(value.based_on_orders) || value.based_on_orders.some((o: unknown) => !isFiniteNumber(o))) {
      push(`${basePath}.based_on_orders`, "expected number[]");
    }
  }
  if (!isChunkStatus(value.status)) {
    push(`${basePath}.status`, `unexpected value: ${String(value.status)}`);
  }
}

function isChunkStatus(value: unknown): value is ChunkStatus {
  return typeof value === "string" && CHUNK_STATUSES.includes(value as ChunkStatus);
}

function normalizeTask(value: Record<string, any>): Record<string, any> {
  if (!Array.isArray(value.chunks)) {
    return value;
  }
  const chunks = value.chunks.map((chunk: any) => {
    const status = normalizeChunkStatus(chunk?.status);
    if (status === chunk?.status) {
      return chunk;
    }
    return { ...chunk, status };
  });
  return { ...value, chunks };
}

function normalizeChunkStatus(status: unknown): ChunkStatus | unknown {
  if (status === "notReady") return "pending";
  if (status === "ready") return "completed";
  return status;
}
