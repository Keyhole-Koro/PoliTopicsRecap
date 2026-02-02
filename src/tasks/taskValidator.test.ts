import { assertTaskReadyForProcessing } from "./taskValidator";
import type { TaskItem } from "./types";

/*
 * accepts a valid single_chunk task
 * [Contract] Well-formed single_chunk tasks must pass validation.
 * [Reason] Baseline sanity for workers before processing.
 * [Accident] Without this, valid tasks might be rejected unexpectedly.
 * [Odd] Uses attachedAssets with speakerMetadataUrl to mirror real tasks.
 * [History] None.
 *
 * throws when required fields are missing
 * [Contract] Missing prompt_url or meeting must throw.
 * [Reason] Prevents processing incomplete tasks.
 * [Accident] Without this, reducers would crash mid-run.
 * [Odd] prompt_url set empty; meeting undefined.
 * [History] None.
 *
 * throws when chunked task has no chunks
 * [Contract] Chunked tasks require chunk definitions.
 * [Reason] Reduce cannot proceed without chunk outputs.
 * [Accident] Without this, chunked tasks would be impossible to complete.
 * [Odd] processingMode=chunked with chunks=[] triggers the guard.
 * [History] None.
 */

function buildTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    pk: "ISSUE-test",
    status: "pending",
    llm: "gemini",
    llmModel: "gemini-pro",
    retryAttempts: 0,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    processingMode: "single_chunk",
    prompt_version: "2.1",
    prompt_url: "s3://bucket/prompts/reduce/ISSUE-test.json",
    result_url: "s3://bucket/results/ISSUE-test_reduce.json",
    attachedAssets: {
      speakerMetadataUrl: "s3://bucket/attachedAssets/ISSUE-test.json",
    },
    meeting: {
      issueID: "ISSUE-test",
      nameOfMeeting: "Test Meeting",
      nameOfHouse: "Test House",
      date: "2025-01-01",
      numberOfSpeeches: 1,
      session: 1,
    },
    chunks: [],
    ...overrides,
  };
}

describe("assertTaskReadyForProcessing", () => {
  test("accepts a valid single_chunk task", () => {
    expect(() => assertTaskReadyForProcessing(buildTask())).not.toThrow();
  });

  test("throws when required fields are missing", () => {
    const task = buildTask({ prompt_url: "", meeting: undefined });
    expect(() => assertTaskReadyForProcessing(task)).toThrow("missing required data");
  });

  test("throws when chunked task has no chunks", () => {
    const task = buildTask({ processingMode: "chunked", chunks: [] });
    expect(() => assertTaskReadyForProcessing(task)).toThrow("missing required data");
  });
});
