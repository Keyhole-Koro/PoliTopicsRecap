import { DISCORD_COLORS, sendNotification, type DiscordField } from "@keyhole-koro/politopics-notification";
import { appConfig } from "../config";
import type Article from "../dynamoDB/article";
import type { TaskItem } from "../tasks/types";

function baseFields(task?: TaskItem): DiscordField[] {
  const fields: DiscordField[] = [];
  if (task) {
    fields.push(
      { name: "Task ID", value: task.pk, inline: true },
      { name: "Mode", value: task.processingMode, inline: true },
      { name: "LLM", value: `${task.llm}/${task.llmModel}`, inline: true },
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
  if (error instanceof Error) {
    const base = `${error.name}: ${error.message}`;
    return error.stack ? `${base}\n${error.stack}`.slice(0, 900) : base.slice(0, 900);
  }
  return String(error).slice(0, 900);
}

export async function notifyTaskError(task: TaskItem | null, error: unknown): Promise<void> {
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

export async function notifyArticlePersistenceSkipped(task: TaskItem, reason: string): Promise<void> {
  const fields = baseFields(task);
  fields.push({ name: "Reason", value: reason.slice(0, 900) });

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
