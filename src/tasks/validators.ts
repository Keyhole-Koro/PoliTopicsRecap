import type { ChunkItem, ChunkStatus, ProcessingMode, TaskItem, TaskStatus } from "./types";

const TASK_STATUSES: TaskStatus[] = ["pending", "completed"];
const CHUNK_STATUSES: ChunkStatus[] = ["notReady", "ready"];
const PROCESSING_MODES: ProcessingMode[] = ["single_chunk", "chunked"];

export function asTaskItem(raw: unknown): TaskItem | null {
  const fail = (path: string, message: string): null => {
    console.warn(`[TaskItem] validation failed at ${path}: ${message}`);
    return null;
  };

  if (!isRecord(raw)) return fail("root", "expected object");
  if (!isString(raw.pk)) return fail("pk", "expected string");
  if (!isTaskStatus(raw.status)) return fail("status", `unexpected value: ${String(raw.status)}`);
  if (!isProcessingMode(raw.processingMode)) {
    return fail("processingMode", `unexpected value: ${String(raw.processingMode)}`);
  }
  if (!isString(raw.llm)) return fail("llm", "expected string");
  if (!isString(raw.llmModel)) return fail("llmModel", "expected string");
  if (!isFiniteNumber(raw.retryAttempts)) return fail("retryAttempts", "expected finite number");
  if (!isIsoDateString(raw.createdAt)) return fail("createdAt", "expected ISO date string");
  if (!isIsoDateString(raw.updatedAt)) return fail("updatedAt", "expected ISO date string");
  if (!isString(raw.prompt_url) || !raw.prompt_url.startsWith("s3://")) {
    return fail("prompt_url", "expected s3:// URL string");
  }
  if (!isString(raw.result_url) || !raw.result_url.startsWith("s3://")) {
    return fail("result_url", "expected s3:// URL string");
  }

  const meetingError = validateMeeting(raw.meeting);
  if (meetingError) return fail(`meeting.${meetingError.path}`, meetingError.message);

  if (raw.processingMode === "chunked") {
    if (!Array.isArray(raw.chunks) || raw.chunks.length === 0) {
      return fail("chunks", "expected non-empty array for chunked mode");
    }
    for (let i = 0; i < raw.chunks.length; i += 1) {
      const chunkError = validateChunkItem(raw.chunks[i], i);
      if (chunkError) {
        return fail(chunkError.path, chunkError.message);
      }
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

function validateMeeting(value: unknown): { path: string; message: string } | null {
  if (!isRecord(value)) return { path: "", message: "expected object" };
  if (!isString(value.issueID)) return { path: "issueID", message: "expected string" };
  if (!isString(value.nameOfMeeting)) return { path: "nameOfMeeting", message: "expected string" };
  if (!isString(value.nameOfHouse)) return { path: "nameOfHouse", message: "expected string" };
  if (!isString(value.date)) return { path: "date", message: "expected string" };
  if (!isFiniteNumber(value.numberOfSpeeches)) {
    return { path: "numberOfSpeeches", message: "expected finite number" };
  }
  if (!isFiniteNumber(value.session)) return { path: "session", message: "expected finite number" };
  return null;
}

function validateChunkItem(value: unknown, index: number): { path: string; message: string } | null {
  const basePath = `chunks[${index}]`;
  if (!isRecord(value)) return { path: basePath, message: "expected object" };
  if (!isString(value.id)) return { path: `${basePath}.id`, message: "expected string" };
  if (!isString(value.prompt_key)) return { path: `${basePath}.prompt_key`, message: "expected string" };
  if (!isString(value.prompt_url) || !value.prompt_url.startsWith("s3://")) {
    return { path: `${basePath}.prompt_url`, message: "expected s3:// URL string" };
  }
  if (!isString(value.result_url) || !value.result_url.startsWith("s3://")) {
    return { path: `${basePath}.result_url`, message: "expected s3:// URL string" };
  }
  if (!isChunkStatus(value.status)) {
    return { path: `${basePath}.status`, message: `unexpected value: ${String(value.status)}` };
  }
  return null;
}

function isChunkStatus(value: unknown): value is ChunkStatus {
  return typeof value === "string" && CHUNK_STATUSES.includes(value as ChunkStatus);
}
