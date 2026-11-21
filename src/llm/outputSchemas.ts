/**
 * JSON schemas for the recap outputs, sent to Claude as structured outputs
 * (output_config.format) so that each call can only return the shape its caller parses.
 *
 * They mirror output_format_chunk, output_format_reduce and output_format_single_chunk in
 * prompts/prompts.ts, and the {"dialogs":[...]} answer of the missing-dialog recovery prompt.
 * Without them Claude once answered a reduce request in a sectioned single_chunk shape
 * ({ mode, chunk, reduce }), and the article could not be saved.
 *
 * Structured outputs need additionalProperties: false on every object, support no length or
 * numeric limits, and allow at most 24 optional properties per request. Every property is
 * therefore required, except dialogs[].qa, which the prompt asks for only when a question is
 * answered.
 */

export type JsonSchema = Record<string, unknown>;

function strictObject(properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    additionalProperties: false,
  };
}

const text: JsonSchema = { type: "string" };
const integer: JsonSchema = { type: "integer" };
const orders: JsonSchema = { type: "array", items: integer };
const arrayOf = (items: JsonSchema): JsonSchema => ({ type: "array", items });
const nonEmptyArrayOf = (items: JsonSchema): JsonSchema => ({ type: "array", items, minItems: 1 });

/** The fixed section titles instruction_common allows for dialogs[].summary_sections[].title. */
export const SECTION_TITLES = ["主張", "説明", "質問", "回答", "根拠", "影響", "次の対応", "決定"];
/** The reactions instruction_common allows for dialogs[].reaction. */
export const REACTIONS = ["賛成", "反対", "質問", "回答", "中立"];

const summaryBlock = strictObject({ based_on_orders: orders, summary: text });

const section = strictObject({
  title: { type: "string", enum: SECTION_TITLES },
  bullets: nonEmptyArrayOf(strictObject({ point: text, quote: text, detail: text })),
});

const qa = strictObject({
  ask: strictObject({ question: text, who: text, orders }),
  answer: text,
  answer_orders: orders,
});

const reaction: JsonSchema = { type: "string", enum: REACTIONS };

const dialog = strictObject(
  { order: integer, summary_sections: nonEmptyArrayOf(section), reaction, qa: arrayOf(qa) },
  ["qa"],
);

const participant = strictObject({ name: text, position: text, summary: text });
const term = strictObject({ term: text, definition: text });
const keyword = strictObject({ keyword: text, priority: { type: "string", enum: ["high", "medium", "low"] } });

const header = { prompt_version: text, id: text };
const meetingFields = {
  title: text,
  category: text,
  description: text,
  date: text,
  key_points: arrayOf(text),
};
const chunkLists = {
  dialogs: arrayOf(dialog),
  participants: arrayOf(participant),
  terms: arrayOf(term),
  keywords: arrayOf(keyword),
};

export const CHUNK_OUTPUT_SCHEMA = strictObject({
  ...header,
  middle_summary: arrayOf(summaryBlock),
  soft_language_summary: summaryBlock,
  summary: summaryBlock,
  ...chunkLists,
});

export const REDUCE_OUTPUT_SCHEMA = strictObject({
  ...header,
  ...meetingFields,
  summary: summaryBlock,
  soft_language_summary: summaryBlock,
  participants: arrayOf(strictObject({ name: text, position: text, summary: text, based_on_orders: orders })),
});

export const SINGLE_CHUNK_OUTPUT_SCHEMA = strictObject({
  ...header,
  ...meetingFields,
  middle_summary: arrayOf(summaryBlock),
  soft_language_summary: summaryBlock,
  summary: summaryBlock,
  ...chunkLists,
});

export const DIALOG_RECOVERY_OUTPUT_SCHEMA = strictObject({
  dialogs: arrayOf(strictObject({ order: integer, summary_sections: nonEmptyArrayOf(section), reaction })),
});
