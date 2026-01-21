import { S3Client } from "@aws-sdk/client-s3";
import type { TaskItem } from "../tasks/types";
import type Article from "../dynamoDB/article";
import { fetchObjectText, parseS3Uri } from "@utils/s3";

export type SpeakerMeta = {
  speaker: string;
  originalText: string;
  speakerYomi?: string | null;
  speakerGroup?: string | null;
  speakerPosition?: string | null;
};

export type SpeakerMap = Map<number, SpeakerMeta>;

type PromptSpeech = {
  speechOrder: number;
  speaker: string;
  speech: string;
  speakerYomi?: string | null;
  speakerGroup?: string | null;
  speakerPosition?: string | null;
};

type PromptPayload = { speeches?: PromptSpeech[] };

type AttachedAssetsSpeech = {
  order: number;
  speaker: string;
  originalText: string;
  speech?: string;
  speakerYomi?: string | null;
  speakerGroup?: string | null;
  speakerPosition?: string | null;
  speechOrder?: number;
};

type AttachedAssetsPayload = { speeches?: AttachedAssetsSpeech[] };

function recordError(errors: string[] | undefined, message: string): void {
  if (errors) {
    errors.push(message);
    return;
  }
  throw new Error(message);
}

function throwValidationErrors(errors: string[]): void {
  if (errors.length === 0) return;
  throw new Error(errors.join("; "));
}

export function assertAttachedAssets(task: TaskItem, errors?: string[]): void {
  if (!task.attachedAssets || typeof task.attachedAssets.speakerMetadataUrl !== "string") {
    recordError(errors, `Task ${task.pk} missing attachedAssets.speakerMetadataUrl`);
  }
}

export function assertNonEmptySpeakerMap(map: SpeakerMap, label: string, errors?: string[]): void {
  if (!(map instanceof Map) || map.size === 0) {
    recordError(errors, `Missing speaker metadata for ${label} flow`);
  }
}

function ensureString(value: unknown, label: string): string;
function ensureString(value: unknown, label: string, errors: string[]): string | null;
function ensureString(value: unknown, label: string, errors?: string[]): string | null {
  if (typeof value !== "string" || value.length === 0) {
    recordError(errors, `${label} is required`);
    return null;
  }
  return value;
}

function ensureOrder(value: unknown, label: string): number;
function ensureOrder(value: unknown, label: string, errors: string[]): number | null;
function ensureOrder(value: unknown, label: string, errors?: string[]): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    recordError(errors, `${label} is required`);
    return null;
  }
  return num;
}

export function extractSpeakerMapFromPrompt(promptText: string): SpeakerMap {
  const map: SpeakerMap = new Map();
  let payload: PromptPayload | null = null;
  try {
    payload = JSON.parse(promptText) as PromptPayload;
  } catch (error) {
    console.warn("[speakerMetadata] Failed to parse prompt JSON for speakers", { error });
    return map;
  }

  if (!payload?.speeches || !Array.isArray(payload.speeches)) {
    throw new Error("Prompt speeches must be an array");
  }

  const errors: string[] = [];
  payload.speeches.forEach((speech, index) => {
    const order = ensureOrder(speech?.speechOrder, `prompt speech[${index}].speechOrder`, errors);
    const speaker = ensureString(speech?.speaker, `prompt speech[${index}].speaker`, errors);
    const originalText = ensureString(speech?.speech, `prompt speech[${index}].speech`, errors);

    if (order === null || speaker === null || originalText === null) {
      return;
    }

    map.set(order, {
      speaker,
      originalText,
      speakerYomi: speech.speakerYomi ?? null,
      speakerGroup: speech.speakerGroup ?? null,
      speakerPosition: speech.speakerPosition ?? null,
    });
  });
  throwValidationErrors(errors);
  return map;
}

