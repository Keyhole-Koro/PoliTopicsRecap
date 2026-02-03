import type { RawSpeechRecord } from "../types/rawMeeting";
import type { Meeting } from "../tasks/types";

type ChunkResultInput = {
  id?: string;
  text: string;
};

const trimOrEmpty = (value?: string | null): string => (typeof value === "string" ? value.trim() : "");

export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

export function formatSpeechLine(speech: RawSpeechRecord): string | null {
  const order = Number(speech.speechOrder);
  if (!Number.isFinite(order)) return null;

  const speechText = trimOrEmpty(speech.speech);
  if (!speechText) return null;
  const speaker = trimOrEmpty(speech.speaker);
  const speakerPosition = trimOrEmpty(speech.speakerPosition ?? undefined);
  const speakerGroup = trimOrEmpty(speech.speakerGroup ?? undefined);

  const speakerParts = [speaker, speakerPosition, speakerGroup].filter(Boolean);
  const speakerLabel = speakerParts.join(" / ");
  const prefix = speakerLabel ? `${speakerLabel}: ` : "";
  const body = `${prefix}${speechText}`.trim();
  return `[order ${order}] ${body}`;
}

export function buildSpeechInput(args: {
  speeches: RawSpeechRecord[];
  meeting?: Meeting;
  issueID?: string;
  contextBefore?: RawSpeechRecord[];
  contextAfter?: RawSpeechRecord[];
}): string {
  const lines: string[] = [];
  lines.push(...buildMeetingHeaderLines(args.meeting));

  const hasContextBefore = Array.isArray(args.contextBefore) && args.contextBefore.length > 0;
  const hasContextAfter = Array.isArray(args.contextAfter) && args.contextAfter.length > 0;
  const includeChunkLabel = hasContextBefore || hasContextAfter;

  const appendSpeechSection = (label: string | null, speeches: RawSpeechRecord[]): boolean => {
    const sectionLines = speeches
      .map((speech) => formatSpeechLine(speech))
      .filter((line): line is string => Boolean(line));
    if (sectionLines.length === 0) return false;
    if (lines.length > 0) lines.push("");
    if (label) lines.push(label);
    lines.push(...sectionLines);
    return true;
  };

  if (hasContextBefore) {
    appendSpeechSection("[context before]", args.contextBefore ?? []);
  }

  appendSpeechSection(includeChunkLabel ? "[chunk]" : null, args.speeches);

  if (hasContextAfter) {
    appendSpeechSection("[context after]", args.contextAfter ?? []);
  }

  const metaLines = buildMetaBlockLines(args.issueID ?? args.meeting?.issueID);
  if (metaLines.length > 0) {
    lines.push("");
    lines.push(...metaLines);
  }

  return lines.join("\n").trim();
}

export function buildReduceInput(args: {
  chunkResults: ChunkResultInput[];
  meeting?: Meeting;
  issueID?: string;
}): string {
  const lines: string[] = [];
  lines.push(...buildMeetingHeaderLines(args.meeting));

  if (lines.length > 0) {
    lines.push("");
  }

  args.chunkResults.forEach((chunk, index) => {
    const label = chunk.id ? chunk.id : `chunk-${index + 1}`;
    lines.push(`[chunk ${label}]`);
    lines.push(stripCodeFence(chunk.text));
    lines.push("");
  });

  const metaLines = buildMetaBlockLines(args.issueID ?? args.meeting?.issueID);
  if (metaLines.length > 0) {
    lines.push(...metaLines);
  }

  return lines.join("\n").trim();
}

function buildMeetingHeaderLines(meeting?: Meeting): string[] {
  if (!meeting) return [];

  const lines: string[] = [];
  const meetingName = trimOrEmpty(meeting.nameOfMeeting) || trimOrEmpty(meeting.issueID);
  if (meetingName) lines.push(`会議名: ${meetingName}`);

  const house = trimOrEmpty(meeting.nameOfHouse);
  if (house) lines.push(`院: ${house}`);

  const date = trimOrEmpty(meeting.date);
  if (date) lines.push(`開催日: ${date}`);

  return lines;
}

function buildMetaBlockLines(issueID?: string): string[] {
  const normalizedId = trimOrEmpty(issueID);
  if (!normalizedId) return [];
  return [
    "[meta]",
    `議事録ID: ${normalizedId}`,
    "上記IDを必ずそのまま\"id\"として出力すること。",
  ];
}
