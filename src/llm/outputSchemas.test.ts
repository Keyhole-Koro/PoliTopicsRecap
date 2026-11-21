import {
  CHUNK_OUTPUT_SCHEMA,
  DIALOG_RECOVERY_OUTPUT_SCHEMA,
  REDUCE_OUTPUT_SCHEMA,
  SINGLE_CHUNK_OUTPUT_SCHEMA,
  type JsonSchema,
} from "./outputSchemas";

/*
 * every object is closed and requires only keys it defines
 * [Contract] Each object node has additionalProperties: false, and required lists only keys of its properties.
 * [Reason] Structured outputs reject an object schema without additionalProperties: false.
 * [Accident] Without this, one loose object makes every Claude call of that step fail with a 400.
 *
 * uses only keywords structured outputs accept, within their limits
 * [Contract] Nodes use only type/properties/required/additionalProperties/items/minItems(0 or 1)/enum; no unions; at most 24 optional properties per schema.
 * [Reason] Length and numeric limits, oneOf and larger minItems are unsupported, and the API allows 24 optional properties and 16 unions per request.
 * [Accident] Without this, a schema edit that adds maxLength or optional fields fails only in production.
 *
 * accepts the flat answers and rejects the sectioned one
 * [Contract] A flat reduce answer and a single_chunk answer (with and without qa) pass; the { mode, chunk, reduce } answer Claude gave on stage fails the reduce schema.
 * [Reason] The schemas exist to rule out that shape.
 * [Odd] A small validator for exactly the keywords above stands in for a JSON Schema library, which the project does not depend on.
 * [History] Stage run of 2026-11-21: a reduce answer came back sectioned and the article could not be saved.
 */

const SCHEMAS: Record<string, JsonSchema> = {
  chunk: CHUNK_OUTPUT_SCHEMA,
  reduce: REDUCE_OUTPUT_SCHEMA,
  single_chunk: SINGLE_CHUNK_OUTPUT_SCHEMA,
  dialog_recovery: DIALOG_RECOVERY_OUTPUT_SCHEMA,
};

const ALLOWED_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "items", "minItems", "enum"]);

function walk(schema: JsonSchema, visit: (node: JsonSchema, path: string) => void, path = "$"): void {
  visit(schema, path);
  const properties = schema.properties as Record<string, JsonSchema> | undefined;
  for (const [key, child] of Object.entries(properties ?? {})) walk(child, visit, `${path}.${key}`);
  if (schema.items) walk(schema.items as JsonSchema, visit, `${path}[]`);
}

function validate(schema: JsonSchema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path}: not an object`];
      const record = value as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
      for (const key of (schema.required ?? []) as string[]) {
        if (!(key in record)) errors.push(`${path}.${key}: missing`);
      }
      for (const [key, child] of Object.entries(record)) {
        if (!(key in properties)) errors.push(`${path}.${key}: not allowed`);
        else errors.push(...validate(properties[key], child, `${path}.${key}`));
      }
      return errors;
    }
    case "array": {
      if (!Array.isArray(value)) return [`${path}: not an array`];
      if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${path}: too few items`);
      value.forEach((item, index) => errors.push(...validate(schema.items as JsonSchema, item, `${path}[${index}]`)));
      return errors;
    }
    case "string":
      if (typeof value !== "string") return [`${path}: not a string`];
      if (schema.enum && !(schema.enum as string[]).includes(value)) return [`${path}: not one of ${String(schema.enum)}`];
      return [];
    case "integer":
      return Number.isInteger(value) ? [] : [`${path}: not an integer`];
    default:
      return [`${path}: unknown type ${String(schema.type)}`];
  }
}

const summaryBlock = { based_on_orders: [1, 2], summary: "## 決定事項\n- 了承した [[orders:1,2]]" };
const dialog = {
  order: 1,
  summary_sections: [{ title: "主張", bullets: [{ point: "予算について", quote: "必要です", detail: "補足" }] }],
  reaction: "賛成",
};
const meeting = {
  prompt_version: "6.3",
  id: "task-1",
  title: "見出し",
  category: "予算",
  description: "説明",
  date: "2026-10-21",
  key_points: ["要点1", "要点2", "要点3"],
};
const flatReduce = {
  ...meeting,
  summary: summaryBlock,
  soft_language_summary: summaryBlock,
  participants: [{ name: "山田", position: "委員長", summary: "進行した", based_on_orders: [1] }],
};
const singleChunk = {
  ...meeting,
  middle_summary: [summaryBlock],
  soft_language_summary: summaryBlock,
  summary: summaryBlock,
  dialogs: [dialog],
  participants: [{ name: "山田", position: "委員長", summary: "進行した" }],
  terms: [{ term: "国政調査", definition: "国会が行う調査" }],
  keywords: [{ keyword: "予算", priority: "high" }],
};

describe("outputSchemas", () => {
  it.each(Object.entries(SCHEMAS))("%s: every object is closed and requires only keys it defines", (_name, schema) => {
    walk(schema, (node, path) => {
      if (node.type !== "object") return;
      expect({ path, additionalProperties: node.additionalProperties }).toEqual({ path, additionalProperties: false });
      const keys = Object.keys((node.properties ?? {}) as object);
      for (const key of (node.required ?? []) as string[]) expect(keys).toContain(key);
    });
  });

  it.each(Object.entries(SCHEMAS))("%s: uses only keywords structured outputs accept, within their limits", (_name, schema) => {
    let optional = 0;
    walk(schema, (node, path) => {
      for (const keyword of Object.keys(node)) expect({ path, keyword, allowed: ALLOWED_KEYWORDS.has(keyword) }).toEqual({ path, keyword, allowed: true });
      expect(Array.isArray(node.type)).toBe(false);
      if (node.minItems !== undefined) expect([0, 1]).toContain(node.minItems);
      if (node.type === "object") {
        const required = new Set((node.required ?? []) as string[]);
        optional += Object.keys((node.properties ?? {}) as object).filter((key) => !required.has(key)).length;
      }
    });
    expect(optional).toBeLessThanOrEqual(24);
  });

  it("accepts the flat answers and rejects the sectioned one", () => {
    expect(validate(REDUCE_OUTPUT_SCHEMA, flatReduce)).toEqual([]);
    expect(validate(SINGLE_CHUNK_OUTPUT_SCHEMA, singleChunk)).toEqual([]);
    const withQa = {
      ...singleChunk,
      dialogs: [{ ...dialog, qa: [{ ask: { question: "方針は？", who: "佐藤", orders: [1] }, answer: "検討する", answer_orders: [2] }] }],
    };
    expect(validate(SINGLE_CHUNK_OUTPUT_SCHEMA, withQa)).toEqual([]);
    expect(validate(DIALOG_RECOVERY_OUTPUT_SCHEMA, { dialogs: [dialog] })).toEqual([]);

    const sectioned = { prompt_version: "6.2", id: "task-1", mode: "single_chunk", chunk: singleChunk, reduce: flatReduce };
    const errors = validate(REDUCE_OUTPUT_SCHEMA, sectioned);
    expect(errors).toEqual(expect.arrayContaining(["$.summary: missing", "$.mode: not allowed", "$.reduce: not allowed"]));
  });
});
