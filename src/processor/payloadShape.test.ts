import { flattenSectionedPayload } from "./payloadShape";

/*
 * leaves a flat payload alone
 * [Contract] A payload with a top-level summary, or without a reduce section that has one, is returned as is with flattened=false.
 * [Reason] Only the sectioned shape needs lifting; everything else goes to the existing checks unchanged.
 *
 * lifts the reduce section of a sectioned answer
 * [Contract] { prompt_version, id, mode, chunk, reduce } becomes reduce's fields plus prompt_version and id; mode, chunk and reduce are dropped. With takeChunkLists, dialogs/terms/keywords/middle_summary missing from reduce come from chunk; without it, none do.
 * [Reason] A single_chunk task has no other source for its dialogs; a reduce task gets them from the saved chunk results and must not take Claude's copy.
 * [Accident] Without this, the sectioned answer of 2026-11-21 on stage failed with "Reduced payload is missing summary" three times and stopped the batch.
 */

const summary = { based_on_orders: [1], summary: "## 決定事項\n- 了承" };
const reduce = { title: "見出し", summary, soft_language_summary: summary, participants: [] };
const chunk = {
  middle_summary: [summary],
  summary,
  dialogs: [{ order: 1 }],
  terms: [{ term: "t", definition: "d" }],
  keywords: [{ keyword: "k", priority: "high" }],
};
const sectioned = { prompt_version: "6.2", id: "task-1", mode: "single_chunk", chunk, reduce };

describe("flattenSectionedPayload", () => {
  it("leaves a flat payload alone", () => {
    const flat = { id: "task-1", ...reduce };
    expect(flattenSectionedPayload(flat, { takeChunkLists: true })).toEqual({ record: flat, flattened: false });

    const noSummary = { id: "task-1", reduce: { title: "見出し" } };
    expect(flattenSectionedPayload(noSummary, { takeChunkLists: true })).toEqual({ record: noSummary, flattened: false });
  });

  it("lifts the reduce section of a sectioned answer", () => {
    expect(flattenSectionedPayload(sectioned, { takeChunkLists: false })).toEqual({
      record: { prompt_version: "6.2", id: "task-1", ...reduce },
      flattened: true,
    });

    expect(flattenSectionedPayload(sectioned, { takeChunkLists: true })).toEqual({
      record: {
        prompt_version: "6.2",
        id: "task-1",
        dialogs: chunk.dialogs,
        terms: chunk.terms,
        keywords: chunk.keywords,
        middle_summary: chunk.middle_summary,
        ...reduce,
      },
      flattened: true,
    });
  });
});
