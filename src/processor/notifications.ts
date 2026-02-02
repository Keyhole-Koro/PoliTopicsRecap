import { DISCORD_COLORS, sendNotification as _sendNotification, type DiscordField } from "@keyhole-koro/politopics-notification";
import { appConfig } from "../config";
import type Article from "../dynamoDB/article";
import type { TaskItem } from "../tasks/types";

const shouldSkipTaskNotification = (task?: TaskItem | null): boolean =>
  Boolean(task && (task.retryAttempts ?? 0) >= 2)
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const sendNotification = async (...args: Parameters<typeof _sendNotification>) => {
  const { enabled, delayMs } = appConfig.notificationSettings;
  if (!enabled) return
  if (delayMs > 0) {
    await delay(delayMs)
  }
  return _sendNotification(...args)
}

function baseFields(task?: TaskItem): DiscordField[] {
  const fields: DiscordField[] = [];
  
  const { logGroupName } = appConfig.notificationSettings;
  if (logGroupName) {
    fields.push({ name: "Log Group", value: logGroupName, inline: false });
  }

  if (task) {
    const modeValue = task.processingMode ?? "n/a";
    const llmParts = [task.llm, task.llmModel].filter(Boolean);
    const llmValue = llmParts.length ? llmParts.join("/") : "n/a";
    fields.push(
      { name: "Task ID", value: task.pk, inline: true },
      { name: "Mode", value: String(modeValue), inline: true },
      { name: "LLM", value: String(llmValue), inline: true },
    );
    if (task.meeting) {
      const meetingLabel = task.meeting.nameOfMeeting || task.meeting.issueID;
      fields.push({ name: "Meeting", value: meetingLabel, inline: false });
    }
  }
  return fields;
}

function formatError(error: unknown): string {
  if (!error) return "Unknown error";
  let text = "";
  if (error instanceof Error) {
    const base = `${error.name}: ${error.message}`;
    text = error.stack ? `${base}\n${error.stack}` : base;
  } else {
    text = String(error);
  }
  
  // Truncate to ~1000 to fit in Discord field (1024 limit) with code block
  return `\`\`\`\n${text.slice(0, 1000)}\n\`\`\``;
}

export async function notifyTaskError(task: TaskItem | null, error: unknown): Promise<void> {
  if (shouldSkipTaskNotification(task)) return
  const fields = baseFields(task ?? undefined);
  fields.push({ name: "Retry attempts", value: String(task?.retryAttempts ?? 0), inline: true });
  fields.push({ name: "Error", value: formatError(error) });

  await sendNotification({
    environment: appConfig.environment,
    webhook: appConfig.notifications.errorWebhook,
    title: "Task processing error",
    content: ":rotating_light: Recap task failed",
    color: DISCORD_COLORS.error,
    fields,
    label: "recap-task-error",
  });
}

export async function notifyTaskWarning(task: TaskItem, message: string): Promise<void> {
  if (shouldSkipTaskNotification(task)) return
  const fields = baseFields(task);
  fields.push({ name: "Retry attempts", value: String(task.retryAttempts ?? 0), inline: true });

  await sendNotification({
    environment: appConfig.environment,
    webhook: appConfig.notifications.warnWebhook,
    fallbackWebhook: appConfig.notifications.errorWebhook,
    title: message,
    content: ":warning: Recap task warning",
    color: DISCORD_COLORS.warn,
    fields,
    label: "recap-task-warning",
  });
}

export async function notifyArticlePersisted(task: TaskItem, article: Article): Promise<void> {
  if (shouldSkipTaskNotification(task)) return
  const fields = baseFields(task);
  fields.push(
    { name: "Article ID", value: article.id, inline: true },
    { name: "Date", value: article.date ?? "unknown", inline: true },
    { name: "House", value: article.nameOfHouse ?? "unknown", inline: true },
    { name: "Meeting", value: article.nameOfMeeting ?? task.meeting?.nameOfMeeting ?? "n/a" },
  );

  await sendNotification({
    environment: appConfig.environment,
    webhook: appConfig.notifications.batchWebhook,
    fallbackWebhook: appConfig.notifications.warnWebhook ?? appConfig.notifications.errorWebhook,
    title: "Article persistence completed",
    content: ":newspaper: Recap article persisted",
    color: DISCORD_COLORS.success,
    fields,
    label: "recap-article-persisted",
  });
}

export async function notifyArticlePersistenceSkipped(
  task: TaskItem,
  reason: string,
  payloadDumpUri?: string,
): Promise<void> {
  if (shouldSkipTaskNotification(task)) return
  const fields = baseFields(task);
  fields.push({ name: "Reason", value: reason.slice(0, 900) });
  if (payloadDumpUri) {
    fields.push({ name: "Payload dump", value: payloadDumpUri, inline: false });
  }

  await sendNotification({
    environment: appConfig.environment,
    webhook: appConfig.notifications.warnWebhook,
    fallbackWebhook: appConfig.notifications.errorWebhook,
    title: "Recap output could not be stored",
    content: ":warning: Article persistence skipped",
    color: DISCORD_COLORS.warn,
    fields,
    label: "recap-article-persistence-skipped",
  });
}

export interface BatchStats {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startTime: number;
}

export async function notifyBatchComplete(
  stats: BatchStats,
  status: "success" | "error",
): Promise<void> {
  const duration = Date.now() - stats.startTime;
  const durationStr = formatDuration(duration);
  
  const fields: DiscordField[] = [
    { name: "Processed", value: String(stats.processed), inline: true },
    { name: "Succeeded", value: String(stats.succeeded), inline: true },
    { name: "Failed", value: String(stats.failed), inline: true },
    { name: "Skipped", value: String(stats.skipped), inline: true },
    { name: "Duration", value: durationStr, inline: true },
  ];

  const { executionEnv } = appConfig.notificationSettings;
  if (executionEnv) {
    fields.push({ name: "Environment", value: executionEnv, inline: true });
  }

  const isError = status === "error";
  const emoji = isError ? ":x:" : ":white_check_mark:";
  const title = isError ? "Batch processing failed" : "Batch processing completed";

  await sendNotification({
    environment: appConfig.environment,
    webhook: isError ? appConfig.notifications.errorWebhook : appConfig.notifications.batchWebhook,
    fallbackWebhook: appConfig.notifications.errorWebhook,
    title,
    content: `${emoji} Recap batch ${status}`,
    color: isError ? DISCORD_COLORS.error : DISCORD_COLORS.success,
    fields,
    label: "recap-batch-complete",
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