export function extractSpeakerMapFromAttachedAssetsPayload(payloadText: string): SpeakerMap {
  const map: SpeakerMap = new Map();
  let payload: AttachedAssetsPayload | null = null;
  try {
    payload = JSON.parse(payloadText) as AttachedAssetsPayload;
  } catch (error) {
    console.warn("[speakerMetadata] Failed to parse attached assets JSON for speakers", { error });
    return map;
  }

  if (!payload?.speeches || !Array.isArray(payload.speeches)) {
    throw new Error("Attached assets speeches must be an array");
  }

  const errors: string[] = [];
  payload.speeches.forEach((speech, index) => {
    const order = ensureOrder(speech?.order ?? speech?.speechOrder, `attached speech[${index}].order`, errors);
    const speaker = ensureString(speech?.speaker, `attached speech[${index}].speaker`, errors);
    const originalText = ensureString(
      speech?.originalText ?? speech?.speech,
      `attached speech[${index}].originalText`,
      errors,
    );

    if (order === null || speaker === null || originalText === null) {
      return;
    }

    map.set(order, {
      speaker,
      originalText,
      speakerYomi: speech.speakerYomi ?? null,
      speakerGroup: speech.speakerGroup ?? null,
      speakerPosition: speech.speakerPosition ?? null,
    });
  });
  throwValidationErrors(errors);
  return map;
}

export async function loadSpeakerMapFromAttachedAssets(
  s3Client: S3Client,
  url?: string,
): Promise<SpeakerMap> {
  if (!url) return new Map();
  try {
    const payloadText = await readS3Text(s3Client, url);
    return extractSpeakerMapFromAttachedAssetsPayload(payloadText);
  } catch (error) {
    console.warn("[speakerMetadata] Failed to read attached assets from S3", { url, error });
    return new Map();
  }
}

export function attachSpeakerMetadata(dialogs: Article["dialogs"], speakerMap: SpeakerMap): Article["dialogs"] {
  if (!Array.isArray(dialogs)) {
    throw new Error("Dialogs must be an array");
  }
  const errors: string[] = [];
  assertNonEmptySpeakerMap(speakerMap, "dialogs", errors);

  dialogs.forEach((dialog) => {
    const hasValidOrder = typeof dialog.order === "number" && Number.isFinite(dialog.order);
    if (!hasValidOrder) {
      errors.push("Each dialog must include a numeric order");
    }
    if (typeof dialog.summary !== "string") {
      errors.push("Each dialog must include a summary");
    }

    if (!hasValidOrder) {
      return;
    }

    const meta = speakerMap.get(dialog.order);
    if (!meta) {
      errors.push(`Missing speaker metadata for dialog order ${dialog.order}`);
      return;
    }

    const speaker = meta.speaker ?? dialog.speaker;
    const originalText = meta.originalText ?? dialog.original_text ?? dialog.summary;

    if (typeof speaker !== "string" || speaker.length === 0) {
      errors.push(`Speaker is required for dialog order ${dialog.order}`);
    }
    if (typeof originalText !== "string" || originalText.length === 0) {
      errors.push(`original_text is required for dialog order ${dialog.order}`);
    }
  });

  throwValidationErrors(errors);

  return dialogs.map((dialog) => {
    const meta = speakerMap.get(dialog.order);
    if (!meta) {
      throw new Error(`Missing speaker metadata for dialog order ${dialog.order}`);
    }

    const speaker = meta.speaker ?? dialog.speaker;
    const originalText = meta.originalText ?? dialog.original_text ?? dialog.summary;

    if (typeof speaker !== "string" || speaker.length === 0) {
      throw new Error(`Speaker is required for dialog order ${dialog.order}`);
    }
    if (typeof originalText !== "string" || originalText.length === 0) {
      throw new Error(`original_text is required for dialog order ${dialog.order}`);
    }

    return {
      ...dialog,
      speaker,
      original_text: originalText,
      speakerYomi: meta.speakerYomi ?? undefined,
      speakerGroup: meta.speakerGroup ?? undefined,
      speakerPosition: meta.speakerPosition ?? undefined,
      position: dialog.position ?? meta.speakerPosition ?? dialog.position,
    };
  });
}

async function readS3Text(client: S3Client, uri: string): Promise<string> {
  const { bucket, key } = parseS3Uri(uri);
  return fetchObjectText(client, bucket, key);
}