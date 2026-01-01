import type { TaskItem } from "./types";

export function assertTaskReadyForProcessing(task: TaskItem): void {
  const issues: string[] = [];
  const requireString = (value: unknown, label: string) => {
    if (typeof value !== "string" || value.length === 0) {
      issues.push(`${label} is required`);
    }
  };
  const requireNumber = (value: unknown, label: string) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(`${label} must be a finite number`);
    }
  };
  const requireS3Url = (value: unknown, label: string) => {
    if (typeof value !== "string" || !value.startsWith("s3://")) {
      issues.push(`${label} must be an s3:// URL`);
    }
  };
  const requireAttachedAssets = (value: unknown) => {
    if (typeof value !== "object" || value === null) {
      issues.push("attachedAssets is required");
      return;
    }
    const url = (value as any).speakerMetadataUrl;
    requireS3Url(url, "attachedAssets.speakerMetadataUrl");
  };

  requireString(task.pk, "pk");
  requireString(task.llm, "llm");
  requireString(task.llmModel, "llmModel");
  requireS3Url(task.prompt_url, "prompt_url");
  requireS3Url(task.result_url, "result_url");
  requireAttachedAssets(task.attachedAssets);

  if (!task.meeting) {
    issues.push("meeting is required");
  } else {
    requireString(task.meeting.issueID, "meeting.issueID");
    requireString(task.meeting.nameOfMeeting, "meeting.nameOfMeeting");
    requireString(task.meeting.nameOfHouse, "meeting.nameOfHouse");
    requireString(task.meeting.date, "meeting.date");
    requireNumber(task.meeting.numberOfSpeeches, "meeting.numberOfSpeeches");
    requireNumber(task.meeting.session, "meeting.session");
  }

  if (task.processingMode === "chunked") {
    if (!Array.isArray(task.chunks) || task.chunks.length === 0) {
      issues.push("chunks must be a non-empty array for chunked tasks");
    } else {
      task.chunks.forEach((chunk, index) => {
        requireString(chunk.id, `chunks[${index}].id`);
        requireS3Url(chunk.prompt_url, `chunks[${index}].prompt_url`);
        requireS3Url(chunk.result_url, `chunks[${index}].result_url`);
      });
    }
  }

  if (issues.length > 0) {
    console.error("[handler] task validation failed", { taskId: task.pk, issues });
    const detail = issues.join("; ");
    throw new Error(detail ? `Task ${task.pk} missing required data: ${detail}` : `Task ${task.pk} missing required data`);
  }
}
