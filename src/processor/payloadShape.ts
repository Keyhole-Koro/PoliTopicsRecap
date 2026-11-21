/**
 * Lifts a sectioned answer back to the flat article shape the persistence code reads.
 *
 * Claude once answered a reduce request in the shape the single_chunk line of
 * instruction_common used to describe: { mode, chunk: {...}, reduce: {...} }, with the
 * article fields under `reduce`. Structured outputs (llm/outputSchemas.ts) now rule that out
 * for Claude; this keeps such a payload persistable when it still arrives (from Gemini, or a
 * result saved before the schemas).
 *
 * - The `reduce` section becomes the top level; prompt_version and id stay.
 * - With takeChunkLists, lists only the chunk section has (dialogs, terms, keywords,
 *   middle_summary) are taken from it. A single_chunk task needs them. A reduce task must not
 *   take them: its dialogs come from the saved chunk results, not from a copy Claude wrote.
 */
export type FlattenResult = { record: Record<string, unknown>; flattened: boolean };

const CHUNK_LISTS = ["dialogs", "terms", "keywords", "middle_summary"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function flattenSectionedPayload(
  record: Record<string, unknown>,
  options: { takeChunkLists: boolean },
): FlattenResult {
  if (record.summary !== undefined) return { record, flattened: false };
  const reduce = record.reduce;
  if (!isPlainObject(reduce) || reduce.summary === undefined) return { record, flattened: false };

  const { mode: _mode, chunk, reduce: _reduce, ...rest } = record;
  const fromChunk: Record<string, unknown> = {};
  if (options.takeChunkLists && isPlainObject(chunk)) {
    for (const key of CHUNK_LISTS) {
      if (reduce[key] === undefined && chunk[key] !== undefined) fromChunk[key] = chunk[key];
    }
  }
  return { record: { ...rest, ...fromChunk, ...reduce }, flattened: true };
}
