import type { RawSpeechRecord } from "../types/rawMeeting";

export interface OrderLen {
  idx: number;
  speech_id: string;
  len: number;
}

export interface IndexPack {
  indices: number[];
  speech_ids: string[];
  totalLen: number;
  oversized?: boolean;
}

export type CountFn = (text: string) => Promise<number>;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = Array.from({ length: Math.max(1, limit) }, run);
  await Promise.all(runners);
  return results;
}

export async function buildOrderLenByTokens(options: {
  speeches: RawSpeechRecord[];
  countFn: CountFn;
  concurrency?: number;
  buildText?: (speech: RawSpeechRecord) => string;
}): Promise<OrderLen[]> {
  const buildText = options.buildText ?? ((speech) => speech?.speech ?? "");
  const counts = await mapWithConcurrency(
    options.speeches,
    options.concurrency ?? 8,
    (speech) => options.countFn(buildText(speech)),
  );

  return options.speeches.map((speech, idx) => ({
    idx,
    speech_id: speech.speechID,
    len: counts[idx],
  }));
}

export function packIndexSets(orderLenList: OrderLen[], tokenThreshold: number): IndexPack[] {
  if (!Number.isFinite(tokenThreshold) || tokenThreshold <= 0) {
    throw new Error(`tokenThreshold must be a positive number. Received: ${tokenThreshold}`);
  }

  const packs: IndexPack[] = [];
  let current: IndexPack = { indices: [], speech_ids: [], totalLen: 0 };

  const pushCurrent = () => {
    if (current.indices.length) packs.push(current);
    current = { indices: [], speech_ids: [], totalLen: 0 };
  };

  for (const item of orderLenList) {
    const { idx, speech_id, len } = item;

    if (len > tokenThreshold) {
      pushCurrent();
      packs.push({ indices: [idx], speech_ids: [speech_id], totalLen: len, oversized: true });
      continue;
    }

    if (current.totalLen + len > tokenThreshold && current.indices.length > 0) {
      pushCurrent();
    }
    current.indices.push(idx);
    current.speech_ids.push(speech_id);
    current.totalLen += len;
  }
  pushCurrent();
  return packs;
}

export function materializeChunks(packs: IndexPack[], speeches: RawSpeechRecord[]): RawSpeechRecord[][] {
  return packs.map((pack) => pack.indices.map((index) => speeches[index]));
}

export async function packSpeechesByTokenThreshold(options: {
  speeches: RawSpeechRecord[];
  tokenThreshold: number;
  countFn: CountFn;
  concurrency?: number;
  buildText?: (speech: RawSpeechRecord) => string;
}): Promise<{
  orderLens: OrderLen[];
  packs: IndexPack[];
  chunks: RawSpeechRecord[][];
}> {
  const orderLens = await buildOrderLenByTokens({
    speeches: options.speeches,
    countFn: options.countFn,
    concurrency: options.concurrency,
    buildText: options.buildText,
  });

  const packs = packIndexSets(orderLens, options.tokenThreshold);
  const chunks = materializeChunks(packs, options.speeches);
  return { orderLens, packs, chunks };
}
